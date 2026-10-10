import crypto from 'node:crypto';
import { getSettings } from '../core/settings.js';
import { getSecret } from '../core/secrets.js';
import type { EventSample } from './attacks.js';

/** One time bucket of production data. */
export interface Bucket {
  ts: number;
  events: number;
  errors: number;
  users: number;
}

export interface Exception {
  type: string;
  message: string;
  count: number;
}

export interface SourceData {
  source: 'posthog' | 'ga4';
  buckets: Bucket[];
  exceptions: Exception[];
  peakUsers: number | null;
  /** Raw events for attack detection (PostHog only). Never stored; only redacted evidence is kept. */
  samples?: EventSample[];
  /** True when the window had more events than were scanned. */
  samplesTruncated?: boolean;
}

/** Most recent events per pass that are scanned for attacks. */
export const ATTACK_SCAN_LIMIT = 10_000;

export class SourceError extends Error {}

const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// ------------------------------------------------------------------ PostHog (events + error tracking)

/** Explains keys that cannot read data. Returns null when the key looks usable. */
export function posthogKeyProblem(key: string): string | null {
  const k = key.trim();
  if (/^phc_/i.test(k)) {
    return 'This is a PostHog project token (phc_...). It can only send events, not read them. Create a personal API key (phx_...) in PostHog > Settings > Personal API keys, give it the "Query: Read" scope, and paste that instead.';
  }
  if (/^phs_/i.test(k)) return 'This is a PostHog secret project key (phs_...), used for feature flags. Paste a personal API key (phx_...) with the "Query: Read" scope instead.';
  return null;
}

/**
 * Accepts the PostHog address in any common form: "us", "eu", "us.posthog.com", an ingestion host
 * (us.i.posthog.com), the old app.posthog.com, a self-hosted URL, or a pasted dashboard link such as
 * https://us.posthog.com/project/657084/insights (the project ID is taken from it).
 */
export function normalizePostHog(hostInput: string, projectIdInput = ''): { host: string; projectId: string } {
  let h = (hostInput || '').trim();
  let projectId = (projectIdInput || '').trim();
  if (/^(us|eu)$/i.test(h)) h = `https://${h.toLowerCase()}.posthog.com`;
  if (h && !/^https?:\/\//i.test(h)) h = `https://${h}`;
  let host = 'https://us.posthog.com';
  if (h) {
    try {
      const u = new URL(h);
      const fromPath = /\/project(?:s)?\/(\d+)/.exec(u.pathname)?.[1];
      if (fromPath && !/^\d+$/.test(projectId)) projectId = fromPath;
      let name = u.hostname.toLowerCase();
      name = name.replace(/^(us|eu)(?:-assets)?\.i\.posthog\.com$/, '$1.posthog.com');
      if (name === 'app.posthog.com' || name === 'posthog.com' || name === 'www.posthog.com') name = 'us.posthog.com';
      host = `${u.protocol}//${name}${u.port ? ':' + u.port : ''}`;
    } catch {
      // Leave the default; the check below reports a bad address.
    }
  }
  // A pasted link in the project ID field.
  const idFromUrl = /\/project(?:s)?\/(\d+)/.exec(projectId)?.[1];
  if (idFromUrl) projectId = idFromUrl;
  return { host, projectId };
}

/** HogQL returns properties as a JSON string or an object depending on version. */
function parseProps(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const j = JSON.parse(v);
      return j && typeof j === 'object' ? j : { value: v };
    } catch {
      return { value: v };
    }
  }
  return {};
}

