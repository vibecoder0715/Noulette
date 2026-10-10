import React, { useState, useEffect } from 'react';
import { Sidebar, type NavPage, type ThemeMode } from './components/Sidebar.js';
import { HomePage } from './pages/HomePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';
import { DecisionsPage } from './pages/DecisionsPage.js';
import { PlansPage } from './pages/PlansPage.js';
import { ManualPage } from './pages/ManualPage.js';
import { SetupWizard } from './components/SetupWizard.js';

export function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('bright');
  const [currentPage, setCurrentPage] = useState<NavPage>('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inSetupMode, setInSetupMode] = useState<boolean>(false);

  useEffect(() => {
    const applyTheme = () => {
      let resolvedTheme: 'light' | 'dark' = 'light';
      if (themeMode === 'dark') {
        resolvedTheme = 'dark';
      } else if (themeMode === 'bright') {
        resolvedTheme = 'light';
      } else {
        // 'system' / desktop settings
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        resolvedTheme = prefersDark ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', resolvedTheme);
    };

    applyTheme();

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyTheme();
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [themeMode]);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => !prev);
  };

  const navigateToDecisions = () => {
    setCurrentPage('decisions');
  };

  const handleLaunchFromSetup = () => {
    localStorage.setItem('noulette_app_setup_completed', 'true');
    setInSetupMode(false);
    setCurrentPage('home');
  };

  if (inSetupMode) {
    return (
      <SetupWizard
        onLaunchSuccess={handleLaunchFromSetup}
        onCancel={() => handleLaunchFromSetup()}
      />
    );
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} id="app-shell">
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        themeMode={themeMode}
        onSelectThemeMode={setThemeMode}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        notificationsCount={3}
        pendingDecisionsCount={1}
        engineReady={true}
      />
      <main className="main-viewport" role="main" id="main-viewport">
        {currentPage === 'home' && <HomePage onNavigate={setCurrentPage} />}
        {currentPage === 'settings' && <SettingsPage />}
        {currentPage === 'notifications' && <NotificationsPage onNavigateToDecisions={navigateToDecisions} />}
        {currentPage === 'decisions' && <DecisionsPage />}
        {currentPage === 'plans' && <PlansPage />}
        {currentPage === 'manual' && (
          <ManualPage
            onNavigate={setCurrentPage}
            onOpenSetupWizard={() => setInSetupMode(true)}
          />
        )}
      </main>
    </div>
  );
}

export default App;

