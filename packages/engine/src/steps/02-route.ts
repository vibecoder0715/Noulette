import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { CaseType } from '../schema/case.schema.js';
import { getProjectsRegistryPath, getQuarantineRoot } from '../util/paths.js';
import { readJsonSync } from '../util/atomic-fs.js';
import type { ProjectsRegistry } from '../schema/config.schema.js';

export interface RouteOptions {
  watcherEvent?: boolean;
  typeHint?: CaseType;
}

export interface RouteResult {
  type: CaseType;
  reason: string;
}

const HARDENED_GIT_ARGS = [
  '-c', 'protocol.ext.allow=never',
  '-c', 'protocol.file.allow=never',
  '-c', 'core.hooksPath=NUL',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.symlinks=false'
].join(' ');

/**
 * Checks if any file in target directory or the directory itself carries a Zone.Identifier ADS.
 */
export function hasZoneIdentifier(targetPath: string): boolean {
  try {
    if (!fs.existsSync(targetPath)) return false;

    // Check directory itself
    const dirZone = `${targetPath}:Zone.Identifier`;
    try {
      if (fs.existsSync(dirZone)) return true;
    } catch {
      // Stream check not supported or throws
    }

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(targetPath, entry.name);
      if (entry.name.includes('Zone.Identifier')) {
        return true;
      }
      try {
        const streamPath = `${fullPath}:Zone.Identifier`;
        if (fs.existsSync(streamPath)) {
          return true;
        }
      } catch {
        // Ignore stream access errors
      }
    }
  } catch {
    // Ignore error
  }
  return false;
}

/**
 * Reads global git user.email.
 */
export function getGlobalGitEmail(): string | null {
  try {
    const out = execSync(`git ${HARDENED_GIT_ARGS} config --global user.email`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function canonicalPath(p: string): string {
  try {
    return fs.realpathSync.native(p).toLowerCase();
  } catch {
    return path.resolve(p).toLowerCase();
  }
}

/**
 * Determines origin route according to Section 3 Step 2 anti-spoofing rules.
 */
export function routeOrigin(targetPath: string, options: RouteOptions = {}): RouteResult {
  const normTarget = path.resolve(targetPath);
  const quarantineRoot = path.resolve(getQuarantineRoot());

  // 1. Under quarantine root -> outside
  if (normTarget.startsWith(quarantineRoot)) {
    return {
      type: 'outside',
      reason: 'quarantined path under quarantine root'
    };
  }

  // 2. .noulette-origin.json marker -> outside
  const originMarker = path.join(normTarget, '.noulette-origin.json');
  if (fs.existsSync(originMarker)) {
    return {
      type: 'outside',
      reason: 'marker file .noulette-origin.json detected'
    };
  }

  // 2b. Clone record in app data (TC-171)
  const clonesRecordPath = path.join(path.dirname(getProjectsRegistryPath()), 'clones.json');
  if (fs.existsSync(clonesRecordPath)) {
    try {
      const clones = JSON.parse(fs.readFileSync(clonesRecordPath, 'utf8'));
      if (Array.isArray(clones)) {
        const isCloned = clones.some(c => c.destination && canonicalPath(c.destination) === canonicalPath(normTarget));
        if (isCloned) {
          return {
            type: 'outside',
            reason: 'clone record in app data'
          };
        }
      }
    } catch {}
  }

  // 3. Zone.Identifier stream on files -> outside ("downloaded")
  if (hasZoneIdentifier(normTarget)) {
    return {
      type: 'outside',
      reason: 'downloaded'
    };
  }

  // 5. Watcher advisory event -> alert
  if (options.watcherEvent || options.typeHint === 'alert') {
    return {
      type: 'alert',
      reason: 'watcher advisory event'
    };
  }

  // 4. Strict Identity & Registration Check (TC-173: canonical path matches symlink/junction/case)
  const registryPath = getProjectsRegistryPath();
  const registry = readJsonSync<ProjectsRegistry>(registryPath, {
    schemaVersion: 1,
    projects: [],
    activeProjectPath: null
  });

  const registeredProject = registry.projects.find(p => canonicalPath(p.path) === canonicalPath(normTarget));

  if (!registeredProject) {
    // Path is not in projects.json
    return {
      type: 'outside',
      reason: 'unknown origin'
    };
  }

  // Check if target is a git repo
  const gitDir = path.join(normTarget, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      type: 'outside',
      reason: 'unknown origin'
    };
  }

  // Check global git config user.email
  const globalEmail = getGlobalGitEmail();

  // Check remote origin
  let remoteOrigin = '';
  try {
    remoteOrigin = execSync(`git ${HARDENED_GIT_ARGS} -C "${normTarget}" remote get-url origin`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    // No remote
  }

  // Extract remote owner from git URL
  // e.g. https://github.com/owner/repo.git or git@github.com:owner/repo.git
  let remoteOwner = '';
  if (remoteOrigin) {
    const httpsMatch = remoteOrigin.match(/[:/]([^/:]+)\/[^/:]+(?:\.git)?$/);
    if (httpsMatch) {
      remoteOwner = httpsMatch[1].toLowerCase();
    }
  }

  // Check against global git user identities
  let remoteOwnerMatches = false;
  if (remoteOwner) {
    if (globalEmail) {
      const emailUser = globalEmail.split('@')[0].toLowerCase();
      if (remoteOwner === emailUser) {
        remoteOwnerMatches = true;
      }
    }
    // Also check global user.name
    try {
      const globalName = execSync(`git ${HARDENED_GIT_ARGS} config --global user.name`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim().toLowerCase();
      if (globalName && remoteOwner === globalName) {
        remoteOwnerMatches = true;
      }
    } catch {
      // ignore
    }
  }

  if (!remoteOwnerMatches) {
    return {
      type: 'outside',
      reason: 'unconfigured remote owner'
    };
  }

  // Check staged diff
  let hasStagedDiff = false;
  try {
    // git diff --staged --quiet exits with 1 if there are staged differences
    execSync(`git ${HARDENED_GIT_ARGS} -C "${normTarget}" diff --staged --quiet`, {
      stdio: 'ignore'
    });
    hasStagedDiff = false;
  } catch {
    // Exit code non-zero indicates staged differences exist
    hasStagedDiff = true;
  }

  if (hasStagedDiff) {
    return {
      type: 'change',
      reason: 'user registered project with staged diff'
    };
  }

  return {
    type: 'outside',
    reason: 'unknown origin'
  };
}
