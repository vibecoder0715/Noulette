import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { closeDb } from '../packages/engine/src/core/db.ts';

export const ROOT = path.resolve(import.meta.dir, '..');
export const ENGINE_CLI = path.join(ROOT, 'packages', 'engine', 'src', 'cli.ts');
export const FIXTURE_SHOP = path.join(ROOT, 'tests', 'fixtures', 'shop-app');

/** Fresh, isolated Noulette data folder for one test file or case. */
export function tempHome(): string {
  closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-home-'));
  process.env.NOULETTE_HOME = dir;
  return dir;
}

export function tempDir(prefix = 'nl-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

/** Copies a fixture into a temp folder so tests can modify it. */
export function copyFixture(src: string): string {
  const dst = tempDir('nl-repo-');
  fs.cpSync(src, dst, { recursive: true });
  return dst;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function initRepo(dir: string): void {
  git(dir, 'init', '-q');
  git(dir, 'checkout', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
}

export function rm(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}
