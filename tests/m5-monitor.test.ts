import { describe, it, expect, afterAll, beforeEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, tempDir, writeFiles, rm } from './helpers.ts';
import '../packages/engine/src/features.ts';
import { parseAiConfigText } from '../packages/engine/src/monitor/aiconfig.ts';
import { chatJson, testAi } from '../packages/engine/src/monitor/llm.ts';
import { redact } from '../packages/engine/src/core/redact.ts';
import { runMonitor, monitorTick, getMonitorStatus } from '../packages/engine/src/monitor/index.ts';
import { getApprovedLogPlans } from '../packages/engine/src/monitor/logplans.ts';
import { evaluate } from '../packages/engine/eval/run-eval.ts';
import { updateSettings, getSettings } from '../packages/engine/src/core/settings.ts';
import { setSecret, getSecret } from '../packages/engine/src/core/secrets.ts';
import { registerProject } from '../packages/engine/src/core/projects.ts';
import { writePlan } from '../packages/engine/src/inspect/plan.ts';
import { listApprovals, listNotifications, decideApproval } from '../packages/engine/src/core/events.ts';
import { routes } from '../packages/engine/src/daemon/api.ts';
import { generateSeed, privateKeyFromSeed, publicKeyB64 } from '../packages/engine/src/core/signing.ts';
import { cloudPass, cloudFetchHandler } from '../packages/engine/src/cloud/worker.ts';
import { syncCloud } from '../packages/engine/src/cloud/sync.ts';
import { getDb } from '../packages/engine/src/core/db.ts';
import { normalizePostHog, posthogKeyProblem } from '../packages/engine/src/monitor/sources.ts';
import { scanEvents } from '../packages/engine/src/monitor/attacks.ts';
import { checklist } from '../packages/engine/src/inspect/checklists.ts';
import { validateSubmission } from '../packages/engine/src/inspect/agent-schema.ts';

const cleanup: string[] = [];
const servers: { stop: (f?: boolean) => void }[] = [];
afterAll(() => {
  servers.forEach((s) => s.stop(true));
  cleanup.forEach(rm);
});

const GRAFILAB = `from openai import OpenAI

client = OpenAI(

    api_key="YOUR_GRAFILAB_API_KEY",

    base_url="https://llm.grafilab.ai/v1"

)

response = client.chat.completions.create(

    model="xiaomi/mimo-v2.5-pro",

    temperature=1,

    top_p=0.95

)`;

/** Fake OpenAI-compatible server. `mode` controls the answer. */
function fakeAi(mode: 'ok' | '401' | 'nojsonmode') {
  const calls: any[] = [];
  const s = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      calls.push({ body, auth: req.headers.get('authorization') });
      if (mode === '401') return Response.json({ error: { message: 'Invalid API key' } }, { status: 401 });
      if (mode === 'nojsonmode' && body.response_format) return Response.json({ error: { message: 'response_format not supported' } }, { status: 400 });
      const isTest = JSON.stringify(body.messages).includes('"ok": true');
      const content = isTest ? '{"ok": true}' : '```json\n{"warnings":[{"index":0,"plan":"Roll back the last release and add a null check in checkout.","explanation":"x"}],"digest":"Errors jumped after a release."}\n```';
      return Response.json({ choices: [{ message: { role: 'assistant', content } }] });
    }
  });
  servers.push(s);
  return { url: `http://127.0.0.1:${s.port}/v1`, calls };
}

