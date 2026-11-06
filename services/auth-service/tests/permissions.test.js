import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { PERMISSIONS } from '../src/lib/permissions.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('policy:import (policy bundles)', () => {
  it('is a canonical permission name', () => {
    expect(PERMISSIONS.POLICY_IMPORT).toBe('policy:import');
    expect(Object.values(PERMISSIONS)).toContain('policy:import');
  });

  it('is granted explicitly by migration 010 to exactly the roles that may edit policies, plus admins', () => {
    const sql = readFileSync(resolve(here, '../../../db/migrations/auth/010_policy_import_permission.sql'), 'utf8');
    const roles = sql.match(/r\.name IN \(([^)]*)\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
    expect(roles.sort()).toEqual(['admin', 'governance-officer', 'platform-admin']);
    // read-only roles must not be able to import
    for (const readOnly of ['auditor', 'business-owner', 'security-reviewer']) expect(roles).not.toContain(readOnly);
  });
});
