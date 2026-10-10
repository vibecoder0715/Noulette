import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJsonSync } from '../util/atomic-fs.js';

export interface AdvisoryEntry {
  id: string; // CVE-2024-xxx or GHSA-xxx
  package: string;
  ecosystem: string;
  vulnerableVersions: string;
  fixedVersion?: string;
  severity: string;
  // External descriptions are deliberately ignored to prevent injection
  externalDescription?: string;
}

export interface DenylistEntry {
  package: string;
  ecosystem: string;
  reason: string;
  bannedAt: string;
}

export interface DangerNotesResult {
  filePath: string;
  content: string;
  entryCount: number;
}

/**
 * Step 20 — Danger Notes:
 * Generates template-only .noulette/danger-notes.md from CVE/GHSA IDs + denylist.json.
 * NEVER pastes external advisory text to guarantee immunity from prompt injection (TC-114).
 */
export function generateDangerNotes(
  projectPath: string,
  advisories: AdvisoryEntry[] = [],
  denylistEntries: DenylistEntry[] = []
): DangerNotesResult {
  const normProject = path.resolve(projectPath);
  const nouletteDir = path.join(normProject, '.noulette');
  if (!fs.existsSync(nouletteDir)) {
    fs.mkdirSync(nouletteDir, { recursive: true });
  }

  // Load denylist.json if exists
  const denylistPath = path.join(nouletteDir, 'denylist.json');
  let combinedDenylist: DenylistEntry[] = [...denylistEntries];
  if (fs.existsSync(denylistPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(denylistPath, 'utf8'));
      if (Array.isArray(parsed)) {
        combinedDenylist = [...combinedDenylist, ...parsed];
      }
    } catch {}
  }

  // Build markdown using ONLY strict templates
  const lines: string[] = [];
  lines.push('# Danger Notes: Known Vulnerable & Banned Packages');
  lines.push('');
  lines.push('> This document is automatically generated from official security advisories and local denylists.');
  lines.push('> It contains only structured metadata, package names, versions, and security identifiers.');
  lines.push('');

  lines.push('## Active Security Advisories');
  if (advisories.length === 0) {
    lines.push('- No active security advisories recorded.');
  } else {
    for (const adv of advisories) {
      // Validate and clean ID: must match CVE or GHSA or MAL pattern
      const cleanId = String(adv.id).replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanPkg = String(adv.package).replace(/[^a-zA-Z0-9_@/.-]/g, '');
      const cleanEco = String(adv.ecosystem).replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanRange = String(adv.vulnerableVersions).replace(/[\r\n]/g, ' ');
      const cleanFixed = adv.fixedVersion ? String(adv.fixedVersion).replace(/[^a-zA-Z0-9_.-]/g, '') : 'None announced';
      const cleanSev = String(adv.severity).toUpperCase();

      lines.push(`### [${cleanSev}] ${cleanPkg} (${cleanId})`);
      lines.push(`- **Ecosystem:** ${cleanEco}`);
      lines.push(`- **Vulnerable Versions:** ${cleanRange}`);
      lines.push(`- **Fixed Version:** ${cleanFixed}`);
      lines.push('- **Guidance:** Upgrade to the fixed release or remove this package dependency.');
      lines.push('');
    }
  }

  lines.push('## Banned Packages (Local Denylist)');
  if (combinedDenylist.length === 0) {
    lines.push('- No packages currently listed on local denylist.');
  } else {
    for (const b of combinedDenylist) {
      const cleanPkg = String(b.package).replace(/[^a-zA-Z0-9_@/.-]/g, '');
      const cleanEco = String(b.ecosystem).replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanReason = String(b.reason).replace(/[\r\n]/g, ' ');
      lines.push(`- **${cleanPkg}** (${cleanEco}): ${cleanReason}`);
    }
  }

  const content = lines.join('\n') + '\n';
  const filePath = path.join(nouletteDir, 'danger-notes.md');
  fs.writeFileSync(filePath, content, 'utf8');

  // Also persist denylist.json if supplied entries were provided
  if (denylistEntries.length > 0) {
    atomicWriteJsonSync(denylistPath, combinedDenylist);
  }

  return {
    filePath,
    content,
    entryCount: advisories.length + combinedDenylist.length
  };
}
