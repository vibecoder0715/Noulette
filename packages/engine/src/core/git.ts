import fs from 'node:fs';
import path from 'node:path';
import { run } from './proc.js';

async function git(cwd: string, args: string[], timeoutMs = 60_000) {
  // Repository hooks are disabled for every git call Noulette makes: a hostile repo must not run code through us.
  const hooksOff = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return run('git', ['-c', `core.hooksPath=${hooksOff}`, '-c', 'protocol.file.allow=user', ...args], { cwd, timeoutMs, env: { GIT_TERMINAL_PROMPT: '0' } });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  if (!fs.existsSync(path.join(dir, '.git'))) return false;
  const r = await git(dir, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

export async function currentBranch(dir: string): Promise<string | null> {
  const r = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const b = r.stdout.trim();
  return r.code === 0 && b && b !== 'HEAD' ? b : null;
}

export async function headCommit(dir: string, ref = 'HEAD'): Promise<string | null> {
  const r = await git(dir, ['rev-parse', ref]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Uncommitted changes, ignoring Noulette's own files (which are gitignored anyway). */
export async function dirtyFiles(dir: string): Promise<string[]> {
  const r = await git(dir, ['status', '--porcelain', '--untracked-files=all']);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ''))
    .filter((f) => !f.startsWith('.noulette/') && !['VULN.md', 'LOGS.md', 'PLAN.md', 'FUTURE.md', '.gitignore'].includes(f));
}

export async function branchExists(dir: string, branch: string): Promise<boolean> {
  const r = await git(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  return r.code === 0;
}

export async function createBranch(dir: string, branch: string): Promise<void> {
  const r = await git(dir, ['checkout', '-b', branch]);
  if (r.code !== 0) throw new Error(`Could not create branch ${branch}: ${r.stderr.trim()}`);
}

export async function checkout(dir: string, branch: string): Promise<void> {
  const r = await git(dir, ['checkout', branch]);
  if (r.code !== 0) throw new Error(`Could not switch to ${branch}: ${r.stderr.trim()}`);
}

/** Commits everything on the current branch. Returns the new commit or null if nothing changed. */
export async function commitAll(dir: string, message: string, exclude: string[] = []): Promise<string | null> {
  await git(dir, ['add', '-A']);
  // Files the user keeps in their working tree (PLAN.md, FUTURE.md, .gitignore) stay unstaged
  // so they are not hidden on the fix branch after switching back.
  for (const f of exclude) await git(dir, ['reset', '-q', '--', f]);
  const st = await git(dir, ['diff', '--cached', '--quiet']);
  if (st.code === 0) return null;
  const r = await git(dir, ['-c', 'user.name=Noulette', '-c', 'user.email=noulette@localhost', 'commit', '--no-verify', '-m', message]);
  if (r.code !== 0) throw new Error(`Commit failed: ${r.stderr.trim()}`);
  return headCommit(dir);
}

export async function isAncestor(dir: string, maybeAncestor: string, ref: string): Promise<boolean> {
  const r = await git(dir, ['merge-base', '--is-ancestor', maybeAncestor, ref]);
  return r.code === 0;
}

export async function diffNames(dir: string, from: string, to = 'HEAD'): Promise<string[]> {
  const r = await git(dir, ['diff', '--name-only', from, to]);
  return r.code === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
}

export async function workingDiffNames(dir: string): Promise<string[]> {
  const a = await git(dir, ['diff', '--name-only', 'HEAD']);
  const b = await git(dir, ['ls-files', '--others', '--exclude-standard']);
  return [...a.stdout.split(/\r?\n/), ...b.stdout.split(/\r?\n/)].filter(Boolean);
}

export async function lsFiles(dir: string): Promise<string[] | null> {
  const r = await git(dir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], 30_000);
  if (r.code !== 0) return null;
  return r.stdout.split('\0').filter(Boolean);
}

/** Top-level folder of the git work tree containing `dir`, or null when it is not inside one. */
export async function repoRoot(dir: string): Promise<string | null> {
  const r = await git(dir, ['rev-parse', '--show-toplevel'], 10_000);
  const top = r.stdout.trim();
  return r.code === 0 && top ? path.resolve(top) : null;
}

export { git as rawGit };
