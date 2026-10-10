/**
 * Downloads the bundled open-source scanners into apps/desktop/src-tauri/resources/scanners
 * and verifies each against a pinned SHA-256. A mismatch aborts the build.
 *
 *   bun run scripts/fetch-scanners.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

interface Pin {
  name: string;
  version: string;
  license: string;
  url: string;
  sha256: string;
  /** For zip assets: the file to extract. */
  extract?: string;
  /** For zip assets that must stay together (exe + DLLs): extract everything into this sub-folder. */
  extractAll?: string;
  out: string;
}

export const PINS: Pin[] = [
  {
    // The core engine (plain OCaml binary + DLLs). The Python-wrapped opengrep_windows_x86.exe is
    // flagged by Microsoft Defender as potentially unwanted, so Noulette drives opengrep-core directly.
    name: 'opengrep', version: 'v1.30.2', license: 'LGPL-2.1',
    url: 'https://github.com/opengrep/opengrep/releases/download/v1.30.2/opengrep-core_windows_x86.zip',
    sha256: '86c405035c33337e8b21d3eb58a46825c951e7fd9982c548a3afc653bca43247', extractAll: 'opengrep', out: 'opengrep/opengrep-core.exe'
  },
  {
    name: 'gitleaks', version: 'v8.30.1', license: 'MIT',
    url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip',
    sha256: 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e', extract: 'gitleaks.exe', out: 'gitleaks.exe'
  },
  {
    name: 'osv-scanner', version: 'v2.6.0', license: 'Apache-2.0',
    url: 'https://github.com/google/osv-scanner/releases/download/v2.6.0/osv-scanner_windows_amd64.exe',
    sha256: 'e0ed7644118b717b028c249ee9d3515024e55e8510747ca08906eb96765354d6', out: 'osv-scanner.exe'
  },
  {
    name: 'askalono', version: '0.5.0', license: 'Apache-2.0',
    url: 'https://github.com/jpeddicord/askalono/releases/download/0.5.0/askalono-Windows.zip',
    sha256: 'cc8a7fcafa61d3463e46bdd785e09907db747c0bd8f07d5b1bbf19a2f335dc14', extract: 'askalono.exe', out: 'askalono.exe'
  }
];

const root = path.resolve(import.meta.dir, '..');
export const SCANNER_DIR = path.join(root, 'apps', 'desktop', 'src-tauri', 'resources', 'scanners');

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function fetchPin(pin: Pin): Promise<void> {
  const target = path.join(SCANNER_DIR, pin.out);
  const stamp = path.join(SCANNER_DIR, `${pin.name}.version`);
  if (fs.existsSync(target) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === `${pin.version} ${pin.sha256}`) {
    console.log(`[${pin.name}] up to date (${pin.version})`);
    return;
  }
  console.log(`[${pin.name}] downloading ${pin.version}...`);
  const res = await fetch(pin.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${pin.name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = sha256(buf);
  if (actual !== pin.sha256) throw new Error(`${pin.name}: checksum mismatch. Expected ${pin.sha256}, got ${actual}`);
  if (pin.extractAll) {
    const tmpZip = path.join(SCANNER_DIR, `${pin.name}.zip`);
    const dest = path.join(SCANNER_DIR, pin.extractAll);
    fs.writeFileSync(tmpZip, buf);
    fs.rmSync(dest, { recursive: true, force: true });
    execFileSync('powershell', ['-NoProfile', '-Command', `$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${dest}' -Force`], { stdio: 'ignore' });
    fs.rmSync(tmpZip, { force: true });
    if (!fs.existsSync(target)) throw new Error(`${pin.name}: ${pin.out} not found after extraction`);
  } else if (pin.extract) {
    const tmpZip = path.join(SCANNER_DIR, `${pin.name}.zip`);
    const tmpDir = path.join(SCANNER_DIR, `${pin.name}.tmp`);
    fs.writeFileSync(tmpZip, buf);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    execFileSync('powershell', ['-NoProfile', '-Command', `$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${tmpDir}' -Force`], { stdio: 'ignore' });
    const found = findFile(tmpDir, pin.extract);
    if (!found) throw new Error(`${pin.name}: ${pin.extract} not found in archive`);
    fs.copyFileSync(found, target);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpZip, { force: true });
  } else {
    fs.writeFileSync(target, buf);
  }
  fs.writeFileSync(stamp, `${pin.version} ${pin.sha256}`);
  console.log(`[${pin.name}] ok`);
}

function findFile(dir: string, name: string): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e.name.toLowerCase() === name.toLowerCase()) return p;
  }
  return null;
}

export async function fetchScanners(): Promise<void> {
  fs.mkdirSync(SCANNER_DIR, { recursive: true });
  for (const pin of PINS) await fetchPin(pin);
  const notice = PINS.map((p) => `${p.name} ${p.version} (${p.license}) ${p.url}`).join('\n');
  fs.writeFileSync(path.join(SCANNER_DIR, 'THIRD_PARTY.txt'), `Bundled scanners, unmodified upstream binaries:\n${notice}\n`);
}

if (import.meta.main) {
  fetchScanners().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
