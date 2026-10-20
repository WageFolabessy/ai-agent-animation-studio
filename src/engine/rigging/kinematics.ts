import type { AssetRigContract, PlanarJoint } from '../../schemas/rig.contract.js';
import type { Vec2, Vec3, CameraTransform } from '../../schemas/primitives.schema.js';
import { worldToCameraSpace, type CameraBasis } from '../camera/camera-3d.js';
import { projectCameraPointToScreen, type ScreenPoint } from '../camera/clipping.js';

export interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export const IDENTITY_AFFINE_2D: Affine2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0
};

export function multiplyAffine2D(m1: Affine2D, m2: Affine2D): Affine2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
    ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty
  };
}

export function applyAffine2D(m: Affine2D, p: Vec2): Vec2 {
  return [m.a * p[0] + m.c * p[1] + m.tx, m.b * p[0] + m.d * p[1] + m.ty];
}

export function createRotationTranslationAffine2D(angleDeg: number, tx: number, ty: number): Affine2D {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    tx,
    ty
  };
}

/**
 * Computes world-space 2D affine transforms for all joints in a skeleton.
 * Evaluates in topological order (parents first) with angle clamping.
 */
export function computeSkeletonFK(
  skeleton: { rootJointId: string; joints: readonly PlanarJoint[] },
  jointAngles: Record<string, number>,
  jointOffsets: Record<string, Vec2>
): Map<string, Affine2D> {
  const jointMap = new Map(skeleton.joints.map((j) => [j.id, j]));
  const result = new Map<string, Affine2D>();

  function evaluateJoint(jointId: string): Affine2D {
    if (result.has(jointId)) {
      return result.get(jointId)!;
    }

    const joint = jointMap.get(jointId);
    if (!joint) {
      throw new Error(`Joint "${jointId}" not found in skeleton`);
    }

    let parentTransform = IDENTITY_AFFINE_2D;
    if (joint.parentId !== null) {
      parentTransform = evaluateJoint(joint.parentId);
    }

    let angle = jointAngles[jointId] ?? joint.rotationZDegrees;
    if (joint.constraintsDeg) {
      angle = Math.max(joint.constraintsDeg[0], Math.min(joint.constraintsDeg[1], angle));
    }

    const offset = jointOffsets[jointId] ?? joint.localOffset2D;
    const localTransform = createRotationTranslationAffine2D(angle, offset[0], offset[1]);
    const worldTransform = multiplyAffine2D(parentTransform, localTransform);

    result.set(jointId, worldTransform);
    return worldTransform;
  }

  for (const joint of skeleton.joints) {
    evaluateJoint(joint.id);
  }

  return result;
}

export interface BillboardProjectionContext {
  screenAnchor: ScreenPoint;
  scaleFactor: number;
  rotationCos: number;
  rotationSin: number;
  entityScale: Vec2;
  depthZ: number;
}

/**
 * Creates projection context for a billboarded 2.5D rig.
 * In billboard mode, all vertices share the anchor depth z_a and map via a uniform similarity.
 */
export function createBillboardContext(
  worldPosition: Vec3,
  rotationZDegrees: number,
  scale: Vec2,
  camera: CameraTransform,
  basis: CameraBasis,
  screenWidth = 1920,
  screenHeight = 1080
): BillboardProjectionContext | null {
  const cameraPoint = worldToCameraSpace(worldPosition, camera, basis);
  const zAnchor = cameraPoint[2];

  if (zAnchor < camera.nearPlane || zAnchor > camera.farPlane) {
    return null;
  }

  const screenAnchor = projectCameraPointToScreen(cameraPoint, camera, screenWidth, screenHeight);

  let scaleFactor: number;
  if (camera.projectionMode === 'perspective') {
    const tanHalfFov = Math.tan((camera.verticalFovDegrees * Math.PI) / 360);
    scaleFactor = (screenHeight / 2) / (zAnchor * tanHalfFov);
  } else {
    scaleFactor = screenHeight / camera.orthographicHeight;
  }

  const rad = (rotationZDegrees * Math.PI) / 180;
  return {
    screenAnchor,
    scaleFactor,
    rotationCos: Math.cos(rad),
    rotationSin: Math.sin(rad),
    entityScale: scale,
    depthZ: zAnchor
  };
}

/**
 * Projects a 2D rig-space point to SVG screen coordinates under billboard mode.
 * Rig coordinate convention: +x right, +y up. SVG convention: +x right, +y down.
 */
export function projectBillboardPoint(
  rigPoint: Vec2,
  ctx: BillboardProjectionContext
): [number, number] {
  const scaledX = rigPoint[0] * ctx.entityScale[0];
  const scaledY = rigPoint[1] * ctx.entityScale[1];

  // Rotate by entity rotation
  const rotX = ctx.rotationCos * scaledX - ctx.rotationSin * scaledY;
  const rotY = ctx.rotationSin * scaledX + ctx.rotationCos * scaledY;

  const sx = ctx.screenAnchor.x + ctx.scaleFactor * rotX;
  const sy = ctx.screenAnchor.y - ctx.scaleFactor * rotY; // Y flipped for SVG canvas
  return [sx, sy];
}

/**
 * Transforms a 2D rig-space point into a 3D world-space point under planar mode.
 */
export function transformPlanarPointToWorld(
  rigPoint: Vec2,
  worldPosition: Vec3,
  rotationZDegrees: number,
  scale: Vec2
): Vec3 {
  const scaledX = rigPoint[0] * scale[0];
  const scaledY = rigPoint[1] * scale[1];

  const rad = (rotationZDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotX = cos * scaledX - sin * scaledY;
  const rotY = sin * scaledX + cos * scaledY;

  return [worldPosition[0] + rotX, worldPosition[1] + rotY, worldPosition[2]];
}
