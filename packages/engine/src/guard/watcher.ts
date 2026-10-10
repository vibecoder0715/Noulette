import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSettings } from '../core/settings.js';
import { activeProject } from '../core/projects.js';
import { dataDir } from '../core/paths.js';
import { scanUnit } from './rules.js';
import { handleScan, releasedRecently } from './quarantine.js';

/**
 * Watches Downloads, the active project and user-added folders for NEW files and folders.
 * Each new top-level item in Downloads/extra folders is one unit (so a whole clone is scanned once);
 * in the active project each new file is its own unit. Units are scanned after 3 s without changes.
 */
const IGNORE = /(^|[\\/])(\.git|node_modules|\.noulette|__pycache__|\.venv|venv|target|\.next|dist|build)([\\/]|$)|\.(crdownload|part|partial|download|tmp|temp|swp)$|~\$/i;

export function downloadsDir(): string {
  return path.join(os.homedir(), 'Downloads');
}

export function desiredRoots(): { path: string; mode: 'unit' | 'file' }[] {
  const s = getSettings();
  if (!s.guard.enabled) return [];
  const roots: { path: string; mode: 'unit' | 'file' }[] = [];
  const add = (p: string, mode: 'unit' | 'file') => {
    if (p && fs.existsSync(p) && !roots.some((r) => r.path.toLowerCase() === p.toLowerCase())) roots.push({ path: path.resolve(p), mode });
  };
  add(process.env.NOULETTE_DOWNLOADS ?? downloadsDir(), 'unit');
  const ap = activeProject();
  if (ap) add(ap.path, 'file');
  for (const f of s.guard.extraFolders) add(f, 'unit');
  return roots;
}

export class GuardWatcher {
  private watchers = new Map<string, fs.FSWatcher>();
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private known = new Map<string, number>();
  public quietMs = 3000;
  public onScanned?: (unit: string, verdict: string) => void;

  sync(): string[] {
    const want = desiredRoots();
    const keys = new Set(want.map((w) => `${w.mode}|${w.path}`));
    for (const [k, w] of this.watchers) if (!keys.has(k)) (w.close(), this.watchers.delete(k));
    for (const r of want) {
      const k = `${r.mode}|${r.path}`;
      if (this.watchers.has(k)) continue;
      try {
        const w = fs.watch(r.path, { recursive: true }, (_ev, name) => name && this.onEvent(r.path, r.mode, String(name)));
        w.on('error', () => {
          w.close();
          this.watchers.delete(k);
        });
        this.watchers.set(k, w);
      } catch {}
    }
    return want.map((w) => w.path);
  }

  close(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  private onEvent(root: string, mode: 'unit' | 'file', rel: string): void {
    if (IGNORE.test(rel)) return;
    const abs = path.join(root, rel);
    if (abs.toLowerCase().startsWith(dataDir().toLowerCase())) return;
    const unit = mode === 'unit' ? path.join(root, rel.split(/[\\/]/)[0]) : abs;
    if (mode === 'file' && /^(VULN|LOGS|PLAN|FUTURE)\.md$/i.test(rel)) return;
    const prev = this.pending.get(unit);
    if (prev) clearTimeout(prev);
    this.pending.set(unit, setTimeout(() => this.settle(unit, mode), this.quietMs));
  }

  private async settle(unit: string, mode: 'unit' | 'file'): Promise<void> {
    this.pending.delete(unit);
    if (!fs.existsSync(unit)) return;
    let st: fs.Stats;
    try {
      st = fs.statSync(unit);
    } catch {
      return;
    }
    if (mode === 'file' && st.isDirectory()) return;
    // Only new items: created recently (edits to existing files are the user's own work).
    const created = st.birthtimeMs || st.ctimeMs;
    if (Date.now() - created > 10 * 60_000) return;
    const key = unit.toLowerCase();
    const rel = releasedRecently.get(path.resolve(unit).toLowerCase());
    if (rel && Date.now() - rel < 10 * 60_000) return;
    if ((this.known.get(key) ?? 0) >= st.mtimeMs) return;
    this.known.set(key, st.mtimeMs);
    try {
      const scan = await scanUnit(unit);
      handleScan(unit, scan, { source: 'watcher' });
      this.onScanned?.(unit, scan.verdict);
    } catch (e) {
      console.error('guard scan failed', unit, e);
    }
  }
}

export const guardWatcher = new GuardWatcher();
