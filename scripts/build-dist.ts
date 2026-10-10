/**
 * Builds the single Windows installer (NSIS, unsigned):
 *   1. download + verify scanners (pinned SHA-256)
 *   2. build the UI
 *   3. copy rule packs and the UI (for "View in Chrome") into Tauri resources
 *   4. compile the engine sidecar
 *   5. tauri build  ->  dist/Noulette-Setup-<version>.exe
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fetchScanners } from './fetch-scanners.ts';

const root = path.resolve(import.meta.dir, '..');
const desktop = path.join(root, 'apps', 'desktop');
const res = path.join(desktop, 'src-tauri', 'resources');
const bun = process.execPath;
const run = (args: string[], cwd: string) => execFileSync(bun, args, { cwd, stdio: 'inherit' });

await fetchScanners();
run(['run', 'build'], desktop);
for (const [src, dst] of [[path.join(root, 'rules'), path.join(res, 'rules')], [path.join(desktop, 'dist'), path.join(res, 'ui')]]) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
}
run(['run', path.join(root, 'scripts', 'build-sidecar.ts')], root);
run(['x', 'tauri', 'build'], desktop);
const version = JSON.parse(fs.readFileSync(path.join(desktop, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
const nsisDir = path.join(desktop, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
// Older installers stay in this folder, so pick the one for this exact version.
const setup = fs.readdirSync(nsisDir).find((f) => f.endsWith('-setup.exe') && f.includes(`_${version}_`));
if (!setup) throw new Error('NSIS installer not found');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const final = path.join(root, 'dist', `Noulette-Setup-${version}.exe`);
fs.copyFileSync(path.join(nsisDir, setup), final);
console.log(`installer: ${final} (${(fs.statSync(final).size / 1e6).toFixed(1)} MB)`);
