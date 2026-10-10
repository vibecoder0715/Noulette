import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';
import { normalizeProjectPath, projectKey } from './paths.js';
import { lsFiles } from './git.js';

export type ProjectStatus = 'ready' | 'inspecting' | 'needs_approval' | 'building' | 'branch_waiting';

export interface ProjectState {
  status: ProjectStatus;
  inspectionId?: string | null;
  lastInspectedAt?: number | null;
  stage?: string | null;
  branch?: { name: string; base: string; head: string; rollback: string; fixed: number; needsYou: number; notificationId: string } | null;
}

export interface ProjectRow {
  key: string;
  path: string;
  name: string;
  added_at: number;
  last_opened: number;
  state: ProjectState;
}

function parse(r: any): ProjectRow {
  return { ...r, state: { status: 'ready', ...JSON.parse(r.state || '{}') } };
}

export function registerProject(p: string): ProjectRow {
  const abs = normalizeProjectPath(p);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Folder not found: ${abs}`);
  const key = projectKey(abs);
  const db = getDb();
  const now = Date.now();
  db.query(
    'INSERT INTO projects(key, path, name, added_at, last_opened) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET last_opened = excluded.last_opened, path = excluded.path'
  ).run(key, abs, path.basename(abs), now, now);
  return getProject(abs)!;
}

export function getProject(p: string): ProjectRow | null {
  const r = getDb().query('SELECT * FROM projects WHERE key = ?').get(projectKey(p));
  return r ? parse(r) : null;
}

export function listProjects(): ProjectRow[] {
  return (getDb().query('SELECT * FROM projects ORDER BY last_opened DESC').all() as any[]).map(parse);
}

export function removeProject(p: string): void {
  getDb().query('DELETE FROM projects WHERE key = ?').run(projectKey(p));
}

export function setProjectState(p: string, patch: Partial<ProjectState>): ProjectState {
  const cur = getProject(p) ?? registerProject(p);
  const next = { ...cur.state, ...patch };
  getDb().query('UPDATE projects SET state = ? WHERE key = ?').run(JSON.stringify(next), projectKey(p));
  return next;
}

export function activeProject(): ProjectRow | null {
  return listProjects()[0] ?? null;
}

export function setActiveProject(p: string): ProjectRow {
  return registerProject(p);
}

// ------------------------------------------------------------- file listing

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.noulette', 'dist', 'build', 'out', '.next', '.nuxt', 'target', 'vendor', 'venv', '.venv',
  '__pycache__', '.pytest_cache', '.idea', '.vscode-test', 'coverage', 'bin', 'obj', '.gradle', '.terraform', 'Pods'
]);

export const SOURCE_EXT = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.java', '.kt', '.kts', '.go', '.rs', '.rb', '.php', '.cs', '.fs',
  '.vb', '.swift', '.m', '.mm', '.c', '.h', '.cc', '.cpp', '.hpp', '.scala', '.clj', '.ex', '.exs', '.erl', '.dart',
  '.lua', '.pl', '.r', '.jl', '.sh', '.ps1', '.bat', '.sql', '.vue', '.svelte', '.astro', '.html', '.css', '.scss',
  '.sol', '.zig', '.nim', '.hs', '.ml', '.groovy', '.apex', '.cls', '.tf', '.hcl'
]);

const CONFIG_NAMES = /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|tsconfig.*\.json|\.eslintrc.*|\.prettierrc.*|.*\.config\.(js|ts|mjs|cjs)|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock)$/i;

/** Lists repo files (relative, forward slashes), honouring .gitignore when the folder is a git repo. */
export async function listRepoFiles(root: string, max = 50_000): Promise<string[]> {
  const fromGit = await lsFiles(root);
  // An empty listing (e.g. the folder is ignored by a parent repo) is not trusted: walk the folder instead.
  // Entries ending in "/" are nested repositories; they belong to their own project.
  if (fromGit && fromGit.length) {
    return fromGit
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => !f.endsWith('/') && !f.split('/').some((s) => IGNORED_DIRS.has(s)) && fs.existsSync(path.join(root, f)))
      .slice(0, max);
  }
  const out: string[] = [];
  walkFiles(root, (r) => {
    out.push(r);
    return out.length < max;
  });
  return out;
}

/** Walks files under root (skipping ignored folders and nested repositories). Stop by returning false. */
function walkFiles(root: string, visit: (rel: string) => boolean): void {
  let going = true;
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!going) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const full = path.join(dir, e.name);
        if (!IGNORED_DIRS.has(e.name) && !fs.existsSync(path.join(full, '.git'))) walk(full, r);
      } else if (e.isFile()) going = visit(r);
    }
  };
  walk(root, '');
}

/** Git repositories directly inside `dir` (one level), e.g. a folder holding several projects. */
export function childRepos(dir: string): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && fs.existsSync(path.join(dir, e.name, '.git')))
    .map((e) => path.join(dir, e.name));
}

export interface RepoSize {
  sourceFiles: number;
  codeLines: number;
  empty: boolean;
}

export const EMPTY_REPO_MESSAGE = 'Noulette is an MCP that finds problems in existing repositories, go build one first!';

/** Empty repo = fewer than 3 source files OR under 100 lines of non-config code. */
export async function measureRepo(root: string): Promise<RepoSize> {
  let sourceFiles = 0;
  let codeLines = 0;
  // Only source files count, and there is no file cap: big asset folders cannot hide the code.
  for (const f of await listRepoFiles(root, Number.MAX_SAFE_INTEGER)) {
    if (!SOURCE_EXT.has(path.extname(f).toLowerCase()) || CONFIG_NAMES.test(f)) continue;
    sourceFiles++;
    if (codeLines < 100) {
      try {
        const text = fs.readFileSync(path.join(root, f), 'utf8');
        codeLines += text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(\/\/|#|\/\*|\*|--)/.test(l)).length;
      } catch {}
    }
  }
  return { sourceFiles, codeLines, empty: sourceFiles < 3 || codeLines < 100 };
}

/** Ensures entries exist in the repo .gitignore (VULN.md, LOGS.md, .noulette/). */
export function ensureGitignore(root: string, entries: string[]): void {
  const f = path.join(root, '.gitignore');
  const existing = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const lines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = entries.filter((e) => !lines.has(e) && !lines.has('/' + e));
  if (!missing.length) return;
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(f, existing + prefix + '# Noulette (private findings and logs)\n' + missing.join('\n') + '\n');
}
