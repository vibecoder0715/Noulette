import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { generateUlid } from '../util/ulid.js';
import { computeCandidateTreeHash } from '../util/candidate-tree.js';
import { signPayload, verifySignature } from '../util/crypto.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';
import { isProtectedFile } from './21-start-fix.js';
import type { DecisionRecord, DecisionAction } from '../schema/decision.schema.js';

export interface RecordDecisionOptions {
  findingId: string;
  candidateId: string;
  candidateTreeHash: string;
  action: DecisionAction;
  attemptId?: string;
  decidedBy?: string;
  acceptedRisk?: {
    reason: string;
    owner: string;
    expiresAt: string;
  };
  findingIsBlocking?: boolean;
}

export interface ApplyResult {
  applied: boolean;
  decisionId: string;
  newTreeHash?: string;
  error?: string;
}

/**
 * Applies a unified diff patch to a directory directly without destroying untouched code.
 */
export function applyPatchToDirectory(targetDir: string, patchText: string): void {
  // Pre-validate all file paths in patch against traversal and protected files (TC-248)
  const fileChunks = patchText.split('--- a/').filter(Boolean);
  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');
    const header = lines[0]; // e.g. "rel/file.ts"
    const relFile = header.split('\t')[0].split('\r')[0].trim();
    const normRel = relFile.replace(/\\/g, '/');

    if (
      normRel.includes('../') ||
      normRel.startsWith('/') ||
      normRel.startsWith('\\') ||
      normRel.startsWith('.noulette/') ||
      isProtectedFile(normRel)
    ) {
      throw new Error(`Security Violation: Patch attempts to touch protected or out-of-tree path: ${relFile}`);
    }

    const filePath = path.join(targetDir, relFile);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(targetDir))) {
      throw new Error(`Security Violation: Path traversal outside project directory: ${relFile}`);
    }
  }

  // 1. Try git apply if targetDir has a .git repository and git is available
  if (fs.existsSync(path.join(targetDir, '.git'))) {
    try {
      const { execSync } = require('node:child_process');
      execSync('git apply --whitespace=nowarn -', {
        input: patchText,
        cwd: targetDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return;
    } catch {
      // Fall back to robust pure-TypeScript unified diff splicer
    }
  }

  // 2. Pure-TypeScript unified diff parser
  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');
    const header = lines[0];
    const relFile = header.split('\t')[0].split('\r')[0].trim();
    const filePath = path.join(targetDir, relFile);

    const plusLineIndex = lines.findIndex(l => l.startsWith('+++ b/'));
    if (plusLineIndex === -1) continue;

    const fileExists = fs.existsSync(filePath);
    let currentLines: string[] = fileExists
      ? fs.readFileSync(filePath, 'utf8').split('\n')
      : [];

    // Identify all hunk headers (@@ -start,count +start,count @@)
    const hunkIndices: number[] = [];
    for (let i = plusLineIndex + 1; i < lines.length; i++) {
      if (lines[i].startsWith('@@')) {
        hunkIndices.push(i);
      }
    }

    if (hunkIndices.length === 0) continue;

    let lineOffset = 0;

    for (let h = 0; h < hunkIndices.length; h++) {
      const hunkHeaderIndex = hunkIndices[h];
      const nextHunkIndex = h + 1 < hunkIndices.length ? hunkIndices[h + 1] : lines.length;
      const hunkHeader = lines[hunkHeaderIndex];
      const match = hunkHeader.match(/@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!match) continue;

      const origStart = parseInt(match[1], 10);
      const origCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;

      const hunkBody = lines.slice(hunkHeaderIndex + 1, nextHunkIndex);
      const newHunkContent: string[] = [];

      for (const hl of hunkBody) {
        if (hl.startsWith('+')) {
          newHunkContent.push(hl.slice(1).replace(/\r$/, ''));
        } else if (hl.startsWith(' ')) {
          newHunkContent.push(hl.slice(1).replace(/\r$/, ''));
        }
      }

      if (!fileExists) {
        currentLines = newHunkContent;
      } else {
        const targetIndex = Math.max(0, origStart - 1 + lineOffset);
        currentLines.splice(targetIndex, origCount, ...newHunkContent);
        lineOffset += (newHunkContent.length - origCount);
      }
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, currentLines.join('\n'), 'utf8');
  }
}

/**
 * Step 24 — You Decide:
 * Records human decision (approve, accept-risk, reject) with Ed25519 cryptographic signing.
 */
