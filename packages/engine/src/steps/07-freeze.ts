import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { computeCandidateTreeHash } from '../util/candidate-tree.js';
import { CandidateSchema, type Candidate } from '../schema/candidate.schema.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';
import { loadGlobalConfig } from './01-arrival.js';

export interface FreezeOptions {
  tier?: 'Low' | 'Medium' | 'High';
  rulesHash?: string;
  configHash?: string;
  opengrepPath?: string | null;
  gitleaksPath?: string | null;
}

/**
 * Derives a deterministic candidate ID matching /^cand_[0-9A-Z]{26}$/ from tree and config hashes.
 */
export function deriveDeterministicCandidateId(seed: string): string {
  const hash = crypto.createHash('sha256').update(seed).digest('hex').toUpperCase();
  // Take first 26 chars
  return `cand_${hash.slice(0, 26)}`;
}

/**
 * Step 7 — Freeze the Candidate:
 * Computes defined content tree hash, pins tool versions, lockfile hash, rules hash,
 * and outputs .noulette/candidate.json.
 */
export function freezeCandidate(
  projectPath: string,
  options: FreezeOptions = {}
): Candidate {
  const config = loadGlobalConfig();
  const tier = options.tier || config.effortTier;

  // 1. Candidate content tree hash
  const candidateTreeHash = computeCandidateTreeHash(projectPath);

  // 2. Git commit hash (nullable for non-git)
  let gitCommitHash: string | null = null;
  let commit: string | null = null;
  try {
    const head = execSync('git rev-parse HEAD', {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (/^[a-f0-9]{40}$/i.test(head)) {
      gitCommitHash = head.toLowerCase();
      commit = head.slice(0, 7);
    }
  } catch {
    // Non-git or no commit yet
  }

  // 3. Lockfile hash (nullable)
  let lockfileHash: string | null = null;
  const lockCandidates = [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'bun.lock',
    'poetry.lock',
    'Pipfile.lock',
    'requirements.txt'
  ];
  for (const lockName of lockCandidates) {
    const lockPath = path.join(projectPath, lockName);
    if (fs.existsSync(lockPath)) {
      const data = fs.readFileSync(lockPath);
      lockfileHash = `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
      break;
    }
  }

  // 4. Rules & config hashes
  const rulesHash = options.rulesHash || `sha256:${crypto.createHash('sha256').update('rules-v1').digest('hex')}`;
  const configHash = options.configHash || `sha256:${crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex')}`;

  // 5. Tool versions probe
  let opengrepVer: string | null = null;
  const opengrepBin = options.opengrepPath || config.scanners.opengrepPath;
  if (opengrepBin && fs.existsSync(opengrepBin)) {
    try {
      opengrepVer = execSync(`"${opengrepBin}" --version`, { encoding: 'utf8' }).trim();
    } catch {
      // unavailable
    }
  }

  let gitleaksVer: string | null = null;
  const gitleaksBin = options.gitleaksPath || config.scanners.gitleaksPath;
  if (gitleaksBin && fs.existsSync(gitleaksBin)) {
    try {
      gitleaksVer = execSync(`"${gitleaksBin}" version`, { encoding: 'utf8' }).trim();
    } catch {
      // unavailable
    }
  }

  // Deterministic candidate ID
  const candidateId = deriveDeterministicCandidateId(`${candidateTreeHash}:${rulesHash}:${configHash}:${tier}`);

  const candidate: Candidate = {
    schemaVersion: 1,
    candidateId,
    commit,
    gitCommitHash,
    candidateTreeHash,
    lockfileHash,
    rulesHash,
    configHash,
    toolVersions: {
      engine: '0.1.0',
      opengrep: opengrepVer,
      gitleaks: gitleaksVer
    },
    tier,
    frozenAt: new Date().toISOString()
  };

  // Validate against CandidateSchema
  CandidateSchema.parse(candidate);

  // Write to .noulette/candidate.json
  const nouletteDir = path.join(projectPath, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }

  atomicWriteJsonSync(path.join(nouletteDir, 'candidate.json'), candidate);

  return candidate;
}
