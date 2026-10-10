import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createZipBuffer } from '../../packages/engine/src/trapcheck/zip-extractor.js';
import {
  quarantineArchive,
  quarantineGit,
  deleteQuarantinedCase,
  promoteQuarantinedCase,
  getQuarantineCaseDir
} from '../../packages/engine/src/steps/03-quarantine.js';

describe('Step 3: Isolated Room & Safe Extraction (TC-007..016, TC-160, TC-161)', () => {
  let tempDir: string;
  let oldLocalApp: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-test-quarantine-'));
    oldLocalApp = process.env.NOULETTE_LOCALAPPDATA_DIR;
    process.env.NOULETTE_LOCALAPPDATA_DIR = path.join(tempDir, 'localapp');
    fs.mkdirSync(process.env.NOULETTE_LOCALAPPDATA_DIR, { recursive: true });
  });

  afterEach(() => {
    if (oldLocalApp !== undefined) {
      process.env.NOULETTE_LOCALAPPDATA_DIR = oldLocalApp;
    } else {
      delete process.env.NOULETTE_LOCALAPPDATA_DIR;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('TC-007: Zip with entry ../escape.txt -> ARC-001; REJECT; sentinel outside does not exist', () => {
    const sentinelOutside = path.join(tempDir, 'escape.txt');
    const zip = createZipBuffer([{ name: '../escape.txt', content: 'MALICIOUS_CANARY' }]);

    const res = quarantineArchive(zip, 'case-tc007');
    expect(res.verdict).toBe('reject');
    expect(res.findings.some(f => f.ruleId === 'ARC-001')).toBe(true);
    expect(fs.existsSync(sentinelOutside)).toBe(false);
  });

  it('TC-008: Zip with absolute entry C:\\sentinel\\x.txt -> ARC-001; REJECT; nothing written to C:\\sentinel', () => {
    const zip = createZipBuffer([{ name: 'C:\\sentinel\\x.txt', content: 'CANARY' }]);
    const res = quarantineArchive(zip, 'case-tc008');

    expect(res.verdict).toBe('reject');
    expect(res.findings.some(f => f.ruleId === 'ARC-001')).toBe(true);
    expect(fs.existsSync('C:\\sentinel\\x.txt')).toBe(false);
  });

  it('TC-009: Zip with entries CON.txt and aux -> ARC-005; both renamed and recorded; UNSURE', () => {
    const zip = createZipBuffer([
      { name: 'CON.txt', content: 'hello' },
      { name: 'aux', content: 'world' }
    ]);

    const res = quarantineArchive(zip, 'case-tc009');
    expect(res.verdict).toBe('unsure');
    const arc005 = res.findings.filter(f => f.ruleId === 'ARC-005');
    expect(arc005.length).toBeGreaterThanOrEqual(2);

    const qDir = getQuarantineCaseDir('case-tc009');
    expect(fs.existsSync(path.join(qDir, 'safe_CON.txt'))).toBe(true);
    expect(fs.existsSync(path.join(qDir, 'safe_aux'))).toBe(true);
  });

  it('TC-010: Zip entry named a.js:hidden (stream syntax) -> ARC-005; stripped; UNSURE', () => {
    const zip = createZipBuffer([{ name: 'a.js:hidden', content: 'console.log(1);' }]);
    const res = quarantineArchive(zip, 'case-tc010');

    expect(res.verdict).toBe('unsure');
    expect(res.findings.some(f => f.ruleId === 'ARC-005')).toBe(true);
    const qDir = getQuarantineCaseDir('case-tc010');
    expect(fs.existsSync(path.join(qDir, 'a.js'))).toBe(true);
  });

  it('TC-011: Zip with A.js and a.js -> ARC-006; both kept under unique names; UNSURE', () => {
    const zip = createZipBuffer([
      { name: 'A.js', content: 'const A = 1;' },
      { name: 'a.js', content: 'const a = 2;' }
    ]);
    const res = quarantineArchive(zip, 'case-tc011');

    expect(res.verdict).toBe('unsure');
    expect(res.findings.some(f => f.ruleId === 'ARC-006')).toBe(true);
    const qDir = getQuarantineCaseDir('case-tc011');
    const files = fs.readdirSync(qDir);
    expect(files.length).toBe(2);
  });

  it('TC-012: File tool.exe containing only MZ + padding -> Renamed tool.exe.nlt; PAY-010; UNSURE; restorable on Pass', () => {
    const peData = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(100, 0)]);
    const zip = createZipBuffer([{ name: 'tool.exe', content: peData }]);
    const res = quarantineArchive(zip, 'case-tc012');

    expect(res.verdict).toBe('unsure');
    expect(res.findings.some(f => f.ruleId === 'PAY-010')).toBe(true);

    const qDir = getQuarantineCaseDir('case-tc012');
    expect(fs.existsSync(path.join(qDir, 'tool.exe.nlt'))).toBe(true);
    expect(fs.existsSync(path.join(qDir, 'tool.exe'))).toBe(false);

    // Promote restores extension
    const promoteDest = path.join(tempDir, 'promoted-tc012');
    promoteQuarantinedCase('case-tc012', promoteDest);
    expect(fs.existsSync(path.join(promoteDest, 'tool.exe'))).toBe(true);
  });

  it('TC-013: Zip nested 5 levels deep -> ARC-003; INCONCLUSIVE; UNSURE; stops at depth cap', () => {
    let currentZip = createZipBuffer([{ name: 'inner.txt', content: 'CANARY' }]);
    for (let i = 1; i <= 4; i++) {
      currentZip = createZipBuffer([{ name: `level_${i}.zip`, content: currentZip }]);
    }

    const res = quarantineArchive(currentZip, 'case-tc013', { maxDepth: 3 });
    expect(res.verdict).toBe('unsure');
    expect(res.inconclusive.some(inc => inc.code === 'ARC-003')).toBe(true);
  });

  it('TC-014: 20 MB zeros zip with limit lowered to 10 MB -> stops at limit; INCONCLUSIVE; bytes <= limit', () => {
    // 20 MB zeros buffer
    const largeContent = Buffer.alloc(20 * 1024 * 1024, 0);
    const zip = createZipBuffer([{ name: 'large.dat', content: largeContent }]);

    const limit10Mb = 10 * 1024 * 1024;
    const res = quarantineArchive(zip, 'case-tc014', { maxTotalBytes: limit10Mb });

    expect(res.verdict).toBe('unsure');
    expect(res.inconclusive.some(inc => inc.code === 'ARC-007')).toBe(true);
    expect(res.totalBytesWritten).toBeLessThanOrEqual(limit10Mb);
  });

  it('TC-015: Bare repo whose template hook writes sentinel -> clone via quarantineGit -> sentinel absent', () => {
    const bareDir = path.join(tempDir, 'remote-bare.git');
    const workDir = path.join(tempDir, 'work-tc015');
    const sentinel = path.join(tempDir, 'hook_sentinel.txt');

    fs.mkdirSync(workDir, { recursive: true });
    execSync('git init -b main', { cwd: workDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(workDir, 'README.md'), 'Safe content');
    execSync('git config user.name "Test" && git config user.email "test@example.com"', { cwd: workDir, stdio: 'ignore' });
    execSync('git add . && git commit -m "init"', { cwd: workDir, stdio: 'ignore' });

    // Clone to bare repo
    execSync(`git clone --bare "${workDir}" "${bareDir}"`, { stdio: 'ignore' });

    // Add a malicious post-checkout hook to bare repo that writes sentinel
    const hookPath = path.join(bareDir, 'hooks', 'post-checkout');
    fs.writeFileSync(hookPath, `#!/bin/sh\necho CANARY > "${sentinel.replace(/\\/g, '/')}"\n`);

    const res = quarantineGit(bareDir, 'case-tc015');
    expect(res.filesCount).toBeGreaterThan(0);
    expect(fs.existsSync(sentinel)).toBe(false); // Sentinel absent! Hooks disabled, no checkout performed.
  });

  it('TC-016: Rejected case in quarantine -> Delete removes it with no leftover handles', () => {
    const zip = createZipBuffer([{ name: '../escape.txt', content: 'CANARY' }]);
    quarantineArchive(zip, 'case-tc016');

    const qDir = getQuarantineCaseDir('case-tc016');
    expect(fs.existsSync(qDir)).toBe(true);

    deleteQuarantinedCase('case-tc016');
    expect(fs.existsSync(qDir)).toBe(false);
  });

  it('TC-160 & TC-161: BasicQuarantine behavior identical without admin prompts', () => {
    const zip = createZipBuffer([{ name: 'test.txt', content: 'hello' }]);
    const res = quarantineArchive(zip, 'case-tc160');
    expect(res.verdict).toBe('pass');
    expect(res.filesCount).toBe(1);
  });
});
