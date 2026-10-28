import type { AssetRigContract, RigPart, RigPaint } from '../../schemas/rig.contract.js';
import { shadeHexColor } from '../math/color.js';

/**
 * Outline policy applied to every part of every archetype.
 *
 * - Color: the stroke belongs to the part's own fill family. A palette fill keeps its role and
 *   its shade is raised by OUTLINE_RIM_LIGHTEN (never below OUTLINE_MIN_RIM_SHADE), producing a
 *   lighter rim of the same hue. A solid fill is lightened by the same amount. A `background`
 *   role fill falls back to a lightened `secondary` rim so it never vanishes into the backdrop.
 * - Contrast: the minimum rim shade guarantees the outline is lighter than the base role color,
 *   which keeps it readable against the dark backdrops used by every theme palette.
 * - Width: scaled by the part's smallest local extent (OUTLINE_WIDTH_PER_EXTENT) and clamped to
 *   [OUTLINE_MIN_WIDTH, OUTLINE_MAX_WIDTH] so thin limbs keep a fine line and large masses a bolder one.
 * - Parts that already declare a stroke keep their paint (accessory accents) and only have their
 *   width clamped into the policy range.
 */
export const OUTLINE_MIN_WIDTH = 0.8;
export const OUTLINE_MAX_WIDTH = 1.8;
export const OUTLINE_WIDTH_PER_EXTENT = 0.14;
export const OUTLINE_RIM_LIGHTEN = 0.45;
export const OUTLINE_MIN_RIM_SHADE = 0.3;
export const MIN_COAT_TO_TORSO_AREA_RATIO = 0.75;
export const MIN_WCAG_CONTRAST_RATIO = 3.0;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) / 255,
      parseInt(clean[1] + clean[1], 16) / 255,
      parseInt(clean[2] + clean[2], 16) / 255
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255
  ];
}

function channelLuminance(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function wcagContrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function minLocalExtent(part: RigPart, rig: AssetRigContract): number {
  const shape = part.shape;
  switch (shape.kind) {
    case 'rect':
      return Math.min(shape.size[0], shape.size[1]);
    case 'ellipse':
      return 2 * Math.min(shape.radius[0], shape.radius[1]);
    case 'polygon':
      return extentOfPoints(shape.points);
    case 'path':
      return extentOfPoints(shape.segments.flatMap((s) => [s.p0, s.p1, s.p2, s.p3]));
    case 'morph':
      return rig.morphTopology
        ? extentOfPoints(rig.morphTopology.baseSegments.flatMap((s) => [s.p0, s.p1, s.p2, s.p3]))
        : OUTLINE_MIN_WIDTH / OUTLINE_WIDTH_PER_EXTENT;
  }
}

function extentOfPoints(points: ReadonlyArray<readonly [number, number]>): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.min(maxX - minX, maxY - minY);
}

export function outlineWidthForExtent(minExtent: number): number {
  const raw = minExtent * OUTLINE_WIDTH_PER_EXTENT;
  const clamped = Math.min(OUTLINE_MAX_WIDTH, Math.max(OUTLINE_MIN_WIDTH, raw));
  return Number(clamped.toFixed(2));
}

export function clampOutlineWidth(width: number): number {
  return Number(Math.min(OUTLINE_MAX_WIDTH, Math.max(OUTLINE_MIN_WIDTH, width)).toFixed(2));
}

export function outlinePaintForFill(fill: RigPaint): RigPaint {
  if (fill.kind === 'solid') {
    return { kind: 'solid', color: shadeHexColor(fill.color, OUTLINE_RIM_LIGHTEN) };
  }
  const role = fill.role === 'background' ? 'secondary' : fill.role;
  const baseShade = fill.role === 'background' ? 0 : fill.shade;
  const shade = Math.min(1, Math.max(OUTLINE_MIN_RIM_SHADE, baseShade + OUTLINE_RIM_LIGHTEN));
  return { kind: 'palette', role, shade: Number(shade.toFixed(3)) };
}

/**
 * Applies the outline policy to every part of the rig. Applied before palette overrides so that
 * derived rims follow the overridden family colors as well.
 */
export function applyOutlinePolicy(rig: AssetRigContract): AssetRigContract {
  return {
    ...rig,
    parts: rig.parts.map((part) => {
      if (part.style.stroke) {
        const paint = part.style.stroke.paint;
        const contrastPaint: RigPaint =
          paint.kind === 'palette'
            ? {
                ...paint,
                shade: Number(Math.max(OUTLINE_MIN_RIM_SHADE, paint.shade).toFixed(3))
              }
            : paint;
        return {
          ...part,
          style: {
            ...part.style,
            stroke: {
              paint: contrastPaint,
              width: clampOutlineWidth(part.style.stroke.width)
            }
          }
        };
      }
      if (!part.style.fill) return part;
      return {
        ...part,
        style: {
          ...part.style,
          stroke: {
            paint: outlinePaintForFill(part.style.fill),
            width: outlineWidthForExtent(minLocalExtent(part, rig))
          }
        }
      };
    })
  };
}
