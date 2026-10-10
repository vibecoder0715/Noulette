import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../schema/finding.schema.js';
import type { Scorecard } from '../schema/scorecard.schema.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

const URGENCY_RANK: Record<string, number> = {
  'fix-before-launch': 3,
  'fix-soon': 2,
  'nice-to-fix': 1
};

const CONFIDENCE_RANK: Record<string, number> = {
  'confirmed': 3,
  'likely': 2,
  'possible-false-alarm': 1
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0
};

export interface MasterListOutput {
  sortedFindings: Finding[];
  jsonPath: string;
  markdownPath: string;
  scorecardPath: string;
}

export interface McpPaginatedResponse {
  findings: Finding[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  truncated: boolean;
  byteSize: number;
}

/**
 * Deterministically sorts findings:
 * 1. blocking (true first)
 * 2. urgency (fix-before-launch > fix-soon > nice-to-fix)
 * 3. confidence (confirmed > likely > possible-false-alarm)
 * 4. severity (critical > high > medium > low > info)
 * 5. id (lexicographical)
 */
export function sortFindingsDeterministically(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    // 1. Blocking
    if (a.blocking !== b.blocking) {
      return a.blocking ? -1 : 1;
    }

    // 2. Urgency
    const urgA = URGENCY_RANK[a.urgency] || 0;
    const urgB = URGENCY_RANK[b.urgency] || 0;
    if (urgA !== urgB) {
      return urgB - urgA;
    }

    // 3. Confidence
    const confA = CONFIDENCE_RANK[a.confidence] || 0;
    const confB = CONFIDENCE_RANK[b.confidence] || 0;
    if (confA !== confB) {
      return confB - confA;
    }

    // 4. Severity
    const sevA = SEVERITY_RANK[a.severity] || 0;
    const sevB = SEVERITY_RANK[b.severity] || 0;
    if (sevA !== sevB) {
      return sevB - sevA;
    }

    // 5. Stable ID tie-breaker
    return a.id.localeCompare(b.id);
  });
}

/**
 * Formats findings and scorecard as human-readable Markdown without banned claims.
 */
export function generateFindingsMarkdown(findings: Finding[], scorecard: Scorecard): string {
  const lines: string[] = [];

  lines.push('# Noulette Verification Findings');
  lines.push('');
  lines.push(`- **Candidate ID:** \`${scorecard.candidateId}\``);
  lines.push(`- **Tree Hash:** \`${scorecard.candidateTreeHash}\``);
  lines.push(`- **Tier:** ${scorecard.tier}`);
  lines.push(`- **Total Findings:** ${findings.length}`);
  lines.push('');

  lines.push('## Uninspected & Skipped Areas');
  if (scorecard.checksSkipped.length === 0 && scorecard.checksNotCovered.length === 0) {
    lines.push('- All configured checks ran.');
  } else {
    for (const s of scorecard.checksSkipped) {
      lines.push(`- **Skipped:** ${s.check} — ${s.reason}`);
    }
    for (const nc of scorecard.checksNotCovered) {
      lines.push(`- **Not Checked:** ${nc.check} — ${nc.explanation}`);
    }
  }
  lines.push('');

  lines.push('## Findings List');
  if (findings.length === 0) {
    lines.push('No findings detected across inspected checks.');
  } else {
    for (const f of findings) {
      const blockBadge = f.blocking ? ' [BLOCKING]' : '';
      lines.push(`### [${f.severity.toUpperCase()}] ${f.what}${blockBadge}`);
      lines.push(`- **ID:** \`${f.id}\``);
      lines.push(`- **Location:** \`${f.where.file}:${f.where.line ?? 1}\``);
      lines.push(`- **Urgency:** ${f.urgency}`);
      lines.push(`- **Confidence:** ${f.confidence}`);
      lines.push(`- **Evidence:** ${f.evidence.excerpt}`);
      lines.push(`- **How to fix:** ${f.howToFix}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Paginates findings for MCP clients:
 * - 20 items per page
 * - Max payload size <= 20,480 bytes (20KB)
 * - Flags truncated if exceeding size or more pages exist
 */
export function paginateFindingsForMcp(
  findings: Finding[],
  page = 1,
  pageSize = 20,
  maxSizeBytes = 20480
): McpPaginatedResponse {
  const sorted = sortFindingsDeterministically(findings);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const startIndex = (page - 1) * pageSize;
  let pageItems = sorted.slice(startIndex, startIndex + pageSize);

  let jsonStr = JSON.stringify(pageItems);
  let byteSize = Buffer.byteLength(jsonStr, 'utf8');
  let truncated = page < totalPages;

  // Enforce 20KB cap per page
  if (byteSize > maxSizeBytes) {
    while (pageItems.length > 1 && byteSize > maxSizeBytes) {
      pageItems.pop();
      jsonStr = JSON.stringify(pageItems);
      byteSize = Buffer.byteLength(jsonStr, 'utf8');
      truncated = true;
    }
  }

  return {
    findings: pageItems,
    total,
    page,
    pageSize,
    totalPages,
    truncated,
    byteSize
  };
}

/**
 * Step 18 — Master List & Scorecard:
 * Sorts findings, writes findings.json, findings.md, and scorecard.json.
 */
export function buildMasterList(
  projectPath: string,
  findings: Finding[],
  scorecard: Scorecard
): MasterListOutput {
  const sortedFindings = sortFindingsDeterministically(findings);
  const nouletteDir = path.join(path.resolve(projectPath), '.noulette');

  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }

  const jsonPath = path.join(nouletteDir, 'findings.json');
  const markdownPath = path.join(nouletteDir, 'findings.md');
  const scorecardPath = path.join(nouletteDir, 'scorecard.json');

  atomicWriteJsonSync(jsonPath, sortedFindings);
  fs.writeFileSync(markdownPath, generateFindingsMarkdown(sortedFindings, scorecard), 'utf8');
  atomicWriteJsonSync(scorecardPath, scorecard);

  return {
    sortedFindings,
    jsonPath,
    markdownPath,
    scorecardPath
  };
}
