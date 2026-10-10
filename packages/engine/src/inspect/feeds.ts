import fs from 'node:fs';
import { dataPath } from '../core/paths.js';

/**
 * Rule/advisory feeds pulled directly by the client:
 *  - OSV + GHSA: queried live by osv-scanner on every scan (api.osv.dev aggregates GHSA).
 *  - CISA KEV: downloaded at most once a day and cached; used to flag actively exploited CVEs.
 */
export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

interface KevCache {
  fetchedAt: number;
  cves: string[];
}

export async function loadKev(opts: { offline?: boolean; fetchImpl?: typeof fetch } = {}): Promise<{ cves: Set<string>; fetchedAt: number | null; fresh: boolean }> {
  const file = dataPath('feeds', 'kev.json');
  let cache: KevCache | null = null;
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const stale = !cache || Date.now() - cache.fetchedAt > 24 * 3600_000;
  if (stale && !opts.offline && process.env.NOULETTE_OFFLINE !== '1') {
    try {
      const res = await (opts.fetchImpl ?? fetch)(KEV_URL, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const j: any = await res.json();
        const cves = (j.vulnerabilities ?? []).map((v: any) => String(v.cveID)).filter(Boolean);
        if (cves.length) {
          cache = { fetchedAt: Date.now(), cves };
          fs.writeFileSync(file, JSON.stringify(cache));
        }
      }
    } catch {
      // Offline: keep using the cached copy.
    }
  }
  return { cves: new Set(cache?.cves ?? []), fetchedAt: cache?.fetchedAt ?? null, fresh: !!cache && Date.now() - cache.fetchedAt < 24 * 3600_000 };
}
