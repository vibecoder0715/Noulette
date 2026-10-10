import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, ExternalLink, ArrowRight } from 'lucide-react';
import { api, type AppState, type Notification } from '../api.js';
import { CodeLine, Pill, Toggle, timeAgo } from '../components/ui.js';

/** Project status (Ready / Inspecting / Needs approval / branch waiting) and the 3-number TL;DR. */
function StatusAndTldr({ state, navigate }: { state: AppState; navigate: (p: Page) => void }) {
  const card = state.card;
  const [findings, setFindings] = useState<any[]>([]);
  useEffect(() => {
    if (!state.active) return setFindings([]);
    api('/api/findings?project=' + encodeURIComponent(state.active)).then((r) => setFindings(r.findings ?? [])).catch(() => setFindings([]));
  }, [state.active, card.counts?.critical, card.counts?.shouldFix, card.counts?.resolved]);
  const counts = card.counts ?? { critical: 0, shouldFix: 0, resolved: 0, needsYou: 0 };
  const open = findings.filter((f) => f.status === 'open' || f.status === 'failed' || f.status === 'needs_you').slice(0, 6);
  const cls = card.status === 'ready' ? 'ready' : card.status === 'needs_approval' || card.status === 'branch_waiting' ? 'waiting' : card.status === 'no_project' ? '' : 'busy';
  return (
    <div className="home-cards" style={{ marginBottom: 8 }}>
      <section className={`action-banner ${cls}`} id="status-card" aria-live="polite" aria-labelledby="status-title">
        <div className="banner-content" style={{ flex: 1, minWidth: 260 }}>
          <h4 id="status-title">{card.title}{card.project ? ` · ${card.project.name}` : ''}</h4>
          <p>{card.detail}</p>
          {card.branch && (
            <div style={{ marginTop: 10 }}>
              <p style={{ marginBottom: 4 }}>
                Branch <strong>{card.branch.name}</strong> (from <strong>{card.branch.base}</strong>): {card.branch.fixed} fixed, {card.branch.needsYou} need you. Nothing was merged.
              </p>
              <CodeLine label="Merge" text={card.branch.commands.merge} />
              <CodeLine label="Discard" text={card.branch.commands.discard} />
            </div>
          )}
        </div>
        {card.status === 'needs_approval' && (
          <button className="btn-clay" onClick={() => navigate('approvals')}>Open Approvals <ArrowRight size={15} /></button>
        )}
        {card.status === 'no_project' && (
          <button className="btn-clay" onClick={() => navigate('settings')}>Add a project <ArrowRight size={15} /></button>
        )}
      </section>
      <section id="tldr" aria-labelledby="tldr-title">
        <h3 id="tldr-title" className="section-title" style={{ marginTop: 0 }}>TL;DR</h3>
        <div className="stat-grid">
          <div className="stat-card critical"><div className="stat-num">{counts.critical}</div><div className="stat-lbl">Critical</div></div>
          <div className="stat-card"><div className="stat-num">{counts.shouldFix}</div><div className="stat-lbl">Should fix</div></div>
          <div className="stat-card resolved"><div className="stat-num">{counts.resolved}</div><div className="stat-lbl">Resolved</div></div>
        </div>
        {counts.needsYou > 0 && <p className="card-desc" style={{ marginTop: -8, marginBottom: 12 }}>{counts.needsYou} item(s) need you. Noulette never marks these as resolved.</p>}
        {open.length > 0 && (
          <details style={{ marginBottom: 16 }}>
            <summary>Top problems ({open.length})</summary>
            {open.map((f) => (
              <div key={f.id} className="details-body" style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <Pill kind={f.status === 'needs_you' ? 'warning' : f.severity} />
                <span><strong>{f.title}</strong>: {f.tldr}</span>
              </div>
            ))}
          </details>
        )}
      </section>
    </div>
  );
}
import type { Page } from '../components/Sidebar.js';

interface Props {
  state: AppState;
  refresh: () => void;
  navigate: (p: Page) => void;
}

export function NotificationsPage({ state, refresh, navigate }: Props) {
  const { main, history } = state.notifications;
  const suppress = state.settings.suppressRead;
  const act = async (path: string) => {
    await api(path, {});
    refresh();
  };

  return (
    <div className="page-container" id="notifications-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Notifications</h1>
        <div className="inline">
          <label htmlFor="suppress" style={{ fontSize: 13, fontWeight: 700 }}>Suppress read/resolved notifications</label>
          <Toggle id="suppress" label="Suppress read/resolved notifications" checked={suppress} onChange={(v) => api('/api/settings', { suppressRead: v }).then(refresh)} />
          {main.some((n) => !n.read) && (
            <button className="btn-outlined" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => act('/api/notifications/read-all')}>
              Mark all as read
            </button>
          )}
        </div>
      </div>

      <StatusAndTldr state={state} navigate={navigate} />

      <h3 className="section-title">Alerts</h3>
      {main.length === 0 ? (
        <div className="empty-state">Nothing new. You are all caught up.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} role="list">
          {main.map((n) => (
            <Item key={n.id} n={n} onRead={() => act(`/api/notifications/${n.id}/read`)} onOpen={() => navigate(n.data?.approvalId ? 'approvals' : 'home')} />
          ))}
        </div>
      )}

      {!suppress && history.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ fontSize: 16, fontWeight: 800 }}>History ({history.length})</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }} role="list">
            {history.map((n) => (
              <Item key={n.id} n={n} history />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function icon(n: Notification) {
  if (n.resolved) return <CheckCircle size={24} color="var(--status-safe-border)" />;
  if (n.severity === 'critical') return <AlertCircle size={24} color="var(--status-critical-border)" />;
  if (n.severity === 'warning') return <AlertTriangle size={24} color="var(--status-warning-border)" />;
  return <Info size={24} />;
}

function Item({ n, onRead, onOpen, history }: { n: Notification; onRead?: () => void; onOpen?: () => void; history?: boolean }) {
  const merge = n.kind === 'merge-ready' && n.data?.commands && !n.resolved;
  return (
    <div
      role="listitem"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-sm)',
        padding: '18px 22px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 14,
        opacity: history ? 0.75 : 1
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
        <div style={{ marginTop: 2 }}>{icon(n)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <Pill kind={n.resolved ? 'resolved' : n.severity} />
            <strong style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
              {!n.read && !history && <span className="sr-only">Unread: </span>}
              {n.title}
            </strong>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.5 }}>{n.body}</p>
          {merge && (
            <>
              <CodeLine label="Merge" text={n.data.commands.merge} />
              <CodeLine label="Discard" text={n.data.commands.discard} />
              <p className="text-tertiary">This stays here until you merge or discard the branch.</p>
            </>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{timeAgo(n.created_at)}</span>
        </div>
      </div>
      {!history && (
        <div className="inline" style={{ flexShrink: 0 }}>
          {n.data?.approvalId && (
            <button className="btn-outlined" style={{ padding: '7px 15px', fontSize: 13 }} onClick={onOpen}>
              <span>Review</span>
              <ExternalLink size={15} />
            </button>
          )}
          {!n.read && (
            <button className="btn-text" onClick={onRead}>
              Mark read
            </button>
          )}
        </div>
      )}
    </div>
  );
}
