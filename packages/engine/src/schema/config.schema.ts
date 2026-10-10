import { z } from 'zod';

export const GlobalConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  effortTier: z.enum(['Low', 'Medium', 'High']).default('Medium'),
  autoFix: z.boolean().default(true),
  audio: z.object({
    enabled: z.boolean().default(true),
    volume: z.number().min(0).max(1).default(0.8)
  }).default({ enabled: true, volume: 0.8 }),
  scanners: z.object({
    opengrepPath: z.string().nullable().default(null),
    gitleaksPath: z.string().nullable().default(null)
  }).default({ opengrepPath: null, gitleaksPath: null })
});

export const ProjectEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  registeredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime()
});

export const ProjectsRegistrySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  projects: z.array(ProjectEntrySchema).default([]),
  activeProjectPath: z.string().nullable().default(null)
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;
export type ProjectsRegistry = z.infer<typeof ProjectsRegistrySchema>;
