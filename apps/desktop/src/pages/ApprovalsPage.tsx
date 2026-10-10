import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Trash2, AlertOctagon } from 'lucide-react';
import { api, type AppState, type Approval } from '../api.js';
import { Banner, Pill, timeAgo } from '../components/ui.js';
import type { Page } from '../components/Sidebar.js';

interface Props {
  state: AppState;
  refresh: () => void;
  navigate: (p: Page) => void;
  focusId?: string | null;
}

export function ApprovalsPage({ state, refresh, focusId }: Props) {
  const { pending, recent } = state.approvals;
  return (
    <div className="page-container" id="approvals-page">
      <h1 className="page-title">Approvals</h1>
      {pending.length === 0 && <div className="empty-state">No approvals waiting. Nothing changes in your code, and nothing blocked is released, until you say so here.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {pending.map((a) => (
          <ApprovalCard key={a.id} a={a} refresh={refresh} focus={a.id === focusId} />
        ))}
      </div>
      {recent.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ fontSize: 16, fontWeight: 800 }}>Decided ({recent.length})</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            {recent.map((a) => (
              <div className="row-card" key={a.id} style={{ opacity: 0.75 }}>
                <strong style={{ fontSize: 14 }}>{a.title}</strong>
                <span className="status-chip">
                  {a.status} {a.decided_at ? timeAgo(a.decided_at) : ''}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ApprovalCard({ a, refresh, focus }: { a: Approval; refresh: () => void; focus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'center' });
  }, [focus]);
  const decide = async (decision: string, extra: Record<string, unknown> = {}) => {
    setErr(null);
    try {
      await api(`/api/approvals/${a.id}/decide`, { decision, ...extra });
      refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const chip = a.kind === 'inspection' ? 'Fix plan' : a.kind === 'guard' ? 'Download guard' : a.origin === 'cloud' ? 'Cloud early warning' : 'Early warning';
  return (
    <section className="card" ref={ref} aria-labelledby={`ap-${a.id}`} style={{ padding: 24, maxWidth: 840, outline: focus ? '2px solid var(--accent-clay)' : undefined }}>
      <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="inline" style={{ gap: 8 }}>
            <span className={`status-chip ${a.kind === 'guard' && a.data.verdict === 'critical' ? 'critical' : ''}`}>{chip}</span>
            {a.origin === 'cloud' && <span className="status-chip safe">Signature checked</span>}
          </div>
          <span className="text-tertiary">{timeAgo(a.created_at)}</span>
        </div>
        <h3 className="card-title" id={`ap-${a.id}`}>{a.title}</h3>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{a.summary}</div>
      </div>
      {err && <Banner kind="error">{err}</Banner>}
      {a.kind === 'inspection' && <InspectionBody a={a} decide={decide} />}
      {a.kind === 'guard' && <GuardBody a={a} decide={decide} />}
      {(a.kind === 'logs' || a.kind === 'cloud') && <LogsBody a={a} decide={decide} />}
    </section>
  );
}

function Actions({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 20, marginTop: 16, gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{children}</div>
      {right}
    </div>
  );
}

function InspectionBody({ a, decide }: { a: Approval; decide: (d: string, x?: any) => void }) {
  const items: any[] = a.data.items ?? [];
  const fixable = items.filter((i) => i.fixability !== 'human');
  const human = items.filter((i) => i.fixability === 'human');
  const [sel, setSel] = useState<Set<string>>(() => new Set(fixable.map((i) => i.id)));
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  return (
    <>
      <h4 className="section-title" style={{ marginTop: 0 }}>1. Your agent may fix</h4>
      <fieldset style={{ border: 0 }}>
        <legend className="sr-only">Fixes to approve</legend>
        {fixable.map((i) => (
          <div className="check-row" key={i.id}>
            <input type="checkbox" id={`sel-${i.id}`} checked={sel.has(i.id)} onChange={() => toggle(i.id)} />
            <label htmlFor={`sel-${i.id}`} style={{ flex: 1, cursor: 'pointer' }}>
              <div className="inline" style={{ gap: 8 }}>
                <Pill kind={i.severity} />
                <strong style={{ fontSize: 14, fontWeight: 800 }}>{i.title}</strong>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{i.tldr}</div>
              <details>
                <summary style={{ fontSize: 12 }}>Details</summary>
                <div className="details-body">
                  {i.where && <div>Where: <code>{i.where}</code></div>}
                  <div>Type: {i.label}</div>
                  {i.fixability === 'both' && i.humanAction && <div>After the fix, you: {i.humanAction}</div>}
                </div>
              </details>
            </label>
          </div>
        ))}
        {fixable.length === 0 && <p className="card-desc">No code fixes in this plan.</p>}
      </fieldset>
      {human.length > 0 && (
        <div style={{ marginTop: 16, background: 'var(--bg-app)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)', padding: 14 }}>
          <h4 className="section-title" style={{ margin: '0 0 6px 0' }}>2. What you must do yourself</h4>
          {human.map((i) => (
            <p key={i.id} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              • <strong>{i.title}</strong>: {i.humanAction ?? i.tldr}
            </p>
          ))}
        </div>
      )}
      <Actions right={<button className="btn-text" style={{ color: 'var(--status-critical-text)' }} onClick={() => decide('reject')}>Reject plan</button>}>
        <button className="btn-clay" disabled={!sel.size} onClick={() => decide('approve', { selection: [...sel] })} id={`approve-${a.id}`}>
          <ShieldCheck size={20} />
          <span>Approve {sel.size} fix{sel.size === 1 ? '' : 'es'}</span>
        </button>
        <span className="text-tertiary" style={{ alignSelf: 'center' }}>Then type "BUILD" in your coding agent.</span>
      </Actions>
    </>
  );
}

function GuardBody({ a, decide }: { a: Approval; decide: (d: string, x?: any) => void }) {
  const critical = a.data.verdict === 'critical';
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  return (
    <>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Location: <code>{a.data.originalPath}</code>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {(a.data.reasons ?? []).slice(0, 8).map((r: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: r.level === 'critical' ? 'var(--status-critical-text)' : 'var(--status-warning-text)' }}>
            <AlertOctagon size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {r.plain}
              {r.file ? <span style={{ color: 'var(--text-tertiary)' }}> ({r.file})</span> : null}
            </span>
          </div>
        ))}
      </div>
      <p className="text-tertiary" style={{ marginTop: 10 }}>It is in quarantine now and cannot run.</p>
      {!typing ? (
        <Actions
          right={
            critical ? (
              <button className="btn-text" style={{ color: 'var(--status-critical-text)' }} onClick={() => setTyping(true)} id={`guard-anyway-${a.id}`}>
                Download anyway...
              </button>
            ) : (
              <button className="btn-outlined" onClick={() => decide('release')} id={`guard-release-${a.id}`}>
                It is safe, release it
              </button>
            )
          }
        >
          <button className="btn-clay" onClick={() => decide('delete')} id={`guard-delete-${a.id}`}>
            <Trash2 size={18} />
            <span>Delete it (recommended)</span>
          </button>
        </Actions>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), decide('release', { confirmText: text }))} style={{ marginTop: 16 }}>
          <Banner kind="warn">This looks dangerous. To release it anyway, type allow below.</Banner>
          <div className="inline">
            <label htmlFor={`allow-${a.id}`} className="sr-only">Type allow to confirm</label>
            <input id={`allow-${a.id}`} className="input" style={{ width: 200 }} type="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="allow" autoComplete="off" />
            <button className="btn-clay" type="submit" disabled={text.trim().toLowerCase() !== 'allow'} style={{ background: 'var(--status-critical-border)', color: '#fff' }}>
              Release
            </button>
            <button className="btn-outlined" type="button" onClick={() => setTyping(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function LogsBody({ a, decide }: { a: Approval; decide: (d: string, x?: any) => void }) {
  const warnings: any[] = a.data.warnings ?? [];
  return (
    <>
      <div style={{ display: 'grid', gap: 12 }}>
        {warnings.map((w, i) => (
          <div key={i} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
            <div className="inline" style={{ gap: 8 }}>
              <Pill kind={w.severity === 'critical' ? 'critical' : w.severity === 'info' ? 'info' : 'warning'} />
              <strong style={{ fontSize: 14, fontWeight: 800 }}>{w.title}</strong>
              <span className="status-chip">confidence {Math.round((w.confidence ?? 0) * 100)}%</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>{w.tldr}</p>
            <details>
              <summary style={{ fontSize: 12 }}>Evidence and plan</summary>
              <div className="details-body">
                {(w.evidence ?? []).map((e: string, j: number) => (
                  <div key={j}>• {e}</div>
                ))}
                {w.plan && <p style={{ marginTop: 6 }}>Plan: {w.plan}</p>}
              </div>
            </details>
          </div>
        ))}
      </div>
      <p className="text-tertiary" style={{ marginTop: 10 }}>Early warnings are predictions from your production data, not certainties. They are never fixed without your approval.</p>
      <Actions right={<button className="btn-text" onClick={() => decide('reject')}>Dismiss</button>}>
        <button className="btn-clay" onClick={() => decide('approve')}>
          <ShieldCheck size={20} />
          <span>Approve plan</span>
        </button>
      </Actions>
    </>
  );
}
