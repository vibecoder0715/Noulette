import { z } from 'zod';
import { kvGet, kvSet } from './db.js';

export const INTERVALS = [5, 15, 30, 45, 60, 75, 90, 120] as const;

export const SettingsSchema = z.object({
  effort: z.enum(['standard', 'extra']).default('standard'),
  volume: z.number().int().min(0).max(100).default(70),
  autoApprove: z.boolean().default(false),
  productionAnalysis: z.boolean().default(false),
  intervalMin: z.union(INTERVALS.map((n) => z.literal(n)) as any).default(30),
  inspector: z
    .object({
      posthog: z.object({ enabled: z.boolean().default(false), host: z.string().default('https://us.posthog.com'), projectId: z.string().default('') }).default({ enabled: false, host: 'https://us.posthog.com', projectId: '' }),
      ga4: z.object({ enabled: z.boolean().default(false), propertyId: z.string().default('') }).default({ enabled: false, propertyId: '' })
    })
    .default({ posthog: { enabled: false, host: 'https://us.posthog.com', projectId: '' }, ga4: { enabled: false, propertyId: '' } }),
  ai: z
    .object({
      configText: z.string().max(20000).default(''),
      baseUrl: z.string().default(''),
      model: z.string().default(''),
      temperature: z.number().min(0).max(2).nullable().default(null),
      topP: z.number().min(0).max(1).nullable().default(null)
    })
    .default({ configText: '', baseUrl: '', model: '', temperature: null, topP: null }),
  guard: z.object({ enabled: z.boolean().default(true), extraFolders: z.array(z.string()).default([]) }).default({ enabled: true, extraFolders: [] }),
  remoteMcp: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  startAtLogin: z.boolean().default(false),
  suppressRead: z.boolean().default(false),
  cloud: z.object({ url: z.string().default(''), publicKey: z.string().default('') }).default({ url: '', publicKey: '' })
});

export type Settings = z.infer<typeof SettingsSchema>;

export function getSettings(): Settings {
  const raw = kvGet<unknown>('settings', {});
  const parsed = SettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

/** Deep-merges a partial update, validates, persists. Throws on invalid input. */
export function updateSettings(patch: Record<string, unknown>): Settings {
  const current = getSettings() as Record<string, any>;
  const merged: Record<string, any> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && current[k] && typeof current[k] === 'object') {
      merged[k] = { ...current[k], ...v };
      for (const [k2, v2] of Object.entries(v as Record<string, any>)) {
        if (v2 && typeof v2 === 'object' && !Array.isArray(v2) && current[k]?.[k2] && typeof current[k][k2] === 'object') {
          merged[k][k2] = { ...current[k][k2], ...v2 };
        }
      }
    } else merged[k] = v;
  }
  const next = SettingsSchema.parse(merged);
  kvSet('settings', next);
  return next;
}

/** Loop caps. Auto-approve always uses the Extra caps (hard cap, never unbounded). */
export function effortCaps(s: Settings): { aiPasses: number; fixLoops: number; secondMethod: boolean; fullRescan: boolean } {
  if (s.effort === 'extra') return { aiPasses: 3, fixLoops: 3, secondMethod: true, fullRescan: true };
  if (s.autoApprove) return { aiPasses: 1, fixLoops: 3, secondMethod: false, fullRescan: false };
  return { aiPasses: 1, fixLoops: 2, secondMethod: false, fullRescan: false };
}
