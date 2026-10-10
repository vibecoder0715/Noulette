import React from 'react';

/**
 * Regex for zero-width characters:
 * \u200B (Zero-width space), \u200C (Zero-width non-joiner), \u200D (Zero-width joiner),
 * \u200E (Left-to-right mark), \u200F (Right-to-left mark), \u2060 (Word joiner),
 * \u2061..\u2064 (Invisible separators), \uFEFF (Zero-width no-break space / BOM)
 */
export const ZWSP_REGEX = /[\u200B-\u200F\u2060-\u2064\uFEFF]/;

/**
 * Regex for Bidirectional (Bidi) override and embedding characters:
 * \u202A..\u202E (LRE, RLE, PDF, LRO, RLO)
 * \u2066..\u2069 (LRI, RLI, FSI, PDI)
 */
export const BIDI_REGEX = /[\u202A-\u202E\u2066-\u2069]/;

/**
 * Combined steganography & bidi character matcher.
 */
export const STEGO_BIDI_REGEX = /([\u200B-\u200F\u2060-\u2064\uFEFF]|[\u202A-\u202E\u2066-\u2069])/g;

/**
 * Safely sanitizes text by rendering dangerous invisible or directional characters
 * as explicit, visible badges. Uses zero raw HTML injection.
 */
export function renderSanitizedText(text: string): React.ReactNode[] {
  if (!text) return [];

  const parts = text.split(STEGO_BIDI_REGEX);
  return parts.map((part, index) => {
    if (!part) return null;

    if (ZWSP_REGEX.test(part)) {
      return React.createElement(
        'span',
        {
          key: `zwsp-${index}`,
          className: 'stego-tag',
          title: `Zero-width character: U+${part.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
          'aria-label': '[ZWSP]',
        },
        '[ZWSP]'
      );
    }

    if (BIDI_REGEX.test(part)) {
      return React.createElement(
        'span',
        {
          key: `bidi-${index}`,
          className: 'stego-tag',
          style: { backgroundColor: '#7A4B00' },
          title: `Bidi override character: U+${part.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
          'aria-label': '[BIDI-OVERRIDE]',
        },
        '[BIDI-OVERRIDE]'
      );
    }

    return React.createElement(React.Fragment, { key: `text-${index}` }, part);
  });
}
