import fs from 'node:fs';
import path from 'node:path';
import type { TrapcheckResult } from '../schema/trapcheck.schema.js';
import { promoteQuarantinedCase, deleteQuarantinedCase, getQuarantineCaseDir } from './03-quarantine.js';
import { atomicWriteFileSync } from '../util/atomic-fs.js';
import { getCaseDir } from '../util/paths.js';

export interface VerdictPolicyReport {
  verdict: 'reject' | 'unsure' | 'pass';
  headline: string;
  topHits: { ruleId: string; severity: string; file: string; explanation: string }[];
  inconclusiveSummary: string[];
  nextAction: 'delete-or-keep' | 'human-review-required' | 'promote-allowed';
  reportMarkdown: string;
}

export function generateVerdictReport(result: TrapcheckResult): VerdictPolicyReport {
  let headline = '';
  let nextAction: 'delete-or-keep' | 'human-review-required' | 'promote-allowed' = 'promote-allowed';

  if (result.verdict === 'reject') {
    headline = 'Intake Stopped — Critical Security Danger Detected';
    nextAction = 'delete-or-keep';
  } else if (result.verdict === 'unsure') {
    headline = 'Intake Held — Manual Inspection Required';
    nextAction = 'human-review-required';
  } else {
    headline = 'Intake Passed — No Known Traps Found Within Inspection Limits';
    nextAction = 'promote-allowed';
  }

  const topHits = result.findings
    .slice(0, 5)
    .map(f => ({
      ruleId: f.ruleId,
      severity: f.severity,
      file: f.file,
      explanation: f.plain
    }));

  const inconclusiveSummary = result.inconclusive.map(inc => `${inc.code} in ${inc.file}: ${inc.why}`);

  // Build markdown report
  const lines: string[] = [
    `# Trap Check Intake Report — ${headline}`,
    '',
    `**Verdict:** ${result.verdict.toUpperCase()}`,
    `**Candidate Tree Hash:** \`${result.treeHash}\``,
    `**Rules Version:** \`${result.rulesVersion}\``,
    `**Files Inspected:** ${result.limits.filesScanned} (${Math.round(result.limits.bytesScanned / 1024)} KB)`,
    '',
    '## Reasons & Findings',
    ''
  ];

  if (topHits.length > 0) {
    lines.push('### Top Detected Issues');
    for (const hit of topHits) {
      lines.push(`- **[${hit.severity}] ${hit.ruleId}** (\`${hit.file}\`): ${hit.explanation}`);
    }
    lines.push('');
  }

  if (inconclusiveSummary.length > 0) {
    lines.push('### Uninspected / Inconclusive Areas');
    for (const inc of inconclusiveSummary) {
      lines.push(`- ${inc}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Notice: This platform does not claim this software is safe. Pass means no known trap was found within configured static scan limits.*');

  const reportMarkdown = lines.join('\n');

  // Save report markdown to case folder
  const caseDir = getCaseDir(result.caseId);
  if (fs.existsSync(caseDir)) {
    atomicWriteFileSync(path.join(caseDir, 'trapcheck-report.md'), reportMarkdown);
  }

  return {
    verdict: result.verdict,
    headline,
    topHits,
    inconclusiveSummary,
    nextAction,
    reportMarkdown
  };
}

export function handleVerdictPromotion(caseId: string, destinationDir: string): boolean {
  const caseDir = getCaseDir(caseId);
  const trapcheckJsonPath = path.join(caseDir, 'trapcheck.json');
  if (!fs.existsSync(trapcheckJsonPath)) {
    throw new Error(`Trap check results missing for case: ${caseId}`);
  }

  const result: TrapcheckResult = JSON.parse(fs.readFileSync(trapcheckJsonPath, 'utf8'));
  if (result.verdict !== 'pass') {
    throw new Error(`Cannot promote case with verdict: ${result.verdict}`);
  }

  promoteQuarantinedCase(caseId, destinationDir);
  return true;
}
