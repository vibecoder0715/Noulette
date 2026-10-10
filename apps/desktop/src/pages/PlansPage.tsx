import React, { useEffect, useState } from 'react';
import { Layers, ShieldAlert, RefreshCw } from 'lucide-react';
import { api, type AppState } from '../api.js';
import { Banner } from '../components/ui.js';
import type { Page } from '../components/Sidebar.js';

interface Props {
  state: AppState;
  refresh: () => void;
  navigate: (p: Page) => void;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export function PlansPage({ state, refresh }: Props) {
  const [future, setFuture] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state.active) return;
    api('/api/future?project=' + encodeURIComponent(state.active)).then(setFuture).catch(() => setFuture(null));
  }, [state.active]);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      setFuture(await api('/api/future', { project: state.active }));
      refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-container" id="plans-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Plans</h1>
        {state.active && (
          <button className="btn-clay" onClick={generate} disabled={busy} id="generate-future">
            <RefreshCw size={16} />
            <span>{future?.tiers ? 'Update FUTURE.md' : 'Create FUTURE.md'}</span>
          </button>
        )}
      </div>
      {!state.active && <div className="empty-state">Add a project on Home first.</div>}
      {err && <Banner kind="error">{err}</Banner>}

      {future?.tiers && (
        <div style={{ background: 'var(--status-warning-bg)', border: '1px solid var(--status-warning-border)', borderRadius: 'var(--radius-md)', padding: '18px 22px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--status-warning-text)', marginBottom: 8 }}>
            <ShieldAlert size={22} color="var(--status-warning-border)" />
            <h4 style={{ fontSize: 19, fontWeight: 800 }}>"Don't build yet" guardrail</h4>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Only do the stage you are at now.{future.missingUsers ? ' No user count yet, so it starts at 100.' : ''} Full details for your agent are in FUTURE.md.
          </p>
        </div>
      )}

      {future?.tiers && <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 14 }}>Roadmap stages</h3>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {future?.tiers?.map((t: any, idx: number) => (
          <div key={t.users} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '18px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10, gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Layers size={20} color="var(--accent-clay)" />
                <h4 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>Stage {idx + 1}: {t.title}</h4>
              </div>
              <span className="status-chip" style={{ fontSize: 11, fontWeight: 700 }}>~{fmt(t.users)} users</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>{t.tldr}</p>
            <div className="inline" style={{ gap: 8 }}>
              {(t.short ?? []).map((s: string) => (
                <span key={s} className="roadmap-chip">{s}</span>
              ))}
              {t.cost && <span className="text-tertiary" style={{ marginLeft: 'auto' }}>{t.cost} / month</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
