import fs from 'node:fs';
import path from 'node:path';
import { generateUlid } from '../util/ulid.js';
import { computeCandidateTreeHash } from '../util/candidate-tree.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface StartFixOptions {
  tier?: 'Low' | 'Medium' | 'High';
  preserveEnvMock?: boolean;
}

export interface AttemptRecord {
  schemaVersion: 1;
  attemptId: string;
  findingIds: string[];
  baselineTreeHash: string;
  workDir: string;
  tier: 'Low' | 'Medium' | 'High';
  startedAt: string;
  status: 'active' | 'verified' | 'failed' | 'held' | 'discarded';
}

export const PROTECTED_FILE_PATTERNS = [
  /^\.noulette\//i,
  /^\.github\/workflows\//i,
  /^rules\//i,
  /^\.gitleaks\.toml$/i,
  /^\.semgrep\.yml$/i,
  /tests?\/.*\.test\.[jt]sx?$/i,
  /tests?\/.*\.spec\.[jt]sx?$/i
];

/**
 * Checks if a relative path is a protected file that cannot be modified by a fix.
 */
export function isProtectedFile(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  return PROTECTED_FILE_PATTERNS.some(regex => regex.test(norm));
}

/**
 * Copies source directory to destination, strictly redacting .env files and excluding git/caches.
 */
export function copyProjectForFix(srcDir: string, destDir: string): void {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const excludeDirs = new Set(['.git', '.noulette', 'node_modules', 'dist', '.next', 'out', 'vendor']);

  function walk(currentSrc: string, currentDest: string) {
    const entries = fs.readdirSync(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        const nextDest = path.join(currentDest, entry.name);
        fs.mkdirSync(nextDest, { recursive: true });
        walk(path.join(currentSrc, entry.name), nextDest);
      } else if (entry.isFile()) {
        // Redact .env files in work copy to prevent secret access
        if (entry.name.startsWith('.env')) {
          fs.writeFileSync(path.join(currentDest, entry.name), '# REDACTED FOR FIX RUNNER\n', 'utf8');
        } else {
          fs.copyFileSync(path.join(currentSrc, entry.name), path.join(currentDest, entry.name));
        }
      }
    }
  }

  walk(srcDir, destDir);
}

/**
 * Step 21 — AI Fixes a Spare Copy:
 * Creates a worktree snapshot in .noulette/attempts/<id>/work/ preserving working tree.
 * The main working tree is left completely untouched (TC-115).
 */
export function startFix(
  projectPath: string,
  findingIds: string[],
  options: StartFixOptions = {}
): AttemptRecord {
  const normProject = path.resolve(projectPath);
  const baselineTreeHash = computeCandidateTreeHash(normProject);
  const attemptId = `att_${generateUlid()}`;

  const attemptDir = path.join(normProject, '.noulette', 'attempts', attemptId);
  const workDir = path.join(attemptDir, 'work');

  // Snapshot project working tree into work directory
  copyProjectForFix(normProject, workDir);

  const attemptRecord: AttemptRecord = {
    schemaVersion: 1,
    attemptId,
    findingIds,
    baselineTreeHash,
    workDir,
    tier: options.tier || 'Medium',
    startedAt: new Date().toISOString(),
    status: 'active'
  };

  atomicWriteJsonSync(path.join(attemptDir, 'attempt.json'), attemptRecord);

  return attemptRecord;
}
