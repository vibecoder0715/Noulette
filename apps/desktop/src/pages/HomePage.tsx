import React, { useState, useEffect } from 'react';
import { Bell, ArrowRight } from 'lucide-react';
import type { NavPage } from '../components/Sidebar.js';
import { ScorecardDrawer } from '../components/ScorecardDrawer.js';
import { HeldBackDrawer } from '../components/HeldBackDrawer.js';

export const PROMPT_SECURITY_LOGIC = `Use the noulette MCP tools. First read AGENTS.md and .noulette/rules.md. Call noulette_scan for this project, then follow each tool's next_required_step. Never edit tests, scanner settings, or files in .noulette/. Never say anything is safe. If auto-fix is off, relay the report from noulette_get_report exactly, then stop.`;

export const PROMPT_ARCH_FEASIBILITY = `Use the noulette MCP tools. Read AGENTS.md. Call noulette_plan for this project, relay the plan summary exactly, and only change what the plan items name after the user approves in the noulette app.`;

export interface HomePageProps {
  onNavigate?: (page: NavPage) => void;
}

const BACKGROUND_SLIDES = [
  '/images/slide-1.jpg',
  '/images/slide-2.jpg',
  '/images/slide-3.jpg',
  '/images/slide-4.jpg',
  '/images/slide-5.jpg'
];

export function HomePage({ onNavigate }: HomePageProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [heldBackOpen, setHeldBackOpen] = useState(false);

  // Indefinitely cycling 5 high-resolution coding/shipping workspace images (30% alpha)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % BACKGROUND_SLIDES.length);
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="home-page-container"
      id="home-page"
      style={{
        position: 'relative',
        minHeight: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px 20px',
        overflow: 'hidden'
      }}
    >
      {/* Backmost Layer: 5 Photorealistic Coding & Shipping Images Playing Indefinitely (30% Alpha) */}
      <div
        className="home-background-slideshow"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          overflow: 'hidden'
        }}
      >
        {BACKGROUND_SLIDES.map((slideSrc, idx) => (
          <div
            key={slideSrc}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${slideSrc})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center center',
              backgroundRepeat: 'no-repeat',
              opacity: idx === currentSlide ? 0.30 : 0,
              transform: idx === currentSlide ? 'scale(1.03)' : 'scale(1.0)',
              transition: 'opacity 1.6s cubic-bezier(0.4, 0, 0.2, 1), transform 6s cubic-bezier(0.25, 1, 0.5, 1)',
              willChange: 'opacity, transform'
            }}
          />
        ))}

        {/* Subtle Ambient Vignette Overlay for Crisp Contrast in Both Modes */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, transparent 35%, var(--bg-app) 95%)',
            pointerEvents: 'none'
          }}
        />
      </div>

      {/* Foreground Hero Content: Wireframe Design (Modern, Super Cool) */}
      <div
        className="home-hero-content"
        style={{
          position: 'relative',
          zIndex: 2,
          maxWidth: '860px',
          margin: '0 auto',
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
        {/* Main Display Headline (Unchanged Main Title Size: 56px Serif Bold) */}
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '56px',
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            WebkitTextStroke: '0.6px currentColor',
            color: 'var(--text-primary)',
            margin: '0 0 36px 0',
            textShadow: '0 2px 16px rgba(0, 0, 0, 0.06)'
          }}
        >
          Problems in your app?<br />
          Let's find out.
        </h1>

        {/* Two Linked Action Buttons as Requested in Screenshot */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '18px',
            flexWrap: 'wrap'
          }}
        >
          {/* Button 1: "Settings ->" -> goes to settings */}
          <button
            type="button"
            className="btn-clay"
            id="home-settings-btn"
            onClick={() => onNavigate?.('settings')}
            style={{
              padding: '11px 24px',
              fontSize: '13.5px',
              fontWeight: 800,
              borderRadius: '9999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.15)',
              cursor: 'pointer',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease'
            }}
          >
            <span>Settings</span>
            <ArrowRight size={15} />
          </button>

          {/* Button 2: "Latest Notifications" -> goes to notifications */}
          <button
            type="button"
            className="btn-outlined"
            id="home-latest-notifications-btn"
            onClick={() => onNavigate?.('notifications')}
            style={{
              padding: '10px 22px',
              fontSize: '13.5px',
              fontWeight: 800,
              borderRadius: '9999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'var(--bg-surface)',
              border: '2px solid var(--border-card)',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              transition: 'transform 0.15s ease, background-color 0.15s ease'
            }}
          >
            <Bell size={16} color="var(--text-primary)" />
            <span>Latest Notifications</span>
          </button>
        </div>
      </div>

      {/* Drawers */}
      <ScorecardDrawer isOpen={scorecardOpen} onClose={() => setScorecardOpen(false)} />
      <HeldBackDrawer isOpen={heldBackOpen} onClose={() => setHeldBackOpen(false)} />
    </div>
  );
}
