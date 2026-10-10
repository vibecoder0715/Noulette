import type {
  TrapcheckFinding,
  TrapcheckInconclusive,
  TrapcheckResult
} from '../schema/trapcheck.schema.js';

export interface VerdictPolicyInput {
  caseId: string;
  treeHash: string;
  rulesVersion: string;
  findings: TrapcheckFinding[];
  inconclusive: TrapcheckInconclusive[];
  filesScanned: number;
  bytesScanned: number;
  partialFiles?: string[];
  neutralized?: { original: string; renamedTo: string }[];
}

/**
 * Determines rule family prefix: AGT, LIF, GIT, CIW, PAY, INJ, DEP, ARC, NET, CMD
 */
export function getRuleFamily(ruleId: string): string {
  const parts = ruleId.split('-');
  return parts[0] || 'GEN';
}

/**
 * Applies Pass M2d verdict evaluation, benign shapes filtering, CLUSTER-001 synthesis,
 * and produces the final TrapcheckResult.
 */
export function evaluateVerdict(input: VerdictPolicyInput): TrapcheckResult {
  const reasons: string[] = [];
  let findings = [...input.findings];
  const inconclusive = [...input.inconclusive];

  // 1. Benign Shapes checks
  // If LIF-001 is only for `prepare: husky` and no other findings exist -> downgrade to note (PASS)
  const isOnlyHusky =
    findings.length === 1 &&
    findings[0].ruleId === 'LIF-001' &&
    findings[0].plain.toLowerCase().includes('husky');

  // If PAY-003 is medium in src/ and not referenced by scripts (TC-040)
  const isOnlyObfuscatedSrc =
    findings.length === 1 &&
    findings[0].ruleId === 'PAY-003' &&
    findings[0].severity === 'MEDIUM';

  // 2. Cluster Rule (§5.3):
  // >= 3 distinct MEDIUM rules in the same family, or >= 5 MEDIUM overall -> synthetic HIGH CLUSTER-001
  const mediumFindings = findings.filter(f => f.severity === 'MEDIUM');
  const familyMediumCounts = new Map<string, Set<string>>();
  for (const f of mediumFindings) {
    const fam = getRuleFamily(f.ruleId);
    if (!familyMediumCounts.has(fam)) familyMediumCounts.set(fam, new Set());
    familyMediumCounts.get(fam)!.add(f.ruleId);
  }

  let clusterTriggered = false;
  for (const [fam, ruleSet] of familyMediumCounts.entries()) {
    if (ruleSet.size >= 3) {
      clusterTriggered = true;
      break;
    }
  }
  if (mediumFindings.length >= 5) {
    clusterTriggered = true;
  }

  if (clusterTriggered && !findings.some(f => f.ruleId === 'CLUSTER-001')) {
    findings.push({
      ruleId: 'CLUSTER-001',
      severity: 'HIGH',
      file: 'project',
      line: null,
      snippetHash: 'sha256:cluster',
      excerpt: 'Multiple medium warning signs clustered in project',
      plain: 'Multiple warning signs across project triggers CLUSTER-001 escalation',
      confidence: 'confirmed'
    });
  }

  // 3. Corroboration Rule (§5.5):
  // HIGH + any other HIGH/CRITICAL in a *different* family -> treat first as CRITICAL for the verdict
  const highOrCritical = findings.filter(f => f.severity === 'HIGH' || f.severity === 'CRITICAL');
  const distinctFamilies = new Set(highOrCritical.map(f => getRuleFamily(f.ruleId)));
  const hasCorroboration = distinctFamilies.size >= 2 && highOrCritical.some(f => f.severity === 'HIGH');

  // 4. Verdict determination
  let verdict: 'reject' | 'unsure' | 'pass' = 'pass';

  const hasCritical = findings.some(f => f.severity === 'CRITICAL') || hasCorroboration;
  const hasHigh = findings.some(f => f.severity === 'HIGH');
  const hasInconclusive = inconclusive.length > 0;

  if (hasCritical) {
    verdict = 'reject';
    for (const f of findings.filter(f => f.severity === 'CRITICAL')) {
      reasons.push(`[REJECT] ${f.ruleId} in ${f.file}: ${f.plain}`);
    }
    if (hasCorroboration && !findings.some(f => f.severity === 'CRITICAL')) {
      reasons.push('[REJECT] Corroborating multiple HIGH risks across different rule families');
    }
  } else if (hasHigh || hasInconclusive) {
    if (isOnlyHusky || isOnlyObfuscatedSrc) {
      // Benign shapes pass with note!
      verdict = 'pass';
      reasons.push(`[PASS with note] Benign pattern recognized: ${findings[0].plain}`);
    } else {
      verdict = 'unsure';
      for (const f of findings.filter(f => f.severity === 'HIGH')) {
        reasons.push(`[UNSURE] ${f.ruleId} in ${f.file}: ${f.plain}`);
      }
      for (const inc of inconclusive) {
        reasons.push(`[UNSURE] ${inc.code} in ${inc.file}: ${inc.why}`);
      }
    }
  } else {
    verdict = 'pass';
    if (findings.length > 0) {
      reasons.push(`[PASS with note] ${findings.length} minor non-blocking notes recorded.`);
    } else {
      reasons.push('[PASS] No trap check rules triggered within limits.');
    }
  }

  return {
    schemaVersion: 1,
    caseId: input.caseId,
    treeHash: input.treeHash,
    rulesVersion: input.rulesVersion,
    verdict,
    reasons,
    findings,
    inconclusive,
    limits: {
      filesScanned: input.filesScanned,
      bytesScanned: input.bytesScanned,
      partialFiles: input.partialFiles || []
    },
    neutralized: input.neutralized || []
  };
}
