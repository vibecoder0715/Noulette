/**
 * Compiles the engine (MCP server + daemon + cloud worker) into one Windows exe and places it where
 * Tauri expects the sidecar: src-tauri/binaries/noulette-engine-x86_64-pc-windows-msvc.exe
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dir, '..');
const out = path.join(root, 'packages', 'engine', 'dist', 'noulette-engine.exe');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(process.execPath, ['build', path.join(root, 'packages', 'engine', 'src', 'cli.ts'), '--compile', '--minify', '--target=bun-windows-x64', '--outfile', out], { stdio: 'inherit' });
const sidecar = path.join(root, 'apps', 'desktop', 'src-tauri', 'binaries', 'noulette-engine-x86_64-pc-windows-msvc.exe');
fs.mkdirSync(path.dirname(sidecar), { recursive: true });
fs.copyFileSync(out, sidecar);
console.log(`engine: ${out}\nsidecar: ${sidecar}`);
