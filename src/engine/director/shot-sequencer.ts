import type { CinematicShot, DirectorStoryboardContract } from '../../schemas/storyboard.contract.js';
import type { CameraTransform, Vec3 } from '../../schemas/primitives.schema.js';
import { interpolateEasing, lerp, lerpVec3 } from '../math/easing.js';
import { computeCameraBasis, dotVec3, normalizeVec3 } from '../camera/camera-3d.js';

export interface ShotLookupResult {
  shot: CinematicShot;
  shotIndex: number;
  localFrame: number;
  normalizedProgress: number; // t in [0, 1]
}

export class ShotSequencer {
  private readonly shots: readonly CinematicShot[];

  constructor(storyboard: DirectorStoryboardContract) {
    this.shots = storyboard.shots;
  }

  public getShotForFrame(frameIndex: number): ShotLookupResult {
    let low = 0;
    let high = this.shots.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const shot = this.shots[mid];
      const start = shot.frameRange.startFrameInclusive;
      const end = shot.frameRange.endFrameExclusive;

      if (frameIndex >= start && frameIndex < end) {
        const localFrame = frameIndex - start;
        const duration = end - start;
        const normalizedProgress = duration > 1 ? localFrame / (duration - 1) : 0;
        return {
          shot,
          shotIndex: mid,
          localFrame,
          normalizedProgress
        };
      } else if (frameIndex < start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    throw new Error(`Frame index ${frameIndex} does not fall within any storyboard shot frameRange`);
  }

  public interpolateCamera(shot: CinematicShot, normalizedProgress: number): CameraTransform {
    const e = interpolateEasing(shot.cameraEasing, normalizedProgress);
    const start = shot.cameraStart;
    const end = shot.cameraEnd;

    let position: Vec3;
    const target = lerpVec3(start.target, end.target, e);
    const up = lerpVec3(start.up, end.up, e);

    if (shot.movement === 'ORBIT') {
      // Circular arc interpolation around start.target
      const center = start.target;
      const vStart: Vec3 = [
        start.position[0] - center[0],
        start.position[1] - center[1],
        start.position[2] - center[2]
      ];
      const vEnd: Vec3 = [
        end.position[0] - center[0],
        end.position[1] - center[1],
        end.position[2] - center[2]
      ];

      const rStart = Math.hypot(vStart[0], vStart[1], vStart[2]);
      const rEnd = Math.hypot(vEnd[0], vEnd[1], vEnd[2]);
      const r = lerp(rStart, rEnd, e);

      if (rStart > 1e-6 && rEnd > 1e-6) {
        const uStart = normalizeVec3(vStart);
        const uEnd = normalizeVec3(vEnd);
        let cosTheta = dotVec3(uStart, uEnd);
        cosTheta = Math.max(-1, Math.min(1, cosTheta));
        const theta = Math.acos(cosTheta);

        if (theta < 1e-5 || Math.sin(theta) < 1e-5) {
          position = lerpVec3(start.position, end.position, e);
        } else {
          const sinTheta = Math.sin(theta);
          const wStart = Math.sin((1 - e) * theta) / sinTheta;
          const wEnd = Math.sin(e * theta) / sinTheta;
          const uDir: Vec3 = [
            wStart * uStart[0] + wEnd * uEnd[0],
            wStart * uStart[1] + wEnd * uEnd[1],
            wStart * uStart[2] + wEnd * uEnd[2]
          ];
          const normDir = normalizeVec3(uDir);
          position = [
            center[0] + r * normDir[0],
            center[1] + r * normDir[1],
            center[2] + r * normDir[2]
          ];
        }
      } else {
        position = lerpVec3(start.position, end.position, e);
      }
    } else {
      position = lerpVec3(start.position, end.position, e);
    }

    const nearPlane = Math.max(0.01, lerp(start.nearPlane, end.nearPlane, e));
    const farPlane = Math.max(nearPlane + 0.01, lerp(start.farPlane, end.farPlane, e));
    const rollDegrees = Math.max(-180, Math.min(180, lerp(start.rollDegrees ?? 0, end.rollDegrees ?? 0, e)));

    let cam: CameraTransform;
    if (start.projectionMode === 'perspective' && end.projectionMode === 'perspective') {
      const verticalFovDegrees = Math.max(
        10,
        Math.min(150, lerp(start.verticalFovDegrees, end.verticalFovDegrees, e))
      );
      cam = {
        projectionMode: 'perspective',
        position,
        target,
        up,
        nearPlane,
        farPlane,
        rollDegrees,
        verticalFovDegrees
      };
    } else if (start.projectionMode === 'orthographic' && end.projectionMode === 'orthographic') {
      const orthographicHeight = Math.max(
        0.01,
        lerp(start.orthographicHeight, end.orthographicHeight, e)
      );
      cam = {
        projectionMode: 'orthographic',
        position,
        target,
        up,
        nearPlane,
        farPlane,
        rollDegrees,
        orthographicHeight
      };
    } else {
      throw new Error(
        `Incompatible camera projectionModes: start is ${start.projectionMode}, end is ${end.projectionMode}`
      );
    }

    // Verify non-degeneracy
    computeCameraBasis(cam);
    return cam;
  }
}