export async function fetchPostHog(from: number, to: number): Promise<SourceData> {
  const s = getSettings().inspector.posthog;
  const key = getSecret('posthogKey')?.trim();
  const { host, projectId } = normalizePostHog(s.host, s.projectId);
  if (!projectId || !key) throw new SourceError('PostHog needs a project ID and a personal API key (Settings > Production analysis).');
  if (!/^\d+$/.test(projectId)) throw new SourceError('The PostHog project ID should be a number (it is in the address bar: /project/<ID>/).');
  const keyProblem = posthogKeyProblem(key);
  if (keyProblem) throw new SourceError(keyProblem);
  const q = async (hogql: string) => {
    const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql }, name: 'noulette' }),
      signal: AbortSignal.timeout(60_000)
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        detail = JSON.parse(text).detail ?? detail;
      } catch {}
      const hint =
        res.status === 401 || res.status === 403
          ? ` (use a personal API key starting with phx_ that has the "Query: Read" scope and access to project ${projectId}; also check you picked the right region, us or eu)`
          : res.status === 404 ? ' (check the project ID and the PostHog address)' : '';
      throw new SourceError(`PostHog answered ${res.status}${hint}: ${detail}`);
    }
    return JSON.parse(text).results as any[][];
  };
  const range = `timestamp >= toDateTime('${iso(from)}') AND timestamp < toDateTime('${iso(to)}')`;
  const rows = await q(`SELECT toUnixTimestamp(toStartOfInterval(timestamp, toIntervalMinute(5))) AS b, count() AS c, countIf(event = '$exception') AS e, count(DISTINCT distinct_id) AS u FROM events WHERE ${range} GROUP BY b ORDER BY b LIMIT 10000`);
  const ex = await q(`SELECT toString(properties.$exception_type) AS t, toString(properties.$exception_message) AS m, count() AS c FROM events WHERE event = '$exception' AND ${range} GROUP BY t, m ORDER BY c DESC LIMIT 25`);
  const peak = await q(`SELECT count(DISTINCT distinct_id) FROM events WHERE ${range}`);
  // Raw events (newest first) for attack detection: every property of every event is checked.
  const raw = await q(`SELECT event, toUnixTimestamp(timestamp), distinct_id, properties FROM events WHERE ${range} ORDER BY timestamp DESC LIMIT ${ATTACK_SCAN_LIMIT}`);
  const buckets = rows.map((r) => ({ ts: Number(r[0]) * 1000, events: Number(r[1]), errors: Number(r[2]), users: Number(r[3]) }));
  const total = buckets.reduce((s, b) => s + b.events, 0);
  return {
    source: 'posthog',
    buckets,
    exceptions: ex.map((r) => ({ type: String(r[0] || 'Error'), message: String(r[1] || ''), count: Number(r[2]) })),
    peakUsers: peak?.[0]?.[0] !== undefined ? Number(peak[0][0]) : null,
    samples: raw.map((r) => ({ event: String(r[0] ?? ''), ts: Number(r[1]) * 1000, actor: String(r[2] ?? ''), props: parseProps(r[3]) })),
    samplesTruncated: raw.length >= ATTACK_SCAN_LIMIT && total > raw.length
  };
}

// ------------------------------------------------------------------ Google Analytics 4 (aggregates)

async function gaToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(30_000)
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new SourceError(`Google sign-in failed: ${j.error_description ?? j.error ?? res.status}`);
  return j.access_token;
}

export async function fetchGa4(from: number, to: number): Promise<SourceData> {
  const s = getSettings().inspector.ga4;
  const raw = getSecret('ga4ServiceAccount');
  if (!s.propertyId || !raw) throw new SourceError('Google Analytics needs a property ID and a service account key.');
  let sa: any;
  try {
    sa = JSON.parse(raw);
  } catch {
    throw new SourceError('The Google service account key is not valid JSON.');
  }
  const token = await gaToken(sa);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(s.propertyId)}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateRanges: [{ startDate: day(from), endDate: day(to) }], dimensions: [{ name: 'dateHour' }], metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }], limit: 1000 }),
    signal: AbortSignal.timeout(60_000)
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new SourceError(`Google Analytics answered ${res.status}: ${j?.error?.message ?? ''}`);
  const buckets: Bucket[] = (j.rows ?? []).map((r: any) => {
    const dh = r.dimensionValues[0].value as string;
    const ts = Date.UTC(+dh.slice(0, 4), +dh.slice(4, 6) - 1, +dh.slice(6, 8), +dh.slice(8, 10));
    return { ts, events: Number(r.metricValues[0].value), errors: 0, users: Number(r.metricValues[1].value) };
  });
  const realtime = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(s.propertyId)}:runRealtimeReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metrics: [{ name: 'activeUsers' }] }),
    signal: AbortSignal.timeout(30_000)
  })
    .then((r) => r.json() as any)
    .catch(() => null);
  const rt = realtime?.rows?.[0]?.metricValues?.[0]?.value;
  return { source: 'ga4', buckets: buckets.filter((b) => b.ts >= from - 3600_000 && b.ts < to), exceptions: [], peakUsers: rt !== undefined ? Number(rt) : Math.max(0, ...buckets.map((b) => b.users)) };
}
