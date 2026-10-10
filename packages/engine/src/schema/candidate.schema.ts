import { z } from 'zod';

export const CandidateSchema = z.object({
  schemaVersion: z.literal(1),
  candidateId: z.string().regex(/^cand_[0-9A-Z]{26}$/),
  commit: z.string().nullable(),
  gitCommitHash: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  // Deterministic LF-normalized content tree hash excluding .noulette/, .git/, vendor/
  candidateTreeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  lockfileHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  rulesHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  configHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  toolVersions: z.object({
    engine: z.string(),
    opengrep: z.string().nullable(),
    gitleaks: z.string().nullable()
  }),
  tier: z.enum(['Low', 'Medium', 'High']),
  frozenAt: z.string().datetime()
});

export type Candidate = z.infer<typeof CandidateSchema>;
