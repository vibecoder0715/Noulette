/**
 * Early-warning eval. Synthetic labelled scenarios measure detector precision/recall.
 * Optional: --loghub <file> replays a LogHub log (e.g. HDFS_2k.log, fetched with fetch-loghub.ts)
 * as error-level counts per 5 minutes to check the detectors stay quiet on real, normal logs.
 *
 *   bun run eval:logs [-- --loghub path/to/HDFS_2k.log]
 */
import fs from 'node:fs';
import { detect } from '../src/monitor/detectors.ts';
import type { Bucket } from '../src/monitor/sources.ts';
import { scenarios, type Label } from './synthetic.ts';

export function evaluate(seed = 42) {
  const per = new Map<string, { tp: number; fp: number; fn: number }>();
  const get = (k: string) => per.get(k) ?? (per.set(k, { tp: 0, fp: 0, fn: 0 }), per.get(k)!);
  const misses: string[] = [];
  for (const s of scenarios(seed)) {
    const fired = new Set<Label>(detect(s.input).map((w) => w.detector));
    const expected = new Set(s.expect.filter((e) => e !== 'none'));
    for (const e of expected) {
      if (fired.has(e)) get(e).tp++;
      else (get(e).fn++, misses.push(`${s.name}: missed ${e}`));
    }
    for (const f of fired) if (!expected.has(f)) (get(f).fp++, misses.push(`${s.name}: false ${f}`));
  }
  const rows = [...per.entries()].map(([k, v]) => ({ detector: k, precision: v.tp / Math.max(1, v.tp + v.fp), recall: v.tp / Math.max(1, v.tp + v.fn), ...v }));
  const tp = rows.reduce((s, r) => s + r.tp, 0);
  const fp = rows.reduce((s, r) => s + r.fp, 0);
  const fn = rows.reduce((s, r) => s + r.fn, 0);
  return { rows, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), misses };
}

/** Minimal LogHub replay: timestamps + level -> 5-minute buckets (events = lines, errors = WARN/ERROR/FATAL). */
export function loghubBuckets(text: string): Bucket[] {
  const m = new Map<number, Bucket>();
  for (const line of text.split(/\r?\n/)) {
    // HDFS: 081109 203615 148 INFO dfs.DataNode$PacketResponder: ...
    const h = /^(\d{2})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2}) \d+ (\w+)/.exec(line);
    if (!h) continue;
    const ts = Date.UTC(2000 + +h[1], +h[2] - 1, +h[3], +h[4], +h[5], +h[6]);
    const b0 = ts - (ts % 300_000);
    const b = m.get(b0) ?? { ts: b0, events: 0, errors: 0, users: 0 };
    b.events++;
    if (/WARN|ERROR|FATAL/.test(h[7])) b.errors++;
    m.set(b0, b);
  }
  return [...m.values()].sort((a, b) => a.ts - b.ts);
}

if (import.meta.main) {
  const r = evaluate();
  console.log('Early-warning detectors (synthetic eval set)');
  for (const row of r.rows) console.log(`  ${row.detector.padEnd(14)} precision ${(row.precision * 100).toFixed(0)}%  recall ${(row.recall * 100).toFixed(0)}%  (tp ${row.tp}, fp ${row.fp}, fn ${row.fn})`);
  console.log(`  overall        precision ${(r.precision * 100).toFixed(0)}%  recall ${(r.recall * 100).toFixed(0)}%`);
  for (const m of r.misses) console.log(`  - ${m}`);
  const i = process.argv.indexOf('--loghub');
  if (i > 0 && process.argv[i + 1]) {
    const buckets = loghubBuckets(fs.readFileSync(process.argv[i + 1], 'utf8'));
    const half = Math.floor(buckets.length * 0.7);
    const w = detect({ current: buckets.slice(half), baseline: buckets.slice(0, half), exceptions: [], knownExceptionTypes: new Set(), peakUsers: null, plannedUsers: null });
    console.log(`LogHub replay: ${buckets.length} buckets, warnings: ${w.map((x) => x.detector).join(', ') || 'none'}`);
  }
}
