import crypto from 'node:crypto';

// Crockford's Base32 alphabet: 0123456789ABCDEFGHJKMNPQRSTVWXYZ (32 chars)
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Deterministic or random ULID generator.
 * Produces a 26-character string matching /^[0-9A-Z]{26}$/.
 * First 10 chars = 48-bit timestamp (ms)
 * Next 16 chars = 80-bit randomness
 */
export function generateUlid(seedTime: number = Date.now()): string {
  let time = seedTime;
  let timeStr = '';
  for (let i = 0; i < 10; i++) {
    const mod = time % 32;
    timeStr = CROCKFORD_ALPHABET[mod] + timeStr;
    time = Math.floor(time / 32);
  }

  const randomBytes = crypto.randomBytes(10);
  let randomStr = '';
  for (let i = 0; i < 10; i++) {
    const byte = randomBytes[i];
    randomStr += CROCKFORD_ALPHABET[byte % 32];
  }
  // We need 16 random chars total
  const extraRandomBytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    randomStr += CROCKFORD_ALPHABET[extraRandomBytes[i] % 32];
  }

  return timeStr + randomStr;
}

export function generateCaseId(): string {
  return `case-${generateUlid()}`;
}

export function generateCandidateId(): string {
  return `cand_${generateUlid()}`;
}

export function generateFindingId(): string {
  return `fnd_${generateUlid()}`;
}

export function generateDecisionId(): string {
  return `dec_${generateUlid()}`;
}

export function generateReceiptId(): string {
  return `rcpt_${generateUlid()}`;
}
