/**
 * Accepts an AI configuration pasted in almost any form (Python/JS OpenAI client code, JSON, YAML,
 * .env, curl) and extracts an OpenAI-compatible endpoint. Works for cloud APIs and local models
 * (Ollama, LM Studio, vLLM). The API key is moved to encrypted storage and removed from the text.
 */
export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string | null;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
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
  } else {
    cfg.baseUrl = pick(t, ['base_url', 'baseURL', 'baseUrl', 'api_base', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'endpoint']) ?? undefined;
    cfg.apiKey = pick(t, ['api_key', 'apiKey', 'OPENAI_API_KEY', 'API_KEY']);
    cfg.model = pick(t, ['model', 'OPENAI_MODEL', 'MODEL']) ?? undefined;
    cfg.temperature = num(pick(t, ['temperature']));
    cfg.topP = num(pick(t, ['top_p', 'topP']));
    cfg.maxTokens = num(pick(t, ['max_tokens', 'maxTokens', 'max_completion_tokens']));
    // curl -H "Authorization: Bearer KEY" https://host/v1/chat/completions
    const bearer = /Authorization:\s*Bearer\s+([^\s"']+)/i.exec(t);
    if (!cfg.apiKey && bearer) cfg.apiKey = bearer[1];
    const curlUrl = /curl[^\n]*?(https?:\/\/[^\s"']+)/i.exec(t);
    if (!cfg.baseUrl && curlUrl) cfg.baseUrl = curlUrl[1].replace(/\/chat\/completions\/?$/, '');
    if (!cfg.model) {
      const m = /"model"\s*:\s*"([^"]+)"/.exec(t);
      if (m) cfg.model = m[1];
    }
  }
  if (cfg.baseUrl) cfg.baseUrl = cfg.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (cfg.apiKey && isPlaceholderKey(cfg.apiKey)) {
    warnings.push('The pasted key looks like a placeholder, so the key from the basic fields will be used.');
    cfg.apiKey = null;
  }
  if (cfg.baseUrl && !/^https?:\/\//i.test(cfg.baseUrl)) {
    warnings.push(`"${cfg.baseUrl}" is not a web address.`);
    cfg.baseUrl = undefined;
  }
  if (!cfg.baseUrl) warnings.push('No base URL found in the pasted configuration (the official OpenAI address will be assumed).');
  if (!cfg.model) warnings.push('No model name found in the pasted configuration.');
  let scrubbed = t;
  if (cfg.apiKey) scrubbed = scrubbed.split(cfg.apiKey).join('<saved securely>');
  return { config: cfg, scrubbed, warnings };
}

export function completeConfig(p: Partial<AiConfig>, fallbackKey: string | null): AiConfig | null {
  if (!p.model) return null;
  return {
    baseUrl: p.baseUrl || 'https://api.openai.com/v1',
    model: p.model,
    apiKey: p.apiKey ?? fallbackKey ?? null,
    temperature: p.temperature ?? null,
    topP: p.topP ?? null,
    maxTokens: p.maxTokens ?? null
  };
}
