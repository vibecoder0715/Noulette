import crypto from 'node:crypto';
import { getDb, newId, kvGet, kvSet } from '../core/db.js';
import { updateSettings } from '../core/settings.js';
import { publicKeyB64, privateKeyFromSeed } from '../core/signing.js';
import { collect } from '../monitor/collector.js';
import { fetchPostHog, fetchGa4, type SourceData } from '../monitor/sources.js';
import { signCloudItem, type CloudItem, type SignedCloudItem } from './sign.js';

/**
 * Cloud worker (bring-your-own-deploy; scaffolded, not shipped as a hosted service).
 * Runs the same Collector core on a schedule while the user's PC is off, signs every plan item,
 * and serves them to the desktop app. It never sees a local repository.
 *
 * Environment:
 *   NOULETTE_CLOUD_TOKEN         bearer token clients must send (required)
 *   NOULETTE_CLOUD_SIGNING_SEED  base64 32-byte Ed25519 seed (required); pin its public key in the desktop app
 *   NOULETTE_POSTHOG_KEY, NOULETTE_POSTHOG_HOST, NOULETTE_POSTHOG_PROJECT
 *   NOULETTE_GA4_SERVICE_ACCOUNT, NOULETTE_GA4_PROPERTY
 *   NOULETTE_AI_BASE_URL, NOULETTE_AI_MODEL, NOULETTE_AI_API_KEY
 *   NOULETTE_INTERVAL_MIN (default 30), NOULETTE_PLANNED_USERS, NOULETTE_PROJECT_NAME, PORT (default 8787)
 */
export function cloudConfigFromEnv(env = process.env) {
  const token = env.NOULETTE_CLOUD_TOKEN ?? '';
  const seed = env.NOULETTE_CLOUD_SIGNING_SEED ?? '';
  if (token.length < 24) throw new Error('NOULETTE_CLOUD_TOKEN must be set (24+ characters).');
  privateKeyFromSeed(seed);
  return {
    token, seed,
    port: Number(env.PORT || 8787),
    intervalMin: Math.max(5, Number(env.NOULETTE_INTERVAL_MIN || 30)),
    plannedUsers: env.NOULETTE_PLANNED_USERS ? Number(env.NOULETTE_PLANNED_USERS) : null,
    project: env.NOULETTE_PROJECT_NAME || 'app'
  };
}

function ensureTable() {
  getDb().exec('CREATE TABLE IF NOT EXISTS cloud_items (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, body TEXT NOT NULL, decision TEXT)');
}

export function storeItem(s: SignedCloudItem): void {
  ensureTable();
  getDb().query('INSERT INTO cloud_items(id, created_at, body) VALUES (?,?,?)').run(s.item.id, s.item.createdAt, JSON.stringify(s));
}

export function itemsSince(since: number): SignedCloudItem[] {
  ensureTable();
  return (getDb().query('SELECT body FROM cloud_items WHERE created_at > ? ORDER BY created_at LIMIT 200').all(since) as any[]).map((r) => JSON.parse(r.body));
}

export async function cloudPass(cfg: ReturnType<typeof cloudConfigFromEnv>, fetchers?: (() => Promise<SourceData>)[], now = Date.now()): Promise<SignedCloudItem | null> {
  const env = process.env;
  updateSettings({
    inspector: {
      posthog: { enabled: !!env.NOULETTE_POSTHOG_KEY, host: env.NOULETTE_POSTHOG_HOST || 'https://us.posthog.com', projectId: env.NOULETTE_POSTHOG_PROJECT || '' },
      ga4: { enabled: !!env.NOULETTE_GA4_SERVICE_ACCOUNT, propertyId: env.NOULETTE_GA4_PROPERTY || '' }
    },
    ai: { baseUrl: env.NOULETTE_AI_BASE_URL || '', model: env.NOULETTE_AI_MODEL || '' }
  });
  const last = kvGet<number>('cloud:lastEnd', now - cfg.intervalMin * 60_000);
  const from = Math.max(last, now - 7 * 86400_000);
  const f = fetchers ?? [
    ...(env.NOULETTE_POSTHOG_KEY ? [() => fetchPostHog(from, now)] : []),
    ...(env.NOULETTE_GA4_SERVICE_ACCOUNT ? [() => fetchGa4(from, now)] : [])
  ];
  const r = await collect({ key: `cloud:${cfg.project}`, from, to: now, fetchers: f, plannedUsers: cfg.plannedUsers, useAi: true });
  if (r.sources.length) kvSet('cloud:lastEnd', now);
  if (!r.warnings.length) return null;
  const item: CloudItem = { id: newId('cld'), kind: 'logs', createdAt: now, project: cfg.project, title: `Early warnings: ${cfg.project}`, summary: r.warnings.map((w) => w.title).join(', '), warnings: r.warnings, window: r.window };
  const signed = signCloudItem(item, cfg.seed);
  storeItem(signed);
  return signed;
}

export function cloudFetchHandler(cfg: ReturnType<typeof cloudConfigFromEnv>) {
  const pub = publicKeyB64(privateKeyFromSeed(cfg.seed));
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === '/health') return Response.json({ ok: true });
    if (url.pathname === '/pubkey') return Response.json({ publicKey: pub });
    const auth = req.headers.get('authorization') ?? '';
    const given = Buffer.from(auth.replace(/^Bearer /, ''));
    const want = Buffer.from(cfg.token);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (url.pathname === '/items' && req.method === 'GET') return Response.json({ items: itemsSince(Number(url.searchParams.get('since') || 0)) });
    const m = /^\/items\/([\w-]+)\/decision$/.exec(url.pathname);
    if (m && req.method === 'POST') {
      const body: any = await req.json().catch(() => ({}));
      if (!['approved', 'rejected'].includes(body.decision)) return Response.json({ error: 'decision must be approved or rejected' }, { status: 400 });
      ensureTable();
      getDb().query('UPDATE cloud_items SET decision=? WHERE id=?').run(body.decision, m[1]);
      return Response.json({ ok: true });
    }
    if (url.pathname === '/approved' && req.method === 'GET') {
      ensureTable();
      // Agent tool calls on the cloud host: only items a human approved, still carrying their signature.
      return Response.json({ items: (getDb().query("SELECT body FROM cloud_items WHERE decision='approved'").all() as any[]).map((r) => JSON.parse(r.body)) });
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  };
}

export async function startCloudWorker(): Promise<void> {
  const cfg = cloudConfigFromEnv();
  Bun.serve({ port: cfg.port, hostname: '0.0.0.0', fetch: cloudFetchHandler(cfg) });
  console.error(`noulette cloud worker on :${cfg.port}, public key ${publicKeyB64(privateKeyFromSeed(cfg.seed))}`);
  const loop = async () => {
    try {
      await cloudPass(cfg);
    } catch (e) {
      console.error('cloud pass failed', e);
    }
  };
  await loop();
  setInterval(loop, cfg.intervalMin * 60_000);
}
