import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { killTree } from '../core/proc.js';
import { labelById } from './taxonomy.js';
import type { Finding, ScannerStatus } from './types.js';

type Raw = Omit<Finding, 'id' | 'fingerprint' | 'status'>;

/**
 * Live testing. Runs ONLY against 127.0.0.1 with the start command the user typed during intake
 * (recorded in Noulette's own database, never read from repo files, so a hostile repo cannot
 * smuggle in a command). If the app cannot start, the result is "not tested".
 */
export interface StartSpec {
  command: string;
  port: number;
}

export function parseStartAnswer(answer: string | null): StartSpec | null {
  if (!answer) return null;
  const portM = /(?:port|:)\s*(\d{2,5})\b/i.exec(answer);
  const port = portM ? parseInt(portM[1], 10) : 3000;
  let command = answer
    .replace(/\s*(on|at|using)?\s*port\s*\d{2,5}.*/i, '')
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/["'`]/g, '')
    .trim();
  if (!command || /^(none|no|skip|n\/a|-)$/i.test(command)) return null;
  if (port < 1 || port > 65535) return null;
  return { command, port };
}

const running = new Map<string, { child: ChildProcess; port: number; startedAt: number; log: string[] }>();

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.setTimeout(1000, () => {
      s.destroy();
      resolve(false);
    });
  });
}

