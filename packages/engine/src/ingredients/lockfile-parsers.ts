import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface PackageEntry {
  name: string;
  version: string;
  ecosystem: 'npm' | 'PyPI';
  isDirect: boolean;
  isDev: boolean;
}

export function parsePackageLockJson(filePath: string): PackageEntry[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(content);
  const packages: PackageEntry[] = [];

  // npm lock v2/v3
  if (json.packages) {
    const rootDeps = { ...json.packages['']?.dependencies, ...json.dependencies };
    const rootDev = { ...json.packages['']?.devDependencies, ...json.devDependencies };

    for (const [pkgPath, info] of Object.entries<any>(json.packages)) {
      if (!pkgPath || pkgPath === '') continue;
      const name = info.name || pkgPath.replace(/^node_modules\//, '');
      const version = info.version || '0.0.0';
      const isDirect = Object.prototype.hasOwnProperty.call(rootDeps, name) || Object.prototype.hasOwnProperty.call(rootDev, name);
      const isDev = !!info.dev || Object.prototype.hasOwnProperty.call(rootDev, name);

      packages.push({
        name,
        version,
        ecosystem: 'npm',
        isDirect,
        isDev
      });
    }
  } else if (json.dependencies) {
    // npm lock v1
    for (const [name, info] of Object.entries<any>(json.dependencies)) {
      packages.push({
        name,
        version: info.version || '0.0.0',
        ecosystem: 'npm',
        isDirect: true,
        isDev: !!info.dev
      });
    }
  }

  return packages;
}

export function parsePnpmLockYaml(filePath: string): PackageEntry[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = YAML.parse(content);
  const packages: PackageEntry[] = [];

  const rawPackages = doc.packages || doc.dependencies || {};
  for (const [key, val] of Object.entries<any>(rawPackages)) {
    // e.g. /lodash@4.17.21 or lodash@4.17.21
    const cleanKey = key.replace(/^\//, '');
    const lastAt = cleanKey.lastIndexOf('@');
    if (lastAt > 0) {
      const name = cleanKey.slice(0, lastAt);
      const version = cleanKey.slice(lastAt + 1);
      packages.push({
        name,
        version,
        ecosystem: 'npm',
        isDirect: !!doc.dependencies?.[name] || !!doc.devDependencies?.[name],
        isDev: !!doc.devDependencies?.[name]
      });
    }
  }

  return packages;
}

export function parseYarnLock(filePath: string): PackageEntry[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const packages: PackageEntry[] = [];

  // Parse lines: e.g. "lodash@^4.17.21":\n  version "4.17.21"
  const blocks = content.split(/\n(?=[^\s])/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const firstLine = trimmed.split('\n')[0];
    const nameMatch = firstLine.match(/^["']?(@?[^@\s:]+)@/);
    const verMatch = trimmed.match(/version\s*[:=]?\s*["']?([^"'\s]+)["']?/);

    if (nameMatch && verMatch) {
      packages.push({
        name: nameMatch[1],
        version: verMatch[1],
        ecosystem: 'npm',
        isDirect: true,
        isDev: false
      });
    }
  }

  return packages;
}

export function parseRequirementsTxt(filePath: string): PackageEntry[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const packages: PackageEntry[] = [];

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;

    const match = trimmed.match(/^([a-zA-Z0-9_\-\.]+)\s*==\s*([a-zA-Z0-9_\-\.]+)/);
    if (match) {
      packages.push({
        name: match[1],
        version: match[2],
        ecosystem: 'PyPI',
        isDirect: true,
        isDev: false
      });
    }
  }

  return packages;
}
