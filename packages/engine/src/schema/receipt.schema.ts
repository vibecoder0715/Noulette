import { z } from 'zod';

export const ReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  receiptId: z.string().regex(/^rcpt_[0-9A-Z]{26}$/),
  approved: z.object({
    commit: z.string().nullable(),
    candidateTreeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    lockfileHash: z.string().nullable(),
    sealHash: z.string().nullable(),
    target: z.enum(['test', 'live'])
  }),
  checks: z.object({
    ran: z.array(z.string()),
    notRun: z.array(z.string()),
    notCovered: z.array(z.string())
  }),
  versions: z.object({
    engine: z.string(),
    opengrep: z.string().nullable(),
    gitleaks: z.string().nullable(),
    rules: z.string(),
    dangerNotesSyncedAt: z.string().datetime()
  }),
  findings: z.object({
    fixed: z.number().int().nonnegative(),
    openNonBlocking: z.number().int().nonnegative(),
    acceptedRisks: z.array(z.object({
      id: z.string(),
      reason: z.string(),
      by: z.string(),
      ends: z.string().datetime()
    }))
  }),
  logic: z.object({
    rulesTested: z.array(z.string()),
    proven: z.number().int().nonnegative(),
    suspected: z.number().int().nonnegative(),
    unansweredAreas: z.array(z.string())
  }),
  approvedBy: z.string(),
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  recheckWhen: z.array(z.string()),
  signature: z.string().regex(/^ed25519:[a-f0-9]{128}$/)
});

export type Receipt = z.infer<typeof ReceiptSchema>;
