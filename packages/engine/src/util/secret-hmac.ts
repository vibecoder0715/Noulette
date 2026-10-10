import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getGlobalSecretKeyPath } from './paths.js';

let cachedKey: Buffer | null = null;

export function getOrCreateInstallKey(): Buffer {
  if (cachedKey) return cachedKey;

  const keyPath = getGlobalSecretKeyPath();
  if (fs.existsSync(keyPath)) {
    try {
      cachedKey = fs.readFileSync(keyPath);
      return cachedKey;
    } catch {
      // Fall through to regenerate
    }
  }

  const dir = path.dirname(keyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const newKey = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
  cachedKey = newKey;
  return cachedKey;
}

/**
 * Masks a secret string using HMAC-SHA256 with the local install key.
 * Format: prefix + ":" + hmacSha256(installKey, secretBytes)
 * Keeps first 4 chars as prefix if length >= 8, else first 2.
 */
export function maskSecretWithHmac(secret: string): string {
  const installKey = getOrCreateInstallKey();
  const prefixLen = secret.length >= 8 ? 4 : Math.min(2, secret.length);
  const prefix = secret.slice(0, prefixLen);
  const hmac = crypto.createHmac('sha256', installKey).update(secret, 'utf8').digest('hex');
  return `${prefix}:${hmac}`;
}

/**
 * Delimited collision-immune fingerprint for findings:
 * sha256(ruleId + ":" + normalizedPath + ":" + occurrenceIndex + ":" + snippet)
 */
export function computeFindingFingerprint(
  ruleId: string,
  normalizedPath: string,
  occurrenceIndex: number,
  snippet: string
): string {
  const raw = `${ruleId}:${normalizedPath.replace(/\\/g, '/')}:${occurrenceIndex}:${snippet.trim()}`;
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  return `sha256:${hash}`;
}
