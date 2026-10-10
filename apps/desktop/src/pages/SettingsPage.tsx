import React, { useEffect, useState } from 'react';
import { Volume2, Play, Sparkles, Plug, Activity, ShieldCheck, Wrench, Gauge, FolderPlus, FolderOpen } from 'lucide-react';
import { api, invoke, isTauri, pickFolder, type AppState } from '../api.js';
import { Banner, CopyButton, Toggle } from '../components/ui.js';
import { playNotificationSound, subscribeToSoundState } from '../util/sound.js';
import type { Page } from '../components/Sidebar.js';

interface Props {
  state: AppState;
  refresh: () => void;
  navigate: (p: Page) => void;
}

const AGENT_LOGO: Record<string, string> = {
  kiro: '/images/integrations/kiro.png',
  'claude-code': '/images/integrations/claude-code.png',
  cline: '/images/integrations/cline.png',
  opencode: '/images/integrations/opencode.png',
  codex: '/images/integrations/codex.png',
  antigravity: '/images/integrations/antigravity.png'
};

function PanelHead({ icon, title, desc }: { icon: React.ReactNode; title: string; desc?: string }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {icon}
        <h4 style={{ fontSize: 19, fontWeight: 800 }}>{title}</h4>
      </div>
      {desc && <p className="panel-desc">{desc}</p>}
    </>
  );
}

const iconProps = { size: 20, color: 'var(--accent-clay)' } as const;

export function SettingsPage({ state, refresh }: Props) {
  const s = state.settings;
  const [prompts, setPrompts] = useState<any>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);

  useEffect(() => {
    api('/api/prompts' + (state.active ? '?project=' + encodeURIComponent(state.active) : '')).then(setPrompts).catch(() => {});
  }, [state.active]);

  async function save(patch: Record<string, unknown>) {
    setMsg(null);
    try {
      const r: any = await api('/api/settings', patch);
      if ('startAtLogin' in patch && isTauri) await invoke('set_autostart', { enabled: patch.startAtLogin }).catch(() => {});
      if (r?.aiConfigWarnings?.length) setMsg({ kind: 'warn', text: r.aiConfigWarnings.join(' ') });
      refresh();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  }

  async function addSnippet() {
    if (!state.active) return;
    try {
      const r = await api('/api/projects/snippet', { path: state.active });
      setMsg({ kind: 'ok', text: `Added the BUILD instructions to ${r.file}` });
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  }

  return (
    <div className="page-container" id="settings-page">
      <h1 className="page-title">Settings</h1>
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

      <ProjectPanel state={state} refresh={refresh} />

      {/* 1. Prompts */}
      <div style={{ marginBottom: 28 }} id="settings-prompts">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Sparkles {...iconProps} />
          <h3 style={{ fontSize: 19, fontWeight: 800 }}>Prompts</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>Copy a prompt and paste it into your coding agent.</p>
        <div className="stack">
          <PromptRow id="prompt-inspect" title="Inspect mode" desc="Finds problems and decides what needs fixing. Asks you a few questions first." text={prompts?.inspect} />
          <PromptRow id="prompt-build" title="Build mode" desc='Fixes the approved problems. You can also just type "BUILD" in your agent.' text={prompts?.build} />
          <div className="row-card" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 14, alignItems: 'center' }}>
              <div>
                <strong>Make "BUILD" work in every agent</strong>
                <p>Adds a short instruction block to AGENTS.md in your project.</p>
              </div>
              <div className="inline" style={{ flexShrink: 0 }}>
                {prompts && <CopyButton text={prompts.snippet} label="Copy snippet" variant="outlined" />}
                <button className="btn-clay" style={{ padding: '7px 14px', fontSize: 13 }} onClick={addSnippet} disabled={!state.active}>Add to my project</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Effort (radio cards, as before) */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Gauge {...iconProps} />
          <h3 style={{ fontSize: 19, fontWeight: 800 }} id="effort-label">Inspection Effort</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>Every step always runs. Effort decides how many review passes and fix rounds are allowed.</p>
        <div className="radio-card-group" role="radiogroup" aria-labelledby="effort-label" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          {[
            { id: 'standard', title: 'Standard (Default)', desc: 'One review pass, up to 2 fix and verify rounds.' },
            { id: 'extra', title: 'Extra', desc: 'Up to 3 review passes, a second check for each fix and a full rescan (hard cap of 3 rounds).' }
          ].map((o) => (
            <div key={o.id} className={`radio-card ${s.effort === o.id ? 'selected' : ''}`} id={`effort-${o.id}`} role="radio" aria-checked={s.effort === o.id} tabIndex={0} onClick={() => save({ effort: o.id })} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), save({ effort: o.id }))}>
              <div className="radio-card-title">{o.title}</div>
              <div className="radio-card-desc">{o.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Auto-approve */}
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <PanelHead icon={<ShieldCheck {...iconProps} />} title="Auto-approve" />
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {s.autoApprove
                ? 'On: after inspection your agent fixes everything it can on a separate branch. Nothing is merged for you, and items that need a person are listed for you.'
                : 'Off: you choose what gets fixed in Approvals.'}
            </p>
          </div>
          <Toggle id="auto-approve" label="Auto-approve" checked={s.autoApprove} onChange={(v) => save({ autoApprove: v })} />
        </div>
      </div>

      <SoundPanel volume={s.volume} save={save} />
      <AgentsSection state={state} refresh={refresh} />
      <ProductionSection state={state} save={save} refresh={refresh} />
      <GuardSection state={state} save={save} />
      <AdvancedSection state={state} save={save} />
    </div>
  );
}

