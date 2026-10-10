import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startFix } from '../../packages/engine/src/steps/21-start-fix.js';
import { verifyFix } from '../../packages/engine/src/steps/22-referee.js';
import { executeFixAttempt } from '../../packages/engine/src/steps/23-retry-loop.js';
import { recordDecision, applyApprovedFix } from '../../packages/engine/src/steps/24-decision.js';
import { computeCandidateTreeHash } from '../../packages/engine/src/util/candidate-tree.js';

describe('Fix Loop & Referee (TC-115..128, TC-156)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-fix-loop-test-'));
    // Setup initial project
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'index.js'), 'export function add(a, b) { return a + b; }\n');
    fs.writeFileSync(path.join(tempDir, 'tests', 'index.test.js'), 'import { test, expect } from "bun:test"; test("adds", () => { expect(1+1).toBe(2); });\n');
    fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET_API_KEY=supersecret123\n');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('TC-115: noulette_start_fix creates spare copy; main tree hash unchanged; .env redacted', () => {
    const initialTreeHash = computeCandidateTreeHash(tempDir);
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);

    expect(attempt.attemptId).toBeDefined();
    expect(fs.existsSync(attempt.workDir)).toBe(true);

    // Main tree hash must remain identical
    const currentMainTreeHash = computeCandidateTreeHash(tempDir);
    expect(currentMainTreeHash).toBe(initialTreeHash);
    expect(attempt.baselineTreeHash).toBe(initialTreeHash);

    // Verify .env is redacted in work copy
    const workEnvPath = path.join(attempt.workDir, '.env');
    expect(fs.existsSync(workEnvPath)).toBe(true);
    const workEnv = fs.readFileSync(workEnvPath, 'utf8');
    expect(workEnv).not.toContain('supersecret123');
    expect(workEnv).toContain('REDACTED');
  });

  it('TC-116: Agent modifies main tree during attempt -> apply_approved refuses diverged tree (main-modified)', () => {
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);

    // Agent fixes issue in work copy
    fs.writeFileSync(path.join(attempt.workDir, 'src', 'index.js'), 'export function add(a, b) { return (a + b) | 0; }\n');

    // BUT agent maliciously or accidentally modifies the main tree
    fs.writeFileSync(path.join(tempDir, 'src', 'index.js'), 'console.log("tampered main tree");\n');

    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some(r => r.includes('main-modified'))).toBe(true);
  });

  it('TC-117: Correct fix resolving issue without side effects -> Referee returns PASS', () => {
    // Introduce an eval vulnerability in main repo
    fs.writeFileSync(path.join(tempDir, 'src', 'server.js'), 'const cmd = req.body; eval(cmd);\n');
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000002']);

    // Fix in work copy by replacing eval with safe JSON.parse
    fs.writeFileSync(path.join(attempt.workDir, 'src', 'server.js'), 'const cmd = req.body; JSON.parse(cmd);\n');

    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(true);
    expect(verdict.verifiedPatchHash).toBeDefined();
    expect(verdict.patch).toContain('JSON.parse(cmd)');
  });

  it('TC-118: Fix that introduces a new security finding -> Referee returns FAIL with regression reason', () => {
    fs.writeFileSync(path.join(tempDir, 'src', 'server.js'), 'const cmd = req.body; eval(cmd);\n');
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000002']);

    // Fix removes eval, but introduces command injection via child_process.exec
    fs.writeFileSync(path.join(attempt.workDir, 'src', 'server.js'), 'const cp = require("child_process"); cp.exec(req.query.cmd);\n');

    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some(r => r.includes('regression-new-findings'))).toBe(true);
  });

  it('TC-119: Fix that deletes or skips an existing test -> Cheating detector flags test deletion, FAIL', () => {
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);

    // Maliciously deletes the test file
    fs.unlinkSync(path.join(attempt.workDir, 'tests', 'index.test.js'));

    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some(r => r.includes('test file was deleted'))).toBe(true);
  });

  it('TC-120: Fix that adds // nosemgrep or # nosec -> Cheating detector flags comment suppression, FAIL', () => {
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);

    // Adds suppression comment
    fs.appendFileSync(path.join(attempt.workDir, 'src', 'index.js'), '\n// nosemgrep: javascript.lang.security.eval\neval(userInput);\n');

    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some(r => r.includes('suppression comment'))).toBe(true);
  });

  it('TC-121: Fix that edits scanner config or .noulette/ -> Cheating detector flags protected path, FAIL', () => {
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);

    // Edits a protected path
    fs.writeFileSync(path.join(attempt.workDir, '.gitleaks.toml'), '[rules]\n');

    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some(r => r.includes('protected file'))).toBe(true);
  });

  it('TC-122: Fix that widens CORS or security permissions -> Cheating detector flags security relaxation, FAIL', () => {
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);

    // Widens CORS with credentials
    fs.appendFileSync(path.join(attempt.workDir, 'src', 'index.js'), '\nconst cors = require("cors"); app.use(cors({ origin: "*", credentials: true }));\n');

    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some(r => r.includes('permissions or CORS widened'))).toBe(true);
  });

  it('TC-123: Fix that disables a rule file -> Cheating detector flags disabled rule, FAIL', () => {
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);

    // Disables rule in config
    fs.writeFileSync(path.join(attempt.workDir, 'src', 'config.json'), '{"rules": []}\n');

    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some(r => r.includes('rule configuration disabled'))).toBe(true);
  });

  it('TC-124: Fix that breaks the build -> Referee returns FAIL with build reason', () => {
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);

    // Introduce syntax error
    fs.writeFileSync(path.join(attempt.workDir, 'src', 'index.js'), 'function broken( { return ;\n');

    const verdict = verifyFix(tempDir, attempt.attemptId, {
      runBuildCommand: 'node --check src/index.js'
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some(r => r.includes('build-failed'))).toBe(true);
  });

  it('TC-125: Second attempt starts from original candidate in fresh copy', async () => {
    const fId = 'fnd_01J00000000000000000000001';
    // First attempt fails
    const res1 = await executeFixAttempt(tempDir, [fId], (workDir) => {
      fs.writeFileSync(path.join(workDir, 'src', 'dirty.txt'), 'dirty garbage');
    });
    expect(res1.attemptCount).toBe(1);

    // Second attempt should be clean (dirty.txt absent)
    const res2 = await executeFixAttempt(tempDir, [fId], (workDir) => {
      expect(fs.existsSync(path.join(workDir, 'src', 'dirty.txt'))).toBe(false);
    });
    expect(res2.attemptCount).toBe(2);
  });

  it('TC-126: Attempts exceed tier cap -> State transitions to Held back; ordinary approval locked', async () => {
    const fId = 'fnd_01J00000000000000000000001';
    // Low tier has cap = 1 attempt
    const res1 = await executeFixAttempt(tempDir, [fId], () => {}, { tier: 'Low' });
    expect(res1.attemptCount).toBe(1);

    // Second attempt in Low tier exceeds cap
    const res2 = await executeFixAttempt(tempDir, [fId], () => {}, { tier: 'Low' });
    expect(res2.status).toBe('held');
    expect(res2.diagnosis).toContain('Held back');

    const heldFile = path.join(tempDir, '.noulette', 'held-back.json');
    expect(fs.existsSync(heldFile)).toBe(true);
  });

  it('TC-127: Identical failure 3 consecutive times -> Early loop termination with diagnosis', async () => {
    const fId = 'fnd_01J00000000000000000000001';
    // Fail 3 times with same reason: delete test
    for (let i = 0; i < 3; i++) {
      await executeFixAttempt(tempDir, [fId], (workDir) => {
        fs.unlinkSync(path.join(workDir, 'tests', 'index.test.js'));
      }, { tier: 'High' });
    }

    // 4th attempt stops early
    const res4 = await executeFixAttempt(tempDir, [fId], () => {}, { tier: 'High' });
    expect(res4.status).toBe('stopped-early');
    expect(res4.diagnosis).toContain('Identical failure repeated 3 times');
  });

  it('TC-128: Secret key removed from code -> Status transitions to needs-person (user must rotate key)', () => {
    fs.writeFileSync(path.join(tempDir, 'src', 'keys.js'), 'const aws = "AKIA1234567890ABCDEF";\n');
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000003']);

    // Remove key from source
    fs.writeFileSync(path.join(attempt.workDir, 'src', 'keys.js'), 'const aws = process.env.AWS_KEY;\n');

    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(true);
    expect(verdict.status).toBe('needs-person');
  });

  it('TC-156: User clicks Reject on approval card -> Finding remains open; attempt discarded', () => {
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);
    const hash = computeCandidateTreeHash(tempDir);

    const decision = recordDecision(tempDir, {
      findingId: 'fnd_01J00000000000000000000001',
      candidateId: 'cand_01J00000000000000000000001',
      candidateTreeHash: hash,
      action: 'reject',
      attemptId: attempt.attemptId
    });

    expect(decision.action).toBe('reject');
    // Attempt record should be marked discarded
    const attemptRec = JSON.parse(fs.readFileSync(path.join(tempDir, '.noulette', 'attempts', attempt.attemptId, 'attempt.json'), 'utf8'));
    expect(attemptRec.status).toBe('discarded');
  });
});
