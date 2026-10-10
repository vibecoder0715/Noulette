import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface ArtifactFileEntry {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface SealRecord {
  schemaVersion: 1;
  sealedAt: string;
  artifactDir: string;
  filesCount: number;
  totalBytes: number;
  files: Record<string, ArtifactFileEntry>;
  merkleRoot: string;
}

/**
 * Step 28 — Build Once, Seal It:
 * Computes deterministic Merkle SHA256 tree of build artifacts (TC-134).
 */
export function sealBuildDirectory(
  artifactDir: string,
  projectPath: string = artifactDir
): SealRecord {
  const normArtifact = path.resolve(artifactDir);
  const normProject = path.resolve(projectPath);

  if (!fs.existsSync(normArtifact)) {
    throw new Error(`Artifact directory does not exist: ${normArtifact}`);
  }

  const entries: Record<string, ArtifactFileEntry> = {};
  let totalBytes = 0;

  function walk(currentDir: string) {
    const list = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const item of list) {
      const fullPath = path.join(currentDir, item.name);
      const relPath = path.relative(normArtifact, fullPath).replace(/\\/g, '/');

      if (item.isDirectory()) {
        walk(fullPath);
      } else if (item.isFile()) {
        const buffer = fs.readFileSync(fullPath);
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        totalBytes += buffer.length;

        entries[relPath] = {
          path: relPath,
          sizeBytes: buffer.length,
          sha256: `sha256:${hash}`
        };
      }
    }
  }

  walk(normArtifact);

  // Compute Merkle root by sorting relative paths and hashing combined leaves
  const sortedPaths = Object.keys(entries).sort();
  const merkleHasher = crypto.createHash('sha256');

  for (const p of sortedPaths) {
    merkleHasher.update(`${p}:${entries[p].sha256}\n`);
  }

  const merkleRoot = `sha256:${merkleHasher.digest('hex')}`;

  const sealRecord: SealRecord = {
    schemaVersion: 1,
    sealedAt: new Date().toISOString(),
    artifactDir: normArtifact,
    filesCount: sortedPaths.length,
    totalBytes,
    files: entries,
    merkleRoot
  };

  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }

  const sealPath = path.join(nouletteDir, 'seal.json');
  atomicWriteJsonSync(sealPath, sealRecord);

  return sealRecord;
}

/**
 * Verifies build artifacts against existing seal.json (TC-134).
 */
export function verifySeal(
  artifactDir: string,
  projectPath: string = artifactDir
): { matches: boolean; reason?: string; expectedMerkle?: string; actualMerkle?: string } {
  const normProject = path.resolve(projectPath);
  const sealPath = path.join(normProject, '.noulette', 'seal.json');

  if (!fs.existsSync(sealPath)) {
    return { matches: false, reason: 'seal.json does not exist' };
  }

  const existingSeal: SealRecord = JSON.parse(fs.readFileSync(sealPath, 'utf8'));

  // Re-compute seal over current artifact directory without overwriting
  const currentSeal = sealBuildDirectory(artifactDir, path.join(normProject, '.noulette', 'temp-verify'));

  if (currentSeal.merkleRoot !== existingSeal.merkleRoot) {
    return {
      matches: false,
      reason: `Artifact Merkle root mismatch: expected ${existingSeal.merkleRoot}, got ${currentSeal.merkleRoot}`,
      expectedMerkle: existingSeal.merkleRoot,
      actualMerkle: currentSeal.merkleRoot
    };
  }

  return { matches: true, expectedMerkle: existingSeal.merkleRoot, actualMerkle: currentSeal.merkleRoot };
}
