import { getSettings } from '../core/settings.js';
import { getSecret } from '../core/secrets.js';
import { parseAiConfigText, completeConfig, detectDialect, type AiConfig } from './aiconfig.js';

export class AiError extends Error {}

/** Candidate configs in order: the pasted configuration first, then the basic fields. */
export function aiCandidates(): { used: 'file' | 'basic'; cfg: AiConfig }[] {
  const s = getSettings();
  const out: { used: 'file' | 'basic'; cfg: AiConfig }[] = [];
  const basicKey = getSecret('aiApiKey');
  if (s.ai.configText.trim()) {
    const p = parseAiConfigText(s.ai.configText);
    const c = completeConfig({ ...p.config, apiKey: getSecret('aiFileKey') ?? p.config.apiKey ?? null }, basicKey);
    if (c) out.push({ used: 'file', cfg: c });
  }
  if (s.ai.model) {
    const dialect = s.ai.dialect && s.ai.dialect !== 'auto' ? s.ai.dialect : detectDialect(s.ai.baseUrl);
    const c = completeConfig({ dialect, baseUrl: s.ai.baseUrl || undefined, model: s.ai.model, temperature: s.ai.temperature, topP: s.ai.topP }, basicKey);
    if (c) out.push({ used: 'basic', cfg: c });
  }
  return out;
}

export function aiConfigured(): boolean {
  return aiCandidates().length > 0;
}

type Msg = { role: string; content: string };

interface Request {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** Pulls the reply text out of the provider's response. */
  read: (j: any) => unknown;
}

/** Builds the HTTP request for each API dialect. */
function buildRequest(cfg: AiConfig, messages: Msg[], json: boolean): Request {
  const base = { 'Content-Type': 'application/json', ...cfg.headers };
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const chat = messages.filter((m) => m.role !== 'system');
  switch (cfg.dialect) {
    case 'anthropic': {
      const body: Record<string, unknown> = { model: cfg.model, max_tokens: cfg.maxTokens ?? 4096, messages: chat.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })) };
      if (system) body.system = json ? `${system}\n\nReply with one JSON object only.` : system;
      if (cfg.temperature !== null) body.temperature = Math.min(cfg.temperature, 1);
      if (cfg.topP !== null) body.top_p = cfg.topP;
      return {
        url: `${cfg.baseUrl}/v1/messages`,
        headers: { ...base, 'anthropic-version': cfg.headers['anthropic-version'] ?? '2023-06-01', ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}) },
        body,
        read: (j) => (Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('') || undefined : undefined)
      };
    }
    case 'gemini': {
      const generationConfig: Record<string, unknown> = {};
      if (cfg.temperature !== null) generationConfig.temperature = cfg.temperature;
      if (cfg.topP !== null) generationConfig.topP = cfg.topP;
      if (cfg.maxTokens !== null) generationConfig.maxOutputTokens = cfg.maxTokens;
      if (json) generationConfig.responseMimeType = 'application/json';
      const body: Record<string, unknown> = { contents: chat.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const model = cfg.model.replace(/^models\//, '');
      return {
        url: `${cfg.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        headers: { ...base, ...(cfg.apiKey ? { 'x-goog-api-key': cfg.apiKey } : {}) },
        body,
        read: (j) => j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') || undefined
      };
    }
    case 'azure':
    case 'openai':
    default: {
      const body: Record<string, unknown> = { model: cfg.model, messages };
      if (cfg.temperature !== null) body.temperature = cfg.temperature;
      if (cfg.topP !== null) body.top_p = cfg.topP;
      if (cfg.maxTokens !== null) body.max_tokens = cfg.maxTokens;
      if (json) body.response_format = { type: 'json_object' };
      const url = cfg.dialect === 'azure'
        ? `${cfg.baseUrl}/openai/deployments/${encodeURIComponent(cfg.model)}/chat/completions?api-version=${encodeURIComponent(cfg.apiVersion ?? '2024-10-21')}`
        : `${cfg.baseUrl}/chat/completions`;
      const auth: Record<string, string> = cfg.apiKey ? (cfg.dialect === 'azure' ? { 'api-key': cfg.apiKey } : { Authorization: `Bearer ${cfg.apiKey}` }) : {};
      return { url, headers: { ...base, ...auth }, body, read: (j) => j?.choices?.[0]?.message?.content };
    }
  }
}

/** Turns provider error bodies into plain advice (includes Grafilab's documented codes). */
function explain(status: number, text: string): string {
  let msg = text.slice(0, 300);
  let code = '';
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0]?.error : j?.error;
    msg = (typeof e === 'string' ? e : e?.message) ?? j?.message ?? msg;
    code = (e?.code ?? e?.type ?? e?.status ?? '').toString();
  } catch {}
  const hint =
    code === 'insufficient_quota' ? ' (your credit balance is too low: top up with your provider)'
      : code === 'billing_currency_unset' ? ' (set a billing country/currency in your provider account)'
        : code === 'model_not_found' ? ' (check the model name; it may be invite-only or not offered in your currency)'
          : status === 401 || status === 403 ? ' (check the API key)'
            : status === 404 ? ' (check the base URL, API type and model name)'
              : status === 429 ? ' (rate limit or quota reached: try again later)'
                : '';
  return `AI service answered ${status}${hint}: ${msg}`;
}

async function callOnce(cfg: AiConfig, messages: Msg[], json: boolean): Promise<string> {
  const req = buildRequest(cfg, messages, json);
  const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(90_000) });
  const text = await res.text();
  if (!res.ok) throw new AiError(explain(res.status, text));
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new AiError('AI service answered with something that is not JSON. Check the base URL and API type.');
  }
  const content = req.read(j);
  if (typeof content !== 'string') throw new AiError('AI service answered without a message.');
  return content;
}

/** Calls the AI and returns parsed JSON. Tries the pasted config, then the basic fields; reports both errors. */
export async function chatJson(messages: Msg[]): Promise<{ used: 'file' | 'basic'; model: string; value: any }> {
  const cands = aiCandidates();
  if (!cands.length) throw new AiError('No AI is set up. Add a configuration or a base URL and model in Settings > Production analysis.');
  const errors: string[] = [];
  for (const c of cands) {
    try {
      let content: string;
      try {
        content = await callOnce(c.cfg, messages, true);
      } catch (e) {
        // Some servers reject JSON mode (response_format / responseMimeType); retry once without it.
        if (e instanceof AiError && /response_format|json_object|responseMimeType|400/.test(e.message)) content = await callOnce(c.cfg, messages, false);
        else throw e;
      }
      const cleaned = content.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
      const start = cleaned.indexOf('{');
      const value = JSON.parse(start >= 0 ? cleaned.slice(start, cleaned.lastIndexOf('}') + 1) : cleaned);
      return { used: c.used, model: c.cfg.model, value };
    } catch (e: any) {
      errors.push(`${c.used === 'file' ? 'Pasted configuration' : 'Basic fields'}: ${e?.name === 'TimeoutError' ? 'no answer within 90 seconds' : e?.message ?? String(e)}`);
    }
  }
  throw new AiError(errors.join(' | '));
}

export async function testAi(): Promise<{ used: 'file' | 'basic'; model: string }> {
  const r = await chatJson([
    { role: 'system', content: 'Reply with JSON only.' },
    { role: 'user', content: 'Return {"ok": true}.' }
  ]);
  return { used: r.used, model: r.model };
}