/** Fake PostHog query API. */
function fakePostHog(state: { errRate: number; events: number; exceptions: any[]; status?: number; raw?: any[][] }) {
  const queries: string[] = [];
  const s = Bun.serve({
    port: 0,
    async fetch(req) {
      if (state.status) return Response.json({ detail: 'Invalid personal API key.' }, { status: state.status });
      if (req.headers.get('authorization') !== 'Bearer phx_testkey') return Response.json({ detail: 'auth' }, { status: 401 });
      const body: any = await req.json();
      const q: string = body.query.query;
      queries.push(q);
      const from = Date.parse(/toDateTime\('([^']+)'\)/.exec(q)![1].replace(' ', 'T') + 'Z');
      const to = Date.parse([...q.matchAll(/toDateTime\('([^']+)'\)/g)][1][1].replace(' ', 'T') + 'Z');
      if (q.includes('toStartOfInterval')) {
        const rows = [];
        for (let t = from - (from % 300_000); t < to; t += 300_000) rows.push([t / 1000, state.events, Math.round(state.events * state.errRate), 20]);
        return Response.json({ results: rows });
      }
      if (q.includes('$exception_type')) return Response.json({ results: state.exceptions });
      if (q.includes('ORDER BY timestamp DESC')) return Response.json({ results: state.raw ?? [] });
      return Response.json({ results: [[60]] });
    }
  });
  servers.push(s);
  return { url: `http://127.0.0.1:${s.port}`, queries };
}

describe('M5 AI configuration', () => {
  beforeEach(() => cleanup.push(tempHome()));

  it('TC-M5-01 accepts the pasted Python example and other formats', () => {
    const p = parseAiConfigText(GRAFILAB);
    expect(p.config.baseUrl).toBe('https://llm.grafilab.ai/v1');
    expect(p.config.model).toBe('xiaomi/mimo-v2.5-pro');
    expect(p.config.temperature).toBe(1);
    expect(p.config.topP).toBe(0.95);
    expect(p.config.apiKey).toBeNull();
    expect(p.warnings.join()).toMatch(/placeholder/);
    expect(parseAiConfigText('{"base_url":"http://localhost:11434/v1","model":"llama3.1:8b"}').config.model).toBe('llama3.1:8b');
    const env = parseAiConfigText('OPENAI_BASE_URL=http://localhost:1234/v1\nOPENAI_API_KEY=lm-studio-key-123\nOPENAI_MODEL=qwen2.5-7b');
    expect(env.config).toMatchObject({ baseUrl: 'http://localhost:1234/v1', apiKey: 'lm-studio-key-123', model: 'qwen2.5-7b' });
    expect(env.scrubbed).not.toContain('lm-studio-key-123');
    const js = parseAiConfigText('const client = new OpenAI({ apiKey: "sk-abc123def456", baseURL: "https://api.example.com/v1" });\nawait client.chat.completions.create({ model: "gpt-x" })');
    expect(js.config).toMatchObject({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-abc123def456', model: 'gpt-x' });
    const curl = parseAiConfigText('curl https://api.example.com/v1/chat/completions -H "Authorization: Bearer sk-zzz999yyy" -d \'{"model": "m1"}\'');
    expect(curl.config).toMatchObject({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-zzz999yyy', model: 'm1' });
  });

  it('TC-M5-02 tries the pasted configuration first, then the basic fields; reports both errors', async () => {
    const bad = fakeAi('401');
    const good = fakeAi('ok');
    updateSettings({ ai: { configText: `client = OpenAI(api_key="sk-file-key-1234", base_url="${bad.url}")\nmodel="m-file"`, baseUrl: good.url, model: 'm-basic' } });
    setSecret('aiFileKey', 'sk-file-key-1234');
    setSecret('aiApiKey', 'sk-basic-key-5678');
    const r = await testAi();
    expect(r.used).toBe('basic');
    expect(bad.calls[0].auth).toBe('Bearer sk-file-key-1234');
    expect(good.calls[0].body.model).toBe('m-basic');
    updateSettings({ ai: { baseUrl: bad.url } });
    await expect(chatJson([{ role: 'user', content: 'x' }])).rejects.toThrow(/Pasted configuration: .*401.*\| Basic fields: .*401/);
    // Error is shown in Notifications too.
    const h = routes.find((x) => x.pattern.test('/api/monitor/test-ai'))!;
    await expect(Promise.resolve(h.handler({ body: {}, params: {}, query: new URLSearchParams() }))).rejects.toThrow(/401/);
    expect(listNotifications().main.some((n) => n.kind === 'monitor-error' && /AI connection test failed/.test(n.body))).toBe(true);
  });

  it('TC-M5-03 grafilab example + temperature/top_p are sent; local servers without JSON mode still work', async () => {
    const ai = fakeAi('nojsonmode');
    updateSettings({ ai: { configText: GRAFILAB.replace('https://llm.grafilab.ai/v1', ai.url), baseUrl: '', model: '' } });
    setSecret('aiApiKey', 'sk-real-key-abc');
    const r = await testAi();
    expect(r).toEqual({ used: 'file', model: 'xiaomi/mimo-v2.5-pro' });
    const last = ai.calls[ai.calls.length - 1];
    expect(last.body.temperature).toBe(1);
    expect(last.body.top_p).toBe(0.95);
    expect(last.auth).toBe('Bearer sk-real-key-abc');
  });

  it('TC-M5-04 a real key in pasted text is moved to encrypted storage and removed from settings', async () => {
    const h = routes.find((x) => x.method === 'POST' && x.pattern.test('/api/settings'))!;
    const out: any = await h.handler({ body: { ai: { configText: 'client = OpenAI(api_key="sk-live-pasted-998877", base_url="https://x.example/v1")\nmodel="m"' } }, params: {}, query: new URLSearchParams() });
    expect(getSettings().ai.configText).not.toContain('sk-live-pasted-998877');
    expect(getSettings().ai.configText).toContain('<saved securely>');
    expect(getSecret('aiFileKey')).toBe('sk-live-pasted-998877');
    expect(out.aiConfigWarnings).toBeUndefined();
  });
});

/** Fake server speaking Anthropic, Gemini and Azure dialects; records path and headers. */
function fakeMultiAi() {
  const calls: { path: string; headers: Record<string, string>; body: any }[] = [];
  const s = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const body: any = await req.json();
      calls.push({ path: u.pathname + u.search, headers: Object.fromEntries(req.headers), body });
      const ok = '{"ok": true}';
      if (u.pathname.endsWith('/v1/messages')) return Response.json({ content: [{ type: 'text', text: ok }] });
      if (u.pathname.includes(':generateContent')) return Response.json({ candidates: [{ content: { parts: [{ text: ok }] } }] });
      if (u.pathname.includes('/openai/deployments/')) return Response.json({ choices: [{ message: { content: ok } }] });
      if (u.pathname.endsWith('/quota/chat/completions')) return Response.json({ error: { code: 'insufficient_quota', message: 'Balance too low' } }, { status: 429 });
      return new Response('not found', { status: 404 });
    }
  });
  servers.push(s);
  return { url: `http://127.0.0.1:${s.port}`, calls };
}

describe('M5 AI dialects', () => {
  beforeEach(() => cleanup.push(tempHome()));

  it('TC-M5-11 Anthropic (Grafilab Anthropic surface), Gemini and Azure configs are detected and called correctly', async () => {
    const f = fakeMultiAi();
    // Anthropic SDK example pointed at Grafilab's Anthropic base URL (no /v1).
    const anth = `import anthropic\nclient = anthropic.Anthropic(api_key="sk-anth-key-1234", base_url="https://llm.grafilab.ai")\nclient.messages.create(model="claude-x", max_tokens=512)`;
    const pa = parseAiConfigText(anth);
    expect(pa.config).toMatchObject({ dialect: 'anthropic', baseUrl: 'https://llm.grafilab.ai', model: 'claude-x', maxTokens: 512, apiKey: 'sk-anth-key-1234' });
    updateSettings({ ai: { configText: anth.replace('https://llm.grafilab.ai', f.url), baseUrl: '', model: '' } });
    setSecret('aiFileKey', 'sk-anth-key-1234');
    expect((await testAi()).used).toBe('file');
    let c = f.calls.at(-1)!;
    expect(c.path).toBe('/v1/messages');
    expect(c.headers['x-api-key']).toBe('sk-anth-key-1234');
    expect(c.headers['anthropic-version']).toBe('2023-06-01');
    expect(c.body.system).toContain('JSON');
    expect(c.body.max_tokens).toBe(512);

    // Gemini native via basic fields with the type chosen.
    updateSettings({ ai: { configText: '', baseUrl: `${f.url}/v1beta`, model: 'gemini-2.5-flash', dialect: 'gemini' } });
    setSecret('aiApiKey', 'gem-key-777');
    await testAi();
    c = f.calls.at(-1)!;
    expect(c.path).toBe('/v1beta/models/gemini-2.5-flash:generateContent');
    expect(c.headers['x-goog-api-key']).toBe('gem-key-777');
    expect(c.body.systemInstruction.parts[0].text).toContain('JSON');

    // Azure OpenAI pasted config.
    const az = `client = AzureOpenAI(azure_endpoint="${f.url}", api_key="az-key-555", api_version="2024-10-21")\nclient.chat.completions.create(model="my-deploy")`;
    updateSettings({ ai: { configText: az, baseUrl: '', model: '', dialect: 'auto' } });
    setSecret('aiFileKey', 'az-key-555');
    await testAi();
    c = f.calls.at(-1)!;
    expect(c.path).toBe('/openai/deployments/my-deploy/chat/completions?api-version=2024-10-21');
    expect(c.headers['api-key']).toBe('az-key-555');

    // Custom headers from curl are kept; the key header is not duplicated into them.
    const curl = parseAiConfigText(`curl https://x.example/v1/messages -H "x-api-key: sk-c-111222" -H "anthropic-beta: tools-1" -d '{"model": "claude-y"}'`);
    expect(curl.config).toMatchObject({ dialect: 'anthropic', baseUrl: 'https://x.example', apiKey: 'sk-c-111222', model: 'claude-y', headers: { 'anthropic-beta': 'tools-1' } });
  });

  it('TC-M5-12 provider error codes become plain advice', async () => {
    const f = fakeMultiAi();
    updateSettings({ ai: { configText: '', baseUrl: `${f.url}/quota`, model: 'm', dialect: 'openai' } });
    await expect(testAi()).rejects.toThrow(/credit balance is too low/);
  });
});

describe('M5 PostHog address and key', () => {
  it('TC-M5-13 accepts any common address form and pulls the project ID from pasted links', () => {
    expect(normalizePostHog('https://us.posthog.com', '657084')).toEqual({ host: 'https://us.posthog.com', projectId: '657084' });
    expect(normalizePostHog('us', '657084').host).toBe('https://us.posthog.com');
    expect(normalizePostHog('EU', '1').host).toBe('https://eu.posthog.com');
    expect(normalizePostHog('https://us.i.posthog.com/', '1').host).toBe('https://us.posthog.com');
    expect(normalizePostHog('https://eu-assets.i.posthog.com', '1').host).toBe('https://eu.posthog.com');
    expect(normalizePostHog('app.posthog.com', '1').host).toBe('https://us.posthog.com');
    expect(normalizePostHog('https://us.posthog.com/project/657084/insights?x=1', '')).toEqual({ host: 'https://us.posthog.com', projectId: '657084' });
    expect(normalizePostHog('https://us.posthog.com', 'https://us.posthog.com/project/657084/web')).toEqual({ host: 'https://us.posthog.com', projectId: '657084' });
    expect(normalizePostHog('http://localhost:8000/', '2')).toEqual({ host: 'http://localhost:8000', projectId: '2' });
  });

  it('TC-M5-14 a project token (phc_) is refused with a plain explanation', async () => {
    cleanup.push(tempHome());
    expect(posthogKeyProblem('phc_abc')).toMatch(/project token.*phx_/);
    expect(posthogKeyProblem('phx_abc')).toBeNull();
    const h = routes.find((x) => x.method === 'POST' && x.pattern.test('/api/secrets'))!;
    expect(() => h.handler({ body: { name: 'posthogKey', value: 'phc_projecttoken' }, params: {}, query: new URLSearchParams() })).toThrow(/Query: Read/);
    const s = routes.find((x) => x.method === 'POST' && x.pattern.test('/api/settings'))!;
    await s.handler({ body: { inspector: { posthog: { host: 'https://us.posthog.com/project/657084/dashboard', projectId: '' } } }, params: {}, query: new URLSearchParams() });
    expect(getSettings().inspector.posthog).toMatchObject({ host: 'https://us.posthog.com', projectId: '657084' });
  });
});

describe('M5 redaction and detectors', () => {
  it('TC-M5-05 sensitive data is redacted before storage or AI', () => {
    const t = redact('user jane.doe@example.com from 203.0.113.7 card 4111 1111 1111 1111 phone +60 12-345 6789 token=abcd1234efgh Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_sig_sig1 key sk_live_51Hx99999999');
    for (const leak of ['jane.doe', '203.0.113.7', '4111 1111', '345 6789', 'abcd1234efgh', 'eyJhbGci', '51Hx9999']) expect(t).not.toContain(leak);
    expect(redact('order 12345 shipped')).toBe('order 12345 shipped');
  });

  it('TC-M5-06 eval set: detectors reach >= 90% precision and recall', () => {
    const r = evaluate();
    expect(r.precision).toBeGreaterThanOrEqual(0.9);
    expect(r.recall).toBeGreaterThanOrEqual(0.9);
  });
});

describe('M5 production monitoring pipeline', () => {
  let project = '';
  let ph: ReturnType<typeof fakePostHog>;
  let state: { errRate: number; events: number; exceptions: any[]; status?: number };
  beforeEach(() => {
    cleanup.push(tempHome());
    project = tempDir('nl-proj-');
    cleanup.push(project);
    writeFiles(project, { 'index.js': '1' });
    writePlan(project, [{ q: 'How many users do you expect in the next 12 months?', a: '1000' }]);
    registerProject(project);
    state = { errRate: 0.004, events: 200, exceptions: [['TypeError', 'Cannot read x', 3]] };
    ph = fakePostHog(state);
    const ai = fakeAi('ok');
    setSecret('posthogKey', 'phx_testkey');
    updateSettings({ productionAnalysis: true, intervalMin: 30, inspector: { posthog: { enabled: true, host: ph.url, projectId: '42' } }, ai: { baseUrl: ai.url, model: 'm' } });
  });

  it('TC-M5-07 normal traffic builds a baseline quietly; an error spike becomes an early warning with evidence, confidence and an AI plan', async () => {
    const day = 86400_000;
    const t0 = Date.UTC(2026, 9, 3, 0, 0);
    getDb().query('INSERT INTO kv(key, value) VALUES (?, ?)').run('monitor:status', JSON.stringify({ lastRunAt: t0, lastWindowEnd: t0, lastError: null, nextRunAt: null, lastWarnings: 0 }));
    const r1 = await runMonitor({ now: t0 + day });
    expect(r1.ok, r1.message).toBe(true);
    expect(r1.result!.warnings.length).toBe(0);
    expect(listApprovals('pending').length).toBe(0);
    state.errRate = 0.2;
    state.exceptions = [['TypeError', 'Cannot read x', 30], ['PaymentError', 'card declined for jane@example.com', 80]];
    updateSettings({ autoApprove: true });
    const r2 = await runMonitor({ now: t0 + day + 30 * 60_000 });
    expect(r2.result!.warnings.map((w) => w.detector)).toEqual(expect.arrayContaining(['error-rate', 'new-error']));
    const ap = listApprovals('pending').find((a) => a.kind === 'logs')!;
    expect(ap).toBeTruthy();
    const w = ap.data.warnings.find((x: any) => x.detector === 'error-rate');
    expect(w.evidence.length).toBeGreaterThan(0);
    expect(w.confidence).toBeGreaterThan(0.5);
    expect(ap.data.warnings[0].plan).toContain('Roll back');
    expect(listNotifications().main.some((n) => n.kind === 'early-warning' && n.alert === 1)).toBe(true);
    const logs = fs.readFileSync(path.join(project, 'LOGS.md'), 'utf8');
    expect(logs).toContain('### Early warnings');
    expect(logs).toContain('Evidence:');
    expect(logs).not.toContain('jane@example.com');
    expect(logs).toContain('[EMAIL]');
    // Plans from logs are never auto-approved, and the agent sees nothing until a human approves.
    expect(getApprovedLogPlans(project).data).toEqual([]);
    decideApproval(ap.id, 'approved');
    expect((getApprovedLogPlans(project).data as any[]).length).toBe(1);
  });

  it('TC-M5-08 scheduler honours on/off and the interval; after sleep one coalesced catch-up pass', async () => {
    const now = Date.UTC(2026, 9, 10, 12, 0);
    updateSettings({ productionAnalysis: false });
    expect(await monitorTick(now)).toBe(false);
    updateSettings({ productionAnalysis: true, intervalMin: 30 });
    getDb().query('INSERT OR REPLACE INTO kv(key, value) VALUES (?, ?)').run('monitor:status', JSON.stringify({ lastRunAt: now - 10 * 60_000, lastWindowEnd: now - 10 * 60_000, lastError: null, nextRunAt: null, lastWarnings: 0 }));
    expect(await monitorTick(now)).toBe(false);
    updateSettings({ intervalMin: 5 });
    expect(await monitorTick(now)).toBe(true);
    // PC was asleep 5 hours: exactly one pass covering the whole gap.
    const before = ph.queries.length;
    const sleptFrom = now - 5 * 3600_000;
    getDb().query('INSERT OR REPLACE INTO kv(key, value) VALUES (?, ?)').run('monitor:status', JSON.stringify({ lastRunAt: sleptFrom, lastWindowEnd: sleptFrom, lastError: null, nextRunAt: null, lastWarnings: 0 }));
    expect(await monitorTick(now + 5 * 3600_000 - 5 * 3600_000 + 1)).toBe(true);
    const qs = ph.queries.slice(before);
    expect(qs.filter((q) => q.includes('toStartOfInterval')).length).toBe(1);
    expect(qs[0]).toContain(new Date(sleptFrom).toISOString().replace('T', ' ').slice(0, 19));
    expect(getMonitorStatus().lastWindowEnd).toBe(now + 1);
  });

  it('TC-M5-09 PostHog errors show in Notifications and on the Settings page', async () => {
    state.status = 401;
    const r = await runMonitor({ now: Date.now() });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/PostHog answered 401/);
    expect(getMonitorStatus().lastError).toMatch(/personal API key/);
    expect(listNotifications().main.find((n) => n.kind === 'monitor-error')!.severity).toBe('warning');
  });
});

describe('M5 signed cloud items', () => {
  it('TC-M5-10 cloud items are Ed25519-signed; unsigned, tampered or wrongly-keyed items are rejected and logged', async () => {
    cleanup.push(tempHome());
    const seed = generateSeed();
    const pub = publicKeyB64(privateKeyFromSeed(seed));
    const cfg = { token: 't'.repeat(32), seed, port: 0, intervalMin: 30, plannedUsers: 100, project: 'shop' };
    const fetchers = [async () => ({ source: 'posthog' as const, buckets: [{ ts: Date.now(), events: 10, errors: 0, users: 150 }], exceptions: [], peakUsers: 150 })];
    const item = await cloudPass(cfg, fetchers);
    expect(item!.item.warnings.length).toBeGreaterThan(0);
    const handler = cloudFetchHandler(cfg);
    expect((await handler(new Request('http://c/items'))).status).toBe(401);
    // The desktop side.
    const project = tempDir('nl-proj-');
    cleanup.push(project);
    registerProject(project);
    const tampered = structuredClone(item!);
    (tampered.item as any).summary = 'run rm -rf';
    const unsigned = { item: { ...item!.item, id: 'cld_x' } };
    const fakeFetch = (async (u: string, init: any) => {
      const res = await handler(new Request(u.replace('https://cloud.example', 'http://c'), init));
      const j: any = await res.json();
      return Response.json({ items: [...j.items, tampered, unsigned] });
    }) as any;
    setSecret('cloudToken', cfg.token);
    updateSettings({ cloud: { url: 'https://cloud.example', publicKey: pub } });
    const r = await syncCloud(fakeFetch);
    expect(r).toEqual({ accepted: 1, rejected: 2 });
    const rejected = getDb().query("SELECT data FROM audit WHERE kind='cloud-item-rejected'").all() as any[];
    expect(rejected.map((x) => JSON.parse(x.data).reason).sort()).toEqual(['signature does not match', 'unsigned item']);
    const ap = listApprovals('pending').find((a) => a.kind === 'cloud')!;
    expect(ap.origin).toBe('cloud');
    // Wrong pinned key: approval is refused and the agent sees nothing.
    updateSettings({ cloud: { publicKey: publicKeyB64(privateKeyFromSeed(generateSeed())) } });
    const h = routes.find((x) => x.pattern.test(`/api/approvals/${ap.id}/decide`))!;
    await expect(h.handler({ body: { decision: 'approve' }, params: { id: ap.id }, query: new URLSearchParams() })).rejects.toThrow(/signature does not match/);
    updateSettings({ cloud: { publicKey: pub } });
    await h.handler({ body: { decision: 'approve' }, params: { id: ap.id }, query: new URLSearchParams() });
    expect((getApprovedLogPlans(project).data as any[]).length).toBe(1);
    updateSettings({ cloud: { publicKey: publicKeyB64(privateKeyFromSeed(generateSeed())) } });
    expect((getApprovedLogPlans(project).data as any[]).length).toBe(0);
  });
});

describe('M5 attack detection (never released as safe)', () => {
  const now = Math.floor(Date.now() / 1000);
  const ev = (event: string, actor: string, props: Record<string, unknown>) => [event, now - 60, actor, JSON.stringify(props)];
  const MOCK_ATTACKS = [
    ev('login_attempt', 'mock-attacker-1', { username: "admin' OR '1'='1' --", password: 'x' }),
    ev('$pageview', 'mock-attacker-1', { $current_url: 'https://shop.example/products?id=1%20UNION%20SELECT%20password%20FROM%20users' }),
    ev('search', 'mock-attacker-2', { q: '&lt;script&gt;alert(document.cookie)&lt;/script&gt;' }),
    ev('file_download', 'mock-attacker-2', { path: '../../../../etc/passwd' }),
    ev('export', 'mock-attacker-3', { filename: 'report.csv; cat /etc/shadow' }),
    ev('api_call', 'mock-attacker-3', { body: { email: { $ne: null }, password: { $ne: null } } }),
    ev('$pageview', 'mock-attacker-3', { $current_url: 'https://shop.example/', $raw_user_agent: 'sqlmap/1.7.2#stable (https://sqlmap.org)' })
  ];
  const BENIGN = [
    ev('$pageview', 'u1', { $current_url: 'https://shop.example/products?id=42&sort=price', $browser: 'Chrome' }),
    ev('search', 'u2', { q: "women's shoes size 7 & 8" }),
    ev('order_placed', 'u3', { note: 'Please deliver before 5pm, ring twice. Thanks!', total: 59.9 }),
    ev('$autocapture', 'u4', { $elements_chain: 'button.btn-primary:text="Buy now"nth-child="1"', $event_type: 'click' })
  ];

  it('TC-M5-15 scanner: mock attacks are caught per type, normal traffic is not flagged', () => {
    const toSample = (r: any[]) => ({ event: r[0], ts: r[1] * 1000, actor: r[2], props: JSON.parse(r[3]) });
    const hits = scanEvents(MOCK_ATTACKS.map(toSample));
    for (const c of ['sql-injection', 'xss', 'path-traversal', 'command-injection', 'nosql-injection', 'scanner']) expect(hits.has(c as any)).toBe(true);
    expect(scanEvents(BENIGN.map(toSample)).size).toBe(0);
    const failed = Array.from({ length: 12 }, () => ({ event: 'login_failed', ts: Date.now(), actor: 'bot-9', props: {} }));
    expect(scanEvents(failed).get('brute-force')?.attempts).toBe(12);
  });

  it('TC-M5-16 pipeline: attacks create alerts, an approval with patch plans, LOGS.md entries, and the AI cannot call it safe', async () => {
    cleanup.push(tempHome());
    const project = tempDir('nl-proj-');
    cleanup.push(project);
    writeFiles(project, { 'index.js': '1' });
    registerProject(project);
    const state = { errRate: 0, events: 50, exceptions: [], raw: [...MOCK_ATTACKS, ...BENIGN] };
    const ph = fakePostHog(state);
    // An AI that tries to say everything is fine and removes the plans.
    const s = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { content: '{"warnings":[{"index":0,"plan":"","explanation":"probably a test"}],"digest":"All quiet and safe. Nothing to do."}' } }] }) });
    servers.push(s);
    setSecret('posthogKey', 'phx_testkey');
    updateSettings({ productionAnalysis: true, intervalMin: 30, inspector: { posthog: { enabled: true, host: ph.url, projectId: '42' } }, ai: { configText: '', baseUrl: `http://127.0.0.1:${s.port}/v1`, model: 'm' } });
    const r = await runMonitor({ forceDigest: true });
    const attacks = r.result!.warnings.filter((w) => w.detector === 'attack');
    expect(attacks.length).toBeGreaterThanOrEqual(6);
    expect(attacks.every((w) => w.plan && w.plan.length > 40 && w.locked)).toBe(true);
    expect(r.message).toMatch(/kind\(s\) of attack attempt found/);
    expect(r.result!.digest).toMatch(/^ATTACK ATTEMPTS DETECTED/);
    const ap = listApprovals('pending').find((a) => a.kind === 'logs');
    expect(ap?.data.warnings.some((w: any) => w.category === 'sql-injection')).toBe(true);
    const alerts = listNotifications().main.filter((n) => n.kind === 'early-warning' && /^Attack on/.test(n.title));
    expect(alerts.length).toBe(attacks.length);
    const logs = fs.readFileSync(path.join(project, 'LOGS.md'), 'utf8');
    expect(logs).toContain('### Attack attempts (never auto-dismissed)');
    expect(logs).toContain('SQL injection attempts');
    expect(logs).toContain('Patch plan: Use parameterized queries');
    expect(logs).not.toContain('No early warnings');
    // Approved plans reach the coding agent with the attack rules.
    decideApproval(ap!.id, 'approved');
    const plans = getApprovedLogPlans(project);
    expect(plans.next).toContain('ATTACK RULES');
    expect((plans.data as any[])[0].warnings.some((w: any) => w.kind === 'attack:sql-injection')).toBe(true);
  });

  it('TC-M5-17 the inspection attacker check (L9) cannot be skipped or waved through', () => {
    const items = checklist('logic', [], { liveApp: false, accounts: 0 });
    expect(items.some((i) => i.id === 'L9')).toBe(true);
    const base = items.map((i) => ({ id: i.id, result: 'ok', note: 'Read the routes and the data layer.' }));
    const sub = (coverage: any[]) => ({ projectPath: process.cwd(), stage: 'logic', pass: 1, coverage, findings: [] });
    const v1: any = validateSubmission(process.cwd(), sub(base.map((c) => (c.id === 'L9' ? { ...c, result: 'not-applicable' } : c))), items);
    expect(v1.errors.join()).toMatch(/L9: "not-applicable" is not allowed/);
    const v2: any = validateSubmission(process.cwd(), sub(base), items);
    expect(v2.errors.join()).toMatch(/L9: "ok" needs a note/);
  });
});
