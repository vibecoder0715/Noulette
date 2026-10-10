import crypto from 'node:crypto';
import { getSecret, setSecret } from './secrets.js';

/**
 * Ed25519 signing for approvals (local key) and cloud items (cloud key).
 * Keys are 32-byte seeds; the local seed is stored DPAPI-encrypted.
 */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function privateKeyFromSeed(seedB64: string): crypto.KeyObject {
  const seed = Buffer.from(seedB64, 'base64');
  if (seed.length !== 32) throw new Error('Signing seed must be 32 bytes');
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export function publicKeyB64(priv: crypto.KeyObject): string {
  const der = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }) as Buffer;
  return der.subarray(SPKI_PREFIX.length).toString('base64');
}

export function publicKeyFromB64(pubB64: string): crypto.KeyObject {
  const raw = Buffer.from(pubB64, 'base64');
  if (raw.length !== 32) throw new Error('Public key must be 32 bytes');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

export function generateSeed(): string {
  return crypto.randomBytes(32).toString('base64');
}

/** Deterministic JSON (sorted keys) so signatures are stable across processes. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

export function sign(payload: unknown, priv: crypto.KeyObject): string {
  return crypto.sign(null, Buffer.from(canonical(payload)), priv).toString('base64');
}

export function verify(payload: unknown, signatureB64: string, pub: crypto.KeyObject): boolean {
  try {
    return crypto.verify(null, Buffer.from(canonical(payload)), pub, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/** The local machine's approval key. Created on first use. */
export function localKey(): { priv: crypto.KeyObject; pub: string } {
  let seed = getSecret('signingSeed');
  if (!seed) {
    seed = generateSeed();
    setSecret('signingSeed', seed);
  }
  const priv = privateKeyFromSeed(seed);
  return { priv, pub: publicKeyB64(priv) };
}
