import { describe, it, expect, vi, beforeEach } from 'vitest';

function mockParsers({ claudeDesktop = () => [], cline = () => [], vscode = () => [], cursor = () => [], windsurf = () => [], docker = () => [] } = {}) {
  vi.doMock('../src/parsers/claude-desktop.js', () => ({ SOURCE: 'claude_desktop', scan: claudeDesktop }));
  vi.doMock('../src/parsers/cline.js', () => ({ SOURCE: 'vscode_cline', scan: cline }));
  vi.doMock('../src/parsers/vscode.js', () => ({ SOURCE: 'vscode', scan: vscode }));
  vi.doMock('../src/parsers/cursor.js', () => ({ SOURCE: 'cursor', scan: cursor }));
  vi.doMock('../src/parsers/windsurf.js', () => ({ SOURCE: 'windsurf', scan: windsurf }));
  vi.doMock('../src/parsers/docker.js', () => ({ SOURCE: 'docker', scan: docker }));
}

describe('runScan', () => {
  beforeEach(() => vi.resetModules());

  it('aggregates results across all registered parsers', async () => {
    mockParsers({
      claudeDesktop: () => [{ name: 's1', source: 'claude_desktop' }],
      cline: () => [{ name: 's2', source: 'vscode_cline' }],
      vscode: () => [{ name: 's3', source: 'vscode' }],
    });
    const { runScan } = await import('../src/scan.js');
    const { discovered, errors } = await runScan();
    expect(discovered).toEqual([
      { name: 's1', source: 'claude_desktop' },
      { name: 's2', source: 'vscode_cline' },
      { name: 's3', source: 'vscode' },
    ]);
    expect(errors).toEqual([]);
  });

  it('collects a parser error without aborting the rest of the scan', async () => {
    mockParsers({
      claudeDesktop: () => { throw new Error('boom'); },
      cline: () => [{ name: 's2', source: 'vscode_cline' }],
    });
    const { runScan } = await import('../src/scan.js');
    const { discovered, errors } = await runScan();
    expect(discovered).toEqual([{ name: 's2', source: 'vscode_cline' }]);
    expect(errors).toEqual([{ source: 'claude_desktop', message: 'boom' }]);
  });

  // EP-306-S8 — docker.js's scan() is async (shells out to the docker CLI),
  // unlike every prior file-based parser. Proves runScan actually awaits a
  // parser's result rather than happening to work only for sync mocks.
  it('awaits an async parser (e.g. docker) before aggregating its results', async () => {
    mockParsers({
      docker: () => Promise.resolve([{ name: 's-docker', source: 'docker' }]),
    });
    const { runScan } = await import('../src/scan.js');
    const { discovered } = await runScan();
    expect(discovered).toContainEqual({ name: 's-docker', source: 'docker' });
  });

  it('collects a rejected-promise error from an async parser without aborting the rest', async () => {
    mockParsers({
      docker: () => Promise.reject(new Error('docker not found')),
      cline: () => [{ name: 's2', source: 'vscode_cline' }],
    });
    const { runScan } = await import('../src/scan.js');
    const { discovered, errors } = await runScan();
    expect(discovered).toEqual([{ name: 's2', source: 'vscode_cline' }]);
    expect(errors).toEqual([{ source: 'docker', message: 'docker not found' }]);
  });
});
