import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from '../core/paths.js';
import { getDb, newId } from '../core/db.js';
import { createApproval, decideApproval, getApproval, notify, resolveByKind } from '../core/events.js';
import type { GuardReason, UnitScan } from './rules.js';

/** Quarantine: the item is moved out of reach, renamed so it cannot be double-clicked, and waits for a decision. */
export function quarantineRoot(): string {
  const d = dataPath('quarantine', '.keep');
  return path.dirname(d);
}

function moveSync(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e: any) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

export function logGuard(p: string, verdict: string, reasons: GuardReason[]): void {
  const db = getDb();
  db.query('INSERT INTO guard_log(id, path, verdict, reasons, created_at) VALUES (?,?,?,?,?)').run(newId('grd'), p, verdict, JSON.stringify(reasons.slice(0, 20)), Date.now());
  db.query('DELETE FROM guard_log WHERE id NOT IN (SELECT id FROM guard_log ORDER BY created_at DESC LIMIT 5000)').run();
}

export function recentGuardLog(limit = 20): any[] {
  return (getDb().query('SELECT * FROM guard_log ORDER BY created_at DESC LIMIT ?').all(limit) as any[]).map((r) => ({ ...r, reasons: JSON.parse(r.reasons) }));
}

/**
 * Handles a scan result: safe = silent log; uncertain = quarantine + quiet approval;
 * critical = quarantine + approval + alert (toast deep-links to the approval).
 * Download-guard decisions are always manual, even with auto-approve on.
 */
export function handleScan(abs: string, scan: UnitScan, opts: { alreadyQuarantined?: string; destination?: string; source: 'watcher' | 'clone' }): { approvalId: string | null; quarantinePath: string | null } {
  const originalPath = opts.destination ?? abs;
  logGuard(originalPath, scan.verdict, scan.reasons);
  if (scan.verdict === 'safe') return { approvalId: null, quarantinePath: null };
  let qPath = opts.alreadyQuarantined ?? null;
  let moveError: string | null = null;
  if (!qPath) {
    const id = newId('q');
    const isDir = fs.statSync(abs).isDirectory();
    qPath = path.join(quarantineRoot(), id, path.basename(abs) + (isDir ? '' : '.quarantined'));
    try {
      moveSync(abs, qPath);
    } catch (e: any) {
      moveError = e.message;
      qPath = null;
    }
  }
  const approvalId = createApproval({
    kind: 'guard',
    title: scan.verdict === 'critical' ? `Blocked: ${path.basename(originalPath)}` : `Check this: ${path.basename(originalPath)}`,
    summary: scan.verdict === 'critical' ? 'This looks like an attack. It was moved to quarantine.' : 'Something here needs a quick look. It was moved to quarantine.',
    data: { verdict: scan.verdict, originalPath, quarantinePath: qPath, reasons: scan.reasons.slice(0, 20), files: scan.files, source: opts.source, moveError }
  });
  if (scan.verdict === 'critical') {
    notify({ severity: 'critical', kind: 'guard-critical', title: `Dangerous download blocked: ${path.basename(originalPath)}`, body: scan.reasons.filter((r) => r.level === 'critical')[0]?.plain ?? 'A threat was found.', alert: true, data: { approvalId } });
  }
  return { approvalId, quarantinePath: qPath };
}

function uniqueTarget(p: string): string {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 1; i < 100; i++) {
    const c = `${base} (released ${i})${ext}`;
    if (!fs.existsSync(c)) return c;
  }
  throw new Error('No free name to release the file to');
}

export class GuardDecisionError extends Error {}

/** Decision from the Approvals page. "Download anyway" on a critical item requires typing allow. */
export function decideGuard(id: string, decision: string, confirmText?: string): { status: string; path?: string } {
  const a = getApproval(id);
  if (!a || a.kind !== 'guard') throw new GuardDecisionError('Not a download-guard item');
  const q = a.data.quarantinePath as string | null;
  if (decision === 'delete') {
    if (q) fs.rmSync(path.dirname(q), { recursive: true, force: true });
    decideApproval(id, 'deleted');
    resolveGuardNotification(id);
    return { status: 'deleted' };
  }
  if (decision === 'release') {
    if (a.data.verdict === 'critical' && (confirmText ?? '').trim().toLowerCase() !== 'allow') throw new GuardDecisionError('Type allow to release an item marked dangerous.');
    let target: string | undefined;
    if (q && fs.existsSync(q)) {
      target = uniqueTarget(a.data.originalPath);
      moveSync(q, target);
      fs.rmSync(path.dirname(q), { recursive: true, force: true });
      releasedRecently.set(path.resolve(target).toLowerCase(), Date.now());
    }
    decideApproval(id, 'released');
    resolveGuardNotification(id);
    return { status: 'released', path: target };
  }
  throw new GuardDecisionError('Unknown decision');
}

function resolveGuardNotification(approvalId: string): void {
  const rows = getDb().query("SELECT id FROM notifications WHERE kind='guard-critical' AND json_extract(data,'$.approvalId')=?").all(approvalId) as any[];
  for (const r of rows) getDb().query('UPDATE notifications SET resolved=1, read=1 WHERE id=?').run(r.id);
  void resolveByKind;
}

/** Items the user released are not re-quarantined by the watcher when they reappear. */
export const releasedRecently = new Map<string, number>();
