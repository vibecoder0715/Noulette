/**
 * WCAG 2.1 Relative Luminance and Contrast Ratio calculation
 */

export function parseHexColor(hex: string): [number, number, number] {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(val => {
    const s = val / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = relativeLuminance(parseHexColor(hex1));
  const lum2 = relativeLuminance(parseHexColor(hex2));
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWcagAA(hexForeground: string, hexBackground: string): boolean {
  return getContrastRatio(hexForeground, hexBackground) >= 4.5;
}
