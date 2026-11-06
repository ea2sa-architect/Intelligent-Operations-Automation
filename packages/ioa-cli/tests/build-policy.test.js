import { describe, it, expect, vi, afterEach } from 'vitest';
import { promptForField, collectRuleAnswers, assemblePayloads, runBuildPolicy } from '../src/build-mode/build-policy.js';

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

describe('promptForField', () => {
  it('enum/severity fields use a select prompt with the schema options as choices', async () => {
    const select = vi.fn().mockResolvedValue('high');
    const value = await promptForField({ type: 'severity', label: 'Severity', options: ['low', 'high'] }, { select });
    expect(select).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Severity',
      choices: [{ name: 'low', value: 'low' }, { name: 'high', value: 'high' }],
    }));
    expect(value).toBe('high');
  });

  it('multi_enum fields use a checkbox prompt', async () => {
    const checkbox = vi.fn().mockResolvedValue(['pii', 'secrets']);
    const value = await promptForField({ type: 'multi_enum', label: 'Categories', options: ['pii', 'secrets', 'other'] }, { checkbox });
    expect(checkbox).toHaveBeenCalled();
    expect(value).toEqual(['pii', 'secrets']);
  });

  it('json_array fields prompt for a comma-separated string and split it', async () => {
    const input = vi.fn().mockResolvedValue('foo, bar ,, baz');
    const value = await promptForField({ type: 'json_array', label: 'Blocked IDs' }, { input });
    expect(value).toEqual(['foo', 'bar', 'baz']);
  });

  it('string fields (and unknown types) fall back to a plain input prompt', async () => {
    const input = vi.fn().mockResolvedValue('hello');
    const value = await promptForField({ type: 'string', label: 'Free text' }, { input });
    expect(value).toBe('hello');
  });
});

describe('collectRuleAnswers', () => {
  it('separates the severity field from config_json', async () => {
    const schema = {
      fields: [
        { name: 'blocked_apps', type: 'json_array', label: 'Blocked apps' },
        { name: 'severity', type: 'severity', label: 'Severity', options: ['low', 'high'] },
      ],
    };
    const prompts = {
      input: vi.fn().mockResolvedValue('dropbox, slack'),
      select: vi.fn().mockResolvedValue('high'),
    };

    const { config_json, severity } = await collectRuleAnswers(schema, prompts);
    expect(config_json).toEqual({ blocked_apps: ['dropbox', 'slack'] });
    expect(severity).toBe('high');
  });
});

describe('assemblePayloads', () => {
  it('is pure — assembles policy/rule payloads without any I/O', () => {
    const payloads = assemblePayloads({
      ruleType: 'zap_execution_governance',
      config_json: { blocked_apps: ['dropbox'] },
      severity: 'medium',
      name: 'My Zap Policy',
      description: 'blocks dropbox zaps',
      enforcementMode: 'warn',
    });

    expect(payloads).toEqual({
      policy: { name: 'My Zap Policy', description: 'blocks dropbox zaps', status: 'active' },
      rule: { rule_type: 'zap_execution_governance', config_json: { blocked_apps: ['dropbox'] }, severity: 'medium', enabled: true },
      enforcementMode: 'warn',
    });
  });
});