export async function startApp(root: string, spec: StartSpec, waitMs = 60_000): Promise<{ ok: boolean; reason?: string; reused?: boolean }> {
  if (await portOpen(spec.port)) {
    // Something already listens there (the user's dev server). Use it, but do not own it.
    return { ok: true, reused: true };
  }
  stopApp(root);
  const log: string[] = [];
  const child = spawn(spec.command, {
    cwd: root,
    shell: true,
    windowsHide: true,
    env: { ...process.env, PORT: String(spec.port), NODE_ENV: 'development', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const keep = (d: Buffer) => {
    log.push(String(d));
    if (log.length > 200) log.shift();
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  running.set(root, { child, port: spec.port, startedAt: Date.now(), log });
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return { ok: false, reason: `The app stopped right away. Last output: ${log.join('').slice(-400)}` };
    if (await portOpen(spec.port)) return { ok: true };
    await new Promise((r) => setTimeout(r, 750));
  }
  stopApp(root);
  return { ok: false, reason: `Nothing answered on port ${spec.port} within ${Math.round(waitMs / 1000)} seconds.` };
}

export function stopApp(root: string): void {
  const r = running.get(root);
  if (r) {
    killTree(r.child.pid);
    running.delete(root);
  }
}

export function appPort(root: string): number | null {
  return running.get(root)?.port ?? null;
}

export function isLocalUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (url.protocol === 'http:' || url.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Single localhost request for the agent's multi-user role-play. Refuses any non-local host. */
export async function probe(req: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  if (!isLocalUrl(req.url)) throw new Error('Live tests only run against 127.0.0.1 / localhost.');
  const res = await fetch(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  const body = (await res.text()).slice(0, 8000);
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
}

const STACK_RE = /(at [\w.<>]+ \(.*:\d+:\d+\)|Traceback \(most recent call last\)|Exception in thread|System\.\w+Exception|Fatal error: .* on line \d+|goroutine \d+ \[running\])/;

export async function runDast(root: string, spec: StartSpec | null): Promise<{ findings: Raw[]; status: ScannerStatus; tested: boolean; port: number | null }> {
  const t0 = Date.now();
  if (!spec) return { findings: [], tested: false, port: null, status: { name: 'live-test', ok: true, ran: false, findings: 0, note: 'not tested (no start command given)', ms: 0 } };
  const started = await startApp(root, spec);
  if (!started.ok) return { findings: [], tested: false, port: null, status: { name: 'live-test', ok: true, ran: false, findings: 0, note: `not tested: ${started.reason}`, ms: Date.now() - t0 } };
  const base = `http://127.0.0.1:${spec.port}`;
  const findings: Raw[] = [];
  const add = (labelId: string, rule: string, severity: Raw['severity'], title: string, evidence: string, fix: string) => {
    const l = labelById(labelId);
    findings.push({ stage: 'security', source: 'dast', rule, severity, labelId, title: title || l.label, tldr: l.tldr, file: null, line: null, evidence, fixability: 'code', humanAction: null, fix, details: { scanner: 'noulette-live', base } });
  };
  const get = async (p: string, headers: Record<string, string> = {}) => {
    try {
      return await probe({ url: base + p, headers });
    } catch {
      return null;
    }
  };
  const home = await get('/');
  if (home) {
    const h = home.headers;
    const missing = [
      !h['content-security-policy'] && 'Content-Security-Policy',
      !h['x-content-type-options'] && 'X-Content-Type-Options',
      !h['x-frame-options'] && !/frame-ancestors/.test(h['content-security-policy'] ?? '') && 'X-Frame-Options'
    ].filter(Boolean);
    if (missing.length) add('headers', 'live.missing-headers', 'low', '', `Missing: ${missing.join(', ')}`, 'Add security headers (for Express use helmet; for others set them in the web server).');
    if (h['x-powered-by']) add('exposure', 'live.x-powered-by', 'low', 'Server reveals its technology', `X-Powered-By: ${h['x-powered-by']}`, 'Remove the X-Powered-By header.');
  }
  for (const p of ['/.env', '/.git/config', '/config.json', '/.aws/credentials']) {
    const r = await get(p);
    if (r && r.status === 200 && /(=|\[core\]|aws_access_key_id|"password"|SECRET|API_KEY)/i.test(r.body)) add('exposure', 'live.sensitive-file', 'critical', 'Private file can be downloaded', `GET ${p} returned 200`, `Stop serving ${p}; only serve the public build folder.`);
  }
  const err = await get("/%27%22%3C%3E__noulette_probe__%00");
  if (err && STACK_RE.test(err.body)) add('exposure', 'live.stack-trace', 'medium', 'Error details shown to visitors', err.body.match(STACK_RE)![0].slice(0, 200), 'Show a generic error page and log details on the server.');
  // Active injection probes: harmless payloads in common parameters; error-based detection only
  // (nothing is written or deleted). Any database or shell error in the reply is a finding.
  const SQL_ERR = /(SQLITE_ERROR|SQLiteException|sqlite3\.OperationalError|syntax error at or near|You have an error in your SQL syntax|unterminated quoted string|unrecognized token|SQLSTATE\[|ORA-\d{5}|Microsoft OLE DB|ODBC SQL Server Driver|PG::SyntaxError|psycopg2\.|MySqlException|near ".*": syntax error|Incorrect syntax near|quoted string not properly terminated)/i;
  const paths = ['/', '/search', '/api/search', '/api/products', '/api/items', '/api/users', '/products', '/items', '/login', '/api/login'];
  const params = ['id', 'q', 'search', 'name', 'category', 'user', 'email'];
  const payloads = ["'", "1' OR '1'='1", '1"', "1) OR (1=1", "';--"];
  let sqlHit: string | null = null;
  outer: for (const p of paths) {
    for (const k of params) {
      for (const pl of payloads) {
        const r = await get(`${p}?${k}=${encodeURIComponent(pl)}`);
        if (r && SQL_ERR.test(r.body)) {
          sqlHit = `GET ${p}?${k}=${pl} -> ${r.status}: ${r.body.match(SQL_ERR)![0]}`;
          break outer;
        }
      }
    }
  }
  if (!sqlHit) {
    for (const p of ['/login', '/api/login', '/api/auth/login', '/auth/login']) {
      try {
        const r = await probe({ url: base + p, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: "admin' --", email: "a@b.c' OR '1'='1", password: "' OR '1'='1" }) });
        if (SQL_ERR.test(r.body)) {
          sqlHit = `POST ${p} with a quote in the login fields -> ${r.status}: ${r.body.match(SQL_ERR)![0]}`;
          break;
        }
      } catch {}
    }
  }
  if (sqlHit) add('database', 'live.sql-error', 'critical', 'Database command injection (confirmed live)', sqlHit, 'Use parameterized queries for this input (and every other query built from user input); never join user text into SQL. Return generic errors.');
  const xss = '<script>noulette_xss_probe()</script>';
  for (const p of ['/search', '/', '/api/search']) {
    const r = await get(`${p}?q=${encodeURIComponent(xss)}`);
    if (r && r.body.includes(xss) && /html/i.test(r.headers['content-type'] ?? '')) {
      add('xss', 'live.reflected-xss', 'high', 'Page injection (confirmed live)', `GET ${p}?q=<script>... is reflected unescaped in HTML`, 'Escape user input in HTML output (use the template engine\'s default escaping) and add a Content-Security-Policy.');
      break;
    }
  }
  const trav = await get('/static/..%2f..%2f..%2f..%2fetc%2fpasswd');
  const trav2 = trav && /root:.*:0:0:/.test(trav.body) ? trav : await get('/files?name=..%2f..%2f..%2f..%2fetc%2fpasswd');
  if (trav2 && /root:.*:0:0:|\[fonts\]|\[extensions\]/.test(trav2.body)) add('path', 'live.path-traversal', 'critical', 'File access flaw (confirmed live)', 'A ../ path returned a system file', 'Resolve file paths against a fixed folder and refuse anything outside it.');
  const cors = await get('/', { Origin: 'http://evil.example' });
  if (cors && cors.headers['access-control-allow-origin'] === 'http://evil.example' && cors.headers['access-control-allow-credentials'] === 'true') add('cors', 'live.cors-reflect', 'high', '', 'Origin http://evil.example reflected with credentials', 'Only allow your own front-end origins.');
  return { findings, tested: true, port: spec.port, status: { name: 'live-test', ok: true, ran: true, findings: findings.length, note: started.reused ? 'used the app already running on that port' : undefined, ms: Date.now() - t0 } };
}
