import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { dataPath } from '../core/paths.js';
import { getSecret, setSecret } from '../core/secrets.js';
import { getSettings } from '../core/settings.js';
import { routes, HttpError } from './api.js';
import { createMcpServer } from '../mcp/server.js';
import { checkFixBranches } from '../build/build.js';
import { VERSION } from '../version.js';

export const DEFAULT_PORT = 47821;

export interface DaemonInfo {
  port: number;
  pid: number;
  version: string;
  startedAt: number;
}

export function daemonInfoFile(): string {
  return dataPath('daemon.json');
}

export function readDaemonInfo(): DaemonInfo | null {
  try {
    return JSON.parse(fs.readFileSync(daemonInfoFile(), 'utf8'));
  } catch {
    return null;
  }
}

/** Stable bearer token for the local API and the optional remote MCP endpoint (DPAPI-protected). */
export function apiToken(): string {
  let t = getSecret('apiToken');
  if (!t) {
    t = crypto.randomBytes(32).toString('base64url');
    setSecret('apiToken', t);
  }
  return t;
}

function uiDir(): string | null {
  const c = [
    process.env.NOULETTE_UI,
    path.join(path.dirname(process.execPath), 'ui'),
    path.join(path.dirname(process.execPath), 'resources', 'ui'),
    path.resolve(import.meta.dir, '..', '..', '..', '..', 'apps', 'desktop', 'dist')
  ].filter(Boolean) as string[];
  return c.find((d) => fs.existsSync(path.join(d, 'index.html'))) ?? null;
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.json': 'application/json' };

const ALLOWED_ORIGINS = new Set(['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost', 'http://localhost:5173', 'http://127.0.0.1:5173']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};

export interface Tick {
  name: string;
  everyMs: number;
  fn: () => Promise<unknown> | unknown;
  last?: number;
}

export const ticks: Tick[] = [{ name: 'fix-branches', everyMs: 30_000, fn: checkFixBranches }];
export const startHooks: (() => void)[] = [];

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function makeFetchHandler(port: number) {
  const token = apiToken();
  const ui = uiDir();
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // DNS-rebinding protection: only accept our own loopback host names.
    if (!hosts.has(req.headers.get('host') ?? '')) return new Response('Forbidden host', { status: 403 });
    const origin = req.headers.get('origin');
    const sameOrigin = origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
    const corsOk = !origin || sameOrigin || ALLOWED_ORIGINS.has(origin);
    const cors: Record<string, string> = origin && corsOk ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version', 'Access-Control-Allow-Methods': 'GET, POST, DELETE' } : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: corsOk ? 204 : 403, headers: cors });
    if (!corsOk) return new Response('Forbidden origin', { status: 403 });

    const auth = req.headers.get('authorization') ?? '';
    const authed = auth.startsWith('Bearer ') && safeEqual(auth.slice(7), token);

    if (url.pathname === '/mcp') {
      if (!getSettings().remoteMcp.enabled) return new Response('Remote MCP is turned off in Noulette Settings', { status: 404 });
      if (!authed) return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const server = createMcpServer();
      await server.connect(transport);
      const res = await transport.handleRequest(req);
      return res;
    }

    if (url.pathname.startsWith('/api/')) {
      if (!authed) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
      if (req.method !== 'GET' && !(req.headers.get('content-type') ?? '').includes('application/json')) return Response.json({ error: 'JSON required' }, { status: 415, headers: cors });
      const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
      if (!r) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
      const m = r.pattern.exec(url.pathname)!;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let body: any = null;
      if (req.method !== 'GET') {
        const text = await req.text();
        if (text.length > 2_000_000) return Response.json({ error: 'Too large' }, { status: 413, headers: cors });
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors });
        }
      }
      try {
        const out = await r.handler({ body, params, query: url.searchParams });
        return Response.json(out ?? { ok: true }, { headers: { ...cors, 'Cache-Control': 'no-store' } });
      } catch (e: any) {
        const status = e instanceof HttpError ? e.status : 500;
        return Response.json({ error: e?.message ?? 'Error' }, { status, headers: cors });
      }
    }

    if (url.pathname === '/health') return Response.json({ ok: true, version: VERSION });

    // Static UI for viewing in Chrome at http://127.0.0.1:<port>/ (token is entered once, kept in sessionStorage).
    if (!ui) return new Response('Noulette UI not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(ui, rel);
    if (!file.startsWith(path.resolve(ui))) return new Response('Not found', { status: 404 });
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(ui, 'index.html');
    return new Response(Bun.file(target), { headers: { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream', ...SECURITY_HEADERS } });
  };
}

export class AlreadyRunning extends Error {}

async function existingDaemon(): Promise<DaemonInfo | null> {
  const info = readDaemonInfo();
  if (!info) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/health`, { signal: AbortSignal.timeout(800) });
    return r.ok ? info : null;
  } catch {
    return null;
  }
}

export async function startDaemon(opts: { port?: number; allowSecond?: boolean } = {}): Promise<{ port: number; stop: () => void }> {
  // One daemon per Windows user: a second copy would run the scheduler and watchers twice.
  if (!opts.allowSecond && (await existingDaemon())) throw new AlreadyRunning('Noulette daemon is already running');
  let port = opts.port ?? (Number(process.env.NOULETTE_PORT) || DEFAULT_PORT);
  let server: ReturnType<typeof Bun.serve> | null = null;
  for (let attempt = 0; attempt < 20 && !server; attempt++) {
    try {
      server = Bun.serve({ hostname: '127.0.0.1', port, fetch: makeFetchHandler(port), idleTimeout: 120 });
    } catch {
      port++;
    }
  }
  if (!server) throw new Error('No free port for the Noulette daemon');
  const info: DaemonInfo = { port, pid: process.pid, version: VERSION, startedAt: Date.now() };
  fs.writeFileSync(daemonInfoFile(), JSON.stringify(info));
  for (const h of startHooks) {
    try {
      h();
    } catch (e) {
      console.error('start hook failed', e);
    }
  }
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    const now = Date.now();
    for (const t of ticks) {
      if (t.last && now - t.last < t.everyMs) continue;
      t.last = now;
      try {
        await t.fn();
      } catch (e) {
        console.error(`tick ${t.name} failed`, e);
      }
    }
    busy = false;
  }, 5_000);
  return {
    port,
    stop: () => {
      clearInterval(timer);
      server!.stop(true);
    }
  };
}
