import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface TestCaseDefinition {
  id: string;
  section: string;
  fixture: string;
  expected: string;
}

export function parseTestCases(markdownPath: string): TestCaseDefinition[] {
  const content = fs.readFileSync(markdownPath, 'utf8');
  const lines = content.split('\n');
  const cases: TestCaseDefinition[] = [];

  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      currentSection = trimmed.replace(/^##\s+/, '').trim();
    } else if (trimmed.startsWith('| TC-')) {
      const parts = trimmed.split('|').map((p: string) => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        cases.push({
          id: parts[0],
          section: currentSection,
          fixture: parts[1],
          expected: parts[2]
        });
      }
    }
  }

  return cases;
}

export function computeCasesHash(cases: TestCaseDefinition[]): string {
  const hasher = crypto.createHash('sha256');
  for (const tc of cases) {
    hasher.update(`${tc.id}|${tc.section}|${tc.fixture}|${tc.expected}\n`);
  }
  return hasher.digest('hex');
}

export function runLock(checkOnly = false): boolean {
  const rootDir = process.cwd();
  const testCasesMd = path.join(rootDir, 'plans', 'TEST_CASES.md');
  const lockedDir = path.join(rootDir, 'tests', 'locked');
  const lockFile = path.join(lockedDir, 'cases.sha256');
  const jsonLockFile = path.join(lockedDir, 'cases.json');

  if (!fs.existsSync(testCasesMd)) {
    console.error(`Error: TEST_CASES.md not found at ${testCasesMd}`);
    return false;
  }

  const cases = parseTestCases(testCasesMd);

  // TC-163 assertion: Exactly 163 test cases
  if (cases.length !== 163) {
    console.error(`TC-163 FAILED: Expected exactly 163 test cases, but found ${cases.length}`);
    return false;
  }

  const currentHash = computeCasesHash(cases);

  if (checkOnly) {
    if (!fs.existsSync(lockFile)) {
      console.error(`TC-151 FAILED: Lock file missing at ${lockFile}`);
      return false;
    }
    const lockedHash = fs.readFileSync(lockFile, 'utf8').trim();
    if (currentHash !== lockedHash) {
      console.error(`TC-151 FAILED: Hash mismatch!\nLocked:  ${lockedHash}\nCurrent: ${currentHash}`);
      return false;
    }
    console.log(`Lock check passed. 163 test cases verified against ${lockFile}.`);
    return true;
  }

  if (!fs.existsSync(lockedDir)) {
    fs.mkdirSync(lockedDir, { recursive: true });
  }

  fs.writeFileSync(lockFile, currentHash + '\n', 'utf8');
  fs.writeFileSync(jsonLockFile, JSON.stringify(cases, null, 2) + '\n', 'utf8');
  console.log(`Locked 163 test cases with hash ${currentHash}`);
  return true;
}

if ((import.meta as any).main) {
  const checkOnly = process.argv.includes('--check');
  const ok = runLock(checkOnly);
  if (!ok) {
    process.exit(1);
  }
}
