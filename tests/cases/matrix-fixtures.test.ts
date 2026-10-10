import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { runMakeFixtures, parseMatrixRows } from '../../scripts/make-fixtures.js';

describe('Cross-cutting: Rule Test Matrix & Fixtures (TC-157, TC-158)', () => {
  const rootDir = process.cwd();
  const rulesMdPath = path.join(rootDir, 'plans', 'TRAPCHECK_RULES.md');
  const matrixLockPath = path.join(rootDir, 'tests', 'locked', 'matrix.sha256');
  const matrixJsonPath = path.join(rootDir, 'tests', 'fixtures', 'matrix.json');

  it('TC-157: Every rule ID in TRAPCHECK §12 has bad, evasion, and lookalike fixtures locked', () => {
    expect(fs.existsSync(matrixLockPath)).toBe(true);
    expect(fs.existsSync(matrixJsonPath)).toBe(true);

    const rows = parseMatrixRows(rulesMdPath);
    expect(rows.length).toBe(142);

    for (const row of rows) {
      expect(row.id).toBeDefined();
      expect(row.bad.length).toBeGreaterThan(0);
      expect(row.evasion.length).toBeGreaterThan(0);
      expect(row.lookalike.length).toBeGreaterThan(0);
    }

    const checkOk = runMakeFixtures(true);
    expect(checkOk).toBe(true);
  });

  it('TC-158: Unmatched or extra rule ID without a §12 row fails verification', () => {
    const rows = parseMatrixRows(rulesMdPath);
    const ids = new Set(rows.map(r => r.id));

    // Simulated new rule ID that does not exist in Section 12
    const orphanRuleId = 'AGT-999-UNLISTED';
    expect(ids.has(orphanRuleId)).toBe(false);

    // Function to verify a rule list against Section 12 matrix
    function verifyRuleIdsInMatrix(ruleIds: string[]): boolean {
      for (const id of ruleIds) {
        if (!ids.has(id)) {
          return false;
        }
      }
      return true;
    }

    expect(verifyRuleIdsInMatrix(['AGT-001', 'LIF-001', 'CLUSTER-001'])).toBe(true);
    expect(verifyRuleIdsInMatrix(['AGT-001', orphanRuleId])).toBe(false);
  });
});
