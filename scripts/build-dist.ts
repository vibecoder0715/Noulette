/**
 * Builds and Authenticode-signs the single Windows installer (NSIS):
 *  1. download + verify scanners (pinned SHA-256)
 *  2. build the UI
 *  3. copy rule packs and the UI (for "View in Chrome") into Tauri resources
 *  4. compile and sign the engine sidecar
 *  5. tauri build -> dist/Noulette-Setup-<version>.exe (signed + SHA-256 verified)
 *
 * Supported Windows code-signing environment variables:
 *  - Azure Trusted Signing: AZURE_CODESIGN_DLIB and AZURE_CODESIGN_METADATA
 *  - Windows Cert Store / Hardware Token: WINDOWS_CERT_THUMBPRINT
 *  - PFX File: WINDOWS_PFX_PATH and WINDOWS_PFX_PASSWORD
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fetchScanners } from './fetch-scanners.ts';

const root = path.resolve(import.meta.dir, '..');
const desktop = path.join(root, 'apps', 'desktop');
const res = path.join(desktop, 'src-tauri', 'resources');
const bun = process.execPath;
const run = (args: string[], cwd: string, env?: NodeJS.ProcessEnv) =>
  execFileSync(bun, args, { cwd, stdio: 'inherit', env: env ? { ...process.env, ...env } : process.env });

export function signWindowsBinary(filePath: string): boolean {
  if (process.platform !== 'win32' || !fs.existsSync(filePath)) return false;
  const signtool = process.env.SIGNTOOL_PATH || 'signtool.exe';
  const dlib = process.env.AZURE_CODESIGN_DLIB;
  const dlibMeta = process.env.AZURE_CODESIGN_METADATA;
  const thumbprint = process.env.WINDOWS_CERT_THUMBPRINT || process.env.TAURI_SIGNING_WINDOWS_CERTIFICATE_THUMBPRINT;
  const pfxPath = process.env.WINDOWS_PFX_PATH;
  const pfxPassword = process.env.WINDOWS_PFX_PASSWORD;
  const timestampUrl = process.env.WINDOWS_TIMESTAMP_URL || 'http://timestamp.acs.microsoft.com';

  let signArgs: string[] | null = null;
  if (dlib && dlibMeta) {
    signArgs = [
      'sign', '/v', '/debug',
      '/fd', 'SHA256',
      '/tr', timestampUrl,
      '/td', 'SHA256',
      '/dlib', dlib,
      '/dmdf', dlibMeta,
      filePath
    ];
  } else if (thumbprint) {
    signArgs = [
      'sign', '/v',
      '/sha1', thumbprint,
      '/fd', 'SHA256',
      '/tr', timestampUrl,
      '/td', 'SHA256',
      filePath
    ];
  } else if (pfxPath) {
    signArgs = [
      'sign', '/v',
      '/f', pfxPath,
      ...(pfxPassword ? ['/p', pfxPassword] : []),
      '/fd', 'SHA256',
      '/tr', timestampUrl,
      '/td', 'SHA256',
      filePath
    ];
  }

  if (!signArgs) {
    console.warn(`[sign] Skipping Authenticode signing for ${path.basename(filePath)} (no signing credentials configured).`);
    return false;
  }

  console.log(`[sign] Signing ${filePath}...`);
  execFileSync(signtool, signArgs, { stdio: 'inherit' });
  execFileSync(signtool, ['verify', '/pa', '/v', filePath], { stdio: 'inherit' });
  return true;
}

await fetchScanners();
run(['run', 'build'], desktop);
for (const [src, dst] of [[path.join(root, 'rules'), path.join(res, 'rules')], [path.join(desktop, 'dist'), path.join(res, 'ui')]]) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
}
run(['run', path.join(root, 'scripts', 'build-sidecar.ts')], root);

// Sign the compiled sidecar before Tauri bundles it into the NSIS installer
const sidecar = path.join(desktop, 'src-tauri', 'binaries', 'noulette-engine-x86_64-pc-windows-msvc.exe');
signWindowsBinary(sidecar);

// Pass certificate thumbprint through to Tauri if provided
const tauriEnv: NodeJS.ProcessEnv = {};
if (process.env.WINDOWS_CERT_THUMBPRINT && !process.env.TAURI_SIGNING_WINDOWS_CERTIFICATE_THUMBPRINT) {
  tauriEnv.TAURI_SIGNING_WINDOWS_CERTIFICATE_THUMBPRINT = process.env.WINDOWS_CERT_THUMBPRINT;
}

run(['x', 'tauri', 'build'], desktop, tauriEnv);

const version = JSON.parse(fs.readFileSync(path.join(desktop, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
const nsisDir = path.join(desktop, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
// Older installers stay in this folder, so pick the one for this exact version.
const setup = fs.readdirSync(nsisDir).find((f) => f.endsWith('-setup.exe') && f.includes(`_${version}_`));
if (!setup) throw new Error('NSIS installer not found');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const final = path.join(root, 'dist', `Noulette-Setup-${version}.exe`);
fs.copyFileSync(path.join(nsisDir, setup), final);

// Sign the outer NSIS installer executable
signWindowsBinary(final);

// Also copy to dist/Noulette-Setup.exe for the latest release link and emit SHA-256
const latestAlias = path.join(root, 'dist', 'Noulette-Setup.exe');
fs.copyFileSync(final, latestAlias);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(final)).digest('hex');
fs.writeFileSync(`${final}.sha256`, `${sha256}  Noulette-Setup-${version}.exe\n`, 'utf8');
console.log(`installer: ${final} (${(fs.statSync(final).size / 1e6).toFixed(1)} MB)`);
console.log(`sha256: ${sha256}`);
