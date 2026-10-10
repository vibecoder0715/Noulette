import fs from 'node:fs';
import path from 'node:path';
import { getSettings, updateSettings, INTERVALS } from '../core/settings.js';
import { hasSecret, setSecret, secretSource, type SecretName } from '../core/secrets.js';
import { listProjects, registerProject, removeProject, setActiveProject, activeProject } from '../core/projects.js';
import { listNotifications, markRead, markAllRead, resolveNotification, listApprovals, decideApproval, getApproval, notify } from '../core/events.js';
import { latestRun } from '../core/runs.js';
import { getFindings, tldr } from '../inspect/store.js';
import { inspectPrompt, buildPrompt, repoInstructionSnippet } from '../inspect/prompts.js';
import { mergeCommands } from '../build/build.js';
import { VERSION } from '../version.js';
import { localKey } from '../core/signing.js';
import { posthogKeyProblem, normalizePostHog } from '../monitor/sources.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Handler = (ctx: { body: any; params: Record<string, string>; query: URLSearchParams }) => Promise<unknown> | unknown;
export interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export const routes: Route[] = [];

export function route(method: Route['method'], p: string, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, pattern, keys, handler });
}

/** Hooks other milestones use to add sections to /api/state. */
export const stateExtras: (() => Record<string, unknown>)[] = [];

import { engineCommand } from '../core/engine-cmd.js';
export { engineCommand };

function statusCard(): any {
  const p = activeProject();
  if (!p) return { status: 'no_project', title: 'Add a project to begin', detail: 'Pick the folder of an app you are building.' };
  const ins = latestRun(p.path, 'inspection');
  const findings = ins ? getFindings(p.path, ins.id) : [];
  const counts = tldr(findings.filter((f) => f.status !== 'dismissed'));
  const st = p.state;
  const pending = listApprovals('pending').filter((a) => a.project && a.project.toLowerCase() === p.path.toLowerCase());
  let status: string = st.status;
  if (status === 'ready' && pending.length) status = 'needs_approval';
  const titles: Record<string, string> = {
    ready: ins ? 'Ready' : 'Ready to inspect',
    inspecting: 'Inspecting',
    needs_approval: 'Needs approval',
    building: 'Fixing',
    branch_waiting: 'Fixes waiting on a branch'
  };
  const details: Record<string, string> = {
    ready: ins ? `Last checked ${new Date(st.lastInspectedAt ?? ins.started_at).toLocaleString()}.` : 'Copy the Inspect prompt into your coding agent to start.',
    inspecting: `Your agent is working on: ${st.stage ?? 'starting'}.`,
    needs_approval: 'Open Approvals to choose what gets fixed.',
    building: 'Your agent is fixing and verifying.',
    branch_waiting: 'The fixes were NOT merged. Merge or discard them when you are ready.'
  };
  return {
    status,
    title: titles[status] ?? 'Ready',
    detail: details[status] ?? '',
    project: { path: p.path, name: p.name },
    counts,
    branch: st.branch ? { ...st.branch, commands: mergeCommands(st.branch.base, st.branch.name) } : null,
    inspectionId: ins?.id ?? null
  };
}

const SECRETS: SecretName[] = ['posthogKey', 'ga4ServiceAccount', 'aiApiKey', 'cloudToken'];

export function stateSnapshot(): Record<string, unknown> {
  const settings = getSettings();
  const n = listNotifications();
  const approvals = listApprovals();
  return {
    version: VERSION,
    settings,
    intervals: INTERVALS,
    secrets: Object.fromEntries(SECRETS.map((s) => [s, secretSource(s)])),
    projects: listProjects().map((p) => ({ path: p.path, name: p.name, status: p.state.status })),
    active: activeProject()?.path ?? null,
    card: statusCard(),
    notifications: n,
    approvals: { pending: approvals.filter((a) => a.status === 'pending'), recent: approvals.filter((a) => a.status !== 'pending').slice(0, 30) },
    signingKey: localKey().pub.slice(0, 12),
    ...Object.assign({}, ...stateExtras.map((f) => f()))
  };
}

// ------------------------------------------------------------------ routes (M1)

route('GET', '/api/state', () => stateSnapshot());

/** Pre-processing of settings writes (for example moving pasted keys into encrypted storage). */
export const settingsFilters: ((body: any) => Record<string, unknown> | void)[] = [];

