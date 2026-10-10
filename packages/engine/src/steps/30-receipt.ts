import fs from 'node:fs';
import path from 'node:path';
import { generateUlid } from '../util/ulid.js';
import { signPayload, verifySignature } from '../util/crypto.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';
import type { Receipt } from '../schema/receipt.schema.js';

export interface GenerateReceiptInput {
  projectPath: string;
  candidateTreeHash: string;
  commit?: string | null;
  lockfileHash?: string | null;
  sealHash?: string | null;
  target?: 'test' | 'live';
  checksRan?: string[];
  checksNotRun?: string[];
  checksNotCovered?: string[];
  engineVersion?: string;
  opengrepVersion?: string | null;
  gitleaksVersion?: string | null;
  rulesVersion?: string;
  dangerNotesSyncedAt?: string;
  fixedCount?: number;
  openNonBlockingCount?: number;
  acceptedRisks?: { id: string; reason: string; by: string; ends: string }[];
  logicRulesTested?: string[];
  logicProvenCount?: number;
  logicSuspectedCount?: number;
  logicUnansweredAreas?: string[];
  approvedBy?: string;
  ttlDays?: number;
  matchingNewAdvisories?: string[];
}

export type ReceiptStatus = 'valid' | 'Recheck needed' | 'invalid-signature';

/**
 * Step 30 — Approved for This Release:
 * Generates and signs release receipts with Ed25519.
 * Strictly avoids banned claims ("safe", "secure", "clean").
 */
export function generateReleaseReceipt(input: GenerateReceiptInput): Receipt {
  const normProject = path.resolve(input.projectPath);
  const receiptId = `rcpt_${generateUlid()}`;
  const now = new Date();
  const ttlDays = input.ttlDays ?? 30;
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const unsigned: Omit<Receipt, 'signature'> = {
    schemaVersion: 1,
    receiptId: receiptId as any,
    approved: {
      commit: input.commit ?? null,
      candidateTreeHash: input.candidateTreeHash as any,
      lockfileHash: input.lockfileHash ?? null,
      sealHash: input.sealHash ?? null,
      target: input.target ?? 'live'
    },
    checks: {
      ran: input.checksRan ?? ['trapcheck', 'keys', 'code-mistakes', 'ingredients', 'ai-checks', 'appmap'],
      notRun: input.checksNotRun ?? [],
      notCovered: input.checksNotCovered ?? []
    },
    versions: {
      engine: input.engineVersion ?? '0.1.0',
      opengrep: input.opengrepVersion ?? null,
      gitleaks: input.gitleaksVersion ?? null,
      rules: input.rulesVersion ?? '2026.10.09',
      dangerNotesSyncedAt: input.dangerNotesSyncedAt ?? now.toISOString()
    },
    findings: {
      fixed: input.fixedCount ?? 0,
      openNonBlocking: input.openNonBlockingCount ?? 0,
      acceptedRisks: input.acceptedRisks ?? []
    },
    logic: {
      rulesTested: input.logicRulesTested ?? [],
      proven: input.logicProvenCount ?? 0,
      suspected: input.logicSuspectedCount ?? 0,
      unansweredAreas: input.logicUnansweredAreas ?? []
    },
    approvedBy: input.approvedBy ?? 'developer',
    approvedAt: now.toISOString(),
    expiresAt,
    recheckWhen: [
      'new-matching-advisory',
      'tree-hash-modified',
      'accepted-risk-expired',
      'ttl-expired'
    ]
  };

  const signature = signPayload(unsigned);
  const receipt: Receipt = {
    ...unsigned,
    signature: signature as any
  };

  const receiptsDir = path.join(normProject, '.noulette', 'receipts');
  if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
  }

  atomicWriteJsonSync(path.join(receiptsDir, `${receiptId}.json`), receipt);
  atomicWriteJsonSync(path.join(receiptsDir, 'latest.json'), receipt);

  return receipt;
}

/**
 * Checks receipt status: valid, "Recheck needed", or "invalid-signature" (TC-137, TC-138).
 */
export function checkReceiptStatus(
  receipt: Receipt,
  options: {
    currentTime?: Date;
    hasMatchingNewDangerNote?: boolean;
    publicKeyPem?: string;
  } = {}
): ReceiptStatus {
  // TC-138: Check signature validity
  const isValidSig = verifySignature(receipt, receipt.signature, options.publicKeyPem);
  if (!isValidSig) {
    return 'invalid-signature';
  }

  // TC-137: Clock advanced past expiresAt -> "Recheck needed"
  const now = options.currentTime || new Date();
  if (now.getTime() > new Date(receipt.expiresAt).getTime()) {
    return 'Recheck needed';
  }

  // TC-137: Check if any accepted risk expired -> "Recheck needed"
  for (const risk of receipt.findings.acceptedRisks) {
    if (now.getTime() > new Date(risk.ends).getTime()) {
      return 'Recheck needed';
    }
  }

  // TC-137: New matching danger note added -> "Recheck needed"
  if (options.hasMatchingNewDangerNote) {
    return 'Recheck needed';
  }

  return 'valid';
}
