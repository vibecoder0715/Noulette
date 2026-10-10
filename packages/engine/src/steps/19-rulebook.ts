import fs from 'node:fs';
import path from 'node:path';

export const START_MARKER = '<!-- noulette:start -->';
export const END_MARKER = '<!-- noulette:end -->';

export interface RuleBookOptions {
  projectPath: string;
  rules?: string[];
  bannedPackages?: string[];
  customRules?: Array<{ id: string; ruleYaml: string }>;
}

export interface RuleBookResult {
  rulesMdPath: string;
  agentsMdPath: string;
  rulesMdLineCount: number;
}

/**
 * Generates the managed markdown block for AGENTS.md.
 */
export function buildManagedBlock(summaryRules: string[]): string {
  const lines = [
    START_MARKER,
    '## Noulette Guardrails',
    'Follow these repository security invariants:',
    '- Never commit `.env`, unmasked credentials, API keys, or private tokens.',
    '- Refer to `.noulette/rules.md` for specific verified invariants and logic rules.',
    ...summaryRules.map(r => `- ${r}`),
    END_MARKER
  ];
  return lines.join('\n');
}

/**
 * Idempotently updates or inserts the managed block inside AGENTS.md.
 * Retains all user content before and after the markers (TC-113).
 */
export function syncAgentsMd(projectPath: string, managedBlock: string): string {
  const agentsPath = path.join(path.resolve(projectPath), 'AGENTS.md');
  let existingContent = '';

  if (fs.existsSync(agentsPath)) {
    existingContent = fs.readFileSync(agentsPath, 'utf8');
  }

  let newContent = '';
  const startIndex = existingContent.indexOf(START_MARKER);
  const endIndex = existingContent.indexOf(END_MARKER);

  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    // Replace existing block
    const before = existingContent.slice(0, startIndex);
    const after = existingContent.slice(endIndex + END_MARKER.length);
    newContent = before.trimEnd() + '\n\n' + managedBlock + '\n\n' + after.trimStart();
  } else if (existingContent.trim().length > 0) {
    // Append to end of user content
    newContent = existingContent.trimEnd() + '\n\n' + managedBlock + '\n';
  } else {
    // New file
    newContent = managedBlock + '\n';
  }

  fs.writeFileSync(agentsPath, newContent.trim() + '\n', 'utf8');
  return agentsPath;
}

/**
 * Step 19 — Rule Book:
 * - Generates .noulette/rules.md (<= 80 lines).
 * - Syncs managed block into AGENTS.md idempotently.
 * - Writes custom opengrep rules to .noulette/custom-rules/.
 */
export function writeRuleBook(options: RuleBookOptions): RuleBookResult {
  const normProject = path.resolve(options.projectPath);
  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }

  // 1. Generate .noulette/rules.md (max 80 lines)
  const rulesLines: string[] = [
    '# Repository Security Rules & Invariants',
    '',
    '## Invariants',
    '1. Do not introduce packages with known critical vulnerabilities.',
    '2. Do not bypass middleware auth or route guards without explicit approval.',
    '3. Do not commit secrets, tokens, or private keys to git.',
    '4. Do not suppress scanners using inline comments (// nosemgrep, # nosec).'
  ];

  if (options.rules && options.rules.length > 0) {
    rulesLines.push('');
    rulesLines.push('## Project Specific Invariants');
    for (const r of options.rules) {
      rulesLines.push(`- ${r}`);
    }
  }

  if (options.bannedPackages && options.bannedPackages.length > 0) {
    rulesLines.push('');
    rulesLines.push('## Banned Packages');
    for (const b of options.bannedPackages) {
      rulesLines.push(`- ${b}`);
    }
  }

  // Enforce <= 80 lines cap
  const cappedLines = rulesLines.slice(0, 80);
  const rulesMdPath = path.join(nouletteDir, 'rules.md');
  fs.writeFileSync(rulesMdPath, cappedLines.join('\n') + '\n', 'utf8');

  // 2. Custom opengrep rules in .noulette/custom-rules/
  if (options.customRules && options.customRules.length > 0) {
    const customRulesDir = path.join(nouletteDir, 'custom-rules');
    if (!fs.existsSync(customRulesDir)) {
      fs.mkdirSync(customRulesDir, { recursive: true });
    }
    for (const cr of options.customRules) {
      fs.writeFileSync(path.join(customRulesDir, `${cr.id}.yaml`), cr.ruleYaml, 'utf8');
    }
  }

  // 3. Sync AGENTS.md managed block
  const managedBlock = buildManagedBlock(options.rules || []);
  const agentsMdPath = syncAgentsMd(normProject, managedBlock);

  return {
    rulesMdPath,
    agentsMdPath,
    rulesMdLineCount: cappedLines.length
  };
}
