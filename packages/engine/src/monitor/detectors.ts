import type { Bucket, Exception } from './sources.js';

/**
 * Deterministic early-warning detectors. They run first, on every collection; the AI is only
 * asked to explain and plan when one fires (or for the daily digest).
 */
export interface EarlyWarning {
  detector: 'error-rate' | 'new-error' | 'traffic-drop' | 'traffic-spike' | 'saturation';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  tldr: string;
  evidence: string[];
  /** 0..1, how sure the detector is. */
  confidence: number;
  plan?: string;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export interface DetectorInput {
  current: Bucket[];
  baseline: Bucket[];
  exceptions: Exception[];
  knownExceptionTypes: Set<string>;
  peakUsers: number | null;
  plannedUsers: number | null;
}

export function detect(i: DetectorInput): EarlyWarning[] {
  const out: EarlyWarning[] = [];
  const curEvents = i.current.reduce((s, b) => s + b.events, 0);
  const curErrors = i.current.reduce((s, b) => s + b.errors, 0);
  // Error rate vs. baseline (per-bucket rates).
  const baseRates = i.baseline.filter((b) => b.events > 0).map((b) => b.errors / b.events);
  if (curEvents > 0 && curErrors >= 5 && baseRates.length >= 12) {
    const rate = curErrors / curEvents;
    const m = mean(baseRates);
    const sd = Math.max(std(baseRates), 0.002);
    const z = (rate - m) / sd;
    if (z >= 3) {
      out.push({
        detector: 'error-rate', severity: z >= 6 && rate >= 0.05 ? 'critical' : 'warning',
        title: 'More errors than usual',
        tldr: `${(rate * 100).toFixed(1)}% of activity is failing, normally ${(m * 100).toFixed(1)}%. Users are likely hitting a bug.`,
        evidence: [`${curErrors} errors in ${curEvents} events this period`, `Usual error rate ${(m * 100).toFixed(2)}% (from ${baseRates.length} earlier periods)`, `z-score ${z.toFixed(1)}`],
        confidence: clamp01(0.5 + z / 20)
      });
    }
  }
  // Exception types never seen before.
  const fresh = i.exceptions.filter((e) => e.count >= 3 && !i.knownExceptionTypes.has(`${e.type}|${e.message.slice(0, 80)}`));
  if (fresh.length && i.knownExceptionTypes.size > 0) {
    out.push({
      detector: 'new-error', severity: fresh.some((e) => e.count >= 50) ? 'critical' : 'warning',
      title: 'A new kind of error appeared',
      tldr: `${fresh.length} error type(s) showed up that were not there before, often after a release.`,
      evidence: fresh.slice(0, 5).map((e) => `${e.type}: ${e.message.slice(0, 140)} (${e.count}x)`),
      confidence: clamp01(0.55 + Math.min(0.4, fresh[0].count / 200))
    });
  }
  // Traffic drop / spike vs. baseline per-bucket volume.
  const baseVol = i.baseline.map((b) => b.events);
  if (baseVol.length >= 12 && i.current.length) {
    const m = mean(baseVol);
    const sd = Math.max(std(baseVol), 1);
    const cur = curEvents / i.current.length;
    if (m >= 10 && cur < 0.3 * m) {
      out.push({ detector: 'traffic-drop', severity: cur < 0.05 * m ? 'critical' : 'warning', title: 'Activity dropped sharply', tldr: 'Far fewer people are using the app than usual. It may be down or a page may be broken.', evidence: [`${cur.toFixed(0)} events per 5 min now, usually ${m.toFixed(0)}`], confidence: clamp01(0.6 + (1 - cur / m) * 0.35) });
    } else if ((cur - m) / sd >= 4 && cur >= 2 * m) {
      out.push({ detector: 'traffic-spike', severity: 'info', title: 'Unusual traffic spike', tldr: 'Much more activity than usual. Good news if expected, otherwise it could be abuse or a bot.', evidence: [`${cur.toFixed(0)} events per 5 min now, usually ${m.toFixed(0)}`], confidence: clamp01(0.5 + ((cur - m) / sd) / 40) });
    }
  }
  // Saturation vs. the user count planned in PLAN.md.
  if (i.peakUsers !== null && i.plannedUsers) {
    const ratio = i.peakUsers / i.plannedUsers;
    if (ratio >= 0.8) {
      out.push({
        detector: 'saturation', severity: ratio >= 1 ? 'critical' : 'warning',
        title: ratio >= 1 ? 'More users than you planned for' : 'Getting close to your planned user count',
        tldr: `${i.peakUsers.toLocaleString('en-US')} users this period, PLAN.md planned for ${i.plannedUsers.toLocaleString('en-US')}. Check Plans for the next step.`,
        evidence: [`Peak users: ${i.peakUsers}`, `Planned in PLAN.md: ${i.plannedUsers}`, `${Math.round(ratio * 100)}% of plan`],
        confidence: 0.9
      });
    }
  }
  return out;
}
