import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar, type Page, type Theme } from './components/Sidebar.js';
import { Tour, TOUR } from './components/Tour.js';
import { api, isTauri, setBrowserToken, toast, type AppState } from './api.js';
import { playNotificationSound } from './util/sound.js';
import { HomePage } from './pages/HomePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';
import { ApprovalsPage } from './pages/ApprovalsPage.js';
import { PlansPage } from './pages/PlansPage.js';
import { ManualPage } from './pages/ManualPage.js';

const SEEN_KEY = 'noulette_seen_alerts';

export function App() {
  const [page, setPage] = useState<Page>(() => {
    const h = window.location.hash.slice(1) as Page;
    return ['home', 'settings', 'notifications', 'approvals', 'plans', 'manual'].includes(h) ? h : 'home';
  });
  const [theme, setTheme] = useState<Theme>(() => {
    const q = new URLSearchParams(window.location.search).get('theme') as Theme | null;
    return q && ['system', 'bright', 'dark'].includes(q) ? q : (localStorage.getItem('noulette_theme') as Theme) || 'bright';
  });
  const [collapsed, setCollapsed] = useState(false);
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needToken, setNeedToken] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [focusApproval, setFocusApproval] = useState<string | null>(null);
  const pendingRoute = useRef<{ page: Page; approval?: string } | null>(null);
  const firstLoad = useRef(true);

  useEffect(() => {
    localStorage.setItem('noulette_theme', theme);
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const refresh = useCallback(async () => {
    try {
      const s = await api<AppState>('/api/state');
      setState(s);
      setError(null);
      setNeedToken(false);
      handleAlerts(s);
    } catch (e: any) {
      if (e?.status === 401 && !isTauri) setNeedToken(true);
      else setError(isTauri ? 'Starting the Noulette background service...' : 'Cannot reach the Noulette background service on this computer.');
    }
  }, []);

  /** Sound + toast only for notifications flagged as alerts (super-critical findings and a few key events). */
  function handleAlerts(s: AppState) {
    const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
    const fresh = s.notifications.main.filter((n) => n.alert && !seen.has(n.id + ':' + n.created_at));
    for (const n of s.notifications.main) seen.add(n.id + ':' + n.created_at);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-400)));
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    if (!fresh.length) return;
    playNotificationSound(s.settings.volume).catch(() => {});
    for (const n of fresh.slice(0, 3)) {
      toast(n.title, n.body).catch(() => {});
      if (n.data?.approvalId && (n.kind === 'guard-critical' || n.severity === 'critical')) pendingRoute.current = { page: 'approvals', approval: n.data.approvalId };
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    // Toast deep link: clicking a Windows toast focuses the window; open the item it was about.
    const onFocus = () => {
      if (pendingRoute.current) {
        setPage(pendingRoute.current.page);
        setFocusApproval(pendingRoute.current.approval ?? null);
        pendingRoute.current = null;
      }
      refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const unread = state ? state.notifications.main.filter((n) => !n.read).length : 0;
  const criticalUnread = !!state?.notifications.main.some((n) => !n.read && n.severity === 'critical');
  const pending = state?.approvals.pending.length ?? 0;

  if (needToken) return <TokenGate onSave={(t) => (setBrowserToken(t), refresh())} />;

  const common = { state: state!, refresh, navigate: setPage };
  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`} id="app-shell">
      <Sidebar page={page} onNavigate={setPage} unread={unread} criticalUnread={criticalUnread} pending={pending} theme={theme} onTheme={setTheme} collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
      <main className="main-viewport" role="main" id="main-viewport" style={page === 'manual' ? { position: 'relative' } : undefined}>
        {error && !state && (
          <div className="page-container">
            <div className="alert-box info" role="status">{error}</div>
          </div>
        )}
        {state && (
          <>
            {error && (
              <div className="page-container">
                <div className="alert-box warn" role="status">Connection to the background service was interrupted. Retrying...</div>
              </div>
            )}
            {page === 'home' && <HomePage {...common} />}
            {page === 'settings' && <SettingsPage {...common} />}
            {page === 'notifications' && <NotificationsPage {...common} />}
            {page === 'approvals' && <ApprovalsPage {...common} focusId={focusApproval} />}
            {page === 'plans' && <PlansPage {...common} />}
            {page === 'manual' && <ManualPage onStartTour={() => setTourStep(0)} />}
          </>
        )}
      </main>
      {tourStep !== null && (
        <Tour step={tourStep} onPage={setPage} onNext={() => setTourStep((s) => (s === null || s >= TOUR.length - 1 ? null : s + 1))} onCancel={() => setTourStep(null)} />
      )}
    </div>
  );
}

function TokenGate({ onSave }: { onSave: (t: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="main-viewport">
      <div className="page-container" style={{ maxWidth: 520, paddingTop: 60 }}>
        <h1 className="page-title">Open Noulette in your browser</h1>
        <p className="card-desc" style={{ marginBottom: 16 }}>For safety, this page needs the access code from the Noulette app (Settings, "View in Chrome").</p>
        <form onSubmit={(e) => (e.preventDefault(), onSave(v))}>
          <div className="field">
            <label htmlFor="token">Access code</label>
            <input id="token" type="password" value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" />
          </div>
          <button className="btn-clay" type="submit" disabled={!v.trim()}>Continue</button>
        </form>
      </div>
    </div>
  );
}

export default App;
