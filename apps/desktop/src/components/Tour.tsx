import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Page } from './Sidebar.js';

export interface TourStep {
  target: string;
  page: Page;
  title: string;
  text: string;
}

/** Pointer walkthrough of the important controls. Next / Cancel, Enter or Right arrow = Next, Esc = Cancel. */
export const TOUR: TourStep[] = [
  { target: 'start-inspection', page: 'home', title: 'Start inspection', text: 'Copies the Inspect prompt. Paste it into your coding agent and answer a few questions.' },
  { target: 'settings-prompts', page: 'settings', title: 'Prompts', text: 'Inspect finds problems. Build fixes the approved ones. Each has a copy button.' },
  { target: 'settings-agents', page: 'settings', title: 'Connect your agent', text: 'One click adds Noulette to Kiro, Claude Code, Cline, OpenCode, Codex or Antigravity.' },
  { target: 'status-card', page: 'notifications', title: 'Status', text: 'What Noulette is doing now: Ready, Inspecting, or Needs approval.' },
  { target: 'tldr', page: 'notifications', title: 'TL;DR', text: 'Critical problems, things to fix, and what is already resolved.' },
  { target: 'nav-approvals', page: 'notifications', title: 'Approvals', text: 'Choose which fixes your agent may make, and decide about blocked downloads.' },
  { target: 'nav-plans', page: 'notifications', title: 'Plans', text: 'What your app needs as you grow to 10 or 100 times more users.' },
  { target: 'nav-manual', page: 'notifications', title: 'Manual', text: 'Come back here any time to read the guide or replay this tour.' }
];

export function Tour({ step, onNext, onCancel, onPage }: { step: number; onNext: () => void; onCancel: () => void; onPage: (p: Page) => void }) {
  const s = TOUR[step];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    onPage(s.page);
  }, [step]);

  useLayoutEffect(() => {
    let el: HTMLElement | null = null;
    const place = () => {
      el?.classList.remove('tour-highlight');
      el = document.getElementById(s.target);
      if (el) {
        el.classList.add('tour-highlight');
        el.scrollIntoView({ block: 'nearest' });
        setRect(el.getBoundingClientRect());
      } else setRect(null);
    };
    const t = setTimeout(place, 200);
    window.addEventListener('resize', place);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', place);
      el?.classList.remove('tour-highlight');
    };
  }, [step]);

  useEffect(() => {
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const left = rect ? Math.min(window.innerWidth - 320, rect.right + 16) : window.innerWidth / 2 - 150;
  const top = rect ? Math.max(12, Math.min(window.innerHeight - 180, rect.top - 6)) : window.innerHeight / 2 - 80;
  const last = step === TOUR.length - 1;
  return (
    <>
      <div className="tour-back" onClick={onCancel} aria-hidden />
      <div className="tour-tip" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" style={{ left, top }}>
        {rect && <span className="arrow" aria-hidden />}
        <div className="tour-step">
          Step {step + 1} of {TOUR.length}
        </div>
        <h3 id="tour-title">{s.title}</h3>
        <p id="tour-text">{s.text}</p>
        <div className="inline">
          <button ref={nextRef} className="btn-clay" onClick={onNext} id="tour-next">
            {last ? 'Finish' : 'Next'}
          </button>
          <button className="btn-outlined" onClick={onCancel} id="tour-cancel">
            Cancel
          </button>
          <span className="text-tertiary">Enter = Next, Esc = Cancel</span>
        </div>
      </div>
    </>
  );
}
