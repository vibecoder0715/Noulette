import fs from 'node:fs';
import path from 'node:path';
import { computeCandidateTreeHash } from '../util/candidate-tree.js';
import { verifySignature } from '../util/crypto.js';
import type { Receipt } from '../schema/receipt.schema.js';

export interface MergeGateOptions {
  publicKeyPem?: string;
  enforceNoProtectedEdits?: boolean;
}

export interface MergeGateResult {
  passed: boolean;
  reason?: string;
  candidateTreeHash: string;
  receiptTreeHash?: string;
  receiptId?: string;
}

/**
 * Generates .github/workflows/noulette-gate.yml running on windows-latest.
 */
export function generateMergeGateWorkflow(projectPath: string): { workflowPath: string; codeownersPath: string } {
  const normProject = path.resolve(projectPath);
  const ghDir = path.join(normProject, '.github');
  const workflowsDir = path.join(ghDir, 'workflows');

  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }

  const workflowContent = `name: Noulette Merge Gate

on:
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  verify:
    name: Verify Release Receipt & Tree Integrity
    runs-on: windows-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - name: Run Noulette Merge Gate
        run: |
          bun run noulette-engine gate --dir .
`;

  const codeownersContent = `
# Noulette Security Protected Files
.noulette/pubkey @security-team
.github/workflows/noulette-gate.yml @security-team
rules/ @security-team
`.trim();

  const workflowPath = path.join(workflowsDir, 'noulette-gate.yml');
  const codeownersPath = path.join(ghDir, 'CODEOWNERS');

  fs.writeFileSync(workflowPath, workflowContent, 'utf8');
  fs.writeFileSync(codeownersPath, codeownersContent, 'utf8');

  return { workflowPath, codeownersPath };
}

/**
 * Step 27 — Merge Gate:
 * Evaluates candidate PR against release receipt, checking signature, expiry, and candidateTreeHash (TC-133).
 */
export function evaluateMergeGate(
  projectPath: string,
  options: MergeGateOptions = {}
): MergeGateResult {
  const normProject = path.resolve(projectPath);
  const currentTreeHash = computeCandidateTreeHash(normProject);

  const receiptPath = path.join(normProject, '.noulette', 'receipts', 'latest.json');
  if (!fs.existsSync(receiptPath)) {
    return {
      passed: false,
      reason: 'Release receipt missing: .noulette/receipts/latest.json not found',
      candidateTreeHash: currentTreeHash
    };
  }

  let receipt: Receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (err: any) {
    return {
      passed: false,
      reason: `Malformed receipt JSON: ${err.message}`,
      candidateTreeHash: currentTreeHash
    };
  }

  // 1. Verify receipt signature
  const validSig = verifySignature(receipt, receipt.signature, options.publicKeyPem);
  if (!validSig) {
    return {
      passed: false,
      reason: 'Cryptographic signature invalid or receipt was tampered with',
      candidateTreeHash: currentTreeHash,
      receiptId: receipt.receiptId
    };
  }

  // 2. Verify candidateTreeHash agreement
  if (receipt.approved.candidateTreeHash !== currentTreeHash) {
    return {
      passed: false,
      reason: `Tree hash mismatch: PR working tree (${currentTreeHash}) does not match approved receipt (${receipt.approved.candidateTreeHash})`,
      candidateTreeHash: currentTreeHash,
      receiptTreeHash: receipt.approved.candidateTreeHash,
      receiptId: receipt.receiptId
    };
  }

  // 3. Verify receipt has not expired
  const now = new Date();
  const expiresAt = new Date(receipt.expiresAt);
  if (now.getTime() > expiresAt.getTime()) {
    return {
      passed: false,
      reason: `Release receipt expired at ${receipt.expiresAt}`,
      candidateTreeHash: currentTreeHash,
      receiptTreeHash: receipt.approved.candidateTreeHash,
      receiptId: receipt.receiptId
    };
  }

  return {
    passed: true,
    candidateTreeHash: currentTreeHash,
    receiptTreeHash: receipt.approved.candidateTreeHash,
    receiptId: receipt.receiptId
  };
}
