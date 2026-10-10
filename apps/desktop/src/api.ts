// Talks to the local Noulette daemon (127.0.0.1 only, bearer token).
// In the desktop app the token comes from the Tauri shell; in Chrome it is entered once and kept for the tab session.

export const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

let conn: { base: string; token: string } | null = null;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function connection(): Promise<{ base: string; token: string }> {
  if (conn) return conn;
  if (isTauri) {
    const info = await invoke<{ port: number; token: string }>('daemon_info');
    conn = { base: `http://127.0.0.1:${info.port}`, token: info.token };
    return conn;
  }
  const url = new URL(window.location.href);
  const t = url.searchParams.get('t');
  if (t) {
    sessionStorage.setItem('noulette_token', t);
    url.searchParams.delete('t');
    window.history.replaceState(null, '', url.toString());
  }
  const token = sessionStorage.getItem('noulette_token') ?? '';
  const base = import.meta.env.DEV ? (import.meta.env.VITE_DAEMON ?? 'http://127.0.0.1:47821') : window.location.origin;
  conn = { base, token };
  return conn;
}

export function setBrowserToken(token: string): void {
  sessionStorage.setItem('noulette_token', token.trim());
  conn = null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const c = await connection();
  const res = await fetch(c.base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${c.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ directory: true, multiple: false, title: 'Choose your project folder' });
  return typeof r === 'string' ? r : null;
}

export async function toast(title: string, body: string): Promise<void> {
  if (!isTauri) {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
    return;
  }
  const n = await import('@tauri-apps/plugin-notification');
  let ok = await n.isPermissionGranted();
  if (!ok) ok = (await n.requestPermission()) === 'granted';
  if (ok) n.sendNotification({ title, body });
}

// ---------------------------------------------------------------- shared types

export type Severity = 'critical' | 'warning' | 'info';

export interface Notification {
  id: string;
  project: string | null;
  severity: Severity;
  kind: string;
  title: string;
  body: string;
  data: any;
  created_at: number;
  read: number;
  resolved: number;
  sticky: number;
  alert: number;
}

export interface Approval {
  id: string;
  project: string | null;
  kind: 'inspection' | 'guard' | 'logs' | 'cloud';
  title: string;
  summary: string;
  data: any;
  status: string;
  origin: 'local' | 'cloud';
  created_at: number;
  decided_at: number | null;
}

export interface Counts {
  critical: number;
  shouldFix: number;
  resolved: number;
  needsYou: number;
}

export interface AppState {
  version: string;
  settings: any;
  intervals: number[];
  secrets: Record<string, 'env' | 'stored' | 'none'>;
  projects: { path: string; name: string; status: string }[];
  active: string | null;
  card: {
    status: string;
    title: string;
    detail: string;
    project?: { path: string; name: string };
    counts?: Counts;
    branch?: { name: string; base: string; fixed: number; needsYou: number; commands: { merge: string; discard: string } } | null;
  };
  notifications: { main: Notification[]; history: Notification[] };
  approvals: { pending: Approval[]; recent: Approval[] };
  monitor?: any;
  guard?: any;
  future?: any;
  agents?: any[];
}
