import fs from 'node:fs';
import { dataPath } from './paths.js';

/**
 * Secret storage. On Windows, values are encrypted with DPAPI (CurrentUser scope),
 * so they are unreadable by other Windows accounts and useless if copied off the machine.
 * Environment variables always win, which is how the cloud worker is configured.
 * Secrets are never returned to the UI: only `hasSecret` booleans are exposed.
 */
export type SecretName = 'posthogKey' | 'ga4ServiceAccount' | 'aiApiKey' | 'aiFileKey' | 'cloudToken' | 'signingSeed' | 'apiToken' | 'cloudSigningSeed';

export const SECRET_ENV: Record<SecretName, string> = {
  aiFileKey: 'NOULETTE_AI_FILE_KEY',
  cloudSigningSeed: 'NOULETTE_CLOUD_SIGNING_SEED',
  apiToken: 'NOULETTE_API_TOKEN',
  posthogKey: 'NOULETTE_POSTHOG_KEY',
  ga4ServiceAccount: 'NOULETTE_GA4_SERVICE_ACCOUNT',
  aiApiKey: 'NOULETTE_AI_API_KEY',
  cloudToken: 'NOULETTE_CLOUD_TOKEN',
  signingSeed: 'NOULETTE_SIGNING_SEED'
};

type Blob = { protect(b: Uint8Array): Uint8Array; unprotect(b: Uint8Array): Uint8Array };

let dpapi: Blob | null | undefined;

function loadDpapi(): Blob | null {
  if (dpapi !== undefined) return dpapi;
  dpapi = null;
  if (process.platform !== 'win32' || process.env.NOULETTE_NO_DPAPI === '1') return dpapi;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffi = require('bun:ffi');
    const { dlopen, FFIType, ptr, toArrayBuffer } = ffi;
    const crypt = dlopen('crypt32.dll', {
      CryptProtectData: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
      CryptUnprotectData: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 }
    });
    const k32 = dlopen('kernel32.dll', { LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr } });
    const CRYPTPROTECT_UI_FORBIDDEN = 0x1;
    const call = (fn: any, input: Uint8Array): Uint8Array => {
      const data = Buffer.from(input.length ? input : new Uint8Array(1));
      const inBlob = Buffer.alloc(16);
      inBlob.writeUInt32LE(input.length, 0);
      inBlob.writeBigUInt64LE(BigInt(ptr(data)), 8);
      const outBlob = Buffer.alloc(16);
      const ok = fn(ptr(inBlob), null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, ptr(outBlob));
      if (!ok) throw new Error('DPAPI call failed');
      const len = outBlob.readUInt32LE(0);
      const p = Number(outBlob.readBigUInt64LE(8));
      const out = new Uint8Array(toArrayBuffer(p, 0, len).slice(0));
      k32.symbols.LocalFree(p);
      return out;
    };
    const candidate: Blob = {
      protect: (b) => call(crypt.symbols.CryptProtectData, b),
      unprotect: (b) => call(crypt.symbols.CryptUnprotectData, b)
    };
    // Self-test round trip before trusting it.
    const probe = new TextEncoder().encode('noulette-probe');
    if (new TextDecoder().decode(candidate.unprotect(candidate.protect(probe))) !== 'noulette-probe') throw new Error('probe mismatch');
    dpapi = candidate;
  } catch {
    dpapi = null;
  }
  return dpapi;
}

export function secretsBackend(): 'dpapi' | 'file' {
  return loadDpapi() ? 'dpapi' : 'file';
}

function storeFile(): string {
  return dataPath('secrets.bin');
}

function readAll(): Record<string, string> {
  const f = storeFile();
  if (!fs.existsSync(f)) return {};
  try {
    const raw = new Uint8Array(fs.readFileSync(f));
    const api = loadDpapi();
    const header = new TextDecoder().decode(raw.slice(0, 5));
    let json: string;
    if (header === 'DPAPI') {
      if (!api) return {};
      json = new TextDecoder().decode(api.unprotect(raw.slice(5)));
    } else {
      json = new TextDecoder().decode(raw.slice(5));
    }
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function writeAll(values: Record<string, string>): void {
  const json = new TextEncoder().encode(JSON.stringify(values));
  const api = loadDpapi();
  const body = api ? api.protect(json) : json;
  const header = new TextEncoder().encode(api ? 'DPAPI' : 'PLAIN');
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  const f = storeFile();
  fs.writeFileSync(f + '.tmp', out, { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
}

export function getSecret(name: SecretName): string | null {
  const env = process.env[SECRET_ENV[name]];
  if (env && env.trim()) return env.trim();
  const v = readAll()[name];
  return v && v.length ? v : null;
}

export function setSecret(name: SecretName, value: string | null): void {
  const all = readAll();
  if (value === null || value === '') delete all[name];
  else all[name] = value;
  writeAll(all);
}

export function hasSecret(name: SecretName): boolean {
  return getSecret(name) !== null;
}

export function secretSource(name: SecretName): 'env' | 'stored' | 'none' {
  if (process.env[SECRET_ENV[name]]?.trim()) return 'env';
  return readAll()[name] ? 'stored' : 'none';
}
