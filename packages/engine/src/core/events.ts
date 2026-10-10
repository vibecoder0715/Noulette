import crypto from 'node:crypto';
import { getDb, newId } from './db.js';
import { localKey, sign, verify, publicKeyFromB64 } from './signing.js';

export type Severity = 'critical' | 'warning' | 'info';

export interface NotificationRow {
  id: string;
  project: string | null;
  severity: Severity;
  kind: string;
  title: string;
  body: string;
  data: any;
  created_at: number;
  read: number;
  resolved: number;
  sticky: number;
  alert: number;
}

export interface NotifyInput {
  project?: string | null;
  severity: Severity;
  kind: string;
  title: string;
  body: string;
  data?: unknown;
  /** Stays in the main list until resolved, even after being read. */
  sticky?: boolean;
  /** Toast + sound. Reserved for super-critical items and a few key events. */
  alert?: boolean;
  /** Replace an existing unresolved notification of the same kind+key instead of stacking duplicates. */
  dedupeKey?: string;
}

export function notify(n: NotifyInput): string {
  const db = getDb();
  const data = { ...(n.data as object), ...(n.dedupeKey ? { dedupeKey: n.dedupeKey } : {}) };
  if (n.dedupeKey) {
    const existing = db
      .query("SELECT id FROM notifications WHERE kind = ? AND resolved = 0 AND json_extract(data, '$.dedupeKey') = ?")
      .get(n.kind, n.dedupeKey) as { id: string } | null;
    if (existing) {
      db.query('UPDATE notifications SET severity=?, title=?, body=?, data=?, created_at=?, read=0, alert=? WHERE id=?').run(
        n.severity, n.title, n.body, JSON.stringify(data), Date.now(), n.alert ? 1 : 0, existing.id
      );
      return existing.id;
    }
  }
  const id = newId('ntf');
  db.query(
    'INSERT INTO notifications(id, project, severity, kind, title, body, data, created_at, sticky, alert) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(id, n.project ?? null, n.severity, n.kind, n.title, n.body, JSON.stringify(data), Date.now(), n.sticky ? 1 : 0, n.alert ? 1 : 0);
  return id;
}

function parseN(r: any): NotificationRow {
  return { ...r, data: JSON.parse(r.data || '{}') };
}

/** Main list = unresolved and (unread or sticky). History = everything else. */
export function listNotifications(): { main: NotificationRow[]; history: NotificationRow[] } {
  const rows = (getDb().query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 500').all() as any[]).map(parseN);
  const main = rows.filter((r) => !r.resolved && (!r.read || r.sticky));
  const history = rows.filter((r) => !main.includes(r));
  return { main, history };
}

export function markRead(id: string): void {
  getDb().query('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
}

export function markAllRead(): void {
  getDb().query('UPDATE notifications SET read = 1').run();
}

export function resolveNotification(id: string): void {
  getDb().query('UPDATE notifications SET resolved = 1, read = 1 WHERE id = ?').run(id);
}

export function resolveByKind(kind: string, dedupeKey?: string): void {
  if (dedupeKey) getDb().query("UPDATE notifications SET resolved=1, read=1 WHERE kind=? AND json_extract(data,'$.dedupeKey')=?").run(kind, dedupeKey);
  else getDb().query('UPDATE notifications SET resolved=1, read=1 WHERE kind=?').run(kind);
}

export function getNotification(id: string): NotificationRow | null {
  const r = getDb().query('SELECT * FROM notifications WHERE id = ?').get(id);
  return r ? parseN(r) : null;
}

// ---------------------------------------------------------------- approvals

export type ApprovalKind = 'inspection' | 'guard' | 'logs' | 'cloud';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'released' | 'deleted' | 'superseded';

export interface ApprovalRow {
  id: string;
  project: string | null;
  kind: ApprovalKind;
  title: string;
  summary: string;
  data: any;
  status: ApprovalStatus;
  origin: 'local' | 'cloud';
  created_at: number;
  decided_at: number | null;
  signature: string | null;
}

function parseA(r: any): ApprovalRow {
  return { ...r, data: JSON.parse(r.data || '{}') };
}

export function createApproval(a: { project?: string | null; kind: ApprovalKind; title: string; summary: string; data: unknown; origin?: 'local' | 'cloud' }): string {
  const id = newId('apr');
  getDb()
    .query('INSERT INTO approvals(id, project, kind, title, summary, data, origin, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, a.project ?? null, a.kind, a.title, a.summary, JSON.stringify(a.data ?? {}), a.origin ?? 'local', Date.now());
  return id;
}

export function getApproval(id: string): ApprovalRow | null {
  const r = getDb().query('SELECT * FROM approvals WHERE id = ?').get(id);
  return r ? parseA(r) : null;
}

export function listApprovals(status?: ApprovalStatus): ApprovalRow[] {
  const rows = status
    ? getDb().query('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC').all(status)
    : getDb().query('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 300').all();
  return (rows as any[]).map(parseA);
}

export function latestApproval(project: string, kind: ApprovalKind): ApprovalRow | null {
  const r = getDb().query("SELECT * FROM approvals WHERE project = ? AND kind = ? AND status != 'superseded' ORDER BY created_at DESC LIMIT 1").get(project, kind);
  return r ? parseA(r) : null;
}

export function supersedePending(project: string, kind: ApprovalKind): void {
  getDb().query("UPDATE approvals SET status='superseded', decided_at=? WHERE project=? AND kind=? AND status='pending'").run(Date.now(), project, kind);
}

function signedPayload(a: ApprovalRow, status: ApprovalStatus, decidedAt: number, selection: unknown) {
  const dataHash = crypto.createHash('sha256').update(JSON.stringify(a.data)).digest('hex');
  return { id: a.id, kind: a.kind, project: a.project, status, decidedAt, dataHash, selection };
}

/**
 * Records a human decision and signs it with the local Ed25519 key.
 * Only the desktop UI calls this (never exposed as an MCP tool), so an agent cannot approve its own work.
 */
export function decideApproval(id: string, status: ApprovalStatus, selection?: string[]): ApprovalRow {
  const a = getApproval(id);
  if (!a) throw new Error('Approval not found');
  if (a.status !== 'pending') throw new Error('This item was already decided');
  const decidedAt = Date.now();
  const data = { ...a.data, ...(selection ? { selection } : {}) };
  const withData = { ...a, data };
  const signature = sign(signedPayload(withData, status, decidedAt, selection ?? null), localKey().priv);
  getDb().query('UPDATE approvals SET status=?, decided_at=?, signature=?, data=? WHERE id=?').run(status, decidedAt, signature, JSON.stringify(data), id);
  return getApproval(id)!;
}

/** True when the decision signature matches the stored record (detects tampering of the DB row). */
export function verifyApprovalSignature(a: ApprovalRow): boolean {
  if (!a.signature || !a.decided_at) return false;
  const pub = publicKeyFromB64(localKey().pub);
  return verify(signedPayload(a, a.status, a.decided_at, a.data?.selection ?? null), a.signature, pub);
}
