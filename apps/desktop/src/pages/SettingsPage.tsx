import React, { useState, useEffect } from 'react';
import { Copy, Check, Volume2, Play, Sparkles, BellRing } from 'lucide-react';
import { tauriInvoke, type EngineStatus } from '../util/ipc.js';
import { playNotificationSound, subscribeToSoundState } from '../util/sound.js';

export interface StarterPromptItem {
  title: string;
  description: string;
  skill: string;
  text: string;
  getPrompt: (appRoot: string) => string;
}

export const STARTER_PROMPTS: StarterPromptItem[] = [
  {
    title: 'Fix security and logic',
    description: 'Automated vulnerability scanning, isolated sandbox fix verification, and safe approval diffs.',
    skill: 'security-logic',
    text: 'Use the noulette MCP server (command: "C:\\Users\\User\\Downloads\\noulette\\dist\\noulette.exe", args: ["mcp"]). Run skill at "C:\\Users\\User\\Downloads\\noulette\\skills\\security-logic". Call noulette_scan for this project. Fix the top finding on an isolated copy, verify it with noulette_verify_fix, and present the diff for approval.',
    getPrompt: (appRoot: string) =>
      `Use the noulette MCP server (command: "${appRoot}\\dist\\noulette.exe", args: ["mcp"]). Run skill at "${appRoot}\\skills\\security-logic". Call noulette_scan for this project. Fix the top finding on an isolated copy, verify it with noulette_verify_fix, and present the diff for approval.`
  },
  {
    title: 'Fix feasibility (scale and risk plan)',
    description: '10-step scale and risk assessment identifying architectural bottlenecks, cost caps, and over-building.',
    skill: 'arch-feasibility',
    text: 'Use the noulette MCP server (command: "C:\\Users\\User\\Downloads\\noulette\\dist\\noulette.exe", args: ["mcp"]). Run skill at "C:\\Users\\User\\Downloads\\noulette\\skills\\arch-feasibility". Call noulette_plan for this project. Focus on the cost and architecture recommendations, and summarize them clearly.',
    getPrompt: (appRoot: string) =>
      `Use the noulette MCP server (command: "${appRoot}\\dist\\noulette.exe", args: ["mcp"]). Run skill at "${appRoot}\\skills\\arch-feasibility". Call noulette_plan for this project. Focus on the cost and architecture recommendations, and summarize them clearly.`
  },
  {
    title: 'Check an outside project before opening it',
    description: 'Quarantine intake verification for downloaded or untrusted third-party repositories before local execution.',
    skill: 'intake-quarantine',
    text: 'Use the noulette MCP server (command: "C:\\Users\\User\\Downloads\\noulette\\dist\\noulette.exe", args: ["mcp"]). Run skill at "C:\\Users\\User\\Downloads\\noulette\\skills\\intake-quarantine". Run the noulette intake quarantine pipeline on this untrusted repo. Report if it is Reject, Unsure, or Pass according to TRAPCHECK_RULES.md.',
    getPrompt: (appRoot: string) =>
      `Use the noulette MCP server (command: "${appRoot}\\dist\\noulette.exe", args: ["mcp"]). Run skill at "${appRoot}\\skills\\intake-quarantine". Run the noulette intake quarantine pipeline on this untrusted repo. Report if it is Reject, Unsure, or Pass according to TRAPCHECK_RULES.md.`
  },
  {
    title: 'Check before I ship',
    description: 'Pre-flight release gate verification ensuring zero blocking bugs, rotated keys, and verified git commit integrity.',
    skill: 'release-gate',
    text: 'Use the noulette MCP server (command: "C:\\Users\\User\\Downloads\\noulette\\dist\\noulette.exe", args: ["mcp"]). Run skill at "C:\\Users\\User\\Downloads\\noulette\\skills\\release-gate". Run complete gate verification on this repository: quick change, keys, and merge gate checks. Ensure no blocking findings exist.',
    getPrompt: (appRoot: string) =>
      `Use the noulette MCP server (command: "${appRoot}\\dist\\noulette.exe", args: ["mcp"]). Run skill at "${appRoot}\\skills\\release-gate". Run complete gate verification on this repository: quick change, keys, and merge gate checks. Ensure no blocking findings exist.`
  },
  {
    title: 'Explain a finding',
    description: 'Plain-language vulnerability walkthrough detailing root-cause exploit mechanisms and safe alternatives.',
    skill: 'explain-finding',
    text: 'Use the noulette MCP server (command: "C:\\Users\\User\\Downloads\\noulette\\dist\\noulette.exe", args: ["mcp"]). Run skill at "C:\\Users\\User\\Downloads\\noulette\\skills\\explain-finding". Fetch the evidence snippet for the active finding from noulette_get_findings. Explain the vulnerability mechanism and the safe alternative.',
    getPrompt: (appRoot: string) =>
      `Use the noulette MCP server (command: "${appRoot}\\dist\\noulette.exe", args: ["mcp"]). Run skill at "${appRoot}\\skills\\explain-finding". Fetch the evidence snippet for the active finding from noulette_get_findings. Explain the vulnerability mechanism and the safe alternative.`
  }
];