function ProjectPanel({ state, refresh }: { state: AppState; refresh: () => void }) {
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function add(p: string) {
    setErr(null);
    try {
      await api('/api/projects', { path: p });
      setAdding(false);
      setPath('');
      refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function onAdd() {
    if (isTauri) {
      const p = await pickFolder();
      if (p) await add(p);
    } else setAdding(true);
  }
  return (
    <div className="panel" id="settings-project">
      <PanelHead icon={<FolderOpen {...iconProps} />} title="Project" desc="The app folder Noulette checks. The prompts below are filled in with this path." />
      <div className="inline">
        {state.projects.length === 0 ? (
          <span className="text-secondary" style={{ flex: 1 }}>No project yet. Add the folder of the app you are building.</span>
        ) : (
          <>
            <label htmlFor="project-select" className="sr-only">Active project</label>
            <select id="project-select" className="input" style={{ flex: 1, minWidth: 260 }} value={state.active ?? ''} onChange={(e) => api('/api/projects/active', { path: e.target.value }).then(refresh)}>
              {state.projects.map((p) => (
                <option key={p.path} value={p.path}>{p.name} ({p.path})</option>
              ))}
            </select>
          </>
        )}
        <button className="btn-outlined" onClick={onAdd} id="add-project"><FolderPlus size={16} /> Add folder</button>
      </div>
      {adding && (
        <form className="inline" style={{ marginTop: 10 }} onSubmit={(e) => (e.preventDefault(), add(path))}>
          <label htmlFor="new-path" className="sr-only">Folder path</label>
          <input id="new-path" className="input" style={{ flex: 1 }} type="text" placeholder="C:\Users\you\my-app" value={path} onChange={(e) => setPath(e.target.value)} />
          <button className="btn-clay" type="submit">Add</button>
        </form>
      )}
      {err && <div style={{ marginTop: 10 }}><Banner kind="error">{err}</Banner></div>}
    </div>
  );
}

function PromptRow({ id, title, desc, text }: { id: string; title: string; desc: string; text?: string }) {
  return (
    <div className="row-card" id={id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <strong>{title}</strong>
          <p>{desc}</p>
        </div>
        {text && <CopyButton text={text} label="Copy Prompt" id={`${id}-copy`} />}
      </div>
      <details>
        <summary style={{ fontSize: 12 }}>Show prompt</summary>
        <div className="prompt-box">{text ?? 'Loading...'}</div>
      </details>
    </div>
  );
}

function SoundPanel({ volume, save }: { volume: number; save: (p: any) => void }) {
  const [v, setV] = useState(volume);
  const [playing, setPlaying] = useState(false);
  useEffect(() => setV(volume), [volume]);
  useEffect(() => subscribeToSoundState(setPlaying), []);
  const commit = () => v !== volume && save({ volume: v });
  return (
    <div className="panel">
      <PanelHead icon={<Volume2 {...iconProps} />} title="Notification sound" desc="Plays only for serious problems and a few key events." />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, maxWidth: 360 }}>
          <label htmlFor="volume" style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Volume:</label>
          <input id="volume" type="range" min={0} max={100} step={5} value={v} onChange={(e) => setV(Number(e.target.value))} onMouseUp={commit} onKeyUp={commit} onTouchEnd={commit} style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', width: 40 }}>{v}%</span>
        </div>
        <div className="sound-visualizer-container" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={`sound-bar ${playing ? 'playing' : ''}`} />
          ))}
        </div>
        <button className="btn-outlined" id="test-chime-btn" onClick={() => playNotificationSound(v)} disabled={v === 0} style={{ fontSize: 13, padding: '6px 12px' }}>
          <Play size={14} />
          <span>Test sound</span>
        </button>
      </div>
    </div>
  );
}

