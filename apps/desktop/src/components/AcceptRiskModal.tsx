import React, { useState } from 'react';
import { X } from 'lucide-react';

export interface AcceptRiskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string, owner: string, days: number) => void;
  findingTitle: string;
}

export function AcceptRiskModal({ isOpen, onClose, onSubmit, findingTitle }: AcceptRiskModalProps) {
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState('');
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!owner.trim()) {
      setError('Owner name is required');
      return;
    }
    if (reason.trim().length < 10) {
      setError('Reason must be at least 10 characters explaining why the risk is accepted');
      return;
    }
    if (days > 90) {
      setError('Risk acceptance expiry cannot exceed 90 days');
      return;
    }

    setError(null);
    onSubmit(reason.trim(), owner.trim(), days);
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 id="modal-title" className="modal-title">Accept Risk Exception</h3>
          <button className="btn-text" onClick={onClose} aria-label="Close modal">
            <X size={22} />
          </button>
        </div>

        <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
          Accepting risk creates a temporary signed exemption for: <strong>{findingTitle}</strong>. Hard stops (blocking findings) cannot be accepted.
        </p>

        {error && (
          <div style={{ padding: '8px 12px', background: 'var(--status-critical-bg)', color: 'var(--status-critical-text)', borderRadius: 'var(--radius-sm)', fontSize: '14px', marginBottom: '14px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <label htmlFor="risk-owner">Owner (Team or Lead)</label>
            <input
              id="risk-owner"
              type="text"
              placeholder="e.g. security-team / jane"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              required
            />
          </div>

          <div className="modal-field">
            <label htmlFor="risk-reason">Justification Reason (minimum 10 chars)</label>
            <textarea
              id="risk-reason"
              rows={3}
              placeholder="Explain why this risk is acceptable until resolved..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {reason.length} / 10 characters minimum
            </div>
          </div>

          <div className="modal-field">
            <label htmlFor="risk-days">Expiry Duration ({days} days, max 90)</label>
            <input
              id="risk-days"
              type="range"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-outlined" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-clay">
              Sign Risk Exemption
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
