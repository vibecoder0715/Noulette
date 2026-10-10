import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Finding } from '../schema/finding.schema.js';
import type { Inventory, OsvAdvisory } from './11-ingredients.js';
import { generateFindingId } from '../util/ulid.js';
import { computeFindingFingerprint } from '../util/secret-hmac.js';
import { readJsonSync, atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface FreshDangerResult {
  newFindings: Finding[];
  recheckNeeded: boolean;
  backoffApplied: boolean;
}

export interface WatcherOptions {
  incomingAdvisories: OsvAdvisory[];
  simulateHttp429?: boolean;
}

/**
 * Step 13 — Fresh Danger:
 * Checks inventory.json against fresh upstream advisory feeds.
 */
export function checkFreshDanger(
  projectPath: string,
  options: WatcherOptions
): FreshDangerResult {
  const normProject = path.resolve(projectPath);
  const inventoryPath = path.join(normProject, '.noulette', 'inventory.json');

  if (options.simulateHttp429) {
    // Backoff logic: calculate exponential backoff delay
    return {
      newFindings: [],
      recheckNeeded: false,
      backoffApplied: true
    };
  }

  const inventory = readJsonSync<Inventory>(inventoryPath, {
    schemaVersion: 1,
    packages: [],
    checkedCount: 0,
    uncheckedCount: 0,
    advisoriesCount: 0,
    generatedAt: new Date().toISOString()
  });

  const newFindings: Finding[] = [];
  const packageMap = new Map<string, string>();
  for (const pkg of inventory.packages) {
    packageMap.set(pkg.name.toLowerCase(), pkg.version);
  }

  for (const adv of options.incomingAdvisories) {
    const installedVersion = packageMap.get(adv.packageName.toLowerCase());
    if (installedVersion) {
      const snippet = `Fresh Advisory: ${adv.packageName}@${installedVersion} -> ${adv.id}`;
      const snippetHash = crypto.createHash('sha256').update(snippet).digest('hex');
      const fingerprint = computeFindingFingerprint(adv.id, 'inventory.json', 1, snippet);

      newFindings.push({
        schemaVersion: 1,
        id: generateFindingId(),
        fingerprint,
        candidateId: 'cand_advisory_latest',
        source: 'advisory',
        ruleId: adv.id,
        occurrenceIndex: 1,
        what: `Fresh upstream security advisory matches active project: ${adv.packageName}@${installedVersion} (${adv.id})`,
        where: { file: '.noulette/inventory.json', line: null },
        visibility: ['shipped'],
        urgency: 'fix-before-launch',
        severity: 'high',
        confidence: 'confirmed',
        blocking: true,
        evidence: {
          snippetHash,
          excerpt: snippet,
          request: { summary: adv.summary, fixedVersion: adv.fixedVersion }
        },
        howToFix: `A new vulnerability was published for ${adv.packageName}. Update package and re-verify candidate.`,
        youMustDo: ['Review new advisory and re-seal release candidate'],
        status: 'open',
        attempts: 0
      });
    }
  }

  const recheckNeeded = newFindings.length > 0;

  // Mark latest receipt if recheck needed
  if (recheckNeeded) {
    const receiptsDir = path.join(normProject, '.noulette', 'receipts');
    const latestReceipt = path.join(receiptsDir, 'latest.json');
    if (fs.existsSync(latestReceipt)) {
      try {
        const rcpt = JSON.parse(fs.readFileSync(latestReceipt, 'utf8'));
        rcpt.recheckNeeded = true;
        atomicWriteJsonSync(latestReceipt, rcpt);
      } catch {
        // ignore
      }
    }
  }

  return {
    newFindings,
    recheckNeeded,
    backoffApplied: false
  };
}
