import { sign, verify, privateKeyFromSeed, publicKeyB64, publicKeyFromB64 } from '../core/signing.js';

/**
 * Every plan or fix item created by the cloud host carries an Ed25519 signature.
 * The local daemon (and therefore the coding agent, which only reads items through Noulette)
 * verifies it against the public key the user pinned in Settings before acting.
 */
export interface CloudItem {
  id: string;
  kind: 'logs';
  createdAt: number;
  project: string;
  title: string;
  summary: string;
  warnings: unknown[];
  window: { from: number; to: number };
}

export interface SignedCloudItem {
  item: CloudItem;
  signature: string;
  keyId: string;
}

export function signCloudItem(item: CloudItem, seedB64: string): SignedCloudItem {
  const priv = privateKeyFromSeed(seedB64);
  const pub = publicKeyB64(priv);
  return { item, signature: sign(item, priv), keyId: pub.slice(0, 16) };
}

export function verifyCloudItem(s: unknown, pinnedPublicKeyB64: string): { ok: true; item: CloudItem } | { ok: false; reason: string } {
  const x = s as SignedCloudItem;
  if (!x || typeof x !== 'object' || !x.item || typeof x.item !== 'object') return { ok: false, reason: 'malformed item' };
  if (!x.signature) return { ok: false, reason: 'unsigned item' };
  if (!pinnedPublicKeyB64) return { ok: false, reason: 'no cloud public key pinned in Settings' };
  let pub;
  try {
    pub = publicKeyFromB64(pinnedPublicKeyB64);
  } catch {
    return { ok: false, reason: 'pinned public key is invalid' };
  }
  if (!verify(x.item, x.signature, pub)) return { ok: false, reason: 'signature does not match' };
  if (x.item.kind !== 'logs') return { ok: false, reason: `unsupported kind ${String(x.item.kind)}` };
  return { ok: true, item: x.item };
}