function AgentsSection({ state, refresh }: { state: AppState; refresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  if (!state.agents) return null;
  async function connect(id: string) {
    setBusy(id);
    setRes(null);
    try {
      const r = await api('/api/agents/connect', { id });
      setRes({ kind: 'ok', text: `${r.name}: connected. ${r.backup ? `Your old settings were backed up to ${r.backup}.` : ''} Restart the agent to load Noulette.` });
      refresh();
    } catch (e: any) {
      setRes({ kind: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="panel" id="settings-agents">
      <PanelHead icon={<Plug {...iconProps} />} title="Connect your coding agent" desc="One click adds Noulette to the agent's settings. Existing settings are backed up and kept." />
      {res && <Banner kind={res.kind}>{res.text}</Banner>}
      {state.agents.map((a: any) => (
        <div className="setting-row" key={a.id}>
          <div className="inline" style={{ gap: 12 }}>
            {AGENT_LOGO[a.id] && <img className="agent-logo" src={AGENT_LOGO[a.id]} alt="" />}
            <div>
              <div className="label">{a.name}</div>
              <div className="desc">{a.connected ? 'Connected' : a.installed ? 'Found on this computer' : 'Not found on this computer'}</div>
            </div>
          </div>
          <div className="inline">
            {a.connected && <span className="status-chip safe">Connected</span>}
            <button className={a.connected ? 'btn-outlined' : 'btn-clay'} style={{ padding: '7px 14px', fontSize: 13 }} disabled={busy === a.id} onClick={() => connect(a.id)}>
              {a.connected ? 'Reconnect' : 'Connect'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductionSection({ state, save, refresh }: { state: AppState; save: (p: any) => Promise<void> | void; refresh: () => void }) {
  const s = state.settings;
  const sec = state.secrets;
  const [ph, setPh] = useState({ host: s.inspector.posthog.host, projectId: s.inspector.posthog.projectId, key: '' });
  const [ga, setGa] = useState({ propertyId: s.inspector.ga4.propertyId, sa: '' });
  const [ai, setAi] = useState({ configText: s.ai.configText, baseUrl: s.ai.baseUrl, model: s.ai.model, key: '' });
  const [test, setTest] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const off = !s.productionAnalysis;
  const mon = state.monitor;
  useEffect(() => setAi((a) => ({ ...a, configText: s.ai.configText })), [s.ai.configText]);

  const saveSecret = (name: string, value: string) => api('/api/secrets', { name, value });
  async function saveInspector() {
    await save({ inspector: { posthog: { host: ph.host.trim(), projectId: ph.projectId.trim() }, ga4: { propertyId: ga.propertyId.trim() } } });
    if (ph.key) await saveSecret('posthogKey', ph.key);
    if (ga.sa) await saveSecret('ga4ServiceAccount', ga.sa);
    setPh({ ...ph, key: '' });
    setGa({ ...ga, sa: '' });
    refresh();
  }
  async function saveAi() {
    await save({ ai: { configText: ai.configText, baseUrl: ai.baseUrl.trim(), model: ai.model.trim() } });
    if (ai.key) await saveSecret('aiApiKey', ai.key);
    setAi({ ...ai, key: '' });
    refresh();
  }
  async function testAi() {
    setTest({ kind: 'info', text: 'Testing the AI connection...' });
    try {
      const r = await api('/api/monitor/test-ai', {});
      setTest({ kind: 'ok', text: `Connected using ${r.used === 'file' ? 'the pasted configuration' : 'the basic fields'} (model ${r.model}).` });
    } catch (e: any) {
      setTest({ kind: 'error', text: e.message });
    }
  }
  async function runNow() {
    setTest({ kind: 'info', text: 'Checking production now...' });
    try {
      const r = await api('/api/monitor/run', {});
      setTest({ kind: r.ok ? 'ok' : 'error', text: r.message });
    } catch (e: any) {
      setTest({ kind: 'error', text: e.message });
    }
    refresh();
  }

  return (
    <div className="panel" id="settings-production">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <PanelHead icon={<Activity {...iconProps} />} title="Production analysis" />
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Reads your PostHog / Google Analytics data on a schedule and warns you early about problems. Your computer must be on, or use the cloud worker.</p>
        </div>
        <Toggle id="prod-toggle" label="Production analysis" checked={s.productionAnalysis} onChange={(v) => save({ productionAnalysis: v })} />
      </div>
      <div className="setting-row" style={{ marginTop: 8 }}>
        <div>
          <label className="label" htmlFor="interval">Inspect after</label>
          <div className="desc">{off ? 'Turn on production analysis to choose.' : 'How often Noulette checks your app.'}</div>
        </div>
        <select id="interval" className="input" value={s.intervalMin} disabled={off} onChange={(e) => save({ intervalMin: Number(e.target.value) })}>
          {state.intervals.map((m) => (
            <option key={m} value={m}>Every {m} minutes</option>
          ))}
        </select>
      </div>
      {mon?.lastError && <Banner kind="error">Last check failed: {mon.lastError}</Banner>}
      {mon?.lastRunAt && !mon?.lastError && <p className="text-tertiary">Last check: {new Date(mon.lastRunAt).toLocaleString()}. Next: {mon.nextRunAt ? new Date(mon.nextRunAt).toLocaleTimeString() : 'soon'}.</p>}

      {!off && (
        <>
          <h4 className="section-title">Inspector API</h4>
          <fieldset style={{ border: 0 }}>
            <div className="setting-row">
              <div className="inline" style={{ gap: 12 }}>
                <img className="agent-logo" src="/images/integrations/posthog.png" alt="" />
                <div>
                  <legend className="label">PostHog</legend>
                  <div className="desc">Events and error tracking</div>
                </div>
              </div>
              <Toggle id="ph-enabled" label="Use PostHog" checked={s.inspector.posthog.enabled} onChange={(v) => save({ inspector: { posthog: { enabled: v } } })} />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="ph-host">PostHog address</label>
              <input id="ph-host" type="url" value={ph.host} onChange={(e) => setPh({ ...ph, host: e.target.value })} placeholder="https://us.posthog.com" />
            </div>
            <div className="field">
              <label htmlFor="ph-project">Project ID</label>
              <input id="ph-project" type="text" value={ph.projectId} onChange={(e) => setPh({ ...ph, projectId: e.target.value })} placeholder="12345" />
            </div>
            <div className="field">
              <label htmlFor="ph-key">Personal API key {sec.posthogKey !== 'none' && `(${sec.posthogKey === 'env' ? 'set by environment variable' : 'saved'})`}</label>
              <input id="ph-key" type="password" autoComplete="off" value={ph.key} onChange={(e) => setPh({ ...ph, key: e.target.value })} placeholder={sec.posthogKey !== 'none' ? 'Leave empty to keep the saved key' : 'phx_...'} />
              <span className="hint">Needs read access to "Query". Or set NOULETTE_POSTHOG_KEY. Stored encrypted for your Windows account.</span>
            </div>
          </fieldset>
          <fieldset style={{ border: 0, marginTop: 6 }}>
            <div className="setting-row">
              <div className="inline" style={{ gap: 12 }}>
                <img className="agent-logo" src="/images/integrations/google-analytics.png" alt="" />
                <div>
                  <legend className="label">Google Analytics 4</legend>
                  <div className="desc">Traffic and usage numbers</div>
                </div>
              </div>
              <Toggle id="ga-enabled" label="Use Google Analytics" checked={s.inspector.ga4.enabled} onChange={(v) => save({ inspector: { ga4: { enabled: v } } })} />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="ga-prop">Property ID</label>
              <input id="ga-prop" type="text" value={ga.propertyId} onChange={(e) => setGa({ ...ga, propertyId: e.target.value })} placeholder="123456789" />
            </div>
            <div className="field">
              <label htmlFor="ga-sa">Service account key (JSON) {sec.ga4ServiceAccount !== 'none' && '(saved)'}</label>
              <textarea id="ga-sa" value={ga.sa} onChange={(e) => setGa({ ...ga, sa: e.target.value })} placeholder='{"type": "service_account", ...}' style={{ minHeight: 70 }} />
            </div>
          </fieldset>
          <button className="btn-clay" onClick={saveInspector} id="save-inspector">Save inspector settings</button>

          <h4 className="section-title">AI for log analysis</h4>
          <p className="panel-desc">Any OpenAI-compatible service works: a cloud API, or a local model (Ollama, LM Studio). Paste a configuration, fill in the basic fields, or both. Noulette tries the pasted configuration first, then the basic fields.</p>
          <div className="field">
            <label htmlFor="ai-config">Paste configuration (optional)</label>
            <textarea id="ai-config" value={ai.configText} onChange={(e) => setAi({ ...ai, configText: e.target.value })} placeholder={'from openai import OpenAI\nclient = OpenAI(api_key="...", base_url="https://.../v1")\nresponse = client.chat.completions.create(model="...", temperature=1)'} />
            <span className="hint">Python, JavaScript, JSON, YAML, .env or curl. Keys found in it are moved to encrypted storage and removed from the text.</span>
          </div>
          <div className="field">
            <label htmlFor="ai-base">Base URL</label>
            <input id="ai-base" type="url" value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
          </div>
          <div className="field">
            <label htmlFor="ai-model">Model</label>
            <input id="ai-model" type="text" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} placeholder="llama3.1:8b" />
          </div>
          <div className="field">
            <label htmlFor="ai-key">API key {sec.aiApiKey !== 'none' && `(${sec.aiApiKey === 'env' ? 'set by environment variable' : 'saved'})`}</label>
            <input id="ai-key" type="password" autoComplete="off" value={ai.key} onChange={(e) => setAi({ ...ai, key: e.target.value })} placeholder="Leave empty for local models" />
          </div>
          <div className="inline">
            <button className="btn-clay" onClick={saveAi} id="save-ai">Save AI settings</button>
            <button className="btn-outlined" onClick={testAi} id="test-ai">Test connection</button>
            <button className="btn-outlined" onClick={runNow} id="run-monitor">Check production now</button>
          </div>
          {test && <div style={{ marginTop: 12 }}><Banner kind={test.kind}>{test.text}</Banner></div>}
        </>
      )}
    </div>
  );
}

function GuardSection({ state, save }: { state: AppState; save: (p: any) => void }) {
  const s = state.settings;
  const [folder, setFolder] = useState('');
  return (
    <div className="panel" id="settings-guard">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <PanelHead icon={<ShieldCheck {...iconProps} />} title="Download guard" />
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Watches Downloads, your active project and the folders below. Suspicious items are moved to quarantine and you decide.</p>
        </div>
        <Toggle id="guard-toggle" label="Download guard" checked={s.guard.enabled} onChange={(v) => save({ guard: { enabled: v } })} />
      </div>
      {state.guard?.watching && <p className="text-tertiary" style={{ marginTop: 8 }}>Watching: {state.guard.watching.join(', ') || 'nothing'}</p>}
      {s.guard.extraFolders.map((f: string) => (
        <div className="code-line" key={f}>
          <code>{f}</code>
          <button className="btn-text" onClick={() => save({ guard: { extraFolders: s.guard.extraFolders.filter((x: string) => x !== f) } })}>Remove</button>
        </div>
      ))}
      <form className="inline" style={{ marginTop: 10 }} onSubmit={(e) => (e.preventDefault(), folder.trim() && save({ guard: { extraFolders: [...s.guard.extraFolders, folder.trim()] } }), setFolder(''))}>
        <label htmlFor="guard-folder" className="sr-only">Folder to watch</label>
        <input id="guard-folder" className="input" style={{ flex: 1 }} type="text" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Add a folder to watch, e.g. C:\Users\you\Projects" />
        <button className="btn-outlined" type="submit">Add</button>
      </form>
    </div>
  );
}

function AdvancedSection({ state, save }: { state: AppState; save: (p: any) => void }) {
  const s = state.settings;
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  async function showBrowserUrl() {
    if (!isTauri) return setBrowserUrl(window.location.origin);
    const info = await invoke<{ port: number; token: string }>('daemon_info');
    setBrowserUrl(`http://127.0.0.1:${info.port}/?t=${encodeURIComponent(info.token)}`);
  }
  return (
    <div className="panel">
      <PanelHead icon={<Wrench {...iconProps} />} title="Advanced" />
      <div className="setting-row">
        <div>
          <label className="label" htmlFor="login-toggle">Start when I sign in to Windows</label>
          <div className="desc">Needed for production checks and the download guard to run without opening the app.</div>
        </div>
        <Toggle id="login-toggle" label="Start at sign-in" checked={s.startAtLogin} onChange={(v) => save({ startAtLogin: v })} />
      </div>
      <div className="setting-row">
        <div>
          <label className="label" htmlFor="remote-toggle">Remote MCP (HTTP)</label>
          <div className="desc">Lets agents connect over HTTP at 127.0.0.1 with your access code. Off by default. Anyone with the code can run Noulette tools, so keep it private.</div>
        </div>
        <Toggle id="remote-toggle" label="Remote MCP" checked={s.remoteMcp.enabled} onChange={(v) => save({ remoteMcp: { enabled: v } })} />
      </div>
      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label">View in Chrome</div>
          <div className="desc">Open this app in your browser on this computer. The link contains your private access code.</div>
          {browserUrl && (
            <div className="code-line">
              <code>{browserUrl}</code>
              <CopyButton text={browserUrl} label="Copy link" variant="outlined" />
            </div>
          )}
        </div>
        <button className="btn-outlined" style={{ padding: '7px 14px', fontSize: 13 }} onClick={showBrowserUrl}>Show link</button>
      </div>
    </div>
  );
}