route('POST', '/api/settings', ({ body }) => {
  const before = getSettings();
  const extras: Record<string, unknown> = {};
  for (const f of settingsFilters) Object.assign(extras, f(body) ?? {});
  // Store the PostHog address and project ID in their clean form (pasted links, "us", ingestion hosts...).
  const ph = body?.inspector?.posthog;
  if (ph && (typeof ph.host === 'string' || typeof ph.projectId === 'string')) {
    const cur = before.inspector.posthog;
    const n = normalizePostHog(ph.host ?? cur.host, ph.projectId ?? cur.projectId);
    if (typeof ph.host === 'string') ph.host = n.host;
    ph.projectId = n.projectId;
  }
  let next;
  try {
    next = updateSettings(body ?? {});
  } catch (e: any) {
    throw new HttpError(400, `Invalid setting: ${e?.issues?.[0]?.message ?? e.message}`);
  }
  const changed = Object.keys(body ?? {}).filter((k) => JSON.stringify((before as any)[k]) !== JSON.stringify((next as any)[k]));
  if (changed.length && !(changed.length === 1 && changed[0] === 'suppressRead')) {
    notify({ severity: 'info', kind: 'settings-changed', title: 'Settings changed', body: `Updated: ${changed.join(', ')}.`, alert: true, dedupeKey: 'settings' });
  }
  return { ...next, ...extras };
});

route('POST', '/api/secrets', ({ body }) => {
  const name = body?.name as SecretName;
  if (!SECRETS.includes(name)) throw new HttpError(400, 'Unknown secret');
  const value = typeof body?.value === 'string' ? body.value.trim() : '';
  if (value.length > 20_000) throw new HttpError(400, 'Value too long');
  const problem = name === 'posthogKey' && value ? posthogKeyProblem(value) : null;
  if (problem) throw new HttpError(400, problem);
  setSecret(name, value || null);
  return { name, present: hasSecret(name) };
});

route('POST', '/api/projects', ({ body }) => {
  const p = String(body?.path ?? '').trim();
  if (!p || !path.isAbsolute(p)) throw new HttpError(400, 'Enter the full folder path, for example C:\\Users\\you\\my-app');
  try {
    return registerProject(p);
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
});

route('POST', '/api/projects/active', ({ body }) => setActiveProject(String(body?.path ?? '')));
route('POST', '/api/projects/remove', ({ body }) => (removeProject(String(body?.path ?? '')), { ok: true }));

route('POST', '/api/projects/snippet', ({ body }) => {
  const p = String(body?.path ?? '');
  if (!p || !fs.existsSync(p)) throw new HttpError(400, 'Project folder not found');
  const file = path.join(p, 'AGENTS.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const block = repoInstructionSnippet();
  const next = /<!-- noulette:start -->[\s\S]*?<!-- noulette:end -->/.test(existing)
    ? existing.replace(/<!-- noulette:start -->[\s\S]*?<!-- noulette:end -->/, block)
    : (existing ? existing.replace(/\s*$/, '\n\n') : '') + block + '\n';
  fs.writeFileSync(file, next);
  return { file };
});

route('GET', '/api/prompts', ({ query }) => {
  const cmd = engineCommand();
  const ctx = { ...cmd, projectPath: query.get('project') || activeProject()?.path || null };
  return { inspect: inspectPrompt(ctx), build: buildPrompt(ctx), snippet: repoInstructionSnippet(cmd), mcpCommand: cmd };
});

route('GET', '/api/findings', ({ query }) => {
  const p = query.get('project') ?? activeProject()?.path;
  if (!p) return { findings: [] };
  const ins = latestRun(p, 'inspection');
  return { inspectionId: ins?.id ?? null, findings: ins ? getFindings(p, ins.id) : [] };
});

route('POST', '/api/notifications/:id/read', ({ params }) => (markRead(params.id), { ok: true }));
route('POST', '/api/notifications/read-all', () => (markAllRead(), { ok: true }));
route('POST', '/api/notifications/:id/resolve', ({ params }) => (resolveNotification(params.id), { ok: true }));

/** Approval handlers by kind; later milestones register guard/logs/cloud handlers. */
export const approvalHandlers: Record<string, (id: string, decision: string, body: any) => Promise<unknown> | unknown> = {
  inspection: (id, decision, body) => {
    const a = getApproval(id)!;
    if (decision === 'approve') {
      const valid = new Set((a.data.items ?? []).map((i: any) => i.id));
      const selection = Array.isArray(body?.selection) ? body.selection.filter((s: string) => valid.has(s)) : [...valid];
      if (!selection.length) throw new HttpError(400, 'Choose at least one item to fix.');
      return decideApproval(id, 'approved', selection);
    }
    if (decision === 'reject') return decideApproval(id, 'rejected');
    throw new HttpError(400, 'Unknown decision');
  }
};

route('POST', '/api/approvals/:id/decide', async ({ params, body }) => {
  const a = getApproval(params.id);
  if (!a) throw new HttpError(404, 'Not found');
  if (a.status !== 'pending') throw new HttpError(409, 'This item was already decided.');
  const h = approvalHandlers[a.kind];
  if (!h) throw new HttpError(400, 'Unsupported approval type');
  const out = await h(a.id, String(body?.decision ?? ''), body);
  if (a.project) {
    const p = listProjects().find((x) => x.path.toLowerCase() === a.project!.toLowerCase());
    if (p && p.state.status === 'needs_approval' && a.kind === 'inspection') {
      const { setProjectState } = await import('../core/projects.js');
      setProjectState(p.path, { status: 'ready' });
    }
  }
  return out;
});
