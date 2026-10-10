/**
 * Accepts an AI configuration pasted in almost any form (Python/JS OpenAI client code, JSON, YAML,
 * .env, curl) and extracts an OpenAI-compatible endpoint. Works for cloud APIs and local models
 * (Ollama, LM Studio, vLLM). The API key is moved to encrypted storage and removed from the text.
 */
/**
 * openai    = OpenAI-compatible /chat/completions (OpenAI, Grafilab /v1, OpenRouter, Groq, Ollama, LM Studio, vLLM, ...)
 * anthropic = Anthropic Messages /v1/messages (Claude, Grafilab's Anthropic surface, other Anthropic-compatible hosts)
 * gemini    = Google Gemini native generateContent
 * azure     = Azure OpenAI deployments (api-key header, api-version)
 */
export type Dialect = 'openai' | 'anthropic' | 'gemini' | 'azure';

export interface AiConfig {
  dialect: Dialect;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  /** Extra request headers (never the key itself). */
  headers: Record<string, string>;
  /** Azure api-version. */
  apiVersion: string | null;
}

const DEFAULT_BASE: Record<Dialect, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  azure: ''
};

/** Guesses the dialect from a base URL and (optionally) the pasted text. */
export function detectDialect(baseUrl: string | undefined, text = ''): Dialect {
  const u = (baseUrl ?? '').toLowerCase();
  const explicit = /["']?\b(?:dialect|provider|api_type|apiType|type)\b["']?\s*[:=]\s*["']?(openai|anthropic|claude|gemini|google|azure)\b/i.exec(text)?.[1]?.toLowerCase();
  if (explicit) return explicit === 'claude' ? 'anthropic' : explicit === 'google' ? 'gemini' : (explicit as Dialect);
  if (/\.openai\.azure\.com|\.cognitiveservices\.azure\.com/.test(u) && !/\/openai\/v1$/.test(u)) return 'azure';
  if (/\bAzureOpenAI\b|azure_endpoint|azureEndpoint|AZURE_OPENAI/.test(text)) return 'azure';
  if (/generativelanguage\.googleapis\.com/.test(u)) return /\/openai\/?$/.test(u) ? 'openai' : 'gemini';
  if (/\bgenai\.Client\b|GoogleGenerativeAI|google\.generativeai|:generateContent/.test(text)) return 'gemini';
  if (/api\.anthropic\.com/.test(u) || /\/v1\/messages\b/.test(u)) return 'anthropic';
  if (/\bAnthropic\s*\(|from anthropic import|@anthropic-ai\/sdk|ANTHROPIC_(API_KEY|BASE_URL)|x-api-key|\/v1\/messages\b|messages\.create\(/.test(text) && !/chat\.completions|\/chat\/completions/.test(text)) return 'anthropic';
  return 'openai';
}

/** Header pairs from default_headers={...}, defaultHeaders: {...}, "headers": {...} or curl -H "Name: value". */
function pickHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const block = /\b(?:default_headers|defaultHeaders|extra_headers|headers)\b["']?\s*[:=]\s*(\{[^}]*\})/i.exec(text)?.[1];
  if (block) for (const m of block.matchAll(/["']([\w-]+)["']\s*:\s*["']([^"']*)["']/g)) out[m[1]] = m[2];
  for (const m of text.matchAll(/(?:-H|--header)\s+["']([\w-]+):\s*([^"']*)["']/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Keys that travel in headers are moved out of `headers` into apiKey. */
function splitKeyHeaders(h: Record<string, string>): { headers: Record<string, string>; key: string | null } {
  const headers: Record<string, string> = {};
  let key: string | null = null;
  for (const [k, v] of Object.entries(h)) {
    const n = k.toLowerCase();
    if (n === 'authorization') key ??= v.replace(/^Bearer\s+/i, '');
    else if (n === 'x-api-key' || n === 'api-key' || n === 'x-goog-api-key') key ??= v;
    else if (n !== 'content-type') headers[k] = v;
  }
  return { headers, key };
}

export interface ParsedConfig {
  config: Partial<AiConfig>;
  /** Text with the key replaced by a placeholder, safe to store in settings. */
  scrubbed: string;
  warnings: string[];
}

const pick = (text: string, keys: string[]): string | null => {
  for (const k of keys) {
    // key = "value" | key: "value" | key="value" | "key": "value" | KEY=value
    const re = new RegExp(`["']?\\b${k}\\b["']?\\s*[:=]\\s*(?:["'\`]([^"'\`\\n]+)["'\`]|([^\\s,;)}\\n]+))`, 'i');
    const m = re.exec(text);
    if (m) return (m[1] ?? m[2]).trim();
  }
  return null;
};

const num = (v: string | null): number | null => {
  if (v === null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function isPlaceholderKey(k: string | null | undefined): boolean {
  if (!k) return true;
  return /^(your[_-]|<|\{|xxx|sk-x+$|changeme|replace|api[_-]?key$|\.\.\.)/i.test(k) || /YOUR_[A-Z_]*KEY/i.test(k) || /os\.environ|process\.env|getenv/i.test(k);
}

export function parseAiConfigText(text: string): ParsedConfig {
  const warnings: string[] = [];
  const t = text.trim();
  const cfg: Partial<AiConfig> = {};
  if (!t) return { config: cfg, scrubbed: '', warnings };
  let json: any = null;
  if (/^[{[]/.test(t)) {
    try {
      json = JSON.parse(t);
    } catch {}
  }
  if (json && typeof json === 'object') {
    const j = Array.isArray(json) ? json[0] : json;
    const flat = { ...j, ...(j.client ?? {}), ...(j.openai ?? {}) };
    cfg.baseUrl = flat.base_url ?? flat.baseURL ?? flat.baseUrl ?? flat.api_base ?? flat.endpoint ?? undefined;
    cfg.apiKey = flat.api_key ?? flat.apiKey ?? flat.key ?? null;
    cfg.model = flat.model ?? undefined;
    cfg.temperature = num(flat.temperature?.toString() ?? null);
    cfg.topP = num((flat.top_p ?? flat.topP)?.toString() ?? null);
    cfg.maxTokens = num((flat.max_tokens ?? flat.maxTokens)?.toString() ?? null);
    cfg.apiVersion = flat.api_version ?? flat.apiVersion ?? null;
    const hs = splitKeyHeaders(Object.fromEntries(Object.entries(flat.headers ?? flat.default_headers ?? flat.defaultHeaders ?? {}).map(([k, v]) => [k, String(v)])));
    cfg.headers = hs.headers;
    cfg.apiKey ??= hs.key;
    cfg.dialect = detectDialect(cfg.baseUrl, t);
  } else {
    cfg.baseUrl = pick(t, ['base_url', 'baseURL', 'baseUrl', 'api_base', 'azure_endpoint', 'azureEndpoint', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'ANTHROPIC_BASE_URL', 'AZURE_OPENAI_ENDPOINT', 'endpoint']) ?? undefined;
    cfg.apiKey = pick(t, ['api_key', 'apiKey', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AZURE_OPENAI_API_KEY', 'API_KEY']);
    cfg.model = pick(t, ['model', 'azure_deployment', 'deployment', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'MODEL']) ?? undefined;
    cfg.temperature = num(pick(t, ['temperature']));
    cfg.topP = num(pick(t, ['top_p', 'topP']));
    cfg.maxTokens = num(pick(t, ['max_tokens', 'maxTokens', 'max_completion_tokens', 'max_output_tokens', 'maxOutputTokens']));
    cfg.apiVersion = pick(t, ['api_version', 'apiVersion', 'OPENAI_API_VERSION', 'api-version']);
    // curl -H "Authorization: Bearer KEY" / -H "x-api-key: KEY" https://host/v1/chat/completions
    const hs = splitKeyHeaders(pickHeaders(t));
    cfg.headers = hs.headers;
    const bearer = /Authorization:\s*Bearer\s+([^\s"']+)/i.exec(t);
    const queryKey = /https?:\/\/[^\s"']*[?&]key=([^&\s"']+)/.exec(t);
    if (!cfg.apiKey) cfg.apiKey = hs.key ?? bearer?.[1] ?? queryKey?.[1] ?? null;
    const curlUrl = /curl[^\n]*?(https?:\/\/[^\s"'\\]+)/i.exec(t);
    if (!cfg.baseUrl && curlUrl) cfg.baseUrl = curlUrl[1];
    if (!cfg.model) {
      const m = /"model"\s*:\s*"([^"]+)"/.exec(t) ?? /\/models\/([^/:?\s"']+):generateContent/.exec(t) ?? /\/deployments\/([^/?\s"']+)\//.exec(t);
      if (m) cfg.model = m[1];
    }
    cfg.dialect = detectDialect(cfg.baseUrl, t);
  }
  if (cfg.baseUrl) cfg.baseUrl = normalizeBase(cfg.dialect ?? 'openai', cfg.baseUrl);
  if (cfg.apiKey && isPlaceholderKey(cfg.apiKey)) {
    warnings.push('The pasted key looks like a placeholder, so the key from the basic fields will be used.');
    cfg.apiKey = null;
  }
  if (cfg.baseUrl && !/^https?:\/\//i.test(cfg.baseUrl)) {
    warnings.push(`"${cfg.baseUrl}" is not a web address.`);
    cfg.baseUrl = undefined;
  }
  if (!cfg.baseUrl) {
    if (cfg.dialect === 'azure') warnings.push('Azure OpenAI needs the endpoint address (https://<name>.openai.azure.com).');
    else warnings.push(`No base URL found in the pasted configuration (${DEFAULT_BASE[cfg.dialect ?? 'openai']} will be assumed).`);
  }
  if (!cfg.model) warnings.push('No model name found in the pasted configuration.');
  let scrubbed = t;
  if (cfg.apiKey) scrubbed = scrubbed.split(cfg.apiKey).join('<saved securely>');
  return { config: cfg, scrubbed, warnings };
}

/** Strips endpoint suffixes so each dialect can append its own path. */
export function normalizeBase(dialect: Dialect, url: string): string {
  let u = url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (dialect === 'openai') u = u.replace(/\/chat\/completions$/, '');
  if (dialect === 'anthropic') u = u.replace(/\/messages$/, '').replace(/\/v1$/, '');
  if (dialect === 'gemini') u = u.replace(/\/models\/[^/]+(:\w+)?$/, '');
  if (dialect === 'azure') u = u.replace(/\/openai\/deployments\/.*$/, '').replace(/\/openai$/, '');
  return u;
}

export function completeConfig(p: Partial<AiConfig>, fallbackKey: string | null): AiConfig | null {
  if (!p.model) return null;
  const dialect = p.dialect ?? detectDialect(p.baseUrl);
  const baseUrl = p.baseUrl ? normalizeBase(dialect, p.baseUrl) : DEFAULT_BASE[dialect];
  if (!baseUrl) return null;
  return {
    dialect,
    baseUrl,
    model: p.model,
    apiKey: p.apiKey ?? fallbackKey ?? null,
    temperature: p.temperature ?? null,
    topP: p.topP ?? null,
    maxTokens: p.maxTokens ?? null,
    headers: p.headers ?? {},
    apiVersion: p.apiVersion ?? null
  };
}
