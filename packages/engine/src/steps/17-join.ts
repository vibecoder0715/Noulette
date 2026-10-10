import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../schema/finding.schema.js';
import type { Scorecard } from '../schema/scorecard.schema.js';
import { computeCandidateTreeHash } from '../util/candidate-tree.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface PolicyConfig {
  hardStopRules?: string[];
  blockOnLiveKeys?: boolean;
}

export interface JoinInput {
  projectPath: string;
  candidateId: string;
  expectedTreeHash: string;
  currentTreeHash?: string;
  tier: 'Low' | 'Medium' | 'High';
  findings: Finding[];
  checksRan: string[];
  checksSkipped: { check: string; reason: string }[];
  checksNotCovered: { check: string; explanation: string }[];
  toolVersions: Record<string, string | null>;
  policy?: PolicyConfig;
  dangerNotesSyncedAt?: string | null;
}

export interface JoinResult {
  stale: boolean;
  rerunRequired: boolean;
  scorecard: Scorecard;
  mergedFindings: Finding[];
}

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0
};

const URGENCY_WEIGHT: Record<string, number> = {
  'fix-before-launch': 3,
  'fix-soon': 2,
  'nice-to-fix': 1
};

const CONFIDENCE_WEIGHT: Record<string, number> = {
  'confirmed': 3,
  'likely': 2,
  'possible-false-alarm': 1
};

/**
 * Step 17 — Join the Evidence:
 * - Verifies candidate tree hash integrity (marks stale if tree changed).
 * - Merges duplicate findings keeping higher severity.
 * - Applies policy hard stops (blocking: true).
 * - Identifies gaps in the scorecard (e.g. Medium tier missing roleplay).
 */
export function joinEvidence(input: JoinInput): JoinResult {
  const {
    projectPath,
    candidateId,
    expectedTreeHash,
    tier,
    findings,
    checksRan,
    checksSkipped,
    checksNotCovered,
    toolVersions,
    policy = {},
    dangerNotesSyncedAt = null
  } = input;

  // 1. Verify candidate tree hash
  const actualTreeHash = input.currentTreeHash || computeCandidateTreeHash(projectPath);
  const isStale = actualTreeHash !== expectedTreeHash;

  if (isStale) {
    // TC-107: Results produced for an older treeHash marked stale; rerun triggered
    const emptyScorecard: Scorecard = {
      schemaVersion: 1,
      candidateId,
      candidateTreeHash: expectedTreeHash as any,
      tier,
      checksRan: [],
      checksSkipped: [{ check: 'join', reason: `Stale tree hash: expected ${expectedTreeHash}, got ${actualTreeHash}` }],
      checksNotCovered: [],
      toolVersions,
      dangerNotesSyncedAt
    };

    return {
      stale: true,
      rerunRequired: true,
      scorecard: emptyScorecard,
      mergedFindings: []
    };
  }

  // 2. TC-108: Merge duplicate findings, keeping higher severity
  const findingsByFingerprint = new Map<string, Finding>();

  for (const finding of findings) {
    const key = finding.fingerprint || `${finding.ruleId}:${finding.where.file}:${finding.where.line}`;
    const existing = findingsByFingerprint.get(key);

    if (!existing) {
      findingsByFingerprint.set(key, { ...finding });
    } else {
      // Merge: pick higher severity
      const existingSev = SEVERITY_WEIGHT[existing.severity] || 0;
      const newSev = SEVERITY_WEIGHT[finding.severity] || 0;
      const higherSeverity = newSev > existingSev ? finding.severity : existing.severity;

      const existingUrg = URGENCY_WEIGHT[existing.urgency] || 0;
      const newUrg = URGENCY_WEIGHT[finding.urgency] || 0;
      const higherUrgency = newUrg > existingUrg ? finding.urgency : existing.urgency;

      const existingConf = CONFIDENCE_WEIGHT[existing.confidence] || 0;
      const newConf = CONFIDENCE_WEIGHT[finding.confidence] || 0;
      const higherConf = newConf > existingConf ? finding.confidence : existing.confidence;

      const isBlocking = existing.blocking || finding.blocking;

      findingsByFingerprint.set(key, {
        ...existing,
        severity: higherSeverity,
        urgency: higherUrgency,
        confidence: higherConf,
        blocking: isBlocking,
        howToFix: existing.howToFix || finding.howToFix,
        youMustDo: Array.from(new Set([...existing.youMustDo, ...finding.youMustDo]))
      });
    }
  }

  // 3. TC-110: Apply policy hard stops (blocking: true)
  const mergedFindings = Array.from(findingsByFingerprint.values()).map(f => {
    let blocking = f.blocking;

    // Live fake key in a pushed file is always blocking by policy
    if (f.source === 'keys' && f.visibility.includes('pushed')) {
      blocking = true;
    }

    if (policy.hardStopRules && policy.hardStopRules.includes(f.ruleId)) {
      blocking = true;
    }

    return {
      ...f,
      blocking
    };
  });

  // 4. TC-109: Medium tier with roleplay not run -> Blocking gap in scorecard
  const finalChecksSkipped = [...checksSkipped];
  const finalChecksNotCovered = [...checksNotCovered];

  if ((tier === 'Medium' || tier === 'High') && !checksRan.includes('roleplay')) {
    const alreadySkipped = finalChecksSkipped.some(s => s.check === 'roleplay');
    if (!alreadySkipped) {
      finalChecksSkipped.push({
        check: 'roleplay',
        reason: 'Roleplay not run (blocking gap in Medium/High tier)'
      });
    }
  }

  // TC-312: Join fails if any mandatory check is missing when policy enforcement is enabled
  if (policy.enforceMandatoryChecks) {
    const MANDATORY_CHECKS = ['freeze', 'classify', 'leaked-keys', 'code-mistakes', 'ingredients', 'fresh-danger', 'appmap'];
    const allAccountedFor = new Set([
      ...checksRan,
      ...finalChecksSkipped.map(s => s.check),
      ...finalChecksNotCovered.map(nc => nc.check)
    ]);
    const missingMandatory = MANDATORY_CHECKS.find(c => !allAccountedFor.has(c));
    if (missingMandatory) {
      throw new Error(`Mandatory checks missing from evidence join: ${missingMandatory} must appear as ran, skipped, or not covered (TC-312)`);
    }
  }

  const scorecard: Scorecard = {
    schemaVersion: 1,
    candidateId,
    candidateTreeHash: expectedTreeHash as any,
    tier,
    checksRan,
    checksSkipped: finalChecksSkipped,
    checksNotCovered: finalChecksNotCovered,
    toolVersions,
    dangerNotesSyncedAt
  };

  const nouletteDir = path.join(projectPath, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }
  atomicWriteJsonSync(path.join(nouletteDir, 'scorecard.json'), scorecard);

  return {
    stale: false,
    rerunRequired: false,
    scorecard,
    mergedFindings
  };
}
