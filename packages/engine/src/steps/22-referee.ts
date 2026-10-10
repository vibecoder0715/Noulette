import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { computeCandidateTreeHash, collectCandidateFiles } from '../util/candidate-tree.js';
import { isProtectedFile } from './21-start-fix.js';
import { scanCodeMistakes } from './10-code-mistakes.js';
import { scanLeakedKeys } from './09-leaked-keys.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface RefereeOptions {
  runBuildCommand?: string;
  runTestCommand?: string;
  expectedRegressionTest?: string;
}

export interface RefereeVerdict {
  schemaVersion: 1;
  attemptId: string;
  passed: boolean;
  reasons: string[];
  verifiedPatchHash: string | null;
  patch: string | null;
  status: 'passed' | 'failed' | 'needs-person';
  evaluatedAt: string;
}

/**
 * Computes a unified diff between original project and the modified work directory.
 */
export function computeUnifiedDiff(originalDir: string, workDir: string): string {
  const diffLines: string[] = [];
  const origFiles = new Set(collectCandidateFiles(originalDir, originalDir));
  const workFiles = new Set(collectCandidateFiles(workDir, workDir));

  const allFiles = Array.from(new Set([...origFiles, ...workFiles])).sort();

  for (const rel of allFiles) {
    const origPath = path.join(originalDir, rel);
    const workPath = path.join(workDir, rel);

    const origExists = fs.existsSync(origPath);
    const workExists = fs.existsSync(workPath);

    if (!origExists && workExists) {
      const content = fs.readFileSync(workPath, 'utf8');
      diffLines.push(`--- /dev/null`);
      diffLines.push(`+++ b/${rel}`);
      diffLines.push(`@@ -0,0 +1,${content.split('\n').length} @@`);
      content.split('\n').forEach(l => diffLines.push(`+${l}`));
    } else if (origExists && !workExists) {
      const content = fs.readFileSync(origPath, 'utf8');
      diffLines.push(`--- a/${rel}`);
      diffLines.push(`+++ /dev/null`);
      diffLines.push(`@@ -1,${content.split('\n').length} +0,0 @@`);
      content.split('\n').forEach(l => diffLines.push(`-${l}`));
    } else if (origExists && workExists) {
      const origContent = fs.readFileSync(origPath, 'utf8');
      const workContent = fs.readFileSync(workPath, 'utf8');
      if (origContent !== workContent) {
        diffLines.push(`--- a/${rel}`);
        diffLines.push(`+++ b/${rel}`);
        const origL = origContent.split('\n');
        const workL = workContent.split('\n');
        diffLines.push(`@@ -1,${origL.length} +1,${workL.length} @@`);
        origL.forEach(l => diffLines.push(`-${l}`));
        workL.forEach(l => diffLines.push(`+${l}`));
      }
    }
  }

  return diffLines.join('\n');
}

/**
 * Step 22 — Deterministic Referee:
 * Evaluates fix candidate in spare copy against safety invariants, regression tests, and checkers.
 */
