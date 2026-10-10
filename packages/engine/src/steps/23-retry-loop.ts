import fs from 'node:fs';
import path from 'node:path';
import { startFix, type AttemptRecord } from './21-start-fix.js';
import { verifyFix, type RefereeVerdict } from './22-referee.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface RetryLoopOptions {
  tier?: 'Low' | 'Medium' | 'High';
}

export interface RetryLoopResult {
  attemptId?: string;
  status: 'passed' | 'failed' | 'held' | 'stopped-early' | 'needs-person';
  attemptCount: number;
  maxAttempts: number;
  verdict?: RefereeVerdict;
  diagnosis?: string;
}

export const TIER_ATTEMPT_CAPS: Record<'Low' | 'Medium' | 'High', number> = {
  Low: 1,
  Medium: 3,
  High: 3
};

/**
 * Lists past attempts for a given project from .noulette/attempts/.
 */
export function listPastAttempts(projectPath: string): { attempt: AttemptRecord; verdict?: RefereeVerdict }[] {
  const attemptsDir = path.join(path.resolve(projectPath), '.noulette', 'attempts');
  if (!fs.existsSync(attemptsDir)) return [];

  const results: { attempt: AttemptRecord; verdict?: RefereeVerdict }[] = [];
  const entries = fs.readdirSync(attemptsDir);

  for (const entry of entries) {
    const recordFile = path.join(attemptsDir, entry, 'attempt.json');
    const verdictFile = path.join(attemptsDir, entry, 'referee-verdict.json');

    if (fs.existsSync(recordFile)) {
      try {
        const attempt = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
        let verdict: RefereeVerdict | undefined;
        if (fs.existsSync(verdictFile)) {
          verdict = JSON.parse(fs.readFileSync(verdictFile, 'utf8'));
        }
        results.push({ attempt, verdict });
      } catch {}
    }
  }

  // Sort chronologically by startedAt
  results.sort((a, b) => new Date(a.attempt.startedAt).getTime() - new Date(b.attempt.startedAt).getTime());
  return results;
}

/**
 * Step 23 — Passed or Failed? Retry Loop:
 * Orchestrates fix attempts with tier limits, fresh copy isolation, and early loop stops.
 */
export async function executeFixAttempt(
  projectPath: string,
  findingIds: string[],
  applyChangesFn: (workDir: string) => Promise<void> | void,
  options: RetryLoopOptions = {}
): Promise<RetryLoopResult> {
  const normProject = path.resolve(projectPath);
  const tier = options.tier || 'Medium';
  const maxAttempts = TIER_ATTEMPT_CAPS[tier];

  const pastAttempts = listPastAttempts(normProject).filter(a =>
    a.attempt.findingIds.some(id => findingIds.includes(id))
  );

  const attemptCount = pastAttempts.length + 1;

  // TC-127: Identical failure 3 consecutive times -> early stop
  if (pastAttempts.length >= 3) {
    const last3 = pastAttempts.slice(-3);
    const reasons = last3.map(a => (a.verdict?.reasons || []).join(';'));
    if (reasons[0] && reasons[0] === reasons[1] && reasons[1] === reasons[2]) {
      return {
        status: 'stopped-early',
        attemptCount: pastAttempts.length,
        maxAttempts,
        diagnosis: `Early loop stop triggered: Identical failure repeated 3 times (${reasons[0]})`
      };
    }
  }

  // TC-126: If attempts exceed the tier cap -> State = Held back
  if (pastAttempts.length >= maxAttempts) {
    const heldFile = path.join(normProject, '.noulette', 'held-back.json');
    atomicWriteJsonSync(heldFile, {
      schemaVersion: 1,
      reason: `Attempts (${pastAttempts.length}) reached or exceeded tier cap (${maxAttempts}) for tier ${tier}`,
      findingIds,
      heldAt: new Date().toISOString()
    });

    return {
      status: 'held',
      attemptCount: pastAttempts.length,
      maxAttempts,
      diagnosis: 'State transitions to Held back: ordinary approval path locked'
    };
  }

  // TC-125: Fresh attempt starts from original candidate in a fresh copy
  const attempt = startFix(normProject, findingIds, { tier });

  // Apply changes to the work directory
  await applyChangesFn(attempt.workDir);

  // Evaluate via Referee
  const verdict = verifyFix(normProject, attempt.attemptId);

  return {
    attemptId: attempt.attemptId,
    status: verdict.status,
    attemptCount,
    maxAttempts,
    verdict,
    diagnosis: verdict.reasons.join(', ') || undefined
  };
}
