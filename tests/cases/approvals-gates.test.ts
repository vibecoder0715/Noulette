import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { recordDecision, applyApprovedFix, isRiskExpired } from '../../packages/engine/src/steps/24-decision.js';
import { startFix } from '../../packages/engine/src/steps/21-start-fix.js';
import { verifyFix } from '../../packages/engine/src/steps/22-referee.js';
import { installSaveGateHooks, uninstallSaveGateHooks, evaluateSaveGate } from '../../packages/engine/src/steps/26-save-gate.js';
import { generateMergeGateWorkflow, evaluateMergeGate } from '../../packages/engine/src/steps/27-merge-gate.js';
import { sealBuildDirectory, verifySeal } from '../../packages/engine/src/steps/28-seal.js';
import { evaluateLaunchGate } from '../../packages/engine/src/steps/29-launch-gate.js';
import { generateReleaseReceipt, checkReceiptStatus } from '../../packages/engine/src/steps/30-receipt.js';
import { computeCandidateTreeHash } from '../../packages/engine/src/util/candidate-tree.js';
import { McpServer } from '../../packages/engine/src/mcp/index.js';

describe('Approvals, Gates, Seal & Release Receipts (TC-129..138)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noulette-gates-test-'));
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'index.js'), 'export const hello = "world";\n');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('TC-129: Approval card created; forged/unsigned approval rejected; no MCP approve tool exists', () => {
    // 1. Verify that MCP server does NOT expose any approval tool (human in the loop requirement)
    const mcp = new McpServer(tempDir);
    const tools = mcp.getToolsList();
    const approveTool = tools.find(t => t.name === 'noulette_approve' || t.name === 'approve');
    expect(approveTool).toBeUndefined();

    // 2. Setup an attempt and referee verdict
    const attempt = startFix(tempDir, ['fnd_01J00000000000000000000001']);
    fs.writeFileSync(path.join(attempt.workDir, 'src', 'index.js'), 'export const hello = "world 2";\n');
    const verdict = verifyFix(tempDir, attempt.attemptId);
    expect(verdict.passed).toBe(true);

    const treeHash = computeCandidateTreeHash(tempDir);

    // 3. Forged decision (handwritten file without valid cryptographic signature)
    const fakeDecisionId = 'dec_01J00000000000000000000099';
    const fakeDecisionPath = path.join(tempDir, '.noulette', 'decisions', `${fakeDecisionId}.json`);
    fs.mkdirSync(path.join(tempDir, '.noulette', 'decisions'), { recursive: true });
    fs.writeFileSync(fakeDecisionPath, JSON.stringify({
      schemaVersion: 1,
      decisionId: fakeDecisionId,
      findingId: 'fnd_01J00000000000000000000001',
      candidateId: 'cand_01J00000000000000000000000',
      candidateTreeHash: treeHash,
      action: 'approve',
      patchHash: verdict.verifiedPatchHash,
      acceptedRisk: null,
      decidedBy: 'script-agent',
      decidedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      signature: 'ed25519:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    }, null, 2));

    // Calling apply on forged decision must fail signature verification
    const forgedResult = applyApprovedFix(tempDir, fakeDecisionId);
    expect(forgedResult.applied).toBe(false);
    expect(forgedResult.error).toContain('Signature verification failed');

    // 4. Valid signed decision via recordDecision
    const validDecision = recordDecision(tempDir, {
      findingId: 'fnd_01J00000000000000000000001',
      candidateId: 'cand_01J00000000000000000000000',
      candidateTreeHash: treeHash,
      action: 'approve',
      attemptId: attempt.attemptId,
      decidedBy: 'lead-dev'
    });

    const validResult = applyApprovedFix(tempDir, validDecision.decisionId);
    expect(validResult.applied).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, 'src', 'index.js'), 'utf8')).toContain('world 2');
  });

  it('TC-130: Accept risk with short reason rejected; valid accepted with max 90-day expiry; expires after date; blocking findings cannot be accepted', () => {
    const treeHash = computeCandidateTreeHash(tempDir);
    const now = new Date();

    // 1. Short reason (< 10 chars) rejected
    expect(() => {
      recordDecision(tempDir, {
        findingId: 'fnd_01J00000000000000000000002',
        candidateId: 'cand_01J00000000000000000000000',
        candidateTreeHash: treeHash,
        action: 'accept-risk',
        acceptedRisk: {
          reason: 'too short', // 9 chars
          owner: 'sec-lead',
          expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString()
        }
      });
    }).toThrow(/at least 10 characters/);

    // 2. Expiry > 90 days rejected
    expect(() => {
      recordDecision(tempDir, {
        findingId: 'fnd_01J00000000000000000000002',
        candidateId: 'cand_01J00000000000000000000000',
        candidateTreeHash: treeHash,
        action: 'accept-risk',
        acceptedRisk: {
          reason: 'Valid justification with sufficient length',
          owner: 'sec-lead',
          expiresAt: new Date(now.getTime() + 95 * 86400000).toISOString() // 95 days
        }
      });
    }).toThrow(/cannot exceed 90 days/);

    // 3. Hard stop (blocking: true) CANNOT be risk accepted
    expect(() => {
      recordDecision(tempDir, {
        findingId: 'fnd_01J00000000000000000000002',
        candidateId: 'cand_01J00000000000000000000000',
        candidateTreeHash: treeHash,
        action: 'accept-risk',
        findingIsBlocking: true,
        acceptedRisk: {
          reason: 'Valid justification with sufficient length',
          owner: 'sec-lead',
          expiresAt: new Date(now.getTime() + 14 * 86400000).toISOString()
        }
      });
    }).toThrow(/policy hard stop/);

    // 4. Valid risk acceptance (length >= 10 chars, <= 90 days)
    const validRisk = recordDecision(tempDir, {
      findingId: 'fnd_01J00000000000000000000002',
      candidateId: 'cand_01J00000000000000000000000',
      candidateTreeHash: treeHash,
      action: 'accept-risk',
      acceptedRisk: {
        reason: 'Temporary exception granted while upstream library updates',
        owner: 'security-team',
        expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString()
      }
    });

    expect(validRisk.action).toBe('accept-risk');
    expect(validRisk.signature).toBeDefined();
    expect(isRiskExpired(validRisk)).toBe(false);

    // 5. Expiry check after time passes
    const pastRisk = {
      ...validRisk,
      expiresAt: new Date(now.getTime() - 1000).toISOString()
    };
    expect(isRiskExpired(pastRisk)).toBe(true);
  });

  it('TC-131: Git repo with hooks installed; staging fake key blocks commit with --no-verify bypass hint', () => {
    // Setup git repo
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });

    // Install save gate hook
    const hookResult = installSaveGateHooks(tempDir);
    expect(hookResult.installed).toBe(true);
    expect(fs.existsSync(hookResult.hookPath)).toBe(true);

    // Stage a live secret key in a file
    fs.writeFileSync(path.join(tempDir, 'src', 'credentials.ts'), 'export const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";\n');
    execSync('git add src/credentials.ts', { cwd: tempDir, stdio: 'ignore' });

    // Evaluate save gate
    const gateCheck = evaluateSaveGate(tempDir);
    expect(gateCheck.allowed).toBe(false);
    expect(gateCheck.reason).toContain('Live secret detected');
    expect(gateCheck.bypassHint).toContain('git commit --no-verify');
  });

  it('TC-132: Uninstall hooks with pre-existing user hook -> Original hook restored intact', () => {
    fs.mkdirSync(path.join(tempDir, '.git', 'hooks'), { recursive: true });
    const preCommitPath = path.join(tempDir, '.git', 'hooks', 'pre-commit');

    // User already had a pre-commit hook
    const originalHook = '#!/bin/sh\necho "Running linter..."\nnpm run lint\n';
    fs.writeFileSync(preCommitPath, originalHook, 'utf8');

    // Install save gate
    installSaveGateHooks(tempDir);
    const hookedContent = fs.readFileSync(preCommitPath, 'utf8');
    expect(hookedContent).toContain('Running linter...');
    expect(hookedContent).toContain('NOULETTE SAVE GATE START');

    // Uninstall save gate
    const uninstallResult = uninstallSaveGateHooks(tempDir);
    expect(uninstallResult.uninstalled).toBe(true);
    expect(uninstallResult.restoredOriginal).toBe(true);

    // Check restored content matches original
    const restoredContent = fs.readFileSync(preCommitPath, 'utf8');
    expect(restoredContent.trim()).toBe(originalHook.trim());
  });

  it('TC-133: Simulated merge gate with valid receipt passes; PR tree mismatch fails; workflow file generated for windows-latest', () => {
    // 1. Generate workflow and CODEOWNERS
    const wf = generateMergeGateWorkflow(tempDir);
    expect(fs.existsSync(wf.workflowPath)).toBe(true);
    expect(fs.existsSync(wf.codeownersPath)).toBe(true);

    const wfContent = fs.readFileSync(wf.workflowPath, 'utf8');
    expect(wfContent).toContain('windows-latest');

    // 2. Generate valid receipt for current tree
    const treeHash = computeCandidateTreeHash(tempDir);
    const receipt = generateReleaseReceipt({
      projectPath: tempDir,
      candidateTreeHash: treeHash,
      target: 'live',
      ttlDays: 14
    });

    expect(receipt.receiptId).toBeDefined();

    // 3. Evaluate merge gate on matching tree -> pass
    const gateResult = evaluateMergeGate(tempDir);
    expect(gateResult.passed).toBe(true);

    // 4. Alter PR tree (e.g. modify src/index.js) -> tree mismatch fail
    fs.appendFileSync(path.join(tempDir, 'src', 'index.js'), '// added line\n');
    const alteredResult = evaluateMergeGate(tempDir);
    expect(alteredResult.passed).toBe(false);
    expect(alteredResult.reason).toContain('Tree hash mismatch');
  });

  it('TC-134: Seal build folder; deterministic hash; 1 byte change detected', () => {
    const buildDir = path.join(tempDir, 'dist');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'bundle.js'), 'console.log("app built");\n');
    fs.writeFileSync(path.join(buildDir, 'style.css'), 'body { margin: 0; }\n');

    // Seal build directory
    const seal = sealBuildDirectory(buildDir, tempDir);
    expect(seal.merkleRoot).toBeDefined();
    expect(seal.filesCount).toBe(2);

    // Verify seal on untouched folder
    const verify1 = verifySeal(buildDir, tempDir);
    expect(verify1.matches).toBe(true);

    // Modify exactly 1 byte in bundle.js
    fs.appendFileSync(path.join(buildDir, 'bundle.js'), ' ');

    // Verify seal detects modification
    const verify2 = verifySeal(buildDir, tempDir);
    expect(verify2.matches).toBe(false);
    expect(verify2.reason).toContain('Merkle root mismatch');
  });

  it('TC-135: Launch gate with matching artifact vs altered artifact', () => {
    const buildDir = path.join(tempDir, 'dist');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'app.exe'), 'BINARY_DATA');

    // Seal and generate receipt
    sealBuildDirectory(buildDir, tempDir);
    const treeHash = computeCandidateTreeHash(tempDir);
    generateReleaseReceipt({
      projectPath: tempDir,
      candidateTreeHash: treeHash,
      target: 'live'
    });

    // 1. Untouched artifacts -> exit 0
    const res1 = evaluateLaunchGate(buildDir, tempDir);
    expect(res1.allowed).toBe(true);
    expect(res1.exitCode).toBe(0);

    // 2. Tampered artifacts -> non-zero exit code
    fs.appendFileSync(path.join(buildDir, 'app.exe'), 'MALICIOUS_BYTE');
    const res2 = evaluateLaunchGate(buildDir, tempDir);
    expect(res2.allowed).toBe(false);
    expect(res2.exitCode).toBe(1);
    expect(res2.sealMatches).toBe(false);
  });

  it('TC-136: Generate a receipt; all schema fields present; text never claims "safe", "secure", or "clean"', () => {
    const treeHash = computeCandidateTreeHash(tempDir);
    const receipt = generateReleaseReceipt({
      projectPath: tempDir,
      candidateTreeHash: treeHash,
      commit: 'a1b2c3d4e5f6',
      checksRan: ['trapcheck', 'keys', 'code-mistakes'],
      checksNotRun: ['roleplay'],
      checksNotCovered: ['untested-routes'],
      ttlDays: 30
    });

    // Verify schema fields
    expect(receipt.schemaVersion).toBe(1);
    expect(receipt.receiptId.startsWith('rcpt_')).toBe(true);
    expect(receipt.approved.candidateTreeHash).toBe(treeHash);
    expect(receipt.checks.notRun).toContain('roleplay');
    expect(receipt.checks.notCovered).toContain('untested-routes');
    expect(receipt.recheckWhen.length).toBeGreaterThan(0);
    expect(receipt.signature.startsWith('ed25519:')).toBe(true);

    // Check banned words across entire serialized receipt
    const serialized = JSON.stringify(receipt).toLowerCase();
    expect(serialized).not.toContain('"safe"');
    expect(serialized).not.toContain('"secure"');
    expect(serialized).not.toContain('"clean"');
  });

  it('TC-137: Advance clock past time limit; add matching danger note -> Status becomes "Recheck needed"', () => {
    const treeHash = computeCandidateTreeHash(tempDir);
    const receipt = generateReleaseReceipt({
      projectPath: tempDir,
      candidateTreeHash: treeHash,
      ttlDays: 7
    });

    // 1. Initially valid
    expect(checkReceiptStatus(receipt)).toBe('valid');

    // 2. Advance clock past 7 days -> "Recheck needed"
    const futureDate = new Date(Date.now() + 8 * 86400000);
    expect(checkReceiptStatus(receipt, { currentTime: futureDate })).toBe('Recheck needed');

    // 3. Matching new danger note / advisory -> "Recheck needed"
    expect(checkReceiptStatus(receipt, { hasMatchingNewDangerNote: true })).toBe('Recheck needed');
  });

  it('TC-138: Edit one field of signed receipt -> Signature invalid; gates fail', () => {
    const buildDir = path.join(tempDir, 'dist');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'app.exe'), 'BINARY');
    sealBuildDirectory(buildDir, tempDir);

    const treeHash = computeCandidateTreeHash(tempDir);
    const receipt = generateReleaseReceipt({
      projectPath: tempDir,
      candidateTreeHash: treeHash
    });

    expect(checkReceiptStatus(receipt)).toBe('valid');

    // Tamper with receipt
    const tamperedReceipt = {
      ...receipt,
      approvedBy: 'attacker'
    };

    // checkReceiptStatus returns invalid-signature
    expect(checkReceiptStatus(tamperedReceipt)).toBe('invalid-signature');

    // Overwrite latest.json with tampered receipt
    const receiptPath = path.join(tempDir, '.noulette', 'receipts', 'latest.json');
    fs.writeFileSync(receiptPath, JSON.stringify(tamperedReceipt), 'utf8');

    // Merge gate fails
    const mergeResult = evaluateMergeGate(tempDir);
    expect(mergeResult.passed).toBe(false);
    expect(mergeResult.reason).toContain('signature invalid');

    // Launch gate fails
    const launchResult = evaluateLaunchGate(buildDir, tempDir);
    expect(launchResult.allowed).toBe(false);
    expect(launchResult.exitCode).toBe(2);
  });
});
