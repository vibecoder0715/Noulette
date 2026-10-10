import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { kvGet, kvSet } from '../core/db.js';
import { getSettings } from '../core/settings.js';
import { setSecret } from '../core/secrets.js';
import { activeProject } from '../core/projects.js';
import { projectKey } from '../core/paths.js';
import { notify, createApproval, resolveByKind, decideApproval, getApproval } from '../core/events.js';
import { route, stateExtras, approvalHandlers, settingsFilters, HttpError } from '../daemon/api.js';
import { ticks } from '../daemon/server.js';
import { toolRegistrars, projectPath as projectPathSchema } from '../mcp/server.js';
import { readPlan, answerFor, parseUserCount } from '../inspect/plan.js';
import { collect, type CollectResult } from './collector.js';
import { fetchPostHog, fetchGa4, type SourceData } from './sources.js';
import { appendLogs } from './logsmd.js';
import { testAi } from './llm.js';
import { parseAiConfigText } from './aiconfig.js';
import { getApprovedLogPlans, completeLogPlan } from './logplans.js';
import { syncCloud, cloudStatus } from '../cloud/sync.js';
import { verifyCloudItem } from '../cloud/sign.js';

export interface MonitorStatus {
  lastRunAt: number | null;
  lastWindowEnd: number | null;
  lastError: string | null;
  nextRunAt: number | null;
  lastWarnings: number;
}

const STATUS_KEY = 'monitor:status';
export const getMonitorStatus = (): MonitorStatus => kvGet<MonitorStatus>(STATUS_KEY, { lastRunAt: null, lastWindowEnd: null, lastError: null, nextRunAt: null, lastWarnings: 0 });

/** Test hook: replace real fetchers. */
export const fetcherOverride: { fn: ((from: number, to: number) => (() => Promise<SourceData>)[]) | null } = { fn: null };

function fetchersFor(from: number, to: number): (() => Promise<SourceData>)[] {
  if (fetcherOverride.fn) return fetcherOverride.fn(from, to);
  const s = getSettings().inspector;
  const f: (() => Promise<SourceData>)[] = [];
  if (s.posthog.enabled) f.push(() => fetchPostHog(from, to));
  if (s.ga4.enabled) f.push(() => fetchGa4(from, to));
  return f;
}

function reportError(message: string): void {
  notify({ severity: 'warning', kind: 'monitor-error', title: 'Production check failed', body: message, dedupeKey: 'monitor' });
}

let running = false;

/**
 * One collection pass. After sleep or offline time, the window starts at the end of the last
 * successful pass (one coalesced catch-up pass, capped at 7 days), never one pass per missed interval.
 */
export async function runMonitor(opts: { now?: number; forceDigest?: boolean } = {}): Promise<{ ok: boolean; message: string; result?: CollectResult; approvalId?: string | null }> {
  const s = getSettings();
  if (!s.productionAnalysis) return { ok: false, message: 'Production analysis is turned off.' };
  const project = activeProject();
  if (!project) {
    const msg = 'No project yet: run an inspection once from your coding agent so Noulette knows which app to watch.';
    reportError(msg);
    return { ok: false, message: msg };
  }
  if (running) return { ok: false, message: 'A check is already running.' };
  running = true;
  const st = getMonitorStatus();
  const now = opts.now ?? Date.now();
  const intervalMs = s.intervalMin * 60_000;
  const from = Math.max(st.lastWindowEnd ?? now - intervalMs, now - 7 * 86400_000);
  try {
    const fetchers = fetchersFor(from, now);
    if (!fetchers.length) {
      const msg = 'Turn on PostHog or Google Analytics under Inspector API.';
      kvSet(STATUS_KEY, { ...st, lastError: msg, nextRunAt: now + intervalMs });
      reportError(msg);
      return { ok: false, message: msg };
    }
    const planned = parseUserCount(answerFor(readPlan(project.path), 'users'));
    const r = await collect({ key: projectKey(project.path), from, to: now, fetchers, plannedUsers: planned, useAi: true, forceDigest: opts.forceDigest });
    let approvalId: string | null = null;
    if (r.warnings.length) {
      approvalId = createApproval({
        project: project.path, kind: 'logs', title: `Early warnings: ${project.name}`,
        summary: r.warnings.map((w) => w.title).join(', '),
        data: { warnings: r.warnings, window: r.window, sources: r.sources }
      });
      // Every attack type gets its own alert (never folded into one, never silent), whatever its severity.
      const attacks = r.warnings.filter((w) => w.detector === 'attack');
      for (const w of attacks) {
        notify({ project: project.path, severity: 'critical', kind: 'early-warning', sticky: true, title: `Attack on ${project.name}: ${w.title}`, body: `${w.tldr} A patch plan is waiting in Approvals. Approve it, then ask your coding agent to "fix the approved production plans" (it uses noulette_log_plans).`, alert: true, data: { approvalId }, dedupeKey: `${projectKey(project.path)}:attack:${w.category}` });
      }
      const crit = r.warnings.filter((w) => w.severity === 'critical' && w.detector !== 'attack');
      if (crit.length) notify({ project: project.path, severity: 'critical', kind: 'early-warning', title: `Production: ${crit[0].title}`, body: crit[0].tldr, alert: true, data: { approvalId }, dedupeKey: `${projectKey(project.path)}:${crit[0].detector}` });
    }
    if (r.sources.length) appendLogs(project.path, r, approvalId);
    const problems = [...r.errors, ...(r.aiError ? [`AI: ${r.aiError}`] : [])];
    const ok = r.sources.length > 0;
    kvSet(STATUS_KEY, { lastRunAt: now, lastWindowEnd: ok ? now : st.lastWindowEnd, lastError: problems.length ? problems.join(' | ') : null, nextRunAt: now + intervalMs, lastWarnings: r.warnings.length });
    if (problems.length) reportError(problems.join(' | '));
    else resolveByKind('monitor-error', 'monitor');
    const attackCount = r.warnings.filter((w) => w.detector === 'attack').length;
    const message = !ok
      ? `Could not read production data: ${problems.join(' | ')}`
      : `Checked ${r.totals.events} events${r.totals.scanned !== undefined ? ` (${r.totals.scanned} scanned for attacks)` : ''}. ${attackCount ? `${attackCount} kind(s) of attack attempt found. ` : ''}${r.warnings.length ? `${r.warnings.length} early warning(s) in Approvals.` : 'No early warnings.'}${problems.length ? ` Problems: ${problems.join(' | ')}` : ''}`;
    return { ok: ok && !problems.length, message, result: r, approvalId };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    kvSet(STATUS_KEY, { ...st, lastError: msg, nextRunAt: now + intervalMs });
    reportError(msg);
    return { ok: false, message: msg };
  } finally {
    running = false;
  }
}

