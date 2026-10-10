/**
 * Removes sensitive data before anything is stored, shown, or sent to an AI:
 * emails, phone numbers, card numbers, IPs, JWTs, bearer tokens, API keys and long secrets.
 */
const RULES: [RegExp, string | ((m: string) => string)][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED JWT]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [REDACTED]'],
  [/\b(sk|pk|rk|phx|phc|ghp|gho|ghs|github_pat|xox[abpr]|AKIA|ASIA|AIza|glpat|hf|whsec|SG)[_-][A-Za-z0-9_-]{8,}/g, (m) => `${m.slice(0, 4)}[REDACTED]`],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED AWS KEY]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\b(?:\d[ -]?){13,19}\b/g, (m) => (luhn(m.replace(/\D/g, '')) ? '[CARD]' : m)],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]'],
  [/\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){5,7}\b/gi, '[IP]'],
  [/\+?\d[\d ().-]{8,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 && m.replace(/\D/g, '').length <= 15 ? '[PHONE]' : m)],
  [/((?:password|passwd|pwd|secret|token|api[_-]?key|apikey|auth|cookie|session)["']?\s*[:=]\s*["']?)[^"'\s,;&}]{4,}/gi, '$1[REDACTED]'],
  [/["'`]([A-Za-z0-9+/_=-]{32,})["'`]/g, (m) => `${m[0]}[REDACTED]${m[m.length - 1]}`]
];

function luhn(d: string): boolean {
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep as any);
  return out;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  return value;
}
