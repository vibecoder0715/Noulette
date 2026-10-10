import React, { useState, useEffect } from 'react';
import { 
  Home, 
  Settings as SettingsIcon, 
  Bell, 
  ShieldCheck, 
  Layers, 
  Info, 
  Sun, 
  Moon, 
  Monitor,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { BrandLogo } from './BrandLogo.js';

export type NavPage = 'home' | 'settings' | 'notifications' | 'decisions' | 'plans' | 'manual';
export type ThemeMode = 'system' | 'bright' | 'dark';

export interface SidebarProps {
  currentPage: NavPage;
  onNavigate: (page: NavPage) => void;
  themeMode: ThemeMode;
  onSelectThemeMode: (mode: ThemeMode) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  notificationsCount?: number;
  pendingDecisionsCount?: number;
  engineReady?: boolean;
}

export function Sidebar({
  currentPage,
  onNavigate,
  themeMode,
  onSelectThemeMode,
  collapsed = false,
  onToggleCollapse,
  notificationsCount = 3,
  pendingDecisionsCount = 1,
  engineReady = true
}: SidebarProps) {
  // Google-style 4-second brown glow animation state
  const [glowActive, setGlowActive] = useState(true);

  // Arrow petunjuk indicator on the side of Manual:
  // Shows every time user initially signs in / refreshes page,
  // disappears when manual is clicked or after 3 minutes.
  const [showManualGuide, setShowManualGuide] = useState(true);

  useEffect(() => {
    setGlowActive(true);
    const timer = setTimeout(() => {
      setGlowActive(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, [notificationsCount, pendingDecisionsCount]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowManualGuide(false);
    }, 3 * 60 * 1000); // 3 minutes timeout
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (currentPage === 'manual') {
      setShowManualGuide(false);
    }
  }, [currentPage]);

  const navItems: { id: NavPage; label: string; icon: React.ReactNode; badge?: number; badgeCritical?: boolean }[] = [
    { id: 'home', label: 'Home', icon: <Home size={27} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={27} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={27} />, badge: notificationsCount },
    { id: 'decisions', label: 'Decisions', icon: <ShieldCheck size={27} />, badge: pendingDecisionsCount, badgeCritical: true },
    { id: 'plans', label: 'Plans', icon: <Layers size={27} /> },
    { id: 'manual', label: 'Manual', icon: <Info size={27} /> }
  ];

  return (
    <aside className={`app-sidebar ${collapsed ? 'collapsed' : 'expanded'}`} id="app-sidebar">
      {/* Centered Brand Section at Top of Sidebar */}
      <div className="sidebar-brand-section">
        <BrandLogo collapsed={collapsed} />
        {onToggleCollapse && (
          <button
            className="sidebar-toggle-btn"
            id="sidebar-collapse-toggle"
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={21} /> : <ChevronLeft size={21} />}
          </button>
        )}
      </div>

      {/* Main Navigation List */}
      <nav className="nav-list" role="navigation" aria-label="Main Navigation">
        {navItems.map(item => {
          const isManual = item.id === 'manual';
          return (
            <div key={item.id} style={{ position: 'relative' }}>
              <button
                id={`nav-${item.id}`}
                className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => {
                  if (isManual) setShowManualGuide(false);
                  onNavigate(item.id);
                }}
                title={collapsed ? item.label : undefined}
                aria-current={currentPage === item.id ? 'page' : undefined}
              >
                <div className="nav-icon-wrapper">{item.icon}</div>
                {!collapsed && <span className="nav-label">{item.label}</span>}
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`nav-badge ${item.badgeCritical ? 'critical' : ''} ${glowActive ? 'glow-google-brown' : ''} ${collapsed ? 'badge-collapsed' : ''}`}
                    aria-label={`${item.badge} ${item.label}`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>

              {/* Speech Bubble Petunjuk on the side of Manual */}
              {isManual && showManualGuide && (
                <div
                  className="manual-guide-petunjuk"
                  id="manual-guide-petunjuk"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowManualGuide(false);
                    onNavigate('manual');
                  }}
                  title="Click to explore Manual"
                  role="tooltip"
                  aria-live="polite"
                >
                  <svg
                    className="petunjuk-speech-tail"
                    viewBox="0 0 18 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M 17 0 C 10 2 5 6 1 10 C 5 14 10 18 17 20 Z"
                      className="petunjuk-tail-fill"
                    />
                    <path
                      d="M 17 0 C 10 2 5 6 1 10 C 5 14 10 18 17 20"
                      fill="none"
                      className="petunjuk-tail-stroke"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="petunjuk-text">Exploring how to use Noulette?</span>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom Area: Segmented Theme Toggle with Desktop, Bright, and Dark SVG Icons */}
      <div className="sidebar-bottom-area" id="theme-toggle-btn">
        <div className="theme-toggle-group" role="radiogroup" aria-label="Theme mode selection">
          <button
            type="button"
            id="theme-btn-system"
            className={`theme-segment-btn ${themeMode === 'system' ? 'active' : ''}`}
            onClick={() => onSelectThemeMode('system')}
            title="Follows desktop settings"
            aria-label="Follows desktop settings"
            aria-checked={themeMode === 'system'}
            role="radio"
          >
            <Monitor size={24} />
          </button>
          <button
            type="button"
            id="theme-btn-bright"
            className={`theme-segment-btn ${themeMode === 'bright' ? 'active' : ''}`}
            onClick={() => onSelectThemeMode('bright')}
            title="Bright mode"
            aria-label="Bright mode"
            aria-checked={themeMode === 'bright'}
            role="radio"
          >
            <Sun size={24} />
          </button>
          <button
            type="button"
            id="theme-btn-dark"
            className={`theme-segment-btn ${themeMode === 'dark' ? 'active' : ''}`}
            onClick={() => onSelectThemeMode('dark')}
            title="Dark mode"
            aria-label="Dark mode"
            aria-checked={themeMode === 'dark'}
            role="radio"
          >
            <Moon size={24} />
          </button>
        </div>
      </div>
    </aside>
  );
}
