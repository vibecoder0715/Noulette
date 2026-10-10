import { getSettings } from '../core/settings.js';
import { getSecret } from '../core/secrets.js';
import { parseAiConfigText, completeConfig, type AiConfig } from './aiconfig.js';

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
    const c = completeConfig({ baseUrl: s.ai.baseUrl || undefined, model: s.ai.model, temperature: s.ai.temperature, topP: s.ai.topP }, basicKey);
    if (c) out.push({ used: 'basic', cfg: c });
  }
  return out;
}

export function aiConfigured(): boolean {
  return aiCandidates().length > 0;
}

async function callOnce(cfg: AiConfig, messages: { role: string; content: string }[], json: boolean): Promise<string> {
  const body: Record<string, unknown> = { model: cfg.model, messages };
  if (cfg.temperature !== null) body.temperature = cfg.temperature;
  if (cfg.topP !== null) body.top_p = cfg.topP;
  if (cfg.maxTokens !== null) body.max_tokens = cfg.maxTokens;
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000)
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text)?.error?.message ?? msg;
    } catch {}
    const hint = res.status === 401 || res.status === 403 ? ' (check the API key)' : res.status === 404 ? ' (check the base URL and model name)' : '';
    throw new AiError(`AI service answered ${res.status}${hint}: ${msg}`);
  }
  const j = JSON.parse(text);
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new AiError('AI service answered without a message.');
  return content;
}

/** Calls the AI and returns parsed JSON. Tries the pasted config, then the basic fields; reports both errors. */
export async function chatJson(messages: { role: string; content: string }[]): Promise<{ used: 'file' | 'basic'; model: string; value: any }> {
  const cands = aiCandidates();
  if (!cands.length) throw new AiError('No AI is set up. Add a configuration or a base URL and model in Settings > Production analysis.');
  const errors: string[] = [];
  for (const c of cands) {
    try {
      let content: string;
      try {
        content = await callOnce(c.cfg, messages, true);
      } catch (e) {
        // Some local servers reject response_format; retry once without it.
        if (e instanceof AiError && /response_format|json_object|400/.test(e.message)) content = await callOnce(c.cfg, messages, false);
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
