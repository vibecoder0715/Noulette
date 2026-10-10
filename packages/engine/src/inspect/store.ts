import { getDb, newId } from '../core/db.js';
import { projectKey } from '../core/paths.js';
import type { Finding, FindingStatus } from './types.js';

export function saveFindings(project: string, inspectionId: string, list: Omit<Finding, 'id'>[]): Finding[] {
  const db = getDb();
  const existing = new Set((db.query('SELECT fingerprint FROM findings WHERE project=? AND inspection_id=?').all(projectKey(project), inspectionId) as any[]).map((r) => r.fingerprint));
  const out: Finding[] = [];
  const ins = db.query(
    'INSERT INTO findings(id, project, inspection_id, stage, source, rule, severity, label, title, tldr, file, line, fixability, status, fingerprint, details) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  db.transaction(() => {
    for (const f of list) {
      if (existing.has(f.fingerprint)) continue;
      existing.add(f.fingerprint);
      const id = newId('fnd');
      const details = { ...f.details, evidence: f.evidence, fix: f.fix, humanAction: f.humanAction };
      ins.run(id, projectKey(project), inspectionId, f.stage, f.source, f.rule, f.severity, f.labelId, f.title, f.tldr, f.file, f.line, f.fixability, f.status, f.fingerprint, JSON.stringify(details));
      out.push({ ...f, id });
    }
  })();
  return out;
}

function parse(r: any): Finding {
  const d = JSON.parse(r.details || '{}');
  return {
    id: r.id, stage: r.stage, source: r.source, rule: r.rule, severity: r.severity, labelId: r.label, title: r.title, tldr: r.tldr,
    file: r.file, line: r.line, evidence: d.evidence ?? null, fixability: r.fixability, humanAction: d.humanAction ?? null, fix: d.fix ?? null,
    details: d, fingerprint: r.fingerprint, status: r.status
  };
}

export function getFindings(project: string, inspectionId: string): Finding[] {
  const order = "CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";
  return (getDb().query(`SELECT * FROM findings WHERE project=? AND inspection_id=? ORDER BY ${order}, stage, file, line`).all(projectKey(project), inspectionId) as any[]).map(parse);
}

export function setFindingStatus(ids: string[], status: FindingStatus, note?: string): void {
  const db = getDb();
  db.transaction(() => {
    for (const id of ids) {
      if (note) {
        const r = db.query('SELECT details FROM findings WHERE id=?').get(id) as any;
        const d = JSON.parse(r?.details || '{}');
        d.statusNote = note;
        db.query('UPDATE findings SET status=?, details=? WHERE id=?').run(status, JSON.stringify(d), id);
      } else db.query('UPDATE findings SET status=? WHERE id=?').run(status, id);
    }
  })();
}

export interface Tldr {
  critical: number;
  shouldFix: number;
  resolved: number;
  needsYou: number;
}

/** Home page TL;DR. "Needs you" items are never counted as resolved. */
export function tldr(findings: Finding[]): Tldr {
  const open = findings.filter((f) => f.status === 'open' || f.status === 'failed');
  return {
    critical: open.filter((f) => f.severity === 'critical').length,
    shouldFix: open.filter((f) => f.severity !== 'critical').length,
    resolved: findings.filter((f) => f.status === 'fixed').length,
    needsYou: findings.filter((f) => f.status === 'needs_you' || ((f.status === 'open' || f.status === 'failed') && f.fixability === 'human')).length
  };
}
