import type { ColorLightingPalette } from '../../schemas/storyboard.contract.js';

export function hexToRgb(hex: string): [number, number, number] {
  const cleanHex = hex.replace('#', '').trim();
  if (cleanHex.length !== 6) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new Error(`Invalid hex color digits: "${hex}"`);
  }
  return [r, g, b];
}

function clampByte(val: number): number {
  return Math.max(0, Math.min(255, Math.round(val)));
}

export function rgbToHex(r: number, g: number, b: number): string {
  const cr = clampByte(r).toString(16).padStart(2, '0');
  const cg = clampByte(g).toString(16).padStart(2, '0');
  const cb = clampByte(b).toString(16).padStart(2, '0');
  return `#${cr}${cg}${cb}`;
}

export function mixHexColors(c1: string, c2: string, t: number): string {
  const clampedT = Math.max(0, Math.min(1, t));
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);

  const r = r1 + clampedT * (r2 - r1);
  const g = g1 + clampedT * (g2 - g1);
  const b = b1 + clampedT * (b2 - b1);

  return rgbToHex(r, g, b);
}

/**
 * Adjusts color shade in range [-1, 1]. Positive numbers brighten towards #ffffff,
 * negative numbers darken towards #000000.
 */
export function shadeHexColor(hex: string, shade: number): string {
  const clampedShade = Math.max(-1, Math.min(1, shade));
  if (clampedShade === 0) return hex;
  if (clampedShade > 0) {
    return mixHexColors(hex, '#ffffff', clampedShade);
  } else {
    return mixHexColors(hex, '#000000', -clampedShade);
  }
}

/**
 * Computes lit and shaded colors for lit primitives under the current palette.
 */
export function computeLitShadedColors(
  baseColor: string,
  palette: ColorLightingPalette
): { litColor: string; shadedColor: string } {
  // Lit color: subtle tint towards ambient light color
  const litColor = mixHexColors(baseColor, palette.ambientLightColor, palette.ambientIntensity * 0.35);

  // Shaded color: reduced luminance based on ambient intensity factor
  const shadeFactor = 1 - (palette.ambientIntensity + (1 - palette.ambientIntensity) * 0.55);
  const shadedColor = mixHexColors(baseColor, '#000000', shadeFactor);

  return { litColor, shadedColor };
}
