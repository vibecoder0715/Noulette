import { z } from 'zod';

export const TrapcheckSeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

export const TrapcheckFindingSchema = z.object({
  ruleId: z.string(),
  severity: TrapcheckSeveritySchema,
  file: z.string(),
  line: z.number().int().nonnegative().nullable(),
  snippetHash: z.string(),
  excerpt: z.string().max(200),
  plain: z.string(),
  confidence: z.enum(['confirmed', 'likely', 'possible-false-alarm'])
});

export const TrapcheckInconclusiveSchema = z.object({
  code: z.string(),
  file: z.string(),
  why: z.string()
});

export const TrapcheckLimitsSchema = z.object({
  filesScanned: z.number().int().nonnegative(),
  bytesScanned: z.number().int().nonnegative(),
  partialFiles: z.array(z.string())
});

export const TrapcheckNeutralizedSchema = z.object({
  original: z.string(),
  renamedTo: z.string()
});

export const TrapcheckResultSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string(),
  treeHash: z.string(),
  rulesVersion: z.string(),
  verdict: z.enum(['reject', 'unsure', 'pass']),
  reasons: z.array(z.string()),
  findings: z.array(TrapcheckFindingSchema),
  inconclusive: z.array(TrapcheckInconclusiveSchema),
  limits: TrapcheckLimitsSchema,
  neutralized: z.array(TrapcheckNeutralizedSchema)
});

export type TrapcheckSeverity = z.infer<typeof TrapcheckSeveritySchema>;
export type TrapcheckFinding = z.infer<typeof TrapcheckFindingSchema>;
export type TrapcheckInconclusive = z.infer<typeof TrapcheckInconclusiveSchema>;
export type TrapcheckLimits = z.infer<typeof TrapcheckLimitsSchema>;
export type TrapcheckNeutralized = z.infer<typeof TrapcheckNeutralizedSchema>;
export type TrapcheckResult = z.infer<typeof TrapcheckResultSchema>;
