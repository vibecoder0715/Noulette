import { execSync } from 'node:child_process';
import { scanAgentRules } from '../trapcheck/rules/agent-rules.js';
import { scanLifecycleRules } from '../trapcheck/rules/lifecycle-rules.js';
import { scanPayloadRules } from '../trapcheck/rules/payload-rules.js';
import type { TrapcheckFinding } from '../schema/trapcheck.schema.js';

export interface QuickChangeOptions {
  maxDiffBytes?: number;
}

export interface QuickChangeResult {
  passed: boolean;
  held: boolean;
  reason: string;
  findings: TrapcheckFinding[];
}

const HARDENED_GIT_ARGS = [
  '-c', 'protocol.ext.allow=never',
  '-c', 'protocol.file.allow=always',
  '-c', 'core.hooksPath=NUL',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.symlinks=false'
].join(' ');

/**
 * Step 6 — Quick Change Check:
 * Runs in < 2 seconds on staged diff. Checks diff-sensitive subset.
 */
export function quickChangeCheck(
  projectPath: string,
  options: QuickChangeOptions = {}
): QuickChangeResult {
  const maxDiffBytes = options.maxDiffBytes ?? (100 * 1024); // 100 KB default limit
  const findings: TrapcheckFinding[] = [];

  // Get staged diff
  let stagedDiff = '';
  try {
    stagedDiff = execSync(`git -C "${projectPath}" ${HARDENED_GIT_ARGS} diff --staged`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (err: any) {
    return {
      passed: false,
      held: true,
      reason: `Could not obtain staged diff: ${err.message}`,
      findings: []
    };
  }

  // TC-049: If staged diff exceeds size limit -> Held with "can't tell"
  if (Buffer.byteLength(stagedDiff, 'utf8') > maxDiffBytes) {
    return {
      passed: false,
      held: true,
      reason: "can't tell (staged diff exceeds quick check limit)",
      findings: []
    };
  }

  // Get list of staged files
  let stagedFiles: string[] = [];
  try {
    const filesOutput = execSync(`git -C "${projectPath}" ${HARDENED_GIT_ARGS} diff --staged --name-only`, {
      encoding: 'utf8'
    });
    stagedFiles = filesOutput.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    // ignore
  }

  // Check each staged file
  for (const relPath of stagedFiles) {
    let fileContent = '';
    let fileBuffer = Buffer.alloc(0);
    try {
      fileBuffer = execSync(`git -C "${projectPath}" ${HARDENED_GIT_ARGS} show ":${relPath}"`, {
        maxBuffer: 5 * 1024 * 1024
      });
      if (!fileBuffer.includes(0)) {
        fileContent = fileBuffer.toString('utf8');
      }
    } catch {
      continue;
    }

    // Check if new binary file (PAY-010)
    const isPE = fileBuffer.length >= 2 && fileBuffer[0] === 0x4d && fileBuffer[1] === 0x5a;
    if (isPE || fileBuffer.includes(0)) {
      findings.push({
        ruleId: 'PAY-010',
        severity: 'HIGH',
        file: relPath,
        line: null,
        snippetHash: 'sha256:binary',
        excerpt: 'Binary file added in staged diff',
        plain: 'Staged diff adds binary executable file (PAY-010)',
        confidence: 'confirmed'
      });
    }

    // Check agent rules on staged content (AGT-*)
    if (fileContent) {
      findings.push(...scanAgentRules(relPath, fileContent));
      findings.push(...scanLifecycleRules(relPath, fileContent));
      findings.push(...scanPayloadRules(relPath, fileBuffer, fileContent, false));
    }
  }

  // Check if blocked by any finding
  const blocking = findings.filter(f => {
    // New lifecycle scripts staged (except benign prepare: husky) hold the commit
    if (f.ruleId === 'LIF-001' && !f.plain.toLowerCase().includes('husky')) {
      return true;
    }
    return f.severity === 'CRITICAL' || f.severity === 'HIGH';
  });
  if (blocking.length > 0) {
    const top = blocking[0];
    return {
      passed: false,
      held: true,
      reason: `${top.ruleId}: ${top.plain}`,
      findings
    };
  }

  return {
    passed: true,
    held: false,
    reason: 'Quick check passed in staged diff',
    findings
  };
}
