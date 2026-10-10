import { kvGet, kvSet, audit } from '../core/db.js';
import { getSettings } from '../core/settings.js';
import { getSecret } from '../core/secrets.js';
import { createApproval, notify } from '../core/events.js';
import { activeProject } from '../core/projects.js';
import { verifyCloudItem } from './sign.js';

/**
 * Pulls plan items from the user's own cloud worker. Each item must carry a valid Ed25519
 * signature from the pinned cloud key; otherwise it is rejected and logged. Accepted items wait
 * in Approvals (never auto-approved).
 */
export async function syncCloud(fetchImpl: typeof fetch = fetch): Promise<{ accepted: number; rejected: number } | null> {
  const s = getSettings().cloud;
  if (!s.url) return null;
  const cursor = kvGet<number>('cloud:cursor', 0);
  const token = getSecret('cloudToken');
  let items: unknown[];
  try {
    const res = await fetchImpl(`${s.url.replace(/\/+$/, '')}/items?since=${cursor}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`cloud worker answered ${res.status}`);
    items = ((await res.json()) as any).items ?? [];
  } catch (e: any) {
    kvSet('cloud:status', { lastSyncAt: Date.now(), error: e.message });
    return null;
  }
  let accepted = 0;
  let rejected = 0;
  let maxTs = cursor;
  for (const raw of items) {
    const v = verifyCloudItem(raw, s.publicKey);
    const created = Number((raw as any)?.item?.createdAt) || 0;
    maxTs = Math.max(maxTs, created);
    if (!v.ok) {
      rejected++;
      audit('cloud-item-rejected', { reason: v.reason, id: (raw as any)?.item?.id ?? null });
      continue;
    }
    const seen = kvGet<string[]>('cloud:seen', []);
    if (seen.includes(v.item.id)) continue;
    kvSet('cloud:seen', [...seen, v.item.id].slice(-2000));
    createApproval({
      project: activeProject()?.path ?? null, kind: 'cloud', origin: 'cloud',
      title: `Cloud: ${v.item.title}`, summary: v.item.summary,
      data: { warnings: v.item.warnings, window: v.item.window, signed: raw }
    });
    accepted++;
  }
  if (rejected) notify({ severity: 'warning', kind: 'cloud-rejected', title: 'Rejected items from the cloud worker', body: `${rejected} item(s) were unsigned or had an invalid signature and were ignored.`, dedupeKey: 'cloud' });
  kvSet('cloud:cursor', maxTs);
  kvSet('cloud:status', { lastSyncAt: Date.now(), error: null, accepted, rejected });
  return { accepted, rejected };
}

export function cloudStatus(): unknown {
  return kvGet('cloud:status', null);
}
