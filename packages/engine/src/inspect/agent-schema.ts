import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { safeJoin } from '../core/paths.js';
import { LABEL_IDS } from './taxonomy.js';
import type { CheckItem } from './checklists.js';

/** Strict schema for findings produced by the host agent (Option A: the agent reasons, Noulette verifies). */
export const AgentFindingSchema = z
  .object({
    checkId: z.string().min(1).max(8),
    label: z.enum(LABEL_IDS),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    title: z.string().min(5).max(120),
    tldr: z.string().min(10).max(220),
    file: z.string().min(1).max(400).nullable(),
    line: z.number().int().min(1).nullable(),
    evidence: z.string().min(3).max(400).nullable(),
    planRef: z.string().max(40).nullable().optional(),
    explanation: z.string().min(20).max(2500),
    scenario: z.array(z.string().min(3).max(400)).max(12).optional(),
    fix: z.string().max(2500).nullable(),
    fixability: z.enum(['code', 'human', 'both']),
    humanAction: z.string().max(600).nullable().optional(),
    confidence: z.enum(['confirmed', 'likely'])
  })
  .strict();

export const SubmissionSchema = z
  .object({
    projectPath: z.string().min(1),
    stage: z.enum(['logic', 'feasibility', 'legal']),
    pass: z.number().int().min(1).max(3),
    coverage: z
      .array(z.object({ id: z.string(), result: z.enum(['ok', 'finding', 'not-applicable']), note: z.string().min(3).max(600) }).strict())
      .min(1),
    findings: z.array(AgentFindingSchema).max(60),
    rejectedMockIds: z.array(z.object({ id: z.string(), reason: z.string().min(20).max(400) }).strict()).max(40).optional()
  })
  .strict();

export type Submission = z.infer<typeof SubmissionSchema>;
export type AgentFinding = z.infer<typeof AgentFindingSchema>;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Rejects anything malformed or unverifiable:
 *  - every checklist item answered;
 *  - every cited file exists inside the repo, the line exists, and the evidence text appears within ±3 lines;
 *  - logic findings must cite code; feasibility/legal may cite PLAN.md instead (planRef);
 *  - feasibility and legal problems always need a human decision.
 */
export function validateSubmission(root: string, raw: unknown, items: CheckItem[]): { ok: true; value: Submission } | { ok: false; errors: string[] } {
  const parsed = SubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 30).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const v = parsed.data;
  const errors: string[] = [];
  const ids = new Set(items.map((i) => i.id));
  const covered = new Set(v.coverage.map((c) => c.id));
  for (const i of items) if (!covered.has(i.id)) errors.push(`coverage: missing result for ${i.id} (${i.check.slice(0, 60)}...)`);
  for (const c of v.coverage) if (!ids.has(c.id)) errors.push(`coverage: unknown check id ${c.id}`);
  for (const c of v.coverage) if (c.result === 'finding' && !v.findings.some((f) => f.checkId === c.id)) errors.push(`coverage ${c.id}: marked "finding" but no finding has checkId ${c.id}`);
  v.findings.forEach((f, idx) => {
    const at = `findings[${idx}]`;
    if (!ids.has(f.checkId)) errors.push(`${at}.checkId: ${f.checkId} is not in this stage's checklist`);
    if (v.stage === 'logic' && (!f.file || !f.line || !f.evidence)) errors.push(`${at}: logic findings must cite file, line and evidence`);
    if (v.stage !== 'logic' && !f.file && !f.planRef) errors.push(`${at}: cite a file+line+evidence or a planRef (PLAN.md question id)`);
    if (v.stage !== 'logic' && f.fixability === 'code') errors.push(`${at}.fixability: ${v.stage} problems need a human decision, use "human" or "both"`);
    if ((f.fixability === 'human' || f.fixability === 'both') && !f.humanAction) errors.push(`${at}.humanAction: required when a human must act`);
    if (f.file) {
      if (path.isAbsolute(f.file) || f.file.includes('\0')) {
        errors.push(`${at}.file: must be a path relative to the repo root`);
        return;
      }
      const abs = safeJoin(root, f.file);
      if (!abs || /(^|[\\/])(\.git|node_modules|\.noulette)([\\/]|$)/.test(f.file)) {
        errors.push(`${at}.file: ${f.file} is outside the repo or in an ignored folder`);
        return;
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        errors.push(`${at}.file: ${f.file} does not exist`);
        return;
      }
      if (f.line === null || f.evidence === null) {
        errors.push(`${at}: when a file is cited, line and evidence are required`);
        return;
      }
      const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
      if (f.line > lines.length) {
        errors.push(`${at}.line: ${f.file} has only ${lines.length} lines`);
        return;
      }
      const win = norm(lines.slice(Math.max(0, f.line - 4), f.line + 3).join(' '));
      if (!win.includes(norm(f.evidence))) errors.push(`${at}.evidence: text not found near ${f.file}:${f.line}. Copy the exact code from that line.`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: v };
}
