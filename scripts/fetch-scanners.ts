import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ScannerMeta {
  version: string;
  binary: string;
  url: string;
  license: string;
  sha256: string;
}

export function verifyScannerChecksum(binaryPath: string, expectedHash: string): boolean {
  if (!fs.existsSync(binaryPath)) {
    return false;
  }
  const content = fs.readFileSync(binaryPath);
  const actualHash = crypto.createHash('sha256').update(content).digest('hex');
  return actualHash === expectedHash;
}

export function loadScannerMetadata(): Record<string, ScannerMeta> {
  const rootDir = process.cwd();
  const jsonPath = path.join(rootDir, 'packages', 'engine', 'resources', 'bin', 'scanners.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Scanners config not found at: ${jsonPath}`);
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

export async function fetchAndVerifyScanners(download = false): Promise<boolean> {
  const rootDir = process.cwd();
  const binDir = path.join(rootDir, 'packages', 'engine', 'resources', 'bin');
  const metadata = loadScannerMetadata();

  console.log(`Checking pinned scanners in ${binDir}...`);

  for (const [name, meta] of Object.entries(metadata)) {
    const targetFile = path.join(binDir, meta.binary);
    if (!fs.existsSync(targetFile)) {
      console.log(`[${name}] Binary not present locally: ${meta.binary} (download flag: ${download})`);
      continue;
    }

    const valid = verifyScannerChecksum(targetFile, meta.sha256);
    if (!valid) {
      console.error(`[${name}] Checksum MISMATCH on ${targetFile}! Expected ${meta.sha256}`);
      return false;
    } else {
      console.log(`[${name}] Checksum verified: ${meta.binary}`);
    }
  }

  return true;
}

if ((import.meta as any).main) {
  const shouldDownload = process.argv.includes('--download');
  fetchAndVerifyScanners(shouldDownload).then(ok => {
    if (!ok) process.exit(1);
  });
}
