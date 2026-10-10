import { z } from 'zod';

export const ScorecardSchema = z.object({
  schemaVersion: z.literal(1),
  candidateId: z.string(),
  candidateTreeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  tier: z.enum(['Low', 'Medium', 'High']),
  checksRan: z.array(z.string()),
  checksSkipped: z.array(z.object({
    check: z.string(),
    reason: z.string()
  })),
  checksNotCovered: z.array(z.object({
    check: z.string(),
    explanation: z.string()
  })),
  toolVersions: z.record(z.string().nullable()),
  dangerNotesSyncedAt: z.string().datetime().nullable()
});

export type Scorecard = z.infer<typeof ScorecardSchema>;
