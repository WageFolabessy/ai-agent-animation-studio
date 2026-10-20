import type { Vec3, CameraTransform } from '../../schemas/primitives.schema.js';
import { worldToCameraSpace, type CameraBasis } from './camera-3d.js';

/** A projected point in SVG canvas coordinates plus its camera-space depth. */
export interface ScreenPoint {
  x: number;
  y: number;
  zDepth: number;
}

export interface ClippedLineSegment {
  p0: ScreenPoint;
  p1: ScreenPoint;
}

export interface ClippedPolygon {
  vertices: ScreenPoint[];
}

/**
 * How camera-space depth varies along a segment in screen space.
 * - `perspective`: screen position is affine in `1 / z`, so depth is interpolated as `1 / z`.
 * - `linear`: orthographic projection, where screen position is affine in `z` itself.
 */
export type DepthInterpolation = 'perspective' | 'linear';

/** Depth interpolation mode that is exact for the given camera. */
export function depthInterpolationFor(camera: CameraTransform): DepthInterpolation {
  return camera.projectionMode === 'perspective' ? 'perspective' : 'linear';
}

/**
 * Interpolates camera-space depth between two screen-space points at parameter `s`.
 * Perspective mode requires strictly positive depths (guaranteed after near-plane clipping)
 * and throws otherwise, because a `1 / z` blend across the camera plane is meaningless.
 */
export function interpolateDepth(mode: DepthInterpolation, z0: number, z1: number, s: number): number {
  if (mode === 'linear') {
    return z0 + s * (z1 - z0);
  }
  if (!(z0 > 0) || !(z1 > 0)) {
    throw new Error(`Perspective depth interpolation requires positive depths (received ${z0}, ${z1})`);
  }
  return 1 / (1 / z0 + s * (1 / z1 - 1 / z0));
}

/**
 * Projects a camera-space point to SVG canvas coordinates. The point must already be
 * clipped against the near/far planes; this function performs no visibility test.
 */
export function projectCameraPointToScreen(
  cameraPoint: Vec3,
  camera: CameraTransform,
  screenWidth = 1920,
  screenHeight = 1080
): ScreenPoint {
  const [xc, yc, zc] = cameraPoint;
  const aspectRatio = screenWidth / screenHeight;

  let xNdc: number;
  let yNdc: number;

  if (camera.projectionMode === 'perspective') {
    const tanHalfFov = Math.tan((camera.verticalFovDegrees * Math.PI) / 360);
    xNdc = xc / (zc * tanHalfFov * aspectRatio);
    yNdc = yc / (zc * tanHalfFov);
  } else {
    const orthoWidth = camera.orthographicHeight * aspectRatio;
    xNdc = xc / (orthoWidth / 2);
    yNdc = yc / (camera.orthographicHeight / 2);
  }

  return {
    x: ((xNdc + 1) / 2) * screenWidth,
    y: ((1 - yNdc) / 2) * screenHeight,
    zDepth: zc
  };
}

/**
 * Liang-Barsky clipping of a 2D segment against the viewport `[0, width] x [0, height]`.
 * Returns `null` when the segment lies entirely outside. Depth is interpolated with
 * `depthMode` (perspective-correct `1 / z` by default).
 */
export function clipLineToViewport(
  p0: ScreenPoint,
  p1: ScreenPoint,
  screenWidth: number,
  screenHeight: number,
  depthMode: DepthInterpolation = 'perspective'
): ClippedLineSegment | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  let tEnter = 0;
  let tLeave = 1;

  // Each boundary is expressed as `p * t <= q`; returns false when the segment is fully outside it.
  const clipAgainst = (p: number, q: number): boolean => {
    if (p === 0) {
      return q >= 0;
    }
    const t = q / p;
    if (p < 0) {
      if (t > tLeave) return false;
      if (t > tEnter) tEnter = t;
    } else {
      if (t < tEnter) return false;
      if (t < tLeave) tLeave = t;
    }
    return true;
  };

  const insideViewport =
    clipAgainst(-dx, p0.x) &&
    clipAgainst(dx, screenWidth - p0.x) &&
    clipAgainst(-dy, p0.y) &&
    clipAgainst(dy, screenHeight - p0.y);

  if (!insideViewport || tEnter > tLeave) {
    return null;
  }

  return {
    p0: {
      x: p0.x + tEnter * dx,
      y: p0.y + tEnter * dy,
      zDepth: interpolateDepth(depthMode, p0.zDepth, p1.zDepth, tEnter)
    },
    p1: {
      x: p0.x + tLeave * dx,
      y: p0.y + tLeave * dy,
      zDepth: interpolateDepth(depthMode, p0.zDepth, p1.zDepth, tLeave)
    }
  };
}

