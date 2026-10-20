import type { Vec3 } from '../../schemas/primitives.schema.js';
import { clipAgainstHalfSpace } from '../camera/clipping.js';

export type DepthTier =
  | 0 // backdrop
  | 1 // background-parallax
  | 2 // midground / world
  | 3 // character / prop
  | 4 // foreground-parallax
  | 5; // particle

export interface SortablePrimitive {
  kind: string;
  depthKey: number;
  tier: DepthTier;
  index: number;
  wasSplit?: boolean;
  [key: string]: unknown;
}

export interface CameraSpaceLine extends SortablePrimitive {
  p0: Vec3;
  p1: Vec3;
}

export interface CameraSpacePolygon extends SortablePrimitive {
  vertices: Vec3[];
}

/** Clamps camera-space z between near and far planes so vertices behind camera cannot corrupt depth keys. */
export function clampDepthKey(z: number, nearPlane: number, farPlane: number): number {
  return Math.max(nearPlane, Math.min(farPlane, z));
}

/** Computes the depth key (centroid z_c) for an array of camera-space points. */
export function computePointsDepthKey(
  points: ReadonlyArray<readonly [number, number, number]>,
  nearPlane: number,
  farPlane: number
): { zMean: number; zMin: number; zMax: number } {
  if (points.length === 0) {
    return { zMean: nearPlane, zMin: nearPlane, zMax: nearPlane };
  }

  let sum = 0;
  let zMin = Infinity;
  let zMax = -Infinity;

  for (const p of points) {
    const zClamped = clampDepthKey(p[2], nearPlane, farPlane);
    sum += zClamped;
    if (zClamped < zMin) zMin = zClamped;
    if (zClamped > zMax) zMax = zClamped;
  }

  return {
    zMean: sum / points.length,
    zMin,
    zMax
  };
}

/**
 * Checks if a primitive spans a large depth range relative to its mean depth.
 * Rule: r = (zmax - zmin) / max(zmean, near). If r > 0.30 and recursion depth < 3, split.
 */
export function shouldSplitPrimitive(
  zMin: number,
  zMax: number,
  zMean: number,
  nearPlane: number,
  recursionDepth: number
): boolean {
  if (recursionDepth >= 3) {
    return false;
  }
  const r = (zMax - zMin) / Math.max(zMean, nearPlane);
  return r > 0.30;
}

/**
 * Splits a camera-space 3D line segment recursively if it spans a large depth range.
 */
export function splitLargeLine<T extends CameraSpaceLine>(
  line: T,
  nearPlane: number,
  farPlane: number,
  recursionDepth = 0
): T[] {
  const { zMean, zMin, zMax } = computePointsDepthKey([line.p0, line.p1], nearPlane, farPlane);

  if (!shouldSplitPrimitive(zMin, zMax, zMean, nearPlane, recursionDepth)) {
    return [{ ...line, depthKey: zMean }];
  }

  const pMid: Vec3 = [
    0.5 * (line.p0[0] + line.p1[0]),
    0.5 * (line.p0[1] + line.p1[1]),
    0.5 * (line.p0[2] + line.p1[2])
  ];

  const piece1 = { ...line, p0: line.p0, p1: pMid, wasSplit: true };
  const piece2 = { ...line, p0: pMid, p1: line.p1, wasSplit: true };

  return [
    ...splitLargeLine(piece1, nearPlane, farPlane, recursionDepth + 1),
    ...splitLargeLine(piece2, nearPlane, farPlane, recursionDepth + 1)
  ];
}

const lerp = (a: number, b: number, t: number): number => a + t * (b - a);

/**
 * Splits a camera-space polygon recursively along z = zMean if it spans a large depth range.
 */
export function splitLargePolygon<T extends CameraSpacePolygon>(
  poly: T,
  nearPlane: number,
  farPlane: number,
  recursionDepth = 0
): T[] {
  const { zMean, zMin, zMax } = computePointsDepthKey(poly.vertices, nearPlane, farPlane);

  if (!shouldSplitPrimitive(zMin, zMax, zMean, nearPlane, recursionDepth)) {
    return [{ ...poly, depthKey: zMean }];
  }

  const intersectAtZMean = (a: Vec3, b: Vec3, t: number): Vec3 => [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    zMean
  ];

  const farPiece = clipAgainstHalfSpace(
    poly.vertices,
    (p) => p[2] - zMean,
    intersectAtZMean
  );

  const nearPiece = clipAgainstHalfSpace(
    poly.vertices,
    (p) => zMean - p[2],
    intersectAtZMean
  );

  if (farPiece.length < 3 || nearPiece.length < 3) {
    // If splitting didn't produce two valid polygons, keep original
    return [{ ...poly, depthKey: zMean }];
  }

  const farPoly = { ...poly, vertices: farPiece, wasSplit: true };
  const nearPoly = { ...poly, vertices: nearPiece, wasSplit: true };

  return [
    ...splitLargePolygon(farPoly, nearPlane, farPlane, recursionDepth + 1),
    ...splitLargePolygon(nearPoly, nearPlane, farPlane, recursionDepth + 1)
  ];
}

/**
 * Strict Painter's Algorithm comparator:
 * 1. Primary: depthKey DESC (farthest first)
 * 2. Secondary: tier ASC (lower tier first to break exact ties)
 * 3. Tertiary: index ASC (stable original submission order)
 */
export function compareDrawables(a: SortablePrimitive, b: SortablePrimitive): number {
  if (b.depthKey !== a.depthKey) {
    return b.depthKey - a.depthKey;
  }
  if (a.tier !== b.tier) {
    return a.tier - b.tier;
  }
  return a.index - b.index;
}

/** Sorts an array of drawables back-to-front in-place and returns it. */
export function sortDrawables<T extends SortablePrimitive>(drawables: T[]): T[] {
  return drawables.sort(compareDrawables);
}
