import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Finding } from '../schema/finding.schema.js';
import { generateFindingId } from '../util/ulid.js';
import { computeFindingFingerprint } from '../util/secret-hmac.js';
import {
  parsePackageLockJson,
  parsePnpmLockYaml,
  parseYarnLock,
  parseRequirementsTxt,
  type PackageEntry
} from '../ingredients/lockfile-parsers.js';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface OsvAdvisory {
  id: string; // e.g. GHSA-..., CVE-..., MAL-...
  packageName: string;
  affectedVersion: string;
  fixedVersion?: string;
  summary: string;
}

export interface IngredientsOptions {
  candidateId?: string;
  mockOsvAdvisories?: OsvAdvisory[];
  mockKevList?: string[]; // List of CVEs in CISA KEV
  simulateOsvOffline?: boolean;
}

export interface Inventory {
  schemaVersion: 1;
  packages: PackageEntry[];
  checkedCount: number;
  uncheckedCount: number;
  advisoriesCount: number;
  isStaleCache?: boolean;
  generatedAt: string;
}

/**
 * Computes fix size: patch, minor, major
 */
export function computeFixSize(current: string, fixed?: string): 'patch' | 'minor' | 'major' | 'unknown' {
  if (!fixed) return 'unknown';
  const cParts = current.split('.').map(n => parseInt(n, 10));
  const fParts = fixed.split('.').map(n => parseInt(n, 10));

  if (cParts.length >= 1 && fParts.length >= 1 && fParts[0] > cParts[0]) {
    return 'major';
  }
  if (cParts.length >= 2 && fParts.length >= 2 && fParts[1] > cParts[1]) {
    return 'minor';
  }
  return 'patch';
}

/**
 * Step 11 — Ingredients:
 * Analyzes dependencies from lockfiles against OSV/KEV datasets.
 */
export function scanIngredients(
  projectPath: string,
  options: IngredientsOptions = {}
): { findings: Finding[]; inventory: Inventory } {
  const normProject = path.resolve(projectPath);
  const candidateId = options.candidateId || 'cand_01J00000000000000000000000';
  const findings: Finding[] = [];

  let packages: PackageEntry[] = [];
  let lockfileName = '';

  const lockCandidates = [
    { file: 'package-lock.json', parser: parsePackageLockJson },
    { file: 'pnpm-lock.yaml', parser: parsePnpmLockYaml },
    { file: 'yarn.lock', parser: parseYarnLock },
    { file: 'requirements.txt', parser: parseRequirementsTxt }
  ];

  for (const { file, parser } of lockCandidates) {
    const p = path.join(normProject, file);
    if (fs.existsSync(p)) {
      try {
        packages.push(...parser(p));
        lockfileName = file;
      } catch {
        // ignore parse error
      }
    }
  }

  const advisories = options.mockOsvAdvisories || [];
  const kevSet = new Set(options.mockKevList || []);

  let uncheckedCount = 0;
  let checkedCount = 0;

  for (const pkg of packages) {
    const matchingAdv = advisories.filter(a => a.packageName.toLowerCase() === pkg.name.toLowerCase());
    if (matchingAdv.length === 0) {
      uncheckedCount++;
    } else {
      checkedCount++;
    }

    for (const adv of matchingAdv) {
      const isMalicious = adv.id.startsWith('MAL-');
      const isKev = kevSet.has(adv.id);
      const fixSize = computeFixSize(pkg.version, adv.fixedVersion);

      const severity = isMalicious ? 'critical' : (isKev ? 'high' : 'medium');
      const isBlocking = isMalicious || isKev;

      const snippet = `${pkg.name}@${pkg.version} -> ${adv.id} (fix: ${adv.fixedVersion || 'none'}, size: ${fixSize})`;
      const snippetHash = crypto.createHash('sha256').update(snippet).digest('hex');
      const fingerprint = computeFindingFingerprint(adv.id, lockfileName || 'dependencies', 1, snippet);

      findings.push({
        schemaVersion: 1,
        id: generateFindingId(),
        fingerprint,
        candidateId,
        source: 'ingredients',
        ruleId: adv.id,
        occurrenceIndex: 1,
        what: `Vulnerable dependency: ${pkg.name}@${pkg.version} (${adv.id})${isKev ? ' [CISA KEV Known Exploited]' : ''}${isMalicious ? ' [Malicious Package]' : ''}`,
        where: { file: lockfileName || 'package-lock.json', line: null },
        visibility: pkg.isDev ? ['local'] : ['shipped'],
        urgency: isBlocking ? 'fix-before-launch' : 'fix-soon',
        severity,
        confidence: 'confirmed',
        blocking: isBlocking,
        evidence: {
          snippetHash,
          excerpt: snippet,
          request: { fixSize, fixedVersion: adv.fixedVersion, direct: pkg.isDirect, dev: pkg.isDev }
        },
        howToFix: adv.fixedVersion
          ? `Upgrade ${pkg.name} to version ${adv.fixedVersion} (${fixSize} update).`
          : `Remove or replace ${pkg.name}. No fixed version available.`,
        youMustDo: [`Update lockfile and re-run check`],
        status: 'open',
        attempts: 0
      });
    }
  }

  const inventory: Inventory = {
    schemaVersion: 1,
    packages,
    checkedCount,
    uncheckedCount,
    advisoriesCount: findings.length,
    isStaleCache: options.simulateOsvOffline,
    generatedAt: new Date().toISOString()
  };

  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }
  atomicWriteJsonSync(path.join(nouletteDir, 'inventory.json'), inventory);

  return { findings, inventory };
}
