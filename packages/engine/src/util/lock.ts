import fs from 'node:fs';
import path from 'node:path';

export interface LockOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
  staleMs?: number;
}

export function withLockSync<T>(
  lockFilePath: string,
  fn: () => T,
  options: LockOptions = {}
): T {
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryIntervalMs = options.retryIntervalMs ?? 50;
  const staleMs = options.staleMs ?? 15000;

  const dir = path.dirname(lockFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const startTime = Date.now();
  let acquired = false;

  while (!acquired) {
    try {
      // wx flag: open for writing, fails if file exists
      const fd = fs.openSync(lockFilePath, 'wx');
      const payload = JSON.stringify({ pid: process.pid, time: Date.now() });
      fs.writeFileSync(fd, payload, 'utf8');
      fs.closeSync(fd);
      acquired = true;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Check if existing lock is stale
        try {
          const stats = fs.statSync(lockFilePath);
          if (Date.now() - stats.mtimeMs > staleMs) {
            try {
              fs.unlinkSync(lockFilePath);
              continue;
            } catch {
              // Ignore race condition on unlink
            }
          }
        } catch {
          // stats failed, lock might have been removed
          continue;
        }

        if (Date.now() - startTime > timeoutMs) {
          throw new Error(`Timeout acquiring lock on: ${lockFilePath}`);
        }

        // Sleep synchronously
        const sleepUntil = Date.now() + retryIntervalMs;
        while (Date.now() < sleepUntil) {
          // busy wait small interval
        }
      } else {
        throw err;
      }
    }
  }

  try {
    return fn();
  } finally {
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch {
      // Ignore cleanup error
    }
  }
}
