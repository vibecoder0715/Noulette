import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Atomic write helper: writes content to a temp file, fsyncs, then renames.
 */
export function atomicWriteFileSync(filePath: string, content: string | Buffer): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const randSuffix = crypto.randomBytes(6).toString('hex');
  const tempPath = `${filePath}.tmp.${process.pid}.${randSuffix}`;

  try {
    const fd = fs.openSync(tempPath, 'w');
    if (typeof content === 'string') {
      fs.writeFileSync(fd, content, 'utf8');
    } else {
      fs.writeFileSync(fd, content);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
    }
    throw err;
  }
}

/**
 * Safely writes JSON atomically.
 */
export function atomicWriteJsonSync(filePath: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2) + '\n';
  atomicWriteFileSync(filePath, content);
}

/**
 * Safely reads JSON with optional fallback.
 */
export function readJsonSync<T>(filePath: string, fallback?: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      if (fallback !== undefined) return fallback;
      throw new Error(`File does not exist: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}