export function recordDecision(
  projectPath: string,
  options: RecordDecisionOptions
): DecisionRecord {
  const normProject = path.resolve(projectPath);
  const decisionId = `dec_${generateUlid()}`;
  const now = new Date();

  const {
    findingId,
    candidateId,
    candidateTreeHash,
    action,
    attemptId,
    decidedBy = 'developer',
    acceptedRisk,
    findingIsBlocking = false
  } = options;

  let patchHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  let patchContent: string | null = null;

  if (action === 'approve') {
    if (!attemptId) {
      throw new Error('Approval requires an attemptId with a verified referee verdict');
    }

    const verdictPath = path.join(normProject, '.noulette', 'attempts', attemptId, 'referee-verdict.json');
    if (!fs.existsSync(verdictPath)) {
      throw new Error(`Referee verdict missing for attempt ${attemptId}`);
    }

    const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
    if (!verdict.passed || !verdict.verifiedPatchHash) {
      throw new Error('Cannot approve an attempt that did not pass referee verification');
    }

    patchHash = verdict.verifiedPatchHash;
    patchContent = verdict.patch;
  } else if (action === 'accept-risk') {
    // TC-110 & TC-130: Hard stops (blocking: true) CANNOT be risk-accepted!
    if (findingIsBlocking) {
      throw new Error('Cannot accept risk: finding is a policy hard stop (blocking: true)');
    }

    // TC-130: Short reason (< 10 chars) is rejected
    if (!acceptedRisk || !acceptedRisk.reason || acceptedRisk.reason.trim().length < 10) {
      throw new Error('Risk acceptance reason must be at least 10 characters');
    }

    if (!acceptedRisk.owner || acceptedRisk.owner.trim() === '') {
      throw new Error('Risk acceptance requires an owner name');
    }

    // Enforce max 90 days expiry and reject past/invalid dates (TC-268)
    const chosenExpiry = new Date(acceptedRisk.expiresAt);
    if (isNaN(chosenExpiry.getTime()) || chosenExpiry.getTime() <= now.getTime()) {
      throw new Error('Risk acceptance expiry cannot be in the past or invalid');
    }
    const maxExpiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (chosenExpiry.getTime() > maxExpiry.getTime()) {
      throw new Error('Risk acceptance expiry cannot exceed 90 days');
    }
  } else if (action === 'reject') {
    // TC-156: Reject discards attempt
    if (attemptId) {
      const attemptDir = path.join(normProject, '.noulette', 'attempts', attemptId);
      const attemptRecordPath = path.join(attemptDir, 'attempt.json');
      if (fs.existsSync(attemptRecordPath)) {
        try {
          const rec = JSON.parse(fs.readFileSync(attemptRecordPath, 'utf8'));
          rec.status = 'discarded';
          atomicWriteJsonSync(attemptRecordPath, rec);
        } catch {}
      }
    }
  }

  // Default expiry: 30 days for approvals, or acceptedRisk.expiresAt
  const expiresAt = acceptedRisk
    ? acceptedRisk.expiresAt
    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const unsignedRecord: Omit<DecisionRecord, 'signature'> = {
    schemaVersion: 1,
    decisionId: decisionId as any,
    findingId: findingId as any,
    candidateId: candidateId as any,
    candidateTreeHash: candidateTreeHash as any,
    action,
    patchHash: patchHash as any,
    acceptedRisk: acceptedRisk || null,
    decidedBy,
    decidedAt: now.toISOString(),
    expiresAt
  };

  const signature = signPayload(unsignedRecord);
  const decisionRecord: DecisionRecord = {
    ...unsignedRecord,
    signature: signature as any
  };

  const decisionsDir = path.join(normProject, '.noulette', 'decisions');
  if (!fs.existsSync(decisionsDir)) {
    fs.mkdirSync(decisionsDir, { recursive: true });
  }

  const decisionPath = path.join(decisionsDir, `${decisionId}.json`);
  atomicWriteJsonSync(decisionPath, decisionRecord);

  // If approved, store patch file alongside decision for apply-time check
  if (patchContent) {
    fs.writeFileSync(path.join(decisionsDir, `${decisionId}.patch`), patchContent, 'utf8');
  }

  return decisionRecord;
}

/**
 * Checks if risk acceptance has expired (TC-130).
 */
export function isRiskExpired(decision: DecisionRecord): boolean {
  if (decision.action !== 'accept-risk') return false;
  const now = new Date();
  const ends = new Date(decision.expiresAt);
  return now.getTime() > ends.getTime();
}

/**
 * Applies approved fix to the project working tree.
 * Enforces signature validity (TC-129) and tree hash consistency (TC-116).
 */
export function applyApprovedFix(projectPath: string, decisionId: string): ApplyResult {
  const normProject = path.resolve(projectPath);
  const decisionPath = path.join(normProject, '.noulette', 'decisions', `${decisionId}.json`);

  if (!fs.existsSync(decisionPath)) {
    return { applied: false, decisionId, error: `Decision record not found: ${decisionId}` };
  }

  const decision: DecisionRecord = JSON.parse(fs.readFileSync(decisionPath, 'utf8'));

  // TC-129: Verify cryptographic signature
  const validSig = verifySignature(decision, decision.signature);
  if (!validSig) {
    return { applied: false, decisionId, error: 'Signature verification failed: forged or tampered decision' };
  }

  if (decision.action !== 'approve') {
    return { applied: false, decisionId, error: `Decision action is ${decision.action}, not approve` };
  }

  // TC-116: Verify current main tree hash matches candidateTreeHash
  const currentMainTreeHash = computeCandidateTreeHash(normProject);
  if (currentMainTreeHash !== decision.candidateTreeHash) {
    return {
      applied: false,
      decisionId,
      error: `Main working tree has diverged (expected ${decision.candidateTreeHash}, current ${currentMainTreeHash})`
    };
  }

  // Read patch file
  const patchPath = path.join(normProject, '.noulette', 'decisions', `${decisionId}.patch`);
  if (!fs.existsSync(patchPath)) {
    return { applied: false, decisionId, error: 'Patch file missing from decision directory' };
  }

  const patchContent = fs.readFileSync(patchPath, 'utf8');
  const computedPatchHash = `sha256:${crypto.createHash('sha256').update(patchContent, 'utf8').digest('hex')}`;

  if (computedPatchHash !== decision.patchHash) {
    return { applied: false, decisionId, error: 'Patch content hash mismatch against signed decision' };
  }

  // Apply patch
  applyPatchToDirectory(normProject, patchContent);

  const newTreeHash = computeCandidateTreeHash(normProject);
  return {
    applied: true,
    decisionId,
    newTreeHash
  };
}
