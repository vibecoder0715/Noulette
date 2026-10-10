import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Root data directory. Override with NOULETTE_HOME (used by tests and the cloud worker). */
export function dataDir(): string {
  const override = process.env.NOULETTE_HOME;
  const base = override
    ? override
    : process.platform === 'win32' && process.env.APPDATA
      ? path.join(process.env.APPDATA, 'noulette')
      : path.join(os.homedir(), '.noulette');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function dataPath(...parts: string[]): string {
  const p = path.join(dataDir(), ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

/** Per-project private working folder (gitignored). */
export function projectWorkDir(projectPath: string, ...parts: string[]): string {
  const p = path.join(projectPath, '.noulette', ...parts);
  fs.mkdirSync(parts.length ? path.dirname(p) : p, { recursive: true });
  return p;
}

/** Normalises a user-supplied project path to an absolute, case-stable key. */
export function normalizeProjectPath(p: string): string {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.replace(/[\\/]+$/, '') : abs.replace(/\/+$/, '');
}

export function projectKey(p: string): string {
  const n = normalizeProjectPath(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/**
 * Resolves `rel` inside `root`, refusing anything that escapes the root
 * (path traversal, absolute paths, other drives).
 */
export function safeJoin(root: string, rel: string): string | null {
  const resolved = path.resolve(root, rel);
  const r = path.relative(root, resolved);
  if (r === '') return resolved;
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return resolved;
}

/** Directory holding bundled scanner binaries. */
export function scannersDir(): string {
  const candidates = [
    process.env.NOULETTE_SCANNERS,
    path.join(path.dirname(process.execPath), 'scanners'),
    path.join(path.dirname(process.execPath), 'resources', 'scanners'),
    path.resolve(import.meta.dir, '..', '..', '..', '..', 'apps', 'desktop', 'src-tauri', 'resources', 'scanners')
  ].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[candidates.length - 1];
}

/** Directory holding curated rule packs (shipped with app updates). */
export function rulesDir(): string {
  const candidates = [
    process.env.NOULETTE_RULES,
    path.join(path.dirname(process.execPath), 'rules'),
    path.join(path.dirname(process.execPath), 'resources', 'rules'),
    path.resolve(import.meta.dir, '..', '..', '..', '..', 'rules')
  ].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[candidates.length - 1];
}
