import type { CastSpecItem, StorySpecContract } from '../../schemas/story-spec.contract.js';
import { mixHexColors } from '../math/color.js';

/**
 * Minimum relative-luminance difference (WCAG relative luminance, range [0, 1]) required
 * between the lead's primary color and every other cast member's primary color.
 */
export const MIN_PRIMARY_LUMINANCE_DELTA = 0.12;

/**
 * Alternative way to pass the contrast rule: a hue difference of at least this many degrees
 * between two chromatic colors (HSL saturation >= MIN_CHROMATIC_SATURATION for both).
 */
export const MIN_PRIMARY_HUE_DELTA_DEGREES = 40;
export const MIN_CHROMATIC_SATURATION = 0.25;

const CORRECTION_MIX_STEP = 0.04;
const CORRECTION_MAX_STEPS = 25;

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  ];
}

/** WCAG relative luminance of a #rrggbb color in [0, 1]. */
export function relativeLuminance(hex: string): number {
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** HSL hue (degrees in [0, 360)) and saturation (in [0, 1]) of a #rrggbb color. */
export function hueSaturation(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = parseHex(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-9) return { hue: 0, saturation: 0 };
  const l = (max + min) / 2;
  const saturation = d / (1 - Math.abs(2 * l - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, saturation };
}

export function hueDeltaDegrees(a: string, b: string): number {
  const d = Math.abs(hueSaturation(a).hue - hueSaturation(b).hue);
  return d > 180 ? 360 - d : d;
}

/**
 * Contrast rule between two primary colors: passes when the luminance difference is at
 * least MIN_PRIMARY_LUMINANCE_DELTA, or when both colors are chromatic and their hues
 * differ by at least MIN_PRIMARY_HUE_DELTA_DEGREES.
 */
export function primariesAreDistinct(a: string, b: string): boolean {
  if (Math.abs(relativeLuminance(a) - relativeLuminance(b)) >= MIN_PRIMARY_LUMINANCE_DELTA) {
    return true;
  }
  const sa = hueSaturation(a);
  const sb = hueSaturation(b);
  return (
    sa.saturation >= MIN_CHROMATIC_SATURATION &&
    sb.saturation >= MIN_CHROMATIC_SATURATION &&
    hueDeltaDegrees(a, b) >= MIN_PRIMARY_HUE_DELTA_DEGREES
  );
}

/**
 * Deterministic correction: moves the candidate toward white (when the reference is dark)
 * or toward black (when the reference is bright) in fixed steps until the luminance
 * difference reaches MIN_PRIMARY_LUMINANCE_DELTA.
 */
export function correctPrimaryAgainst(reference: string, candidate: string): string {
  if (primariesAreDistinct(reference, candidate)) return candidate;
  const target = relativeLuminance(reference) <= 0.5 ? '#ffffff' : '#000000';
  const refLum = relativeLuminance(reference);
  let result = candidate;
  for (let i = 1; i <= CORRECTION_MAX_STEPS; i++) {
    result = mixHexColors(candidate, target, Math.min(1, i * CORRECTION_MIX_STEP));
    if (Math.abs(relativeLuminance(result) - refLum) >= MIN_PRIMARY_LUMINANCE_DELTA) {
      return result;
    }
  }
  return result;
}

/**
 * Enforces the lead-vs-other primary contrast rule on a cast list. The lead is the first
 * cast member; every other member that declares a primary override is corrected against it.
 * Pure and idempotent: a compliant cast is returned with identical values.
 */
export function enforceCastPaletteContrast(cast: readonly CastSpecItem[]): CastSpecItem[] {
  const leadPrimary = cast[0]?.paletteOverrides?.primary;
  if (!leadPrimary) return [...cast];
  return cast.map((member, idx) => {
    const primary = member.paletteOverrides?.primary;
    if (idx === 0 || !primary) return member;
    const corrected = correctPrimaryAgainst(leadPrimary, primary);
    if (corrected === primary) return member;
    return {
      ...member,
      paletteOverrides: { ...member.paletteOverrides, primary: corrected }
    };
  });
}

export function enforceStorySpecPaletteContrast(spec: StorySpecContract): StorySpecContract {
  return { ...spec, cast: enforceCastPaletteContrast(spec.cast) };
}
