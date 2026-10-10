import React from 'react';
import { X, Lock, AlertOctagon } from 'lucide-react';

export interface HeldBackDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  issues?: { title: string; actionRequired: string }[];
}

const defaultIssues = [
  {
    title: 'Repeated referee verification failure (attempt cap exceeded)',
    actionRequired: 'Automated fixes failed 3 consecutive times. Review the broken test assertions and refactor manually.'
  },
  {
    title: 'Leaked production credential detected in history',
    actionRequired: 'Revoke the AWS access key in provider console and purge secret using git filter-repo or BFG before release.'
  }
];

export function HeldBackDrawer({ isOpen, onClose, issues = defaultIssues }: HeldBackDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="drawer-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="heldback-title">
      <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header" style={{ borderBottomColor: 'var(--status-critical-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--status-critical-text)' }}>
            <Lock size={24} />
            <h3 id="heldback-title" style={{ fontSize: '24px', fontWeight: 800 }}>Release Held Back</h3>
          </div>
          <button className="btn-text" onClick={onClose} aria-label="Close held back drawer">
            <X size={22} />
          </button>
        </div>

        <div className="drawer-body">
          <div style={{ background: 'var(--status-critical-bg)', border: '1px solid var(--status-critical-border)', borderRadius: 'var(--radius-sm)', padding: '14px', marginBottom: '18px', fontSize: '15px', color: 'var(--status-critical-text)', lineHeight: 1.5 }}>
            <strong>Ordinary approval path locked:</strong> This project cannot be signed for release until the following blocker items are resolved manually by a person and a fresh candidate is frozen.
          </div>

          <h5 style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 800 }}>
            <span>Required Human Actions</span>
            <span className="alert-count-pill">{issues.length}</span>
          </h5>

          {issues.map((issue, idx) => (
            <div key={`issue-${idx}`} style={{ background: 'var(--bg-app)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)', padding: '14px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px', fontSize: '17px' }}>
                <AlertOctagon size={20} color="var(--status-critical-border)" />
                <span>{issue.title}</span>
              </div>
              <div style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {issue.actionRequired}
              </div>
            </div>
          ))}

          <div style={{ marginTop: '20px', padding: '12px', background: 'var(--bg-surface)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'var(--text-tertiary)' }}>
            Once you fix these issues, run a new scan or call <code>noulette_scan</code> to re-evaluate the frozen candidate.
          </div>
        </div>
      </div>
    </div>
  );
}
