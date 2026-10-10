import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { parseTestCases, computeCasesHash, runLock } from '../../scripts/lock-tests.js';

describe('Cross-cutting: Test Case Lock & Integrity (TC-151, TC-163)', () => {
  const rootDir = process.cwd();
  const testCasesMd = path.join(rootDir, 'plans', 'TEST_CASES.md');
  const lockFile = path.join(rootDir, 'tests', 'locked', 'cases.sha256');

  it('TC-163: TEST_CASES.md contains exactly 163 test cases', () => {
    expect(fs.existsSync(testCasesMd)).toBe(true);
    const cases = parseTestCases(testCasesMd);
    expect(cases.length).toBe(163);

    // Verify first and last IDs
    expect(cases[0].id).toBe('TC-001');
    expect(cases[cases.length - 1].id).toBe('TC-163');
  });

  it('TC-151: Valid lock check passes against locked cases.sha256', () => {
    expect(fs.existsSync(lockFile)).toBe(true);
    const ok = runLock(true);
    expect(ok).toBe(true);
  });

  it('TC-151: Tampering with any test case definition causes hash mismatch and fails', () => {
    const cases = parseTestCases(testCasesMd);
    const originalHash = computeCasesHash(cases);

    // Tamper with one case
    const tamperedCases = cases.map(c => ({ ...c }));
    tamperedCases[0].expected = 'TAMPERED_EXPECTED_RESULT';

    const tamperedHash = computeCasesHash(tamperedCases);
    expect(tamperedHash).not.toBe(originalHash);

    const lockedHash = fs.readFileSync(lockFile, 'utf8').trim();
    expect(originalHash).toBe(lockedHash);
  });
});
