import { z } from 'zod';

export const FindingSourceSchema = z.enum([
  'trapcheck', 'keys', 'code', 'ingredients', 'ai', 'advisory', 'logic', 'plan'
]);

export const FindingSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^fnd_[0-9A-Z]{26}$/),
  // Delimited collision-immune fingerprint: sha256(ruleId + ":" + path + ":" + occurrenceIndex + ":" + snippet)
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  candidateId: z.string().regex(/^cand_[0-9A-Z]{26}$/),
  source: FindingSourceSchema,
  ruleId: z.string(),
  occurrenceIndex: z.number().int().positive().default(1),
  what: z.string(),
  where: z.object({
    file: z.string(),
    line: z.number().int().nonnegative().nullable()
  }),
  visibility: z.array(z.enum(['pushed', 'shipped', 'local', 'pushed-pending'])),
  urgency: z.enum(['fix-before-launch', 'fix-soon', 'nice-to-fix']),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  confidence: z.enum(['confirmed', 'likely', 'possible-false-alarm']),
  blocking: z.boolean(),
  evidence: z.object({
    snippetHash: z.string(),
    // For secrets: prefix + ":" + hmacSha256(installKey, secretBytes) to prevent rainbow table recovery
    excerpt: z.string().max(200),
    request: z.any().nullable()
  }),
  howToFix: z.string(),
  youMustDo: z.array(z.string()),
  status: z.enum(['open', 'fixed', 'accepted-risk', 'needs-person', 'held']),
  attempts: z.number().int().nonnegative().default(0)
});

export type FindingSource = z.infer<typeof FindingSourceSchema>;
export type Finding = z.infer<typeof FindingSchema>;
