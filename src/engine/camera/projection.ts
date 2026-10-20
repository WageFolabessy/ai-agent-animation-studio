import type { Vec3, CameraTransform } from '../../schemas/primitives.schema.js';
import { worldToCameraSpace, type CameraBasis } from './camera-3d.js';
import { projectCameraPointToScreen } from './clipping.js';

export interface ProjectedPoint {
  x: number;
  y: number;
  zDepth: number;
  visible: boolean;
}

/**
 * Projects a 3D world point to SVG canvas coordinates (1920x1080 by default).
 * Applies the depth clipping rule `nearPlane <= z_c <= farPlane` and supports
 * perspective and orthographic projection.
 */
export function projectToScreen(
  worldPoint: Vec3,
  camera: CameraTransform,
  basis: CameraBasis,
  screenWidth = 1920,
  screenHeight = 1080
): ProjectedPoint {
  const pCam = worldToCameraSpace(worldPoint, camera, basis);
  const zc = pCam[2];

  // Clipping rule: visible iff nearPlane <= z_c <= farPlane
  if (zc < camera.nearPlane || zc > camera.farPlane) {
    return { x: 0, y: 0, zDepth: zc, visible: false };
  }

  // Single projection formula shared with the primitive clipping code.
  const projected = projectCameraPointToScreen(pCam, camera, screenWidth, screenHeight);

  // Viewport visibility check for a single point.
  const isInsideViewport =
    projected.x >= 0 &&
    projected.x <= screenWidth &&
    projected.y >= 0 &&
    projected.y <= screenHeight;

  return {
    x: projected.x,
    y: projected.y,
    zDepth: zc,
    visible: isInsideViewport
  };
}

export {
  clipAndProjectLine,
  clipAndProjectPolygon,
  projectCameraPointToScreen,
  clipLineToViewport,
  interpolateDepth,
  depthInterpolationFor,
  type DepthInterpolation,
  type ScreenPoint,
  type ClippedLineSegment,
  type ClippedPolygon
} from './clipping.js';
