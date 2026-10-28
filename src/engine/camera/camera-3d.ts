import type { Vec3, CameraTransform } from '../../schemas/primitives.schema.js';

/** Orthonormal camera axes in world space. */
export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

/** Vectors shorter than this are treated as degenerate. */
const MIN_VECTOR_LENGTH = 1e-8;

/** Normalizes a vector, throwing instead of returning a made-up direction for zero-length input. */
export function normalizeVec3(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < MIN_VECTOR_LENGTH) {
    throw new Error(`Cannot normalize a zero-length vector [${v.join(', ')}]`);
  }
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Computes the orthonormal camera basis, including roll (Dutch angle) rotation about
 * the view axis.
 *
 * @throws if the camera position equals its target, or if the up vector is zero or
 * collinear with the view direction (the basis would be undefined).
 */
export function computeCameraBasis(camera: CameraTransform): CameraBasis {
  const viewDirection: Vec3 = [
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2]
  ];
  if (Math.hypot(...viewDirection) < MIN_VECTOR_LENGTH) {
    throw new Error('Degenerate camera: position and target are identical');
  }
  const forward = normalizeVec3(viewDirection);

  const rawRight = crossVec3(forward, camera.up);
  if (Math.hypot(...rawRight) < MIN_VECTOR_LENGTH) {
    throw new Error('Degenerate camera: up vector is zero or collinear with the view direction');
  }
  const baseRight = normalizeVec3(rawRight);
  const baseUp = crossVec3(baseRight, forward);

  const rollDegrees = camera.rollDegrees ?? 0;
  if (rollDegrees === 0) {
    return { forward, right: baseRight, up: baseUp };
  }

  const rollRad = (rollDegrees * Math.PI) / 180;
  const cosR = Math.cos(rollRad);
  const sinR = Math.sin(rollRad);

  const right: Vec3 = [
    baseRight[0] * cosR + baseUp[0] * sinR,
    baseRight[1] * cosR + baseUp[1] * sinR,
    baseRight[2] * cosR + baseUp[2] * sinR
  ];
  const up: Vec3 = [
    -baseRight[0] * sinR + baseUp[0] * cosR,
    -baseRight[1] * sinR + baseUp[1] * cosR,
    -baseRight[2] * sinR + baseUp[2] * cosR
  ];

  return { forward, right, up };
}

/** Transforms a world-space point into camera space `(x_c, y_c, z_c)`, where `z_c` is the depth along the view axis. */
export function worldToCameraSpace(worldPoint: Vec3, camera: CameraTransform, basis: CameraBasis): Vec3 {
  const relative: Vec3 = [
    worldPoint[0] - camera.position[0],
    worldPoint[1] - camera.position[1],
    worldPoint[2] - camera.position[2]
  ];

  return [
    dotVec3(relative, basis.right),
    dotVec3(relative, basis.up),
    dotVec3(relative, basis.forward)
  ];
}
