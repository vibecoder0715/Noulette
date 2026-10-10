import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, ExternalLink, Volume2 } from 'lucide-react';
import { playNotificationSound } from '../util/sound.js';

export type NotificationCategory = 'All' | 'Stops release' | 'Warnings' | 'Resolved';

export interface NotificationItem {
  id: string;
  badge: 'Critical' | 'Warning' | 'Resolved' | 'Info';
  type: 'critical' | 'warning' | 'resolved' | 'info';
  category: 'Stops release' | 'Warnings' | 'Resolved' | 'Info';
  title: string;
  summary: string;
  timestamp: string;
  decisionId?: string;
}

const mockNotifications: NotificationItem[] = [
  {
    id: 'notif-1',
    badge: 'Critical',
    type: 'critical',
    category: 'Stops release',
    title: 'Arbitrary code execution via eval in api/handler.js',
    summary: 'Referee verification passed an isolated fix. Approval card created.',
    timestamp: '10 minutes ago',
    decisionId: 'dec_01J00000000000000000000001'
  },
  {
    id: 'notif-2',
    badge: 'Critical',
    type: 'critical',
    category: 'Stops release',
    title: 'Live AWS API Access Key staged in credentials.ts',
    summary: 'Save Gate pre-commit hook blocked commit attempt.',
    timestamp: '25 minutes ago'
  },
  {
    id: 'notif-3',
    badge: 'Warning',
    type: 'warning',
    category: 'Warnings',
    title: 'CORS wildcard with credentials in server.js',
    summary: 'Origin "*" combined with credentials true. Recommended origin list provided.',
    timestamp: '1 hour ago'
  },
  {
    id: 'notif-4',
    badge: 'Resolved',
    type: 'resolved',
    category: 'Resolved',
    title: 'SQL injection in search route fixed and applied',
    summary: 'Fix patch was cryptographically signed and applied to main working tree.',
    timestamp: '2 hours ago'
  }
];

export interface NotificationsPageProps {
  onNavigateToDecisions?: (decisionId?: string) => void;
}

export function NotificationsPage({ onNavigateToDecisions }: NotificationsPageProps) {
  const [filter, setFilter] = useState<NotificationCategory>('All');

  const filtered = mockNotifications.filter(n => {
    if (filter === 'All') return true;
    return n.category === filter;
  });

  return (
    <div className="page-container" id="notifications-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Notifications</h1>
        <button
          type="button"
          className="btn-outlined"
          id="notif-test-sound-btn"
          onClick={() => playNotificationSound(80)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            fontWeight: 700,
            padding: '7px 14px',
            cursor: 'pointer'
          }}
          title="Play notification alert chime"
        >
          <Volume2 size={16} />
          <span>Test Alert Sound</span>
        </button>
      </div>

      {/* Filter Pills */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        {(['All', 'Stops release', 'Warnings', 'Resolved'] as NotificationCategory[]).map(cat => (
          <button
            key={cat}
            className={`btn-outlined ${filter === cat ? 'active' : ''}`}
            id={`filter-${cat.toLowerCase().replace(/\s+/g, '-')}`}
            style={{
              padding: '7px 15px',
              fontSize: '13px',
              backgroundColor: filter === cat ? 'var(--bg-sidebar-active)' : 'transparent',
              borderColor: filter === cat ? 'var(--accent-clay)' : 'var(--border-card)',
              fontWeight: filter === cat ? 800 : 600
            }}
            onClick={() => setFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filtered.map(notif => {
          let badgeClass = 'notification-badge';
          let icon = <Info size={24} />;

          if (notif.type === 'critical') {
            badgeClass = 'notification-badge critical badge-critical';
            icon = <AlertCircle size={24} color="var(--status-critical-border)" />;
          } else if (notif.type === 'warning') {
            badgeClass = 'notification-badge warning badge-warning';
            icon = <AlertTriangle size={24} color="var(--status-warning-border)" />;
          } else if (notif.type === 'resolved') {
            badgeClass = 'notification-badge resolved badge-resolved';
            icon = <CheckCircle size={24} color="var(--status-safe-border)" />;
          }

          return (
            <div
              key={notif.id}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-sm)',
                padding: '18px 22px',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <div style={{ marginTop: '2px' }}>{icon}</div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <span className={badgeClass}>
                      {notif.badge}
                    </span>
                    <strong style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{notif.title}</strong>
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px', lineHeight: 1.5 }}>{notif.summary}</p>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>{notif.timestamp}</span>
                </div>
              </div>

              {notif.decisionId && onNavigateToDecisions && (
                <button
                  className="btn-outlined"
                  style={{ padding: '7px 15px', fontSize: '13px' }}
                  onClick={() => onNavigateToDecisions(notif.decisionId)}
                >
                  <span>Review Card</span>
                  <ExternalLink size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
