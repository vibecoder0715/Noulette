import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export type FileVisibility = 'pushed' | 'shipped' | 'local' | 'pushed-pending';

export interface FileClassification {
  file: string;
  visibility: FileVisibility[];
  isIgnored: boolean;
  isTracked: boolean;
  inDockerContext: boolean;
  isBuildArtifact: boolean;
}

export interface FileMap {
  schemaVersion: 1;
  files: Record<string, FileClassification>;
  classifiedAt: string;
}

/**
 * Step 8 — Classify Files:
 * Identifies visibility of every file in the project (pushed, shipped, local, pushed-pending).
 */
export function classifyFiles(projectPath: string): FileMap {
  const normProject = path.resolve(projectPath);
  const filesMap: Record<string, FileClassification> = {};

  // Read git status and files if git is available
  const trackedFiles = new Set<string>();
  const ignoredFiles = new Set<string>();
  const untrackedNonIgnored = new Set<string>();

  try {
    const trackedOut = execSync('git ls-files', { cwd: normProject, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    trackedOut.split('\n').map(l => l.trim()).filter(Boolean).forEach(f => trackedFiles.add(f.replace(/\\/g, '/')));

    const ignoredOut = execSync('git ls-files -o -i --exclude-standard', { cwd: normProject, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    ignoredOut.split('\n').map(l => l.trim()).filter(Boolean).forEach(f => ignoredFiles.add(f.replace(/\\/g, '/')));

    const othersOut = execSync('git ls-files -o --exclude-standard', { cwd: normProject, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    othersOut.split('\n').map(l => l.trim()).filter(Boolean).forEach(f => untrackedNonIgnored.add(f.replace(/\\/g, '/')));
  } catch {
    // Non-git directory: treat all files as tracked
  }

  // Parse Dockerfile and .dockerignore
  const dockerfilePath = path.join(normProject, 'Dockerfile');
  let hasDockerCopyAll = false;
  if (fs.existsSync(dockerfilePath)) {
    try {
      const dockerContent = fs.readFileSync(dockerfilePath, 'utf8');
      if (/COPY\s+\.\s+\./i.test(dockerContent) || /ADD\s+\.\s+\./i.test(dockerContent)) {
        hasDockerCopyAll = true;
      }
    } catch {
      // ignore
    }
  }

  const dockerIgnoredPatterns = new Set<string>();
  const dockerignorePath = path.join(normProject, '.dockerignore');
  if (fs.existsSync(dockerignorePath)) {
    try {
      const diContent = fs.readFileSync(dockerignorePath, 'utf8');
      diContent.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).forEach(p => dockerIgnoredPatterns.add(p.replace(/\\/g, '/')));
    } catch {
      // ignore
    }
  }

  function isExcludedByDockerIgnore(relPath: string): boolean {
    const norm = relPath.replace(/\\/g, '/');
    const base = path.basename(norm);
    if (dockerIgnoredPatterns.has(norm) || dockerIgnoredPatterns.has(base)) return true;
    for (const pat of dockerIgnoredPatterns) {
      if (pat.endsWith('/') && norm.startsWith(pat)) return true;
      if (pat.startsWith('*') && norm.endsWith(pat.slice(1))) return true;
    }
    return false;
  }

  // Walk all files in project
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(normProject, fullPath).replace(/\\/g, '/');

      if (entry.name === '.git' || entry.name === '.noulette') continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const isTracked = trackedFiles.has(relPath);
        const isIgnored = ignoredFiles.has(relPath);
        const isPending = untrackedNonIgnored.has(relPath);

        const inDocker = hasDockerCopyAll && !isExcludedByDockerIgnore(relPath);

        // Check build artifact paths or public assets (shipped)
        const isBuildArtifact =
          relPath.startsWith('dist/') ||
          relPath.startsWith('.next/static/') ||
          relPath.startsWith('.next/standalone/') ||
          relPath.startsWith('build/') ||
          relPath.startsWith('out/');

        const isPublicAsset = relPath.startsWith('public/');

        const visibility: FileVisibility[] = [];

        if (isTracked) {
          visibility.push('pushed');
        } else if (isPending) {
          visibility.push('pushed-pending');
        }

        if (isBuildArtifact || isPublicAsset || inDocker) {
          visibility.push('shipped');
        }

        if (isIgnored && !inDocker && !isBuildArtifact && !isPublicAsset) {
          visibility.push('local');
        }

        if (visibility.length === 0) {
          visibility.push(isTracked ? 'pushed' : 'local');
        }

        filesMap[relPath] = {
          file: relPath,
          visibility,
          isIgnored,
          isTracked,
          inDockerContext: inDocker,
          isBuildArtifact: isBuildArtifact || isPublicAsset
        };
      }
    }
  }

  walk(normProject);

  const fileMap: FileMap = {
    schemaVersion: 1,
    files: filesMap,
    classifiedAt: new Date().toISOString()
  };

  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }
  atomicWriteJsonSync(path.join(nouletteDir, 'filemap.json'), fileMap);

  return fileMap;
}
