import { Database } from 'bun:sqlite';
import { dataPath } from './paths.js';

let db: Database | null = null;
let dbFile: string | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  key TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL,
  added_at INTEGER NOT NULL, last_opened INTEGER NOT NULL, state TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, project TEXT, severity TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, resolved INTEGER NOT NULL DEFAULT 0,
  sticky INTEGER NOT NULL DEFAULT 0, alert INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, project TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', origin TEXT NOT NULL DEFAULT 'local',
  created_at INTEGER NOT NULL, decided_at INTEGER, signature TEXT
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, project TEXT NOT NULL, inspection_id TEXT NOT NULL, stage TEXT NOT NULL,
  source TEXT NOT NULL, rule TEXT NOT NULL, severity TEXT NOT NULL, label TEXT NOT NULL,
  title TEXT NOT NULL, tldr TEXT NOT NULL, file TEXT, line INTEGER, fixability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', fingerprint TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS findings_project ON findings(project, inspection_id);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, project TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
  started_at INTEGER NOT NULL, finished_at INTEGER, data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS guard_log (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, verdict TEXT NOT NULL, reasons TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS metrics (
  project TEXT NOT NULL, source TEXT NOT NULL, name TEXT NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL,
  PRIMARY KEY (project, source, name, ts)
);
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
`;

/** Shared SQLite store. WAL mode lets the daemon and MCP shim processes share it safely. */
export function getDb(): Database {
  const file = dataPath('noulette.db');
  if (db && dbFile === file) return db;
  if (db) db.close();
  db = new Database(file, { create: true });
  dbFile = file;
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Closes the handle (tests switch NOULETTE_HOME between cases). */
export function closeDb(): void {
  if (db) db.close();
  db = null;
  dbFile = null;
}

export function kvGet<T>(key: string, fallback: T): T {
  const row = getDb().query('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | null;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function kvSet(key: string, value: unknown): void {
  getDb().query('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

export function newId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}_${t}${Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function audit(kind: string, data: unknown): void {
  getDb().query('INSERT INTO audit(id, ts, kind, data) VALUES (?, ?, ?, ?)').run(newId('aud'), Date.now(), kind, JSON.stringify(data));
}
