import React from 'react';
import { X, CheckCircle, AlertTriangle, HelpCircle } from 'lucide-react';

export interface ScorecardData {
  ran: string[];
  skipped: { name: string; reason: string }[];
  notCovered: { area: string; explanation: string }[];
  versions: {
    engine: string;
    rules: string;
    opengrep?: string;
    gitleaks?: string;
    dangerNotesSyncedAt: string;
  };
}

export interface ScorecardDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  data?: ScorecardData;
}

const defaultScorecardData: ScorecardData = {
  ran: ['trapcheck', 'gitleaks (keys)', 'opengrep (code-mistakes)', 'ingredients (dep-trust)', 'ai-checks', 'appmap (route inspection)'],
  skipped: [
    { name: 'Roleplay simulation', reason: 'Roleplay skipped: earlier blocking finding present' }
  ],
  notCovered: [
    { area: 'Unanswered logic rules', explanation: '2 areas not checked because policy wizard questions remained unanswered' },
    { area: 'AI SDK checks', explanation: 'No AI SDK detected in codebase; not applicable' }
  ],
  versions: {
    engine: '0.1.0 (win-x64)',
    rules: '2026.10.09',
    opengrep: 'sha256:d1e2f3... (pinned)',
    gitleaks: 'sha256:a4b5c6... (pinned)',
    dangerNotesSyncedAt: '2026-10-09T18:00:00Z'
  }
};

export function ScorecardDrawer({ isOpen, onClose, data = defaultScorecardData }: ScorecardDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="drawer-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="scorecard-title">
      <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h3 id="scorecard-title" style={{ fontSize: '24px', fontWeight: 800 }}>Inspection Scorecard</h3>
          <button className="btn-text" onClick={onClose} aria-label="Close scorecard drawer">
            <X size={22} />
          </button>
        </div>

        <div className="drawer-body">
          <div className="drawer-section">
            <h5 style={{ color: 'var(--status-safe-text)', fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Checks Ran</span>
              <span className="badge badge-success" style={{ fontSize: '13px' }}>{data.ran.length}</span>
            </h5>
            {data.ran.map((check, i) => (
              <div key={`ran-${i}`} className="drawer-item">
                <CheckCircle size={20} color="var(--status-safe-border)" />
                <span style={{ fontSize: '15px' }}>{check}</span>
              </div>
            ))}
          </div>

          <div className="drawer-section">
            <h5 style={{ color: 'var(--status-warning-text)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 800 }}>
              <span>Checks Skipped</span>
              <span className="alert-count-pill">{data.skipped.length}</span>
            </h5>
            {data.skipped.map((item, i) => (
              <div key={`skipped-${i}`} className="drawer-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
                  <AlertTriangle size={18} color="var(--status-warning-border)" />
                  <span>{item.name}</span>
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginLeft: '26px', marginTop: '3px' }}>
                  {item.reason}
                </div>
              </div>
            ))}
          </div>

          <div className="drawer-section">
            <h5 style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 800 }}>
              <span>Checks Not Covered</span>
              <span className="alert-count-pill">{data.notCovered.length}</span>
            </h5>
            {data.notCovered.map((item, i) => (
              <div key={`not-covered-${i}`} className="drawer-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
                  <HelpCircle size={18} color="var(--text-tertiary)" />
                  <span>{item.area}</span>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: '26px', marginTop: '3px' }}>
                  {item.explanation}
                </div>
              </div>
            ))}
          </div>

          <div className="drawer-section" style={{ borderTop: 'var(--border-width) solid var(--border-subtle)', paddingTop: '16px' }}>
            <h5>Engine & Scanner Versions</h5>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'grid', gap: '6px' }}>
              <div><strong>Engine:</strong> {data.versions.engine}</div>
              <div><strong>Ruleset:</strong> {data.versions.rules}</div>
              {data.versions.opengrep && <div><strong>Opengrep:</strong> {data.versions.opengrep}</div>}
              {data.versions.gitleaks && <div><strong>Gitleaks:</strong> {data.versions.gitleaks}</div>}
              <div><strong>Danger Notes Synced:</strong> {data.versions.dangerNotesSyncedAt}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