describe('runBuildPolicy', () => {
  // Nested exactly like the real GET /rule-schemas response — fields live
  // under schema_json, not on the row itself (caught a real bug: the first
  // draft of runBuildPolicy read schema.fields directly and silently
  // produced an empty config_json against the live server).
  const SCHEMA = {
    type: 'zap_execution_governance',
    display_name: 'Zap Execution Governance',
    description: 'Blocks or warns on Zap executions',
    schema_json: {
      fields: [
        { name: 'blocked_apps', type: 'json_array', label: 'Blocked apps' },
        { name: 'severity', type: 'severity', label: 'Severity', options: ['low', 'high'] },
      ],
    },
  };

  function mockFetchSequence(responses) {
    let i = 0;
    global.fetch = vi.fn(() => Promise.resolve(responses[i++]));
  }

  it('dry-run (default): prints payloads and never calls POST /policies', async () => {
    mockFetchSequence([
      { ok: true, json: () => Promise.resolve([SCHEMA]) },                      // rule-schemas
    ]);
    const prompts = {
      select: vi.fn()
        .mockResolvedValueOnce('zap_execution_governance') // rule type
        .mockResolvedValueOnce('high')                       // severity field
        .mockResolvedValueOnce('observe'),                   // enforcement mode
      input: vi.fn()
        .mockResolvedValueOnce('dropbox')     // blocked_apps
        .mockResolvedValueOnce('My Policy')   // name
        .mockResolvedValueOnce(''),           // description
    };
    const log = vi.fn();

    const result = await runBuildPolicy({ baseUrl: 'https://ioa.example.com', token: 'jwt', apply: false, prompts, log });

    expect(result.applied).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1); // rule-schemas only, no POST
    expect(log).toHaveBeenCalledWith(expect.stringContaining('--dry-run'));
  });

  it('--apply: creates the policy, the rule, and skips the enforcement-mode PATCH when observe (the default)', async () => {
    mockFetchSequence([
      { ok: true, json: () => Promise.resolve([SCHEMA]) },
      { ok: true, json: () => Promise.resolve({ id: 'policy-1', name: 'My Policy' }) },
      { ok: true, json: () => Promise.resolve({ id: 'rule-1' }) },
    ]);
    const prompts = {
      select: vi.fn()
        .mockResolvedValueOnce('zap_execution_governance')
        .mockResolvedValueOnce('high')
        .mockResolvedValueOnce('observe'),
      input: vi.fn()
        .mockResolvedValueOnce('dropbox')
        .mockResolvedValueOnce('My Policy')
        .mockResolvedValueOnce(''),
    };

    const result = await runBuildPolicy({ baseUrl: 'https://ioa.example.com', token: 'jwt', apply: true, prompts, log: vi.fn() });

    expect(result.applied).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(3); // schemas, POST policy, POST rule — no enforcement-mode PATCH
    const [policyUrl, policyOpts] = global.fetch.mock.calls[1];
    expect(policyUrl).toContain('/api/governance/policies');
    expect(JSON.parse(policyOpts.body)).toEqual({ name: 'My Policy', description: '', status: 'active' });
  });

  it('--apply with a non-observe mode also PATCHes enforcement-mode', async () => {
    mockFetchSequence([
      { ok: true, json: () => Promise.resolve([SCHEMA]) },
      { ok: true, json: () => Promise.resolve({ id: 'policy-1', name: 'My Policy' }) },
      { ok: true, json: () => Promise.resolve({ id: 'rule-1' }) },
      { ok: true, json: () => Promise.resolve({ enforcement_mode: 'enforce' }) },
    ]);
    const prompts = {
      select: vi.fn()
        .mockResolvedValueOnce('zap_execution_governance')
        .mockResolvedValueOnce('high')
        .mockResolvedValueOnce('enforce'),
      input: vi.fn()
        .mockResolvedValueOnce('dropbox')
        .mockResolvedValueOnce('My Policy')
        .mockResolvedValueOnce(''),
    };

    await runBuildPolicy({ baseUrl: 'https://ioa.example.com', token: 'jwt', apply: true, prompts, log: vi.fn() });

    expect(global.fetch).toHaveBeenCalledTimes(4);
    const [patchUrl, patchOpts] = global.fetch.mock.calls[3];
    expect(patchUrl).toContain('/enforcement-mode');
    expect(JSON.parse(patchOpts.body)).toEqual({ enforcement_mode: 'enforce' });
  });

  it('throws a clear error when no rule types are seeded', async () => {
    mockFetchSequence([
      { ok: true, json: () => Promise.resolve([]) },
    ]);
    await expect(runBuildPolicy({ baseUrl: 'https://ioa.example.com', token: 'jwt', prompts: {}, log: vi.fn() }))
      .rejects.toThrow(/No rule types available/);
  });
});
