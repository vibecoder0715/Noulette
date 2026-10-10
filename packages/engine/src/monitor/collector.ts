import { getDb, kvGet, kvSet } from '../core/db.js';
import { redact } from '../core/redact.js';
import { detect, type EarlyWarning } from './detectors.js';
import { chatJson, aiConfigured } from './llm.js';
import { UNTRUSTED_RULE, untrusted } from '../inspect/prompts.js';
import type { Bucket, Exception, SourceData } from './sources.js';

/**
 * Collector core, shared by the desktop daemon and the cloud worker.
 * fetch -> redact -> store metrics -> deterministic detectors -> (AI only if a detector fired or digest due).
 */
export interface CollectInput {
  key: string;
  from: number;
  to: number;
  fetchers: (() => Promise<SourceData>)[];
  plannedUsers: number | null;
  useAi: boolean;
  forceDigest?: boolean;
}

export interface CollectResult {
  window: { from: number; to: number };
  sources: string[];
  totals: { events: number; errors: number; peakUsers: number | null };
  exceptions: Exception[];
  warnings: EarlyWarning[];
  digest: string | null;
  aiUsed: string | null;
  aiError: string | null;
  errors: string[];
}

function storeBuckets(key: string, source: string, buckets: Bucket[]) {
  const db = getDb();
  const ins = db.query('INSERT OR REPLACE INTO metrics(project, source, name, ts, value) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    for (const b of buckets) {
      ins.run(key, source, 'events', b.ts, b.events);
      ins.run(key, source, 'errors', b.ts, b.errors);
      ins.run(key, source, 'users', b.ts, b.users);
    }
  })();
  db.query('DELETE FROM metrics WHERE project=? AND ts < ?').run(key, Date.now() - 30 * 86400_000);
}

function baseline(key: string, source: string, before: number): Bucket[] {
  const rows = getDb().query('SELECT ts, name, value FROM metrics WHERE project=? AND source=? AND ts < ? AND ts >= ? ORDER BY ts').all(key, source, before, before - 7 * 86400_000) as any[];
  const m = new Map<number, Bucket>();
  for (const r of rows) {
    const b = m.get(r.ts) ?? { ts: r.ts, events: 0, errors: 0, users: 0 };
    (b as any)[r.name] = r.value;
    m.set(r.ts, b);
  }
  return [...m.values()];
}

export async function collect(input: CollectInput): Promise<CollectResult> {
  const errors: string[] = [];
  const warnings: EarlyWarning[] = [];
  const exceptions: Exception[] = [];
  const sources: string[] = [];
  let events = 0;
  let errs = 0;
  let peak: number | null = null;
  const knownKey = `exc:${input.key}`;
  const known = new Set<string>(kvGet<string[]>(knownKey, []));
  for (const f of input.fetchers) {
    let d: SourceData;
    try {
      d = await f();
    } catch (e: any) {
      errors.push(redact(e?.message ?? String(e)));
      continue;
    }
    sources.push(d.source);
    const exc = d.exceptions.map((e) => ({ type: redact(e.type).slice(0, 120), message: redact(e.message).slice(0, 300), count: e.count }));
    const base = baseline(input.key, d.source, input.from);
    warnings.push(...detect({ current: d.buckets, baseline: base, exceptions: exc, knownExceptionTypes: known, peakUsers: d.peakUsers, plannedUsers: input.plannedUsers }));
    storeBuckets(input.key, d.source, d.buckets);
    for (const e of exc) known.add(`${e.type}|${e.message.slice(0, 80)}`);
    exceptions.push(...exc);
    events += d.buckets.reduce((s, b) => s + b.events, 0);
    errs += d.buckets.reduce((s, b) => s + b.errors, 0);
    if (d.peakUsers !== null) peak = Math.max(peak ?? 0, d.peakUsers);
  }
  kvSet(knownKey, [...known].slice(-2000));
  // Deduplicate warnings from several sources by detector (keep the more severe).
  const byDet = new Map<string, EarlyWarning>();
  const rank = { critical: 0, warning: 1, info: 2 };
  for (const w of warnings) {
    const p = byDet.get(w.detector);
    if (!p || rank[w.severity] < rank[p.severity]) byDet.set(w.detector, w);
  }
  const final = [...byDet.values()];
  let digest: string | null = null;
  let aiUsed: string | null = null;
  let aiError: string | null = null;
  const digestKey = `digest:${input.key}`;
  const digestDue = input.forceDigest || Date.now() - kvGet<number>(digestKey, 0) > 24 * 3600_000;
  if (input.useAi && aiConfigured() && sources.length && (final.length || digestDue)) {
    try {
      const r = await chatJson([
        {
          role: 'system',
          content: [
            'You are a production reliability analyst for a small team. You explain early warnings in plain words and propose a short fix plan a coding agent can follow.',
            UNTRUSTED_RULE,
            'Only use the numbers and errors given. Do not invent incidents. Reply with JSON: {"warnings":[{"index":number,"plan":string,"explanation":string}],"digest":string}. "digest" is 2-4 plain sentences about the period.'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            `Period: ${new Date(input.from).toISOString()} to ${new Date(input.to).toISOString()}. Events ${events}, errors ${errs}, peak users ${peak ?? 'unknown'}, planned users ${input.plannedUsers ?? 'unknown'}.`,
            untrusted('EARLY WARNINGS', JSON.stringify(final.map((w, index) => ({ index, ...w })), null, 1)),
            untrusted('TOP ERRORS (redacted production data)', JSON.stringify(exceptions.slice(0, 15), null, 1))
          ].join('\n\n')
        }
      ]);
      aiUsed = `${r.used}:${r.model}`;
      for (const p of Array.isArray(r.value?.warnings) ? r.value.warnings : []) {
        const w = final[Number(p.index)];
        if (w && typeof p.plan === 'string') w.plan = redact(p.plan).slice(0, 1500);
      }
      if (typeof r.value?.digest === 'string') digest = redact(r.value.digest).slice(0, 1200);
      if (digestDue) kvSet(digestKey, Date.now());
    } catch (e: any) {
      aiError = e?.message ?? String(e);
    }
  }
  return { window: { from: input.from, to: input.to }, sources, totals: { events, errors: errs, peakUsers: peak }, exceptions, warnings: final, digest, aiUsed, aiError, errors };
}
