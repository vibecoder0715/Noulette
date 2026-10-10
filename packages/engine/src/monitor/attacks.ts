import { redact } from '../core/redact.js';
import type { EarlyWarning } from './detectors.js';

/**
 * Attack detection on raw production events (deterministic, no AI).
 * Every event property is decoded (URL, HTML entities, "+" as space, repeated) and checked against
 * signatures for common web attacks. Rule: a matched attempt is ALWAYS reported. It is never
 * downgraded or dropped because an AI, a digest or a missing plan says things look fine.
 */
export interface EventSample {
  event: string;
  ts: number;
  actor: string;
  props: Record<string, unknown>;
}

export type AttackCategory =
  | 'sql-injection' | 'nosql-injection' | 'xss' | 'command-injection' | 'path-traversal' | 'template-injection'
  | 'xxe' | 'jndi-injection' | 'ssrf' | 'open-redirect' | 'crlf-injection' | 'prototype-pollution' | 'ldap-injection'
  | 'scanner' | 'brute-force';

interface Signature {
  category: AttackCategory;
  severity: 'critical' | 'warning';
  re: RegExp;
}

// Patterns are tuned to the shape of real payloads, not single characters, to keep false alarms low.
const SIGNATURES: Signature[] = [
  // SQL injection
  { category: 'sql-injection', severity: 'critical', re: /['"`)]\s*(or|and)\s+['"`]?\w*['"`]?\s*(=|like|<|>)\s*['"`]?\w*/i },
  { category: 'sql-injection', severity: 'critical', re: /\b(or|and)\s+\d+\s*=\s*\d+/i },
  { category: 'sql-injection', severity: 'critical', re: /\bunion(\s+all)?\s+select\b/i },
  { category: 'sql-injection', severity: 'critical', re: /;\s*(drop|delete|truncate|alter|insert|update|create|exec(ute)?)\s+/i },
  { category: 'sql-injection', severity: 'critical', re: /\b(sleep|pg_sleep|benchmark)\s*\(\s*\d+|\bwaitfor\s+delay\b/i },
  { category: 'sql-injection', severity: 'critical', re: /\b(information_schema|sqlite_master|pg_catalog|sys\.tables|xp_cmdshell)\b/i },
  { category: 'sql-injection', severity: 'critical', re: /['"]\s*(--|#|\/\*)/ },
  { category: 'sql-injection', severity: 'critical', re: /\b(extractvalue|updatexml|load_file)\s*\(|\binto\s+(out|dump)file\b/i },
  // NoSQL injection
  { category: 'nosql-injection', severity: 'critical', re: /[{,]\s*["']?\$(ne|gt|gte|lt|lte|regex|where|nin|exists|expr)["']?\s*:/i },
  { category: 'nosql-injection', severity: 'critical', re: /\[\$(ne|gt|regex|where|nin)\]/i },
  // XSS
  { category: 'xss', severity: 'critical', re: /<\s*script\b|<\s*\/\s*script\s*>/i },
  { category: 'xss', severity: 'critical', re: /\bjavascript\s*:|\bvbscript\s*:/i },
  { category: 'xss', severity: 'critical', re: /<[^>]+\bon(error|load|click|mouseover|focus|toggle|begin|animationstart)\s*=/i },
  { category: 'xss', severity: 'critical', re: /<\s*(iframe|svg|img|object|embed|body|details|math)\b[^>]*>/i },
  { category: 'xss', severity: 'warning', re: /\bdocument\.(cookie|domain)|\balert\s*\(|\bprompt\s*\(\s*\d|String\.fromCharCode/i },
  // Command injection
  { category: 'command-injection', severity: 'critical', re: /[;&|`]\s*(cat|ls|id|whoami|uname|curl|wget|nc|ncat|bash|sh|powershell|cmd|ping|nslookup|rm|chmod)\b/i },
  { category: 'command-injection', severity: 'critical', re: /\$\(\s*\w+[^)]*\)|`\s*(id|whoami|uname|cat)\b[^`]*`/i },
  { category: 'command-injection', severity: 'critical', re: /\/bin\/(ba)?sh\b|\bcmd(\.exe)?\s+\/c\b|powershell(\.exe)?\s+-(e|enc|c)\b/i },
  // Path traversal / local file inclusion
  { category: 'path-traversal', severity: 'critical', re: /(\.\.[\/\\]){2,}|\.\.[\/\\](etc|windows|boot|proc|var)\b/i },
  { category: 'path-traversal', severity: 'critical', re: /\/etc\/(passwd|shadow|hosts)\b|\bc:\\windows\\(win\.ini|system32)|\bboot\.ini\b|\/proc\/self\//i },
  { category: 'path-traversal', severity: 'critical', re: /\b(php|file|zip|phar|expect|data):\/\/(?!\s)/i },
  // Template injection
  { category: 'template-injection', severity: 'critical', re: /\{\{\s*[\d\w.]*\s*[*+]\s*[\d\w.]*\s*\}\}|\$\{\s*\d+\s*[*+]\s*\d+\s*\}|<%=?\s*\d+\s*[*+]\s*\d+\s*%>/ },
  { category: 'template-injection', severity: 'critical', re: /__class__|__mro__|__subclasses__|__globals__|\bconfig\.items\(\)/ },
  // XXE
  { category: 'xxe', severity: 'critical', re: /<!DOCTYPE[^>]*\[|<!ENTITY\s+\S+\s+(SYSTEM|PUBLIC)/i },
  // JNDI (Log4Shell)
  { category: 'jndi-injection', severity: 'critical', re: /\$\{\s*(jndi|\$\{[^}]*\}|lower:|upper:|env:)/i },
  // SSRF
  { category: 'ssrf', severity: 'critical', re: /169\.254\.169\.254|metadata\.google\.internal|\b100\.100\.100\.200\b|gopher:\/\/|dict:\/\//i },
  { category: 'ssrf', severity: 'warning', re: /(url|uri|target|dest|redirect|callback|image|feed|host)=["']?(https?:)?\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|10\.\d+|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i },
  // Open redirect
  { category: 'open-redirect', severity: 'warning', re: /(redirect|return|next|url|continue|dest)(_?url|_?to)?=\s*(https?:)?\/\/(?![^&]*\b(localhost)\b)[^&\s]+/i },
  // CRLF / header injection
  { category: 'crlf-injection', severity: 'warning', re: /(%0d%0a|\r\n)\s*(set-cookie|location|content-type)\s*:/i },
  // Prototype pollution
  { category: 'prototype-pollution', severity: 'warning', re: /__proto__|constructor\s*\[\s*["']?prototype|constructor\.prototype/ },
  // LDAP injection
  { category: 'ldap-injection', severity: 'warning', re: /\*\)\s*\(\s*[|&]|\)\s*\(\s*\|\s*\(\s*\w+=\*/ },
  // Known attack tools (in user agents or any field)
  { category: 'scanner', severity: 'warning', re: /\b(sqlmap|nikto|nuclei|acunetix|nessus|openvas|w3af|dirbuster|gobuster|ffuf|wfuzz|masscan|zgrab|burp\s?(suite|collaborator)|havij|commix|xsstrike|wpscan|owasp\s?zap)\b/i }
];

const LABEL: Record<AttackCategory, { title: string; tldr: string; fix: string }> = {
  'sql-injection': { title: 'SQL injection attempts', tldr: 'Someone is typing database commands into your app to read or change data they should not see.', fix: 'Use parameterized queries (placeholders) for every database call that uses user input; never build SQL by joining strings. Validate types (numbers, ids). Return generic errors, never database messages. Add rate limiting on the targeted endpoint and a test that sends these payloads.' },
  'nosql-injection': { title: 'NoSQL injection attempts', tldr: 'Someone is sending database operators (like $ne or $gt) to skip checks such as login.', fix: 'Reject objects where a string is expected (validate input with a schema), strip keys starting with "$", and never pass request bodies straight into database filters. Add a test for these payloads.' },
  xss: { title: 'Cross-site scripting (XSS) attempts', tldr: 'Someone is trying to run their own script in other users\' browsers through your pages.', fix: 'Escape output by default in templates, never insert user text with innerHTML / dangerouslySetInnerHTML, sanitize allowed HTML with a vetted library, and add a Content-Security-Policy header. Add a test that renders these payloads safely.' },
  'command-injection': { title: 'Command injection attempts', tldr: 'Someone is trying to run system commands on your server through your app.', fix: 'Never pass user input to a shell. Use APIs that take an argument list (no shell), allow-list accepted values, and run the app with least privilege. Add a test for these payloads.' },
  'path-traversal': { title: 'Path traversal / file read attempts', tldr: 'Someone is trying to read files on your server (like passwords or config) by changing a file path.', fix: 'Resolve requested paths against a fixed base folder and refuse anything that leaves it; use ids instead of file names from users; block file:// and php:// style inputs. Add a test for these payloads.' },
  'template-injection': { title: 'Template injection attempts', tldr: 'Someone is trying to make your server run code through a page template.', fix: 'Never build templates from user input; pass user data only as template variables; use sandboxed rendering. Add a test for these payloads.' },
  xxe: { title: 'XML external entity (XXE) attempts', tldr: 'Someone is sending XML that tries to read server files or reach internal systems.', fix: 'Disable DTDs and external entities in every XML parser, or accept JSON only. Add a test for these payloads.' },
  'jndi-injection': { title: 'Log4Shell / JNDI injection attempts', tldr: 'Someone is trying the Log4Shell attack to take over Java servers through logged text.', fix: 'Upgrade log4j-core to 2.17.1 or later (or remove JndiLookup), and never log raw user input without encoding. Check all Java services and dependencies.' },
  ssrf: { title: 'Server-side request forgery (SSRF) attempts', tldr: 'Someone is trying to make your server call internal addresses, such as cloud metadata that holds keys.', fix: 'Allow-list outbound hosts for any feature that fetches URLs, block private and link-local ranges after DNS resolution, and disable redirects for these requests.' },
  'open-redirect': { title: 'Open redirect attempts', tldr: 'Someone is trying to use your site to send people to another site (often for phishing).', fix: 'Only redirect to relative paths or an allow-list of your own domains; ignore full URLs in redirect parameters.' },
  'crlf-injection': { title: 'Header injection attempts', tldr: 'Someone is trying to add their own HTTP headers (like cookies) through your app.', fix: 'Strip CR and LF characters from any value placed in headers or redirects; use your framework\'s header APIs.' },
  'prototype-pollution': { title: 'Prototype pollution attempts', tldr: 'Someone is sending special keys that can change how your JavaScript server behaves for everyone.', fix: 'Reject __proto__, constructor and prototype keys in JSON input, use Object.create(null) or Map for user-keyed objects, and update deep-merge libraries.' },
  'ldap-injection': { title: 'LDAP injection attempts', tldr: 'Someone is trying to change directory (LDAP) searches, often to skip login checks.', fix: 'Escape LDAP filter values with your library\'s escape function and validate input against an allow-list.' },
  scanner: { title: 'Attack tool activity', tldr: 'Known hacking tools are scanning your app for weaknesses.', fix: 'Rate limit and block the sources, make sure every probed endpoint validates input, and review the other attack warnings from the same period.' },
  'brute-force': { title: 'Login brute-force attempts', tldr: 'Someone is trying many passwords to break into accounts.', fix: 'Add rate limiting and temporary lockout per account and per IP on login, require strong passwords, offer 2FA, and return the same error for unknown users and wrong passwords.' }
};

function decode(s: string): string {
  let out = s;
  for (let i = 0; i < 3; i++) {
    let next = out.replace(/\+/g, ' ');
    try {
      next = decodeURIComponent(next);
    } catch {
      next = next.replace(/%([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    }
    next = next
      .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);?/g, (_m, d) => String.fromCharCode(Number(d)))
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&amp;/gi, '&')
      .replace(/\\u([0-9a-f]{4})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Flattens properties into [path, text] pairs. Keys are included because pollution payloads live in keys. */
function fields(v: unknown, prefix = '', out: [string, string][] = [], depth = 0): [string, string][] {
  if (depth > 6 || out.length > 400) return out;
  if (v === null || v === undefined) return out;
  if (typeof v === 'string') out.push([prefix, v]);
  else if (typeof v === 'number' || typeof v === 'boolean') return out;
  else if (Array.isArray(v)) v.forEach((x, i) => fields(x, `${prefix}[${i}]`, out, depth + 1));
  else if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/^(__proto__|constructor|prototype)$/.test(k)) out.push([`${prefix}.${k}`, k]);
      // Database operators sent as object keys ({"$ne": null}) are NoSQL injection payloads.
      if (/^\$(ne|gt|gte|lt|lte|regex|where|nin|exists|expr)$/i.test(k)) out.push([`${prefix}.${k}`, JSON.stringify({ [k]: x ?? null })]);
      fields(x, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
  }
  return out;
}

// Fields PostHog fills itself; payloads there are still checked, except values that are only ids or hashes.
const SKIP_FIELD = /^(\$lib|\$lib_version|\$insert_id|\$session_id|\$window_id|\$device_id|\$browser_version|\$os_version|\$screen_|\$viewport_|token|distinct_id|\$time|\$sent_at|uuid)/;

export interface AttackHit {
  category: AttackCategory;
  severity: 'critical' | 'warning';
  attempts: number;
  actors: Set<string>;
  events: Map<string, number>;
  fields: Set<string>;
  samples: string[];
  first: number;
  last: number;
}

const FAILED_LOGIN_EVENT = /(login|log_in|signin|sign_in|auth)[\w\s-]*(fail|error|denied|invalid|rejected)|(fail|invalid|wrong)[\w\s-]*(login|password|credential)/i;

export function scanEvents(samples: EventSample[]): Map<AttackCategory, AttackHit> {
  const hits = new Map<AttackCategory, AttackHit>();
  const add = (cat: AttackCategory, sev: 'critical' | 'warning', e: EventSample, field: string, value: string) => {
    let h = hits.get(cat);
    if (!h) hits.set(cat, (h = { category: cat, severity: sev, attempts: 0, actors: new Set(), events: new Map(), fields: new Set(), samples: [], first: e.ts, last: e.ts }));
    if (sev === 'critical') h.severity = 'critical';
    h.attempts++;
    h.actors.add(e.actor);
    h.events.set(e.event, (h.events.get(e.event) ?? 0) + 1);
    h.fields.add(field.replace(/\[\d+\]/g, '[]'));
    h.first = Math.min(h.first, e.ts);
    h.last = Math.max(h.last, e.ts);
    // Evidence keeps the attack shape but is redacted and cut, and never contains raw secrets.
    const sample = `${e.event} -> ${field}: ${redact(value.replace(/\s+/g, ' ')).slice(0, 160)}`;
    if (h.samples.length < 5 && !h.samples.includes(sample)) h.samples.push(sample);
  };
  const failedLogins = new Map<string, number>();
  for (const e of samples) {
    if (FAILED_LOGIN_EVENT.test(e.event)) failedLogins.set(e.actor, (failedLogins.get(e.actor) ?? 0) + 1);
    const seen = new Set<AttackCategory>();
    for (const [field, raw] of [['event', e.event] as [string, string], ...fields(e.props)]) {
      if (SKIP_FIELD.test(field) || raw.length < 4) continue;
      const text = decode(raw).slice(0, 4000);
      for (const s of SIGNATURES) {
        if (seen.has(s.category)) continue;
        if (s.re.test(text)) {
          seen.add(s.category);
          add(s.category, s.severity, e, field, text);
        }
      }
    }
  }
  for (const [actor, n] of failedLogins) {
    if (n < 10) continue;
    const e = samples.find((s) => s.actor === actor && FAILED_LOGIN_EVENT.test(s.event))!;
    for (let i = 0; i < n; i++) add('brute-force', n >= 30 ? 'critical' : 'warning', { ...e, ts: e.ts }, 'event', `${n} failed logins from one user or device`);
  }
  return hits;
}

/** One early warning per attack category. These are never merged away or downgraded. */
export function attackWarnings(hits: Map<AttackCategory, AttackHit>, opts: { scanned: number; truncated: boolean }): EarlyWarning[] {
  const out: EarlyWarning[] = [];
  const t = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  for (const h of hits.values()) {
    const l = LABEL[h.category];
    const evs = [...h.events.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => `${n} (${c})`).join(', ');
    out.push({
      detector: 'attack',
      category: h.category,
      severity: h.severity,
      title: l.title,
      tldr: `${l.tldr} ${h.attempts} attempt(s) from ${h.actors.size} user(s)/device(s). Check that none of them worked.`,
      evidence: [
        `${h.attempts} matching event(s) between ${t(h.first)} and ${t(h.last)}`,
        `Events: ${evs}`,
        `Fields: ${[...h.fields].slice(0, 6).join(', ')}`,
        ...h.samples.map((s) => `Sample: ${s}`),
        ...(opts.truncated ? [`Only the latest ${opts.scanned} events were scanned in this period; there may be more attempts.`] : [])
      ],
      confidence: Math.min(0.98, 0.75 + Math.min(0.2, h.attempts / 50) + (h.actors.size > 1 ? 0.03 : 0)),
      plan: l.fix,
      locked: true
    });
  }
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
