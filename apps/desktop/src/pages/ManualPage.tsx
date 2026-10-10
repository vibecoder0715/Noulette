import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ArrowDown, MousePointerClick } from 'lucide-react';
import { Slideshow } from '../components/ui.js';

const MANUAL_SLIDES = ['/images/manual-1.jpg', '/images/manual-2.jpg', '/images/manual-3.jpg', '/images/manual-4.jpg'];

/**
 * Head page keeps the original look: 4-photo slideshow, serif headline, pill button.
 * The walkthrough itself is words only. Scrolling to the end and holding 1.5 s starts the pointer tour on Home.
 * "Start tour" button, Enter/Right arrow (Next) and Esc (Cancel) also work.
 */
export function ManualPage({ onStartTour }: { onStartTour: () => void }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [hold, setHold] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearHold = () => {
    if (timer.current) clearTimeout(timer.current);
    if (tick.current) clearInterval(tick.current);
    timer.current = tick.current = null;
    setHold(null);
  };
  useEffect(() => clearHold, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close(then?: () => void) {
    clearHold();
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      then?.();
    }, 320);
  }

  function startTour() {
    if (open) close(onStartTour);
    else onStartTour();
  }

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom && !closing) {
      if (timer.current) return;
      const started = Date.now();
      setHold(1.5);
      tick.current = setInterval(() => setHold(Math.max(0, 1.5 - (Date.now() - started) / 1000)), 100);
      timer.current = setTimeout(() => {
        clearHold();
        close(onStartTour);
      }, 1500);
    } else if (timer.current) clearHold();
  }

  return (
    <div className="manual-page-container" id="manual-page">
      <Slideshow slides={MANUAL_SLIDES} opacity={0.36} className="manual-slideshow" />

      <div className="manual-hero" style={{ opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto', transition: 'opacity 0.25s ease' }}>
        <h1 className="hero-headline">
          New to us?
          <br />
          Let's dive in.
        </h1>
        <div className="hero-actions">
          <button type="button" className="btn-clay pill-primary" id="manual-walkthrough-btn" onClick={() => setOpen(true)}>
            <BookOpen size={16} />
            <span>Walkthrough</span>
          </button>
          <button type="button" className="btn-outlined pill-secondary" id="start-tour" onClick={startTour}>
            <MousePointerClick size={16} />
            <span>Start tour</span>
          </button>
        </div>
      </div>

      {open && (
        <div className={`walkthrough-overlay-container ${closing ? 'closing' : ''}`} id="walkthrough-overlay-page" onScroll={onScroll} role="dialog" aria-label="Noulette guide">
          <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, backgroundImage: 'url(/images/manual-1.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.18, filter: 'blur(2px)' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 30%, var(--bg-app) 88%)' }} />
          </div>

          <div className="walkthrough-content-wrapper" style={{ position: 'relative', zIndex: 2, gap: 24 }}>
            <div style={{ textAlign: 'center', maxWidth: 820, margin: '0 auto 16px auto' }}>
              <h1 className="hero-headline" style={{ fontSize: 48, margin: '0 0 20px 0' }}>It's time to build real products.</h1>
              <p style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--text-secondary)', fontWeight: 500 }}>
                Before shipping, plug Noulette in to find underlying problems in your software before catastrophe ever happens.
              </p>
            </div>

            <Section title="What Noulette does">
              <p>Noulette checks your app for problems before you release it, helps your coding agent fix the ones you approve, and warns you early when something goes wrong after launch.</p>
            </Section>

            <Section title="Settings, one by one">
              <Item name="Project">The folder of the app you are building. Add folder picks it. If you have several apps, choose which one Noulette works on.</Item>
              <Item name="Prompts">Inspect mode finds problems. Build mode fixes the ones you approved. Copy Prompt copies it, with everything your agent needs to connect, so just paste it into your agent. Show prompt lets you read it first.</Item>
              <Item name='Make "BUILD" work in every agent'>Adds a few lines to your project so you can simply type BUILD in any agent.</Item>
              <Item name="Inspection effort">Standard checks everything once. Extra checks everything up to three times and double-checks each fix. Extra is slower and uses more AI credit.</Item>
              <Item name="Auto-approve">Off: you choose what gets fixed. On: your agent fixes everything it can right after inspecting, on a separate copy of your code (a branch). Nothing is merged for you; you get two commands to merge or throw away the fixes.</Item>
              <Item name="Notification sound">How loud the alert is, from 0% (silent) to 100%. Test sound plays it.</Item>
              <Item name="Connect your coding agent">One click adds Noulette to Kiro, Claude Code, Cline, OpenCode, Codex or Antigravity. Your old settings are saved first. Restart the agent afterwards.</Item>
              <Item name="Production analysis">On: Noulette looks at how your live app is doing and warns you early. Inspect after sets how often (every 5 to 120 minutes).</Item>
              <Item name="Inspector API">Where the live data comes from. PostHog shows errors and activity; Google Analytics shows visitor numbers. Paste the IDs and keys from those services.</Item>
              <Item name="AI for log analysis">The AI that explains the warnings. Paste your provider's example code, or fill in the address, model and key. Test connection checks it; Check production now runs a check right away.</Item>
              <Item name="Download guard">Checks new downloads and files. Anything suspicious is locked away until you decide. Add more folders to watch below it.</Item>
              <Item name="Start when I sign in">Keeps Noulette running in the background after you turn on your PC.</Item>
              <Item name="Remote MCP">Lets agents connect over a private web address. Leave it off unless you need it.</Item>
              <Item name="View in Chrome">Gives you a private link to open this app in your browser.</Item>
            </Section>

            <div className="walkthrough-bottom-arrow-zone" id="walkthrough-exit-zone" onClick={() => close(onStartTour)} title="Stay here 1.5 s, or click, to start the tour">
              <button type="button" className={`walkthrough-down-arrow-btn ${hold !== null ? 'pulse-hold' : ''}`} aria-label="Start the tour">
                <ArrowDown size={20} />
              </button>
              <span className="text-tertiary" aria-live="polite">
                {hold !== null ? `Starting the tour in ${hold.toFixed(1)} s...` : 'Stay here for a moment to start the tour'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="guide-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Item({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <p style={{ marginTop: 10 }}>
      <strong style={{ color: 'var(--text-primary)' }}>{name}.</strong> {children}
    </p>
  );
}
