import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export function buildSidecar(destPath?: string): boolean {
  const rootDir = process.cwd();
  const entryPath = path.join(rootDir, 'packages', 'engine', 'src', 'cli', 'index.ts');
  const engineDistDir = path.join(rootDir, 'packages', 'engine', 'dist');
  if (!fs.existsSync(engineDistDir)) {
    fs.mkdirSync(engineDistDir, { recursive: true });
  }

  const primaryOutFile = path.join(engineDistDir, process.platform === 'win32' ? 'noulette-engine.exe' : 'noulette-engine');

  if (!fs.existsSync(entryPath)) {
    console.error(`Error: CLI entrypoint not found at ${entryPath}`);
    return false;
  }

  console.log(`Building compiled engine sidecar binary from ${entryPath} -> ${primaryOutFile}...`);

  if (fs.existsSync(primaryOutFile)) {
    try {
      fs.unlinkSync(primaryOutFile);
    } catch {}
  }

  try {
    const cmd = `bun build --compile "${entryPath}" --outfile "${primaryOutFile}"`;
    execSync(cmd, { stdio: 'inherit', cwd: rootDir });
    console.log(`Successfully built engine binary at: ${primaryOutFile}`);

    // Also mirror to dist/ if dist folder exists or custom destPath provided
    const outDir = path.join(rootDir, 'dist');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const mirrorOut = destPath || path.join(outDir, process.platform === 'win32' ? 'noulette-engine.exe' : 'noulette-engine');
    fs.copyFileSync(primaryOutFile, mirrorOut);

    return true;
  } catch (err: any) {
    console.error(`Failed to build sidecar binary: ${err.message}`);
    return false;
  }
}

if ((import.meta as any).main) {
  const ok = buildSidecar();
  if (!ok) {
    process.exit(1);
  }
}
