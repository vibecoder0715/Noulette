import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../api.js';

/** Copy button in the original style (black "clay" button, or outlined when secondary). */
export function CopyButton({ text, label = 'Copy', id, variant = 'clay' }: { text: string; label?: string; id?: string; variant?: 'clay' | 'outlined' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      id={id}
      type="button"
      className={variant === 'clay' ? 'btn-clay' : 'btn-outlined'}
      style={{ flexShrink: 0, padding: '7px 14px', fontSize: '13px' }}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        }
      }}
      aria-label={done ? 'Copied' : label}
    >
      {done ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      <span>{done ? 'Copied' : label}</span>
    </button>
  );
}

export function CodeLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="code-line">
      <span className="sr-only">{label}:</span>
      <code>{text}</code>
      <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} variant="outlined" />
    </div>
  );
}

/** Original toggle switch markup (.toggle-switch / .toggle-slider). */
export function Toggle({ id, checked, onChange, label, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="toggle-switch" style={disabled ? { opacity: 0.5 } : undefined}>
      <input id={id} type="checkbox" role="switch" aria-checked={checked} aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-slider" aria-hidden />
    </label>
  );
}

const SEV_LABEL: Record<string, string> = { critical: 'Critical', warning: 'Warning', info: 'Info', high: 'Should fix', medium: 'Should fix', low: 'Minor', resolved: 'Resolved' };
const SEV_CLASS: Record<string, string> = { critical: 'critical badge-critical', high: 'warning badge-warning', medium: 'warning badge-warning', warning: 'warning badge-warning', resolved: 'resolved badge-resolved', low: '', info: '' };

/** Severity chip using the original notification-badge colours (red / yellow / green / neutral). */
export function Pill({ kind }: { kind: string }) {
  const cls = SEV_CLASS[kind] ?? '';
  return (
    <span className={`notification-badge ${cls}`} style={cls ? undefined : { border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
      {SEV_LABEL[kind] ?? kind}
    </span>
  );
}

export function Banner({ kind, children }: { kind: 'error' | 'warn' | 'ok' | 'info'; children: React.ReactNode }) {
  return (
    <div className={`alert-box ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString();
}

/** Background slideshow used on Home (slide-1..5) and the Manual head page (manual-1..4), as in the original design. */
export function Slideshow({ slides, opacity, className }: { slides: string[]; opacity: number; className: string }) {
  const [i, setI] = useState(0);
  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((p) => (p + 1) % slides.length), 4500);
    return () => clearInterval(t);
  }, [slides.length]);
  return (
    <div className={className} aria-hidden="true">
      {slides.map((src, idx) => (
        <div
          key={src}
          className="slide-layer"
          style={{ backgroundImage: `url(${src})`, opacity: idx === i ? opacity : 0, transform: idx === i ? 'scale(1.03)' : 'scale(1.0)' }}
        />
      ))}
      <div className="slide-vignette" />
    </div>
  );
}
