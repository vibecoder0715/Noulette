import crypto from 'node:crypto';
import { getSettings } from '../core/settings.js';
import { getSecret } from '../core/secrets.js';

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
}

export class SourceError extends Error {}

const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// ------------------------------------------------------------------ PostHog (events + error tracking)

export async function fetchPostHog(from: number, to: number): Promise<SourceData> {
  const s = getSettings().inspector.posthog;
  const key = getSecret('posthogKey');
  if (!s.projectId || !key) throw new SourceError('PostHog needs a project ID and a personal API key (Settings > Production analysis).');
  if (!/^\d+$/.test(s.projectId.trim())) throw new SourceError('The PostHog project ID should be a number.');
  const host = (s.host || 'https://us.posthog.com').replace(/\/+$/, '').replace('://us.i.posthog.com', '://us.posthog.com').replace('://eu.i.posthog.com', '://eu.posthog.com');
  const q = async (hogql: string) => {
    const res = await fetch(`${host}/api/projects/${s.projectId.trim()}/query/`, {
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
      throw new SourceError(`PostHog answered ${res.status}${res.status === 401 || res.status === 403 ? ' (check the personal API key and that it can read Query)' : res.status === 404 ? ' (check the project ID and address)' : ''}: ${detail}`);
    }
    return JSON.parse(text).results as any[][];
  };
  const range = `timestamp >= toDateTime('${iso(from)}') AND timestamp < toDateTime('${iso(to)}')`;
  const rows = await q(`SELECT toUnixTimestamp(toStartOfInterval(timestamp, toIntervalMinute(5))) AS b, count() AS c, countIf(event = '$exception') AS e, count(DISTINCT distinct_id) AS u FROM events WHERE ${range} GROUP BY b ORDER BY b LIMIT 10000`);
  const ex = await q(`SELECT toString(properties.$exception_type) AS t, toString(properties.$exception_message) AS m, count() AS c FROM events WHERE event = '$exception' AND ${range} GROUP BY t, m ORDER BY c DESC LIMIT 25`);
  const peak = await q(`SELECT count(DISTINCT distinct_id) FROM events WHERE ${range}`);
  return {
    source: 'posthog',
    buckets: rows.map((r) => ({ ts: Number(r[0]) * 1000, events: Number(r[1]), errors: Number(r[2]), users: Number(r[3]) })),
    exceptions: ex.map((r) => ({ type: String(r[0] || 'Error'), message: String(r[1] || ''), count: Number(r[2]) })),
    peakUsers: peak?.[0]?.[0] !== undefined ? Number(peak[0][0]) : null
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
