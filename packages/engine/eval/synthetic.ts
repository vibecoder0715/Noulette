import type { Bucket, Exception } from '../src/monitor/sources.ts';
import type { DetectorInput } from '../src/monitor/detectors.ts';

/** Seeded PRNG so the eval set is reproducible. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export type Label = 'none' | 'error-rate' | 'new-error' | 'traffic-drop' | 'traffic-spike' | 'saturation';

export interface Scenario {
  name: string;
  expect: Label[];
  input: DetectorInput;
}

const STEP = 5 * 60_000;

/** 7 days of 5-minute buckets with a daily cycle and noise. */
function series(r: () => number, start: number, n: number, base: number, errRate: number): Bucket[] {
  const out: Bucket[] = [];
  for (let i = 0; i < n; i++) {
    const ts = start + i * STEP;
    const hour = new Date(ts).getUTCHours();
    const cycle = 0.6 + 0.4 * Math.sin(((hour - 6) / 24) * 2 * Math.PI);
    const events = Math.max(0, Math.round(base * cycle * (0.85 + r() * 0.3)));
    const errors = Math.round(events * errRate * (0.5 + r()));
    out.push({ ts, events, errors, users: Math.round(events / 4) });
  }
  return out;
}

export function scenarios(seed = 42): Scenario[] {
  const r = rng(seed);
  const now = Date.UTC(2026, 9, 10, 14, 0);
  const baseStart = now - 7 * 86400_000;
  const known = new Set(['TypeError|Cannot read properties of undefined', 'NetworkError|Failed to fetch']);
  const exc: Exception[] = [{ type: 'TypeError', message: 'Cannot read properties of undefined', count: 4 }];
  const mk = (name: string, expect: Label[], cur: (b: Bucket[]) => Bucket[], extra: Partial<DetectorInput> = {}): Scenario => {
    const baseline = series(r, baseStart, 2016, 200, 0.005);
    const current = cur(series(r, now - 30 * 60_000, 6, 200, 0.005));
    return { name, expect, input: { current, baseline, exceptions: exc, knownExceptionTypes: known, peakUsers: 300, plannedUsers: 1000, ...extra } };
  };
  const list: Scenario[] = [];
  for (let i = 0; i < 10; i++) list.push(mk(`normal-${i}`, ['none'], (b) => b));
  for (let i = 0; i < 5; i++) list.push(mk(`error-spike-${i}`, ['error-rate'], (b) => b.map((x) => ({ ...x, errors: Math.round(x.events * (0.08 + 0.04 * i)) }))));
  for (let i = 0; i < 5; i++) list.push(mk(`outage-${i}`, ['traffic-drop'], (b) => b.map((x) => ({ ...x, events: Math.round(x.events * (0.02 + 0.04 * i)), errors: 0 }))));
  for (let i = 0; i < 4; i++) list.push(mk(`new-exception-${i}`, ['new-error'], (b) => b, { exceptions: [...exc, { type: 'RangeError', message: `Invalid time value ${i}`, count: 10 + i * 20 }] }));
  for (let i = 0; i < 4; i++) list.push(mk(`saturation-${i}`, ['saturation'], (b) => b, { peakUsers: 850 + i * 150 }));
  for (let i = 0; i < 3; i++) list.push(mk(`spike-${i}`, ['traffic-spike'], (b) => b.map((x) => ({ ...x, events: x.events * (5 + i) }))));
  // Hard negatives: small blips that must NOT alert.
  for (let i = 0; i < 5; i++) list.push(mk(`blip-${i}`, ['none'], (b) => b.map((x, j) => (j === 0 ? { ...x, errors: x.errors + 2 } : x))));
  return list;
}
