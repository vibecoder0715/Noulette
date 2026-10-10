import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getGlobalSecretKeyPath } from './paths.js';

export interface KeyPairResult {
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyHex: string;
}

let cachedKeyPair: KeyPairResult | null = null;

/**
 * Gets or creates the global Ed25519 keypair in %APPDATA%\noulette\keys\.
 */
export function getOrCreateSigningKey(): KeyPairResult {
  if (cachedKeyPair) return cachedKeyPair;

  const appDataDir = path.dirname(getGlobalSecretKeyPath());
  const keysDir = path.join(appDataDir, 'keys');
  const privKeyPath = path.join(keysDir, 'ed25519.pem');
  const pubKeyPath = path.join(keysDir, 'pubkey');

  if (fs.existsSync(privKeyPath) && fs.existsSync(pubKeyPath)) {
    try {
      const privateKeyPem = fs.readFileSync(privKeyPath, 'utf8');
      const publicKeyPem = fs.readFileSync(pubKeyPath, 'utf8');
      const pubKeyObj = crypto.createPublicKey(publicKeyPem);
      const exportedRaw = pubKeyObj.export({ type: 'spki', format: 'der' });
      const publicKeyHex = exportedRaw.toString('hex');
      cachedKeyPair = { publicKeyPem, privateKeyPem, publicKeyHex };
      return cachedKeyPair;
    } catch {
      // Regenerate on read error
    }
  }

  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const rawPub = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyHex = rawPub.toString('hex');

  fs.writeFileSync(privKeyPath, privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(pubKeyPath, publicKeyPem, 'utf8');

  cachedKeyPair = { publicKeyPem, privateKeyPem, publicKeyHex };
  return cachedKeyPair;
}

/**
 * Deterministically sorts an object's keys recursively for consistent hashing and signing.
 */
export function canonicalizeJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalizeJson(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalizeJson(obj[k])).join(',') + '}';
}

/**
 * Signs a payload using Ed25519. Excludes the signature property itself if present.
 * Format: `ed25519:<128-hex>`
 */
export function signPayload(payload: Record<string, any>, privateKeyPem?: string): string {
  const priv = privateKeyPem || getOrCreateSigningKey().privateKeyPem;
  const clone = { ...payload };
  delete clone.signature;

  const canonicalString = canonicalizeJson(clone);
  const buffer = Buffer.from(canonicalString, 'utf8');

  const privateKeyObj = crypto.createPrivateKey(priv);
  const sigBuffer = crypto.sign(null, buffer, privateKeyObj);
  const sigHex = sigBuffer.toString('hex').padStart(128, '0');

  return `ed25519:${sigHex}`;
}

/**
 * Verifies an Ed25519 signature on a payload.
 */
export function verifySignature(
  payload: Record<string, any>,
  signature: string,
  publicKeyPem?: string
): boolean {
  if (!signature || !signature.startsWith('ed25519:')) {
    return false;
  }
  const sigHex = signature.slice(8);
  if (sigHex.length !== 128 || !/^[0-9a-fA-F]{128}$/.test(sigHex)) {
    return false;
  }

  const pub = publicKeyPem || getOrCreateSigningKey().publicKeyPem;
  const clone = { ...payload };
  delete clone.signature;

  const canonicalString = canonicalizeJson(clone);
  const buffer = Buffer.from(canonicalString, 'utf8');
  const sigBuffer = Buffer.from(sigHex, 'hex');

  try {
    const publicKeyObj = crypto.createPublicKey(pub);
    return crypto.verify(null, buffer, publicKeyObj, sigBuffer);
  } catch {
    return false;
  }
}
