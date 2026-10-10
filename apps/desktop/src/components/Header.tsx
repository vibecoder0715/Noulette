import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { BrandLogo } from './BrandLogo.js';

export interface HeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function Header({ theme, onToggleTheme }: HeaderProps) {
  return (
    <header className="app-header" id="app-header">
      <div className="brand-container">
        <BrandLogo />
      </div>

      <div className="header-actions">
        <button
          className="theme-toggle-btn"
          id="theme-toggle-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