/** Scheduler tick: runs when the chosen interval has passed (the interval change applies immediately). */
export async function monitorTick(now = Date.now()): Promise<boolean> {
  const s = getSettings();
  if (!s.productionAnalysis) return false;
  const st = getMonitorStatus();
  const due = !st.lastRunAt || now - st.lastRunAt >= s.intervalMin * 60_000;
  if (!due) return false;
  await runMonitor({ now });
  return true;
}

ticks.push({ name: 'monitor', everyMs: 30_000, fn: () => monitorTick() });
ticks.push({ name: 'cloud-sync', everyMs: 60_000, fn: () => syncCloud() });

stateExtras.push(() => ({ monitor: { ...getMonitorStatus(), cloud: cloudStatus() } }));

// Pasted AI configuration: the key moves to encrypted storage; only scrubbed text is kept in settings.
settingsFilters.push((body) => {
  if (body?.ai && typeof body.ai.configText === 'string') {
    const parsed = parseAiConfigText(body.ai.configText);
    if (parsed.config.apiKey) setSecret('aiFileKey', parsed.config.apiKey);
    else if (!body.ai.configText.trim()) setSecret('aiFileKey', null);
    body.ai.configText = parsed.scrubbed;
    return parsed.warnings.length ? { aiConfigWarnings: parsed.warnings } : undefined;
  }
});

route('POST', '/api/monitor/run', async () => runMonitor({ forceDigest: true }));
route('POST', '/api/monitor/test-posthog', async () => {
  const now = Date.now();
  try {
    const d = await fetchPostHog(now - 3600_000, now);
    return { ok: true, events: d.buckets.reduce((a, b) => a + b.events, 0), users: d.peakUsers ?? 0 };
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
});
route('POST', '/api/monitor/test-ai', async () => {
  try {
    return await testAi();
  } catch (e: any) {
    reportError(`AI connection test failed: ${e.message}`);
    throw new HttpError(400, e.message);
  }
});
route('GET', '/api/monitor/logs', ({ query }) => {
  const p = query.get('project') ?? activeProject()?.path;
  const f = p ? path.join(p, 'LOGS.md') : null;
  return { text: f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(-50_000) : '' };
});

const logDecision = (id: string, decision: string) => {
  const a = getApproval(id)!;
  if (decision === 'approve') {
    if (a.origin === 'cloud') {
      const v = verifyCloudItem(a.data.signed, getSettings().cloud.publicKey);
      if (!v.ok) throw new HttpError(400, `Refused: ${v.reason}`);
    }
    return decideApproval(id, 'approved');
  }
  if (decision === 'reject') return decideApproval(id, 'rejected');
  throw new HttpError(400, 'Unknown decision');
};
approvalHandlers.logs = logDecision;
approvalHandlers.cloud = logDecision;

toolRegistrars.push((server, { guarded }) => {
  server.registerTool('noulette_log_plans', {
    title: 'Approved production fixes',
    description: 'Returns production early-warning plans (from LOGS.md) that the user approved in the app. Unapproved, unsigned or tampered items are never returned.',
    inputSchema: { projectPath: projectPathSchema }
  }, async ({ projectPath }) => guarded(() => getApprovedLogPlans(projectPath)));
  server.registerTool('noulette_log_plan_done', {
    title: 'Mark a production fix done',
    description: 'Call after fixing an approved production plan.',
    inputSchema: { projectPath: projectPathSchema, planId: z.string(), summary: z.string() }
  }, async ({ projectPath, planId, summary }) => guarded(() => completeLogPlan(projectPath, planId, summary)));
});