/**
 * Clips a 3D segment parametrically against the near/far planes in camera space,
 * projects it, then clips the projection against the viewport. A segment with one
 * endpoint behind the camera is shortened rather than discarded.
 *
 * @returns the visible screen segment, or `null` if nothing is visible.
 */
/**
 * Clips a camera-space 3D segment parametrically against the near/far planes,
 * projects it, then clips the projection against the viewport.
 */
export function clipAndProjectCameraLine(
  c0: Vec3,
  c1: Vec3,
  camera: CameraTransform,
  screenWidth = 1920,
  screenHeight = 1080
): ClippedLineSegment | null {
  const { nearPlane, farPlane } = camera;

  const dz = c1[2] - c0[2];
  let tStart = 0;
  let tEnd = 1;

  if (Math.abs(dz) < 1e-9) {
    // Segment parallel to the near/far planes: keep or drop it as a whole.
    if (c0[2] < nearPlane || c0[2] > farPlane) {
      return null;
    }
  } else {
    const tNear = (nearPlane - c0[2]) / dz;
    const tFar = (farPlane - c0[2]) / dz;
    tStart = Math.max(tStart, Math.min(tNear, tFar));
    tEnd = Math.min(tEnd, Math.max(tNear, tFar));
    if (tStart > tEnd) {
      return null;
    }
  }

  const pointAt = (t: number): Vec3 => [
    c0[0] + t * (c1[0] - c0[0]),
    c0[1] + t * (c1[1] - c0[1]),
    c0[2] + t * dz
  ];

  const s0 = projectCameraPointToScreen(pointAt(tStart), camera, screenWidth, screenHeight);
  const s1 = projectCameraPointToScreen(pointAt(tEnd), camera, screenWidth, screenHeight);

  return clipLineToViewport(s0, s1, screenWidth, screenHeight, depthInterpolationFor(camera));
}

/**
 * Clips a 3D segment parametrically against the near/far planes in camera space,
 * projects it, then clips the projection against the viewport. A segment with one
 * endpoint behind the camera is shortened rather than discarded.
 *
 * @returns the visible screen segment, or `null` if nothing is visible.
 */
export function clipAndProjectLine(
  p0World: Vec3,
  p1World: Vec3,
  camera: CameraTransform,
  basis: CameraBasis,
  screenWidth = 1920,
  screenHeight = 1080
): ClippedLineSegment | null {
  const c0 = worldToCameraSpace(p0World, camera, basis);
  const c1 = worldToCameraSpace(p1World, camera, basis);
  return clipAndProjectCameraLine(c0, c1, camera, screenWidth, screenHeight);
}

/**
 * One Sutherland-Hodgman pass: clips `polygon` against a single half-space.
 * `signedDistance(p) >= 0` means "inside"; `intersect` builds the vertex where an
 * edge crosses the boundary, given the interpolation parameter `t` along `a -> b`.
 */
export function clipAgainstHalfSpace<T>(
  polygon: readonly T[],
  signedDistance: (point: T) => number,
  intersect: (a: T, b: T, t: number) => T
): T[] {
  const output: T[] = [];

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const distA = signedDistance(a);
    const distB = signedDistance(b);
    const insideA = distA >= 0;
    const insideB = distB >= 0;

    if (insideA !== insideB) {
      output.push(intersect(a, b, distA / (distA - distB)));
    }
    if (insideB) {
      output.push(b);
    }
  }

  return output;
}

