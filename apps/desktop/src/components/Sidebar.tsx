import React, { useEffect, useState } from 'react';
import { Home, Settings as SettingsIcon, Bell, ShieldCheck, Layers, Info, Sun, Moon, Monitor, ChevronLeft, ChevronRight } from 'lucide-react';
import { BrandLogo } from './BrandLogo.js';

export type Page = 'home' | 'settings' | 'notifications' | 'approvals' | 'plans' | 'manual';
export type Theme = 'system' | 'bright' | 'dark';

export interface SidebarProps {
  page: Page;
  onNavigate: (p: Page) => void;
  unread: number;
  criticalUnread: boolean;
  pending: number;
  theme: Theme;
  onTheme: (t: Theme) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** Original sidebar: centered wordmark (emblem when collapsed), 27px icons, square red badges with brown glow, Manual speech bubble, 3-way theme toggle. */
export function Sidebar({ page, onNavigate, unread, criticalUnread, pending, theme, onTheme, collapsed, onToggleCollapse }: SidebarProps) {
  const [glow, setGlow] = useState(true);
  const [showGuide, setShowGuide] = useState(() => !localStorage.getItem('noulette_manual_seen'));

  useEffect(() => {
    setGlow(true);
    const t = setTimeout(() => setGlow(false), 4000);
    return () => clearTimeout(t);
  }, [unread, pending]);

  useEffect(() => {
    const t = setTimeout(() => setShowGuide(false), 3 * 60 * 1000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (page === 'manual') {
      setShowGuide(false);
      localStorage.setItem('noulette_manual_seen', '1');
    }
  }, [page]);

  const items: { id: Page; label: string; icon: React.ReactNode; badge?: number; critical?: boolean }[] = [
    { id: 'home', label: 'Home', icon: <Home size={27} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={27} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={27} />, badge: unread, critical: criticalUnread },
    { id: 'approvals', label: 'Approvals', icon: <ShieldCheck size={27} />, badge: pending, critical: true },
    { id: 'plans', label: 'Plans', icon: <Layers size={27} /> },
    { id: 'manual', label: 'Manual', icon: <Info size={27} /> }
  ];

  const themes: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: 'system', label: 'Follows desktop settings', icon: <Monitor size={24} /> },
    { id: 'bright', label: 'Bright mode', icon: <Sun size={24} /> },
    { id: 'dark', label: 'Dark mode', icon: <Moon size={24} /> }
  ];

  return (
    <aside className={`app-sidebar ${collapsed ? 'collapsed' : 'expanded'}`} id="app-sidebar">
      <div className="sidebar-brand-section">
        <BrandLogo collapsed={collapsed} />
        <button className="sidebar-toggle-btn" id="sidebar-collapse-toggle" onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={21} /> : <ChevronLeft size={21} />}
        </button>
      </div>

      <nav className="nav-list" aria-label="Main Navigation">
        {items.map((item) => (
          <div key={item.id} style={{ position: 'relative' }}>
            <button
              id={`nav-${item.id}`}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <div className="nav-icon-wrapper">{item.icon}</div>
              {!collapsed && <span className="nav-label">{item.label}</span>}
              {!!item.badge && item.badge > 0 && (
                <span className={`nav-badge ${item.critical ? 'critical' : 'warning'} ${glow ? 'glow-google-brown' : ''} ${collapsed ? 'badge-collapsed' : ''}`} aria-label={`${item.badge} new in ${item.label}`}>
                  {item.badge > 99 ? '99' : item.badge}
                </span>
              )}
            </button>
            {item.id === 'manual' && showGuide && !collapsed && (
              <button
                type="button"
                className="manual-guide-petunjuk"
                id="manual-guide-petunjuk"
                onClick={() => {
                  setShowGuide(false);
                  onNavigate('manual');
                }}
              >
                <svg className="petunjuk-speech-tail" viewBox="0 0 18 20" fill="none" aria-hidden="true">
                  <path d="M 17 0 C 10 2 5 6 1 10 C 5 14 10 18 17 20 Z" className="petunjuk-tail-fill" />
                  <path d="M 17 0 C 10 2 5 6 1 10 C 5 14 10 18 17 20" fill="none" className="petunjuk-tail-stroke" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="petunjuk-text">Exploring how to use Noulette?</span>
              </button>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom-area">
        <div className="theme-toggle-group" role="radiogroup" aria-label="Theme mode selection">
          {themes.map((t) => (
            <button key={t.id} type="button" id={`theme-btn-${t.id}`} className={`theme-segment-btn ${theme === t.id ? 'active' : ''}`} onClick={() => onTheme(t.id)} title={t.label} aria-label={t.label} aria-checked={theme === t.id} role="radio">
              {t.icon}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
