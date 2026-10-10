import { getDb, newId } from './db.js';
import { projectKey } from './paths.js';

export interface RunRow<T = any> {
  id: string;
  project: string;
  kind: 'inspection' | 'build';
  status: string;
  started_at: number;
  finished_at: number | null;
  data: T;
}

const parse = (r: any): RunRow => ({ ...r, data: JSON.parse(r.data || '{}') });

export function createRun<T>(project: string, kind: RunRow['kind'], status: string, data: T): RunRow<T> {
  const id = newId(kind === 'inspection' ? 'ins' : 'bld');
  getDb().query('INSERT INTO runs(id, project, kind, status, started_at, data) VALUES (?,?,?,?,?,?)').run(id, projectKey(project), kind, status, Date.now(), JSON.stringify(data));
  return getRun(id)!;
}

export function getRun<T = any>(id: string): RunRow<T> | null {
  const r = getDb().query('SELECT * FROM runs WHERE id=?').get(id);
  return r ? parse(r) : null;
}

export function latestRun<T = any>(project: string, kind: RunRow['kind']): RunRow<T> | null {
  const r = getDb().query('SELECT * FROM runs WHERE project=? AND kind=? ORDER BY started_at DESC LIMIT 1').get(projectKey(project), kind);
  return r ? parse(r) : null;
}

export function updateRun<T>(id: string, patch: { status?: string; data?: Partial<T>; finished?: boolean }): RunRow<T> {
  const cur = getRun<T>(id);
  if (!cur) throw new Error('run not found');
  const data = { ...cur.data, ...(patch.data ?? {}) };
  getDb()
    .query('UPDATE runs SET status=?, data=?, finished_at=? WHERE id=?')
    .run(patch.status ?? cur.status, JSON.stringify(data), patch.finished ? Date.now() : cur.finished_at, id);
  return getRun<T>(id)!;
}

/**
 * Long jobs (scans) keep running in the background while an MCP call returns early,
 * so clients with short tool timeouts can simply call again.
 */
const jobs = new Map<string, Promise<unknown>>();
const results = new Map<string, { ok: boolean; value?: unknown; error?: string }>();

export async function runJob<T>(key: string, fn: () => Promise<T>, waitMs: number): Promise<{ done: true; value: T } | { done: false }> {
  if (results.has(key)) {
    const r = results.get(key)!;
    results.delete(key);
    if (!r.ok) throw new Error(r.error);
    return { done: true, value: r.value as T };
  }
  if (!jobs.has(key)) {
    const p = fn()
      .then((value) => results.set(key, { ok: true, value }))
      .catch((e) => results.set(key, { ok: false, error: e?.message ?? String(e) }))
      .finally(() => jobs.delete(key));
    jobs.set(key, p);
  }
  const p = jobs.get(key)!;
  const timedOut = await Promise.race([p.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), waitMs))]);
  if (timedOut) return { done: false };
  const r = results.get(key)!;
  results.delete(key);
  if (!r.ok) throw new Error(r.error);
  return { done: true, value: r.value as T };
}
