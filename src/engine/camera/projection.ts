import type { Vec3, CameraTransform } from '../../schemas/primitives.schema.js';
import { worldToCameraSpace, type CameraBasis } from './camera-3d.js';

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
  const xc = pCam[0];
  const yc = pCam[1];
  const zc = pCam[2];

  // Clipping rule: visible iff nearPlane <= z_c <= farPlane
  if (zc < camera.nearPlane || zc > camera.farPlane) {
    return { x: 0, y: 0, zDepth: zc, visible: false };
  }

  const aspectRatio = screenWidth / screenHeight;
  let xNdc = 0;
  let yNdc = 0;

  if (camera.projectionMode === 'perspective') {
    const fovRad = (camera.verticalFovDegrees * Math.PI) / 180;
    const tanHalfFov = Math.tan(fovRad / 2);
    xNdc = xc / (zc * tanHalfFov * aspectRatio);
    yNdc = yc / (zc * tanHalfFov);
  } else {
    // Orthographic projection
    const orthoHeight = camera.orthographicHeight;
    const orthoWidth = orthoHeight * aspectRatio;
    xNdc = xc / (orthoWidth / 2);
    yNdc = yc / (orthoHeight / 2);
  }

  // Map NDC [-1, 1] to the SVG canvas viewport.
  const xSvg = ((xNdc + 1) / 2) * screenWidth;
  const ySvg = ((1 - yNdc) / 2) * screenHeight;

  // Viewport visibility check for a single point.
  const isInsideViewport =
    xSvg >= 0 &&
    xSvg <= screenWidth &&
    ySvg >= 0 &&
    ySvg <= screenHeight;

  return {
    x: xSvg,
    y: ySvg,
    zDepth: zc,
    visible: isInsideViewport
  };
}

export {
  clipAndProjectLine,
  clipAndProjectPolygon,
  projectCameraPointToScreen,
  clipLineToViewport,
  type ScreenPoint,
  type ClippedLineSegment,
  type ClippedPolygon
} from './clipping.js';
