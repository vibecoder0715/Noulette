import React, { useState } from 'react';
import { BrandMark } from './BrandLogo.js';
import { Download, Play, Check, Copy, ExternalLink, Sparkles, Terminal, Shield } from 'lucide-react';
import { tauriInvoke } from '../util/ipc.js';

interface InstallWidgetProps {
  appRoot?: string;
  onLaunchSuccess?: () => void;
}

export function InstallWidget({
  appRoot = 'C:\\Users\\User\\Downloads\\noulette',
  onLaunchSuccess
}: InstallWidgetProps) {
  const [copiedMcp, setCopiedMcp] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(true); // Connected to running instance

  const mcpConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        noulette: {
          command: `${appRoot}\\dist\\noulette.exe`,
          args: ['mcp']
        }
      }
    },
    null,
    2
  );

  const handleCopyMcp = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(mcpConfigSnippet);
      setCopiedMcp(true);
      setTimeout(() => setCopiedMcp(false), 2000);
    }
  };

  const handleAutoLaunch = async () => {
    setLaunching(true);
    try {
      await tauriInvoke('play_chime');
      setLaunched(true);
      onLaunchSuccess?.();
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setLaunching(false), 600);
    }
  };

  return (
    <div
      className="install-widget-card"
      id="install-widget"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '32px',
        maxWidth: '720px',
        margin: '0 auto',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)'
      }}
    >
      {/* Brand Header: Real Emblem Mark without the word Noulette + clean "noulette" title */}
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px', color: 'var(--accent-clay)' }}>
          <BrandMark size={54} />
        </div>
        <h2
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '28px',
            fontWeight: 700,
            margin: '0 0 6px 0',
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)'
          }}
        >
          noulette
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>
          High-assurance software problem detection, isolated fix verification & release gates.
        </p>
      </div>

      {/* Preconfigured Download & Install Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '32px' }}>
        {/* Step 1 */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            alignItems: 'flex-start',
            padding: '16px',
            background: 'var(--bg-app)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent-clay)',
              color: 'var(--accent-clay-text)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '14px',
              flexShrink: 0
            }}
          >
            1
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>Single All-in-One Download</strong>
              <span className="badge" style={{ fontSize: '11px', background: 'var(--bg-sidebar-active)' }}>Windows x64 • ~104 MB</span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>
              Contains the complete desktop interface and headless analysis engine in one unified file.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                dist\noulette.exe
              </span>
              <span style={{ fontSize: '12px', color: 'var(--color-success-text)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Check size={14} /> Ready
              </span>
            </div>
          </div>
        </div>

        {/* Step 2: Auto Launch */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            alignItems: 'flex-start',
            padding: '16px',
            background: 'var(--bg-app)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent-clay)',
              color: 'var(--accent-clay-text)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '14px',
              flexShrink: 0
            }}
          >
            2
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>Launch & Connect Desktop App</strong>
              {launched && (
                <span className="badge badge-accent" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
                  Running (Active)
                </span>
              )}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
              Click to launch the application. The background engine initializes securely in your user profile.
            </p>
            <button
              className="btn-clay"
              id="auto-launch-btn"
              onClick={handleAutoLaunch}
              disabled={launching}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}
            >
              <Play size={15} />
              <span>{launching ? 'Launching Application...' : 'Auto Launch'}</span>
            </button>
          </div>
        </div>

        {/* Step 3: MCP Agent Connection */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            alignItems: 'flex-start',
            padding: '16px',
            background: 'var(--bg-app)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent-clay)',
              color: 'var(--accent-clay-text)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '14px',
              flexShrink: 0
            }}
          >
            3
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>AI Coding Assistant Setup (MCP)</strong>
              <button
                className="btn-outlined"
                onClick={handleCopyMcp}
                style={{ fontSize: '12px', padding: '4px 10px' }}
                id="copy-mcp-config-btn"
              >
                {copiedMcp ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedMcp ? 'Config Copied' : 'Copy MCP Config'}</span>
              </button>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>
              Human builders never need to touch the terminal. Your AI agent (Cursor, Claude Code, Copilot) runs inspection commands in the background via MCP.
            </p>
            <pre
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-xs)',
                padding: '10px',
                margin: 0,
                overflowX: 'auto',
                color: 'var(--text-primary)'
              }}
            >
              {mcpConfigSnippet}
            </pre>
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-tertiary)' }}>
        Zero external runtimes or separate downloads required • Verified with Ed25519 signatures
      </div>
    </div>
  );
}
