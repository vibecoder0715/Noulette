import { z } from 'zod';

export const CaseTypeSchema = z.enum(['outside', 'change', 'alert']);

export const CaseRecordSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().regex(/^case-[0-9A-Z]{26}$/),
  type: CaseTypeSchema,
  projectPath: z.string(),
  tier: z.enum(['Low', 'Medium', 'High']),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  routingReason: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type CaseType = z.infer<typeof CaseTypeSchema>;
export type CaseRecord = z.infer<typeof CaseRecordSchema>;
