import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface CandidateTreeOptions {
  excludeDirs?: string[];
}

const DEFAULT_EXCLUDE_DIRS = new Set([
  '.noulette',
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'site-packages',
  'target',
  'dist',
  '.next',
  '.turbo',
  'build'
]);

/**
 * Normalizes string or buffer content to LF line endings.
 */
export function normalizeLf(buffer: Buffer): Buffer {
  // If binary file containing null bytes or non-text, keep bytes as-is
  const isBinary = buffer.includes(0);
  if (isBinary) {
    return buffer;
  }
  const text = buffer.toString('utf8');
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return Buffer.from(normalized, 'utf8');
}

/**
 * Collects relative paths of files in projectPath, excluding standard vendor/git/.noulette.
 */
export function collectCandidateFiles(
  dirPath: string,
  baseDir: string = dirPath,
  excludeDirs: Set<string> = DEFAULT_EXCLUDE_DIRS
): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) {
        continue;
      }
      results.push(...collectCandidateFiles(fullPath, baseDir, excludeDirs));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }

  return results;
}

/**
 * Computes deterministic LF-normalized candidateTreeHash.
 * Returns `sha256:<64-hex>`.
 */
export function computeCandidateTreeHash(
  projectPath: string,
  options: CandidateTreeOptions = {}
): string {
  const excludeDirs = options.excludeDirs
    ? new Set([...DEFAULT_EXCLUDE_DIRS, ...options.excludeDirs])
    : DEFAULT_EXCLUDE_DIRS;

  const files = collectCandidateFiles(projectPath, projectPath, excludeDirs);
  // Sort relative paths in lexicographical byte order
  files.sort();

  const hasher = crypto.createHash('sha256');

  for (const relPath of files) {
    const fullPath = path.join(projectPath, relPath);
    const content = fs.readFileSync(fullPath);
    const normalized = normalizeLf(content);

    // Hash path header + LF-normalized content
    hasher.update(`path:${relPath}\n`);
    hasher.update(`size:${normalized.length}\n`);
    hasher.update(normalized);
    hasher.update('\n');
  }

  const digest = hasher.digest('hex');
  return `sha256:${digest}`;
}
