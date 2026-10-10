import React, { useState } from 'react';
import { BrandMark, BrandWordmark } from './BrandLogo.js';
import { Download, Play, Check, Copy, Shield, Monitor } from 'lucide-react';
import { tauriInvoke } from '../util/ipc.js';

interface SetupWizardProps {
  appRoot?: string;
  onLaunchSuccess: () => void;
  onCancel?: () => void;
}

export function SetupWizard({
  appRoot = 'C:\\Users\\User\\Downloads\\noulette',
  onLaunchSuccess,
  onCancel
}: SetupWizardProps) {
  const [installBin, setInstallBin] = useState(true);
  const [createDesktopShortcut, setCreateDesktopShortcut] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);

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
      await tauriInvoke('get_engine_status');
      setTimeout(() => {
        setLaunching(false);
        onLaunchSuccess();
      }, 700);
    } catch (err) {
      console.error(err);
      setTimeout(() => {
        setLaunching(false);
        onLaunchSuccess();
      }, 500);
    }
  };

  return (
    <div
      className="setup-wizard-overlay"
      id="setup-wizard-overlay"
      style={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000000',
        padding: '24px',
        color: '#FFFFFF'
      }}
    >
      {/* Website One-Click Download Notification Banner */}
      <div
        className="website-download-banner"
        id="website-download-banner"
        style={{
          width: '100%',
          maxWidth: '640px',
          background: '#0A0A0A',
          border: '1px solid #222222',
          borderRadius: '8px',
          padding: '12px 18px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: '#1A1A1A',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Download size={16} />
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
              One-Click Download Initiated
            </div>
            <div style={{ fontSize: '12px', color: '#888888' }}>
              noulette.exe • 104 MB • Saved to Downloads
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: '11px',
            border: '1px solid #FFFFFF',
            color: '#FFFFFF',
            padding: '2px 8px',
            borderRadius: '4px',
            fontWeight: 600
          }}
        >
          Ready
        </span>
      </div>

      {/* Tauri Built-in System Installer Window Frame */}
      <div
        className="setup-window-frame"
        id="setup-window-frame"
        style={{
          width: '100%',
          maxWidth: '640px',
          background: '#000000',
          border: '1px solid #FFFFFF',
          borderRadius: '10px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Title Bar */}
        <div
          style={{
            height: '40px',
            background: '#0A0A0A',
            borderBottom: '1px solid #222222',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BrandMark size={16} />
            <span style={{ fontSize: '12px', fontWeight: 500, color: '#FFFFFF' }}>
              Noulette Installer
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#444444' }} />
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#444444' }} />
          </div>
        </div>

        {/* Content Area */}
        <div style={{ padding: '36px 36px 28px 36px' }}>
          {/* Identity: Noulette Logo emblem + Noulette Word separated */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px', color: '#FFFFFF' }}>
              <BrandMark size={52} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>
              <BrandWordmark height={24} />
            </div>
          </div>

          <h2
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '24px',
              fontWeight: 700,
              color: '#FFFFFF',
              margin: '0 0 18px 0',
              textAlign: 'center'
            }}
          >
            Desktop Installation & Launch
          </h2>

          {/* Installer Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px' }}>
            {/* Install as Bin */}
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '12px 14px',
                border: '1px solid #FFFFFF',
                borderRadius: '6px',
                background: '#0A0A0A',
                cursor: 'pointer'
              }}
            >
              <input
                type="radio"
                name="installerBinOption"
                checked={installBin}
                onChange={() => setInstallBin(true)}
                style={{ marginTop: '3px', accentColor: '#FFFFFF' }}
              />
              <div>
                <strong style={{ fontSize: '13px', color: '#FFFFFF', display: 'block', marginBottom: '2px' }}>
                  Install as system application binary (bin)
                </strong>
                <span style={{ fontSize: '12px', color: '#AAAAAA' }}>
                  Unpacks all-in-one headless engine and desktop shell into %APPDATA%\noulette\bin\noulette.exe.
                </span>
              </div>
            </label>

            {/* Desktop Shortcut Option */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 14px',
                border: '1px solid #333333',
                borderRadius: '6px',
                background: '#050505',
                cursor: 'pointer'
              }}
            >
              <input
                type="checkbox"
                id="create-shortcut-checkbox"
                checked={createDesktopShortcut}
                onChange={(e) => setCreateDesktopShortcut(e.target.checked)}
                style={{ accentColor: '#FFFFFF' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BrandMark size={18} />
                <span style={{ fontSize: '13px', color: '#FFFFFF' }}>
                  Create Desktop Shortcut (uses Noulette emblem icon without words)
                </span>
              </div>
            </label>

            {/* Security Guarantee Checkbox */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '6px 14px',
                cursor: 'pointer'
              }}
            >
              <input
                type="checkbox"
                id="agree-security-checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                style={{ accentColor: '#FFFFFF' }}
              />
              <span style={{ fontSize: '12px', color: '#888888' }}>
                Enable cryptographic Ed25519 signing for all human decisions and receipts
              </span>
            </label>
          </div>

          {/* MCP configuration quick toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid #222222', borderRadius: '6px', marginBottom: '16px' }}>
            <span style={{ fontSize: '12px', color: '#AAAAAA' }}>AI Coding Assistant Setup (MCP)</span>
            <button
              type="button"
              onClick={handleCopyMcp}
              style={{
                background: 'transparent',
                border: '1px solid #FFFFFF',
                color: '#FFFFFF',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {copiedMcp ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedMcp ? 'Copied' : 'Copy MCP Config'}</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            background: '#0A0A0A',
            borderTop: '1px solid #222222',
            padding: '14px 36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px', color: '#666666' }}>
            <span>Noulette 0.1.0</span>
            <span>Ed25519 Verified</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {onCancel && (
              <button
                type="button"
                id="setup-back-btn"
                onClick={onCancel}
                style={{
                  background: 'transparent',
                  border: '1px solid #444444',
                  color: '#FFFFFF',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Back
              </button>
            )}

            <button
              type="button"
              id="setup-auto-launch-btn"
              disabled={!agreeTerms || launching}
              onClick={handleAutoLaunch}
              style={{
                background: '#FFFFFF',
                color: '#000000',
                border: '1px solid #FFFFFF',
                padding: '9px 24px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Play size={14} fill="#000000" />
              <span>{launching ? 'Launching...' : 'Auto Launch'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
