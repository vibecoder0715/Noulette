import React, { useState } from 'react';
import { Bell, Play, ArrowRight } from 'lucide-react';
import { api, copyText, type AppState } from '../api.js';
import { Slideshow } from '../components/ui.js';
import type { Page } from '../components/Sidebar.js';

const HOME_SLIDES = ['/images/slide-1.jpg', '/images/slide-2.jpg', '/images/slide-3.jpg', '/images/slide-4.jpg', '/images/slide-5.jpg'];

interface Props {
  state: AppState;
  refresh: () => void;
  navigate: (p: Page) => void;
}

/** Original hero home page. Status and TL;DR live in Notifications. */
export function HomePage({ navigate }: Props) {
  const [showGuide, setShowGuide] = useState(false);

  async function startInspection() {
    // No project picker: the agent's open folder decides what gets inspected.
    const prompts = await api('/api/prompts');
    await copyText(prompts.inspect);
    setShowGuide(true);
  }

  return (
    <div className="home-page-container home-centered" id="home-page">
      <Slideshow slides={HOME_SLIDES} opacity={0.3} className="home-slideshow" />
      <div className="hero">
        <h1 className="hero-headline">
          Problems in your app?
          <br />
          Let's find out.
        </h1>
        <div className="hero-actions">
          <button type="button" className="btn-clay pill-primary" id="start-inspection" onClick={startInspection}>
            <Play size={15} />
            <span>Start inspection</span>
            <ArrowRight size={15} />
          </button>
          <button type="button" className="btn-outlined pill-secondary" id="home-latest-notifications-btn" onClick={() => navigate('notifications')}>
            <Bell size={16} color="var(--text-primary)" />
            <span>Latest Notifications</span>
          </button>
        </div>
      </div>

      {showGuide && (
        <div className="modal-overlay" role="presentation" onClick={() => setShowGuide(false)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title" id="guide-title">Inspect prompt copied</h3>
            <ol style={{ paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li>Open your coding agent in the project folder you want checked.</li>
              <li>Paste the prompt and send it. It already says how to connect to Noulette.</li>
              <li>Answer a few short questions. Progress shows in Notifications.</li>
            </ol>
            <div className="modal-actions">
              <button className="btn-clay" autoFocus onClick={() => setShowGuide(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