const lerp = (a: number, b: number, t: number): number => a + t * (b - a);

/** Intersection on a constant-depth plane; the depth is set exactly to avoid floating-point drift. */
function intersectAtDepth(planeZ: number) {
  return (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), planeZ];
}

/** Intersection on a vertical viewport edge; `x` is set exactly to the boundary. */
function intersectAtScreenX(boundX: number, depthMode: DepthInterpolation) {
  return (a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint => ({
    x: boundX,
    y: lerp(a.y, b.y, t),
    zDepth: interpolateDepth(depthMode, a.zDepth, b.zDepth, t)
  });
}

/** Intersection on a horizontal viewport edge; `y` is set exactly to the boundary. */
function intersectAtScreenY(boundY: number, depthMode: DepthInterpolation) {
  return (a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint => ({
    x: lerp(a.x, b.x, t),
    y: boundY,
    zDepth: interpolateDepth(depthMode, a.zDepth, b.zDepth, t)
  });
}

/**
 * Clips a polygon against the near/far planes in camera space (Sutherland-Hodgman),
 * projects the result, then clips it against the four viewport edges. The returned
 * polygon is a real clipped primitive, not a visibility flag.
 *
 * @returns the clipped polygon (at least 3 vertices), or `null` if nothing is visible.
 */
/**
 * Clips a camera-space polygon against the near/far planes (Sutherland-Hodgman),
 * projects the result, then clips it against the four viewport edges.
 */
export function clipAndProjectCameraPolygon(
  cameraVertices: readonly Vec3[],
  camera: CameraTransform,
  screenWidth = 1920,
  screenHeight = 1080
): ClippedPolygon | null {
  if (cameraVertices.length < 3) {
    return null;
  }

  const { nearPlane, farPlane } = camera;

  const nearClipped = clipAgainstHalfSpace(cameraVertices, (p) => p[2] - nearPlane, intersectAtDepth(nearPlane));
  if (nearClipped.length < 3) return null;

  const depthClipped = clipAgainstHalfSpace(nearClipped, (p) => farPlane - p[2], intersectAtDepth(farPlane));
  if (depthClipped.length < 3) return null;

  const projected = depthClipped.map((v) => projectCameraPointToScreen(v, camera, screenWidth, screenHeight));

  const depthMode = depthInterpolationFor(camera);
  const viewportStages: Array<(polygon: ScreenPoint[]) => ScreenPoint[]> = [
    (polygon) => clipAgainstHalfSpace(polygon, (p) => p.x, intersectAtScreenX(0, depthMode)),
    (polygon) => clipAgainstHalfSpace(polygon, (p) => screenWidth - p.x, intersectAtScreenX(screenWidth, depthMode)),
    (polygon) => clipAgainstHalfSpace(polygon, (p) => p.y, intersectAtScreenY(0, depthMode)),
    (polygon) => clipAgainstHalfSpace(polygon, (p) => screenHeight - p.y, intersectAtScreenY(screenHeight, depthMode))
  ];

  let clipped = projected;
  for (const stage of viewportStages) {
    clipped = stage(clipped);
    if (clipped.length < 3) return null;
  }

  return { vertices: clipped };
}

/**
 * Clips a polygon against the near/far planes in camera space (Sutherland-Hodgman),
 * projects the result, then clips it against the four viewport edges. The returned
 * polygon is a real clipped primitive, not a visibility flag.
 *
 * @returns the clipped polygon (at least 3 vertices), or `null` if nothing is visible.
 */
export function clipAndProjectPolygon(
  verticesWorld: readonly Vec3[],
  camera: CameraTransform,
  basis: CameraBasis,
  screenWidth = 1920,
  screenHeight = 1080
): ClippedPolygon | null {
  if (verticesWorld.length < 3) {
    return null;
  }
  const cameraSpace = verticesWorld.map((v) => worldToCameraSpace(v, camera, basis));
  return clipAndProjectCameraPolygon(cameraSpace, camera, screenWidth, screenHeight);
}
