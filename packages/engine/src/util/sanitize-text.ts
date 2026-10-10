/**
 * Utility for detecting, visualizing, and decoding invisible/steganographic characters.
 */

// Zero-width space, joiners, markers: U+200B-U+200F, U+2060-U+2064, U+FEFF
export const ZERO_WIDTH_REGEX = /[\u200B-\u200F\u2060-\u2064\uFEFF]/g;

// Bidi control characters (Trojan source): U+202A-U+202E, U+2066-U+2069
export const BIDI_OVERRIDE_REGEX = /[\u202A-\u202E\u2066-\u2069]/g;

// Unicode Tag Block: U+E0000 to U+E007F (used for hidden steganographic ASCII)
export const TAG_BLOCK_REGEX = /[\u{E0000}-\u{E007F}]/u;
export const TAG_BLOCK_GLOBAL_REGEX = /[\u{E0000}-\u{E007F}]/gu;

export function hasZeroWidth(text: string): boolean {
  return ZERO_WIDTH_REGEX.test(text);
}

export function hasBidiOverrides(text: string): boolean {
  return BIDI_OVERRIDE_REGEX.test(text);
}

export function hasTagBlock(text: string): boolean {
  return TAG_BLOCK_REGEX.test(text);
}

/**
 * Decodes Unicode tag block characters back into plain ASCII characters.
 * Each tag block character U+E0000 + c represents ASCII character c (0x00 to 0x7F).
 */
export function decodeTagBlock(text: string): string {
  let decoded = '';
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && codePoint >= 0xe0000 && codePoint <= 0xe007f) {
      const asciiVal = codePoint - 0xe0000;
      if (asciiVal > 0) {
        decoded += String.fromCharCode(asciiVal);
      }
    }
  }
  return decoded;
}

/**
 * Encodes ASCII string into Unicode tag block characters (for fixture generation).
 */
export function encodeTagBlock(asciiText: string): string {
  let encoded = '';
  for (let i = 0; i < asciiText.length; i++) {
    const code = asciiText.charCodeAt(i);
    encoded += String.fromCodePoint(0xe0000 + code);
  }
  return encoded;
}

/**
 * Visualizes zero-width and bidi characters for secure display without executing or rendering invisibly.
 */
export function visualizeSteganography(text: string): string {
  return text
    .replace(ZERO_WIDTH_REGEX, '[ZWSP]')
    .replace(BIDI_OVERRIDE_REGEX, '[BIDI-OVERRIDE]');
}