export function verifyFix(
  projectPath: string,
  attemptId: string,
  options: RefereeOptions = {}
): RefereeVerdict {
  const normProject = path.resolve(projectPath);
  const attemptDir = path.join(normProject, '.noulette', 'attempts', attemptId);
  const attemptRecordPath = path.join(attemptDir, 'attempt.json');

  if (!fs.existsSync(attemptRecordPath)) {
    throw new Error(`Attempt record not found: ${attemptRecordPath}`);
  }

  const attempt = JSON.parse(fs.readFileSync(attemptRecordPath, 'utf8'));
  const workDir = path.join(attemptDir, 'work');
  const reasons: string[] = [];

  // TC-116: Verify main tree was NOT modified during the attempt
  const currentMainTreeHash = computeCandidateTreeHash(normProject);
  if (currentMainTreeHash !== attempt.baselineTreeHash) {
    reasons.push('main-modified: Main working tree was altered during fix attempt');
    return writeAndReturnVerdict(attemptDir, attemptId, false, reasons, null, null, 'failed');
  }

  // 1. Cheating Detector: inspect modified files
  const origFiles = collectCandidateFiles(normProject, normProject);
  const workFiles = collectCandidateFiles(workDir, workDir);

  // TC-119: Test deletion check
  const origTestFiles = origFiles.filter(f => /tests?\/.*\.test\.[jt]sx?$/i.test(f));
  const workTestFiles = workFiles.filter(f => /tests?\/.*\.test\.[jt]sx?$/i.test(f));
  if (workTestFiles.length < origTestFiles.length) {
    reasons.push('banned-move: test file was deleted or removed');
  }

  // Check file diffs for banned patterns
  for (const rel of workFiles) {
    // TC-121: Edit scanner config or .noulette/ or protected path
    if (isProtectedFile(rel)) {
      const origFile = path.join(normProject, rel);
      const workFile = path.join(workDir, rel);
      if (fs.existsSync(origFile)) {
        if (fs.readFileSync(origFile, 'utf8') !== fs.readFileSync(workFile, 'utf8')) {
          reasons.push(`banned-move: protected file was modified: ${rel}`);
        }
      } else {
        reasons.push(`banned-move: protected file was added: ${rel}`);
      }
    }

    // Inspect content changes
    const workFile = path.join(workDir, rel);
    let workText = '';
    try {
      workText = fs.readFileSync(workFile, 'utf8');
    } catch {
      continue;
    }

    // TC-120 & TC-249: Comment suppressions (nosemgrep, nosec, eslint-disable, @ts-ignore, # noqa, NOSONAR, istanbul ignore, .gitleaksignore)
    if (
      /\/\/\s*nosemgrep/i.test(workText) ||
      /#\s*nosec/i.test(workText) ||
      /\/\*\s*eslint-disable/i.test(workText) ||
      /\/\/\s*eslint-disable/i.test(workText) ||
      /@ts-(?:ignore|expect-error)/i.test(workText) ||
      /#\s*noqa/i.test(workText) ||
      /NOSONAR/i.test(workText) ||
      /istanbul\s+ignore/i.test(workText) ||
      /\.gitleaksignore/i.test(rel)
    ) {
      reasons.push(`banned-move: suppression comment or ignore file detected in ${rel}`);
    }

    // TC-250: Test skip detection in test files
    if (/tests?\/.*\.test\.[jt]sx?$/i.test(rel)) {
      if (
        /\b(?:it|test|describe)\.skip\b/i.test(workText) ||
        /\b(?:xit|xdescribe|xtest)\b/i.test(workText)
      ) {
        reasons.push(`banned-move: test skipped or weakened in ${rel}`);
      }
    }

    // TC-251: test script changed to exit 0 or relaxed tsconfig
    if (rel === 'package.json') {
      if (/"test"\s*:\s*"exit\s+0"/i.test(workText) || /"test"\s*:\s*"echo/i.test(workText)) {
        reasons.push('banned-move: test script faked with exit 0 in package.json');
      }
    }
    if (/tsconfig.*\.json$/i.test(rel)) {
      if (/"strict"\s*:\s*false/i.test(workText)) {
        reasons.push('banned-move: strict mode disabled in tsconfig');
      }
    }

    // TC-122: Widened permissions or CORS wildcard
    if (
      /cors\s*\(\s*\{\s*origin\s*:\s*['"]\*['"]\s*,\s*credentials\s*:\s*true/i.test(workText) ||
      /Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"].*credentials/i.test(workText)
    ) {
      reasons.push(`banned-move: security permissions or CORS widened in ${rel}`);
    }

    // TC-123: Disabled rules
    if (
      /(["']?rules["']?)\s*:\s*\[\s*\]/i.test(workText) && /config/i.test(rel)
    ) {
      reasons.push(`banned-move: rule configuration disabled in ${rel}`);
    }
  }

  // TC-124: Check if build or syntax is broken
  if (options.runBuildCommand) {
    try {
      execSync(options.runBuildCommand, { cwd: workDir, stdio: 'pipe' });
    } catch (err: any) {
      reasons.push(`build-failed: ${err.message || 'Build command failed'}`);
    }
  }

  // 2. Re-run scanners on workDir to ensure finding is eradicated and no new findings
  let isSecretFindingResolved = false;
  const origMistakes = scanCodeMistakes(normProject);
  const workMistakes = scanCodeMistakes(workDir);

  const origKeys = scanLeakedKeys(normProject);
  const workKeys = scanLeakedKeys(workDir);

  // TC-118: Check if new security findings were introduced
  const hasNewMistake = workMistakes.findings.some(wf =>
    !origMistakes.findings.some(of => of.fingerprint === wf.fingerprint && of.ruleId === wf.ruleId)
  );
  if (hasNewMistake || workMistakes.findings.length > origMistakes.findings.length) {
    reasons.push('regression-new-findings: Fix introduced new code mistakes findings');
  }
  if (workKeys.length > origKeys.length) {
    reasons.push('regression-new-findings: Fix introduced new leaked keys');
  }

  // TC-128: Secret removed from code transitions to needs-person (user must rotate key)
  if (origKeys.length > 0 && workKeys.length === 0) {
    isSecretFindingResolved = true;
  }

  // Check if target findings were resolved
  if (attempt.findingIds && attempt.findingIds.length > 0) {
    // If working tree still has the exact same findings count on code mistakes:
    if (origMistakes.findings.length > 0 && workMistakes.findings.length >= origMistakes.findings.length) {
      // Check if target finding is still present
      const stillPresent = workMistakes.findings.some(wf => attempt.findingIds.includes(wf.id));
      if (stillPresent) {
        reasons.push('finding-not-resolved: Target code finding was not resolved by the fix');
      }
    }
  }

  if (reasons.length > 0) {
    return writeAndReturnVerdict(attemptDir, attemptId, false, reasons, null, null, 'failed');
  }

  // Generate patch and verifiedPatchHash
  const patch = computeUnifiedDiff(normProject, workDir);
  const patchHash = crypto.createHash('sha256').update(patch, 'utf8').digest('hex');
  const verifiedPatchHash = `sha256:${patchHash}`;

  // TC-128: Secret key removal needs human confirmation of rotation
  const finalStatus = isSecretFindingResolved ? 'needs-person' : 'passed';

  return writeAndReturnVerdict(
    attemptDir,
    attemptId,
    true,
    [],
    verifiedPatchHash,
    patch,
    finalStatus
  );
}

function writeAndReturnVerdict(
  attemptDir: string,
  attemptId: string,
  passed: boolean,
  reasons: string[],
  verifiedPatchHash: string | null,
  patch: string | null,
  status: 'passed' | 'failed' | 'needs-person'
): RefereeVerdict {
  const verdict: RefereeVerdict = {
    schemaVersion: 1,
    attemptId,
    passed,
    reasons,
    verifiedPatchHash,
    patch,
    status,
    evaluatedAt: new Date().toISOString()
  };

  const verdictPath = path.join(attemptDir, 'referee-verdict.json');
  atomicWriteJsonSync(verdictPath, verdict);

  return verdict;
}
