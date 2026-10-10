import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { buildSidecar } from './build-sidecar.js';

export function buildAllDownloadables(): boolean {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  console.log('--- 1. Building engine payload ---');
  const okEngine = buildSidecar();
  if (!okEngine) {
    console.error('Failed to build engine payload.');
    return false;
  }

  console.log('\n--- 2. Building frontend production bundle (Vite) ---');
  const desktopDir = path.join(rootDir, 'apps', 'desktop');
  execSync('bun run build', { cwd: desktopDir, stdio: 'inherit' });

  console.log('\n--- 3. Compiling unified release executable (Rust/Tauri) ---');
  const tauriDir = path.join(desktopDir, 'src-tauri');
  execSync('cargo build --release', { cwd: tauriDir, stdio: 'inherit' });

  const releaseExe = path.join(tauriDir, 'target', 'release', 'noulette-desktop.exe');
  if (fs.existsSync(releaseExe)) {
    const mainApp = path.join(distDir, 'noulette.exe');
    fs.copyFileSync(releaseExe, mainApp);

    // Clean up redundant duplicate desktop binary if present
    const redundantDesktop = path.join(distDir, 'noulette-desktop.exe');
    if (fs.existsSync(redundantDesktop)) {
      try { fs.unlinkSync(redundantDesktop); } catch {}
    }

    // Ensure strictly ONLY ONE unified executable exists in dist/ (noulette.exe)
    const sidecarBinary = path.join(distDir, 'noulette-engine.exe');
    if (fs.existsSync(sidecarBinary)) {
      try { fs.unlinkSync(sidecarBinary); } catch {}
    }

    console.log(`\nMain unified downloadable created:\n  - ${mainApp}`);
  } else {
    console.warn(`Warning: Release executable not found at ${releaseExe}`);
  }

  // Copy MSI installer if available
  const msiDir = path.join(tauriDir, 'target', 'release', 'bundle', 'msi');
  if (fs.existsSync(msiDir)) {
    const msiFiles = fs.readdirSync(msiDir).filter(f => f.endsWith('.msi'));
    if (msiFiles.length > 0) {
      const latestMsi = path.join(msiDir, msiFiles[0]);
      const destMsi = path.join(distDir, 'noulette-setup.msi');
      fs.copyFileSync(latestMsi, destMsi);
      console.log(`Windows MSI Installer created:\n  - ${destMsi}`);
    }
  }

  console.log('\nDownloadables in dist/ folder:');
  for (const file of fs.readdirSync(distDir)) {
    const stat = fs.statSync(path.join(distDir, file));
    console.log(`  - ${file} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
  }
  return true;
}

if ((import.meta as any).main) {
  const ok = buildAllDownloadables();
  if (!ok) process.exit(1);
}