export function SettingsPage() {
  const [effort, setEffort] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [autoFix, setAutoFix] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [volume, setVolume] = useState(80);
  const [isPlaying, setIsPlaying] = useState(false);
  const [copiedPromptIdx, setCopiedPromptIdx] = useState<number | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);

  // Dynamically resolve workspace root for absolute skill and exe paths
  const appRoot = engineStatus?.sidecarPath
    ? engineStatus.sidecarPath.replace(/[\\/]dist[\\/][^\\/]+$/, '')
    : 'C:\\Users\\User\\Downloads\\noulette';

  useEffect(() => {
    tauriInvoke<EngineStatus>('get_engine_status')
      .then(setEngineStatus)
      .catch(console.error);
  }, []);

  useEffect(() => {
    return subscribeToSoundState(setIsPlaying);
  }, []);

  const handleCopyPrompt = async (promptItem: StarterPromptItem, idx: number) => {
    const dynamicPromptText = promptItem.getPrompt(appRoot);
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(dynamicPromptText);
    }
    setCopiedPromptIdx(idx);
    setTimeout(() => setCopiedPromptIdx(null), 2000);
  };

  const handleTestChime = () => {
    if (soundEnabled) {
      playNotificationSound(volume).catch(console.error);
      tauriInvoke('play_chime', { volume }).catch(() => {});
    }
  };

  return (
    <div className="page-container" id="settings-page">
      <h1 className="page-title">Settings</h1>

      {/* 1. Effort Level (Radio Cards) */}
      <div style={{ marginBottom: '28px' }}>
        <h3 style={{ fontSize: '19px', fontWeight: 800, marginBottom: '6px' }}>Inspection Effort Tier</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          Controls checker depth, role-play execution, and maximum retry cycles.
        </p>

        <div className="radio-card-group">
          <div
            className={`radio-card ${effort === 'Low' ? 'selected' : ''}`}
            onClick={() => setEffort('Low')}
            id="effort-low"
          >
            <div className="radio-card-title">Low</div>
            <div className="radio-card-desc">Quick, light on tokens — Static checks only, no app execution (1 retry).</div>
          </div>

          <div
            className={`radio-card ${effort === 'Medium' ? 'selected' : ''}`}
            onClick={() => setEffort('Medium')}
            id="effort-medium"
          >
            <div className="radio-card-title">Medium (Default)</div>
            <div className="radio-card-desc">Recommended — Static checks plus test-copy role-play as two users (3 retries).</div>
          </div>

          <div
            className={`radio-card ${effort === 'High' ? 'selected' : ''}`}
            onClick={() => setEffort('High')}
            id="effort-high"
          >
            <div className="radio-card-title">High</div>
            <div className="radio-card-desc">Deep — Full rescan after each accepted fix, second-method validation (cap: 3 rounds).</div>
          </div>
        </div>
      </div>

      {/* 2. Auto-Fix Toggle */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '16px 20px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div>
            <h4 style={{ fontSize: '19px', fontWeight: 800, marginBottom: '4px' }}>Automated Spare-Copy Fixing</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {autoFix
                ? 'Your agent fixes issues on a spare copy and submits an approval card in this app.'
                : 'Your agent outputs a concise TL;DR report and halts until you approve a plan in this app.'}
            </p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              id="auto-fix-toggle"
              checked={autoFix}
              onChange={(e) => setAutoFix(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {/* 3. Starter Prompts Catalog (Abstracted for Vibe Coders — Raw Prompts and Skills Hidden) */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <Sparkles size={20} color="var(--accent-clay)" />
          <h3 style={{ fontSize: '19px', fontWeight: 800 }}>Starter Prompts Catalog</h3>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.5 }}>
          Copy these prompts directly into your AI coding tool (Claude Code, Cursor, Copilot, Gemini). Each prompt automatically configures the MCP server and dynamic skill paths.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {STARTER_PROMPTS.map((prompt, idx) => (
            <div
              key={`prompt-${idx}`}
              id={`starter-prompt-card-${idx}`}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '14px'
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <strong style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{prompt.title}</strong>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  {prompt.description}
                </p>
              </div>

              <button
                className="btn-clay"
                id={`copy-starter-btn-${idx}`}
                onClick={() => handleCopyPrompt(prompt, idx)}
                style={{ flexShrink: 0, padding: '7px 14px', fontSize: '13px' }}
              >
                {copiedPromptIdx === idx ? <Check size={16} /> : <Copy size={16} />}
                <span>{copiedPromptIdx === idx ? 'Copied with MCP' : 'Copy Prompt'}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Audio Chime & Notifications */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <Volume2 size={20} color="var(--accent-clay)" />
          <h4 style={{ fontSize: '19px', fontWeight: 800 }}>Audio Chime & Notifications</h4>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.5 }}>
          Subtle native chime plays on review cards; Windows toasts are silent to prevent double chime.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              id="sound-enabled-checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
            />
            <span>Audio Chime Enabled</span>
          </label>

          <button className="btn-outlined" id="test-chime-btn" onClick={handleTestChime} disabled={!soundEnabled} style={{ fontSize: '13px', padding: '6px 12px' }}>
            <Play size={14} />
            <span>Test Chime</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '300px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Volume:</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            disabled={!soundEnabled}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', width: '40px' }}>{volume}%</span>
        </div>

        {/* Interactive Sound Demo Card */}
        <div
          id="notification-sound-demo-card"
          style={{
            marginTop: '18px',
            padding: '16px 20px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-card)',
            background: 'var(--bg-app)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  backgroundColor: isPlaying ? 'var(--accent-clay)' : 'var(--bg-surface)',
                  color: isPlaying ? 'var(--accent-clay-text)' : 'var(--accent-clay)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: isPlaying ? '0 0 16px var(--accent-clay)' : 'none'
                }}
              >
                <BellRing size={20} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ fontSize: '15px', fontWeight: 800 }}>Notification Alert Sound Demo</strong>
                  <span
                    className="badge"
                    style={{
                      fontSize: '11px',
                      backgroundColor: isPlaying ? 'var(--accent-clay)' : 'var(--bg-surface)',
                      color: isPlaying ? 'var(--accent-clay-text)' : 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {isPlaying ? 'Playing Audio...' : 'Studio WAV • 44.1 kHz'}
                  </span>
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Crisp tri-tone glassy chime (E5 → A5 → E6) engineered for instant, clear alert recognition.
                </div>
              </div>
            </div>

            {/* Visualizer & Demo Action Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div className="sound-visualizer-container" aria-label="Audio Visualizer">
                <span className={`sound-bar ${isPlaying ? 'playing' : ''}`} />
                <span className={`sound-bar ${isPlaying ? 'playing' : ''}`} />
                <span className={`sound-bar ${isPlaying ? 'playing' : ''}`} />
                <span className={`sound-bar ${isPlaying ? 'playing' : ''}`} />
                <span className={`sound-bar ${isPlaying ? 'playing' : ''}`} />
              </div>

              <button
                type="button"
                className="btn-clay"
                id="play-demo-sound-btn"
                onClick={handleTestChime}
                disabled={!soundEnabled}
                style={{
                  padding: '8px 18px',
                  fontSize: '13px',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: soundEnabled ? 'pointer' : 'not-allowed',
                  opacity: soundEnabled ? 1 : 0.5,
                  boxShadow: isPlaying ? '0 0 12px rgba(0,0,0,0.25)' : 'none'
                }}
              >
                <Play size={14} />
                <span>{isPlaying ? 'Playing Alert...' : 'Play Demo'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
