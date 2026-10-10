import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { quickChangeCheck } from '../../packages/engine/src/steps/06-quick-change.js';
import { freezeCandidate } from '../../packages/engine/src/steps/07-freeze.js';

describe('Steps 6 & 7: Quick Change Check & Freeze Candidate (TC-045..052)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-test-quickfreeze-'));
    execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'Initial');
    execSync('git config user.name "Tester" && git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });
  });

  afterEach(() => {
    try {
      fs.rmSync(repoDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('TC-045: Staged diff adds .claude/settings.json with hook -> Blocked, cites AGT-001', () => {
    const claudeDir = path.join(repoDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: { postToolExecution: 'echo CANARY' }
    }));
    execSync('git add .claude/settings.json', { cwd: repoDir, stdio: 'ignore' });

    const res = quickChangeCheck(repoDir);
    expect(res.passed).toBe(false);
    expect(res.held).toBe(true);
    expect(res.reason).toContain('AGT-001');
  });

  it('TC-046: Staged diff changes only README text -> Passes in < 2 seconds', () => {
    const start = Date.now();
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'Updated friendly readme text.');
    execSync('git add README.md', { cwd: repoDir, stdio: 'ignore' });

    const res = quickChangeCheck(repoDir);
    const duration = Date.now() - start;

    expect(res.passed).toBe(true);
    expect(res.held).toBe(false);
    expect(duration).toBeLessThan(2000);
  });

  it('TC-047: Staged diff adds a postinstall script -> Held, cites LIF-001', () => {
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
      scripts: { postinstall: 'node setup.js' }
    }));
    execSync('git add package.json', { cwd: repoDir, stdio: 'ignore' });

    const res = quickChangeCheck(repoDir);
    expect(res.passed).toBe(false);
    expect(res.held).toBe(true);
    expect(res.reason).toContain('LIF-001');
  });

  it('TC-048: Staged diff adds new binary file (inert MZ) -> Held, cites PAY-010', () => {
    const fakeBin = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(50, 0)]);
    fs.writeFileSync(path.join(repoDir, 'tool.exe'), fakeBin);
    execSync('git add tool.exe', { cwd: repoDir, stdio: 'ignore' });

    const res = quickChangeCheck(repoDir);
    expect(res.passed).toBe(false);
    expect(res.held).toBe(true);
    expect(res.reason).toContain('PAY-010');
  });

  it('TC-049: Staged diff exceeds configured limit -> Held with "can\'t tell"', () => {
    const largeText = 'A'.repeat(5000);
    fs.writeFileSync(path.join(repoDir, 'large.txt'), largeText);
    execSync('git add large.txt', { cwd: repoDir, stdio: 'ignore' });

    const res = quickChangeCheck(repoDir, { maxDiffBytes: 1000 });
    expect(res.passed).toBe(false);
    expect(res.held).toBe(true);
    expect(res.reason).toContain("can't tell");
  });

  it('TC-050: Freeze the same tree twice -> Identical treeHash and candidateId', () => {
    const cand1 = freezeCandidate(repoDir);
    const cand2 = freezeCandidate(repoDir);

    expect(cand1.candidateTreeHash).toBe(cand2.candidateTreeHash);
    expect(cand1.candidateId).toBe(cand2.candidateId);
  });

  it('TC-051: Change one byte then freeze -> treeHash differs', () => {
    const cand1 = freezeCandidate(repoDir);

    fs.appendFileSync(path.join(repoDir, 'README.md'), '!');
    const cand2 = freezeCandidate(repoDir);

    expect(cand1.candidateTreeHash).not.toBe(cand2.candidateTreeHash);
    expect(cand1.candidateId).not.toBe(cand2.candidateId);
  });

  it('TC-052: Freeze with gitleaks missing -> Recorded unavailable / null', () => {
    const cand = freezeCandidate(repoDir, { gitleaksPath: null });
    expect(cand.toolVersions.gitleaks).toBeNull();
  });
});
