import { z } from 'zod';

export const DecisionActionSchema = z.enum(['approve', 'accept-risk', 'reject']);

export const AcceptedRiskDetailsSchema = z.object({
  reason: z.string().min(10, 'Risk acceptance reason must be at least 10 characters'),
  owner: z.string().min(1, 'Owner name required'),
  expiresAt: z.string().datetime() // Max 90 days from decision
});

export const DecisionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  decisionId: z.string().regex(/^dec_[0-9A-Z]{26}$/),
  findingId: z.string().regex(/^fnd_[0-9A-Z]{26}$/),
  candidateId: z.string().regex(/^cand_[0-9A-Z]{26}$/),
  candidateTreeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  action: DecisionActionSchema,
  patchHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  acceptedRisk: AcceptedRiskDetailsSchema.nullable(),
  decidedBy: z.string(),
  decidedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  signature: z.string().regex(/^ed25519:[a-f0-9]{128}$/)
});

export type DecisionAction = z.infer<typeof DecisionActionSchema>;
export type AcceptedRiskDetails = z.infer<typeof AcceptedRiskDetailsSchema>;
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
