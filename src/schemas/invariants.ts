import type { AudioAnalysisManifest } from './audio.contract.js';
import type { DirectorStoryboardContract } from './storyboard.contract.js';
import type { RenderConfig } from '../config/render-config.js';
import type { AssetRigContract, RigPart } from './rig.contract.js';
import type { ChoreographyContract, EntityTrack } from './choreography.contract.js';
import type { Vec3 } from './primitives.schema.js';
import { computeCameraBasis, worldToCameraSpace } from '../engine/camera/camera-3d.js';
import { projectCameraPointToScreen } from '../engine/camera/clipping.js';
import { ShotSequencer } from '../engine/director/shot-sequencer.js';
import {
  ANATOMICAL_FOCUS_OFFSETS,
  ARCHETYPE_CANONICAL_BASE_Y
} from '../engine/director/trajectory-solver.js';
import type { CharacterArchetypeId } from '../engine/library/types.js';
import { lerpVec3 } from '../engine/math/easing.js';

function computePartPivotDistance(part: RigPart): number {
  const [ox, oy] = part.localOffset2D;
  let minX = ox;
  let maxX = ox;
  let minY = oy;
  let maxY = oy;

  switch (part.shape.kind) {
    case 'rect': {
      const [w, h] = part.shape.size;
      minX = ox - w / 2;
      maxX = ox + w / 2;
      minY = oy - h / 2;
      maxY = oy + h / 2;
      break;
    }
    case 'ellipse': {
      const [rx, ry] = part.shape.radius;
      minX = ox - rx;
      maxX = ox + rx;
      minY = oy - ry;
      maxY = oy + ry;
      break;
    }
    case 'polygon': {
      const xs = part.shape.points.map((p) => ox + p[0]);
      const ys = part.shape.points.map((p) => oy + p[1]);
      minX = Math.min(...xs);
      maxX = Math.max(...xs);
      minY = Math.min(...ys);
      maxY = Math.max(...ys);
      break;
    }
    case 'path': {
      const pts = part.shape.segments.flatMap((s) => [s.p0, s.p1, s.p2, s.p3]);
      if (pts.length > 0) {
        const xs = pts.map((p) => ox + p[0]);
        const ys = pts.map((p) => oy + p[1]);
        minX = Math.min(...xs);
        maxX = Math.max(...xs);
        minY = Math.min(...ys);
        maxY = Math.max(...ys);
      }
      break;
    }
    case 'morph':
      return 0;
  }

  const dx = Math.max(0, minX, -maxX);
  const dy = Math.max(0, minY, -maxY);
  return Math.hypot(dx, dy);
}

export interface ValidationErrorItem {
  code: string;
  path: string;
  severity: 'fatal' | 'error' | 'warning';
  message: string;
  relatedIds?: string[];
}

export interface ValidationReport {
  isValid: boolean;
  errors: ValidationErrorItem[];
}

/**
 * Validates cross-contract consistency across Audio, Storyboard, RenderConfig, and Asset Rigs.
 * Ensures timeline continuity, frame-rate coherence, act coverage, and structural validity
 * before any rendering begins.
 */
export function validateProjectContracts(
  audioManifest: AudioAnalysisManifest,
  storyboard: DirectorStoryboardContract,
  renderConfig: RenderConfig,
  rigs: Map<string, AssetRigContract>
): ValidationReport {
  const errors: ValidationErrorItem[] = [];

  // 1. Cross-contract FPS and TotalFrames consistency
  if (
    storyboard.totalFrames !== audioManifest.metadata.totalFrames ||
    storyboard.totalFrames !== renderConfig.totalFrames
  ) {
    errors.push({
      code: 'TOTAL_FRAMES_MISMATCH',
      path: 'storyboard.totalFrames',
      severity: 'fatal',
      message: `Total frames mismatch across contracts: storyboard (${storyboard.totalFrames}), audio (${audioManifest.metadata.totalFrames}), renderConfig (${renderConfig.totalFrames})`
    });
  }
  if (storyboard.fps !== audioManifest.metadata.fps || storyboard.fps !== renderConfig.fps) {
    errors.push({
      code: 'FPS_MISMATCH',
      path: 'storyboard.fps',
      severity: 'fatal',
      message: `FPS mismatch across contracts: storyboard (${storyboard.fps}), audio (${audioManifest.metadata.fps}), renderConfig (${renderConfig.fps})`
    });
  }

  // 1b. Invariant Audio Duration vs TotalFrames: abs(durationSeconds * fps - totalFrames) <= 1
  const audioMeta = audioManifest.metadata;
  const expectedFrameCount = audioMeta.durationSeconds * audioMeta.fps;
  const durationFrameDiff = Math.abs(expectedFrameCount - audioMeta.totalFrames);
  if (durationFrameDiff > 1) {
    errors.push({
      code: 'AUDIO_DURATION_TOTAL_FRAMES_MISMATCH',
      path: 'audioManifest.metadata.totalFrames',
      severity: 'fatal',
      message: `Audio duration mismatch: durationSeconds (${audioMeta.durationSeconds}) * fps (${audioMeta.fps}) = expected frame count ${expectedFrameCount}, but actual totalFrames is ${audioMeta.totalFrames} (diff: ${durationFrameDiff.toFixed(2)} > 1 tolerance)`
    });
  }

  // 2. Act Invariants: Exactly acts [1, 2, 3], contiguous, covering [0, totalFrames)
  const acts = storyboard.acts;
  if (acts[0].actNumber !== 1 || acts[1].actNumber !== 2 || acts[2].actNumber !== 3) {
    errors.push({
      code: 'ACT_NUMBER_ORDER_INVALID',
      path: 'storyboard.acts',
      severity: 'fatal',
      message: 'Act numbers must strictly follow [1, 2, 3]'
    });
  }
  if (acts[0].frameRange.startFrameInclusive !== 0) {
    errors.push({
      code: 'ACT_START_NON_ZERO',
      path: 'storyboard.acts[0]',
      severity: 'fatal',
      message: 'Act 1 must start at frame 0'
    });
  }
  if (
    acts[1].frameRange.startFrameInclusive !== acts[0].frameRange.endFrameExclusive ||
    acts[2].frameRange.startFrameInclusive !== acts[1].frameRange.endFrameExclusive
  ) {
    errors.push({
      code: 'ACT_TIMELINE_DISCONTINUOUS',
      path: 'storyboard.acts',
      severity: 'fatal',
      message: 'Acts must be contiguous with no gaps or overlaps'
    });
  }
  if (acts[2].frameRange.endFrameExclusive !== storyboard.totalFrames) {
    errors.push({
      code: 'ACT_END_MISMATCH',
      path: 'storyboard.acts[2]',
      severity: 'fatal',
      message: 'Act 3 must end exactly at totalFrames'
    });
  }

  // 3. Shot Invariants: Sequential, unique, contiguous, within act boundaries
  const shots = storyboard.shots;
  const shotIds = new Set<string>();

  if (shots.length === 0) {
    errors.push({
      code: 'EMPTY_SHOTS_LIST',
      path: 'storyboard.shots',
      severity: 'fatal',
      message: 'Storyboard must contain at least one shot'
    });
  } else {
    // First shot must start at frame 0
    if (shots[0].frameRange.startFrameInclusive !== 0) {
      errors.push({
        code: 'FIRST_SHOT_START_NON_ZERO',
        path: 'storyboard.shots[0].frameRange.startFrameInclusive',
        severity: 'fatal',
        message: `First shot must start at frame 0 (found ${shots[0].frameRange.startFrameInclusive})`
      });
    }

    // Last shot must end exactly at totalFrames
    const lastShot = shots[shots.length - 1];
    if (lastShot.frameRange.endFrameExclusive !== storyboard.totalFrames) {
      errors.push({
        code: 'LAST_SHOT_END_MISMATCH',
        path: `storyboard.shots[${shots.length - 1}].frameRange.endFrameExclusive`,
        severity: 'fatal',
        message: `Last shot must end exactly at totalFrames ${storyboard.totalFrames} (found ${lastShot.frameRange.endFrameExclusive})`
      });
    }
  }

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (shotIds.has(shot.id)) {
      errors.push({
        code: 'DUPLICATE_SHOT_ID',
        path: `storyboard.shots[${i}].id`,
        severity: 'fatal',
        message: `Duplicate shot ID detected: "${shot.id}"`,
        relatedIds: [shot.id]
      });
    }
    shotIds.add(shot.id);

    if (shot.shotIndex !== i) {
      errors.push({
        code: 'SHOT_INDEX_NON_SEQUENTIAL',
        path: `storyboard.shots[${i}].shotIndex`,
        severity: 'error',
        message: `shotIndex must be strictly sequential (expected ${i}, found ${shot.shotIndex})`
      });
    }

    // Camera projection mode consistency
    if (shot.cameraStart.projectionMode !== shot.cameraEnd.projectionMode) {
      errors.push({
        code: 'CAMERA_PROJECTION_MODE_MISMATCH',
        path: `storyboard.shots[${i}].cameraStart.projectionMode`,
        severity: 'fatal',
        message: `Shot "${shot.id}" cameraStart projectionMode (${shot.cameraStart.projectionMode}) does not match cameraEnd (${shot.cameraEnd.projectionMode})`,
        relatedIds: [shot.id]
      });
    }

    // Static movement consistency check
    if (shot.movement === 'STATIC') {
      const start = shot.cameraStart;
      const end = shot.cameraEnd;
      const posDiff = Math.hypot(
        start.position[0] - end.position[0],
        start.position[1] - end.position[1],
        start.position[2] - end.position[2]
      );
      const tgtDiff = Math.hypot(
        start.target[0] - end.target[0],
        start.target[1] - end.target[1],
        start.target[2] - end.target[2]
      );
      const upDiff = Math.hypot(
        start.up[0] - end.up[0],
        start.up[1] - end.up[1],
        start.up[2] - end.up[2]
      );
      const rollDiff = Math.abs((start.rollDegrees ?? 0) - (end.rollDegrees ?? 0));
      if (posDiff > 1e-4 || tgtDiff > 1e-4 || upDiff > 1e-4 || rollDiff > 1e-4) {
        errors.push({
          code: 'STATIC_SHOT_CAMERA_MOVES',
          path: `storyboard.shots[${i}].movement`,
          severity: 'warning',
          message: `Shot "${shot.id}" is marked as STATIC, but cameraStart and cameraEnd transforms differ.`
        });
      }
    }

    // Deferred depth of field warning
    if (shot.depthOfFieldBlur !== undefined) {
      errors.push({
        code: 'DOF_DEFERRED',
        path: `storyboard.shots[${i}].depthOfFieldBlur`,
        severity: 'warning',
        message: `Shot "${shot.id}" specifies depthOfFieldBlur which is deferred in Phase 2.`
      });
    }

    // Every shot must have valid bounds within [0, totalFrames)
    if (shot.frameRange.startFrameInclusive < 0 || shot.frameRange.endFrameExclusive > storyboard.totalFrames) {
      errors.push({
        code: 'SHOT_FRAME_OUT_OF_BOUNDS',
        path: `storyboard.shots[${i}].frameRange`,
        severity: 'fatal',
        message: `Shot frame range for "${shot.id}" [${shot.frameRange.startFrameInclusive}, ${shot.frameRange.endFrameExclusive}) is out of bounds [0, ${storyboard.totalFrames})`,
        relatedIds: [shot.id]
      });
    }

    if (shot.frameRange.startFrameInclusive >= shot.frameRange.endFrameExclusive) {
      errors.push({
        code: 'SHOT_FRAME_RANGE_INVERTED',
        path: `storyboard.shots[${i}].frameRange`,
        severity: 'fatal',
        message: `Invalid frame range for shot "${shot.id}" (start ${shot.frameRange.startFrameInclusive} >= end ${shot.frameRange.endFrameExclusive})`,
        relatedIds: [shot.id]
      });
    }

    // Shot must be fully contained within the referenced act
    if (shot.actNumber < 1 || shot.actNumber > acts.length) {
      errors.push({
        code: 'INVALID_SHOT_ACT_NUMBER',
        path: `storyboard.shots[${i}].actNumber`,
        severity: 'fatal',
        message: `Shot "${shot.id}" references non-existent actNumber ${shot.actNumber}`,
        relatedIds: [shot.id]
      });
    } else {
      const parentAct = acts[shot.actNumber - 1];
      if (
        shot.frameRange.startFrameInclusive < parentAct.frameRange.startFrameInclusive ||
        shot.frameRange.endFrameExclusive > parentAct.frameRange.endFrameExclusive
      ) {
        errors.push({
          code: 'SHOT_OUTSIDE_ACT_BOUNDARY',
          path: `storyboard.shots[${i}].frameRange`,
          severity: 'fatal',
          message: `Shot "${shot.id}" [${shot.frameRange.startFrameInclusive}, ${shot.frameRange.endFrameExclusive}) crosses act boundary of act ${shot.actNumber} [${parentAct.frameRange.startFrameInclusive}, ${parentAct.frameRange.endFrameExclusive})`,
          relatedIds: [shot.id]
        });
      }
    }

    // No duplicate activeRigIds within a single shot
    const rigSet = new Set<string>();
    for (const rigId of shot.activeRigIds) {
      if (rigSet.has(rigId)) {
        errors.push({
          code: 'DUPLICATE_ACTIVE_RIG_IN_SHOT',
          path: `storyboard.shots[${i}].activeRigIds`,
          severity: 'warning',
          message: `Rig "${rigId}" is registered multiple times in shot "${shot.id}"`
        });
      }
      rigSet.add(rigId);

      const activeRig = rigs.get(rigId);
      if (!activeRig) {
        errors.push({
          code: 'RIG_NOT_FOUND',
          path: `storyboard.shots[${i}].activeRigIds`,
          severity: 'error',
          message: `Rig ID "${rigId}" is not found in asset rig catalog`,
          relatedIds: [shot.id, rigId]
        });
      } else if (
        activeRig.type === 'parallax_foreground' &&
        shot.cameraStart.target[2] < shot.cameraStart.position[2] &&
        shot.cameraEnd.target[2] < shot.cameraEnd.position[2]
      ) {
        const minSafeCameraZ = Math.min(
          shot.cameraStart.position[2] - shot.cameraStart.nearPlane,
          shot.cameraEnd.position[2] - shot.cameraEnd.nearPlane
        );
        const rigZ = activeRig.baseTransform.position[2];
        if (rigZ >= minSafeCameraZ) {
          errors.push({
            code: 'FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE',
            path: `rigs[${rigId}].baseTransform.position`,
            severity: 'error',
            message: `Foreground rig "${rigId}" baseTransform Z (${rigZ}) crosses or sits behind camera near-plane boundary (${minSafeCameraZ}) in shot "${shot.id}". Keep foreground parallax rigs at a safe Z strictly less than ${minSafeCameraZ} (e.g. z = 140) so they do not vanish mid-shot.`,
            relatedIds: [shot.id, rigId]
          });
        }
      }
    }

    // Inter-shot continuity: no gaps, no overlaps
    if (i > 0) {
      const prev = shots[i - 1].frameRange;
      if (shot.frameRange.startFrameInclusive > prev.endFrameExclusive) {
        errors.push({
          code: 'SHOT_TIMELINE_GAP',
          path: `storyboard.shots[${i}].frameRange.startFrameInclusive`,
          severity: 'fatal',
          message: `Timeline gap detected between shot "${shots[i - 1].id}" (end ${prev.endFrameExclusive}) and shot "${shot.id}" (start ${shot.frameRange.startFrameInclusive})`
        });
      } else if (shot.frameRange.startFrameInclusive < prev.endFrameExclusive) {
        errors.push({
          code: 'SHOT_TIMELINE_OVERLAP',
          path: `storyboard.shots[${i}].frameRange.startFrameInclusive`,
          severity: 'fatal',
          message: `Timeline overlap detected between shot "${shots[i - 1].id}" (end ${prev.endFrameExclusive}) and shot "${shot.id}" (start ${shot.frameRange.startFrameInclusive})`
        });
      }
    }
  }

  // 4. Beat and Lyric Invariants: Valid frame ranges [0, totalFrames), unique IDs, sorted & non-overlapping
  const lyricIds = new Set<string>();
  const lyrics = audioManifest.lyrics;
  for (let i = 0; i < lyrics.length; i++) {
    const lyric = lyrics[i];
    if (lyricIds.has(lyric.id)) {
      errors.push({
        code: 'DUPLICATE_LYRIC_ID',
        path: 'audioManifest.lyrics',
        severity: 'fatal',
        message: `Duplicate lyric ID: "${lyric.id}"`
      });
    }
    lyricIds.add(lyric.id);

    if (lyric.frameRange.startFrameInclusive < 0 || lyric.frameRange.endFrameExclusive > storyboard.totalFrames) {
      errors.push({
        code: 'LYRIC_FRAME_OUT_OF_BOUNDS',
        path: `audioManifest.lyrics[${lyric.id}]`,
        severity: 'error',
        message: `Lyric frame range is out of video bounds [0, ${storyboard.totalFrames})`
      });
    }

    const expectedStartFrame = Math.round(lyric.startTimeSeconds * audioMeta.fps);
    const expectedEndFrame = Math.round(lyric.endTimeSeconds * audioMeta.fps);
    if (
      Math.abs(expectedStartFrame - lyric.frameRange.startFrameInclusive) > 1 ||
      Math.abs(expectedEndFrame - lyric.frameRange.endFrameExclusive) > 1
    ) {
      errors.push({
        code: 'LYRIC_TIME_FRAME_MISMATCH',
        path: `audioManifest.lyrics[${i}]`,
        severity: 'error',
        message: `Lyric "${lyric.id}" time range [${lyric.startTimeSeconds}, ${lyric.endTimeSeconds}]s at ${audioMeta.fps} fps (expected frames [${expectedStartFrame}, ${expectedEndFrame})) diverges from frameRange [${lyric.frameRange.startFrameInclusive}, ${lyric.frameRange.endFrameExclusive}) by > 1 frame`,
        relatedIds: [lyric.id]
      });
    }

    if (i > 0) {
      const prev = lyrics[i - 1];
      if (lyric.frameRange.startFrameInclusive <= prev.frameRange.startFrameInclusive) {
        errors.push({
          code: 'LYRIC_TIMELINE_UNSORTED',
          path: `audioManifest.lyrics[${i}].frameRange.startFrameInclusive`,
          severity: 'error',
          message: `Lyric "${lyric.id}" startFrameInclusive (${lyric.frameRange.startFrameInclusive}) must be strictly greater than previous lyric "${prev.id}" startFrameInclusive (${prev.frameRange.startFrameInclusive})`,
          relatedIds: [prev.id, lyric.id]
        });
      }
      if (lyric.frameRange.startFrameInclusive < prev.frameRange.endFrameExclusive) {
        errors.push({
          code: 'LYRIC_TIMELINE_OVERLAP',
          path: `audioManifest.lyrics[${i}].frameRange.startFrameInclusive`,
          severity: 'error',
          message: `Lyric "${lyric.id}" startFrameInclusive (${lyric.frameRange.startFrameInclusive}) overlaps previous lyric "${prev.id}" endFrameExclusive (${prev.frameRange.endFrameExclusive})`,
          relatedIds: [prev.id, lyric.id]
        });
      }
    }
  }

  for (const beat of audioManifest.beatEvents) {
    if (beat.frameIndex < 0 || beat.frameIndex >= storyboard.totalFrames) {
      errors.push({
        code: 'BEAT_FRAME_OUT_OF_BOUNDS',
        path: 'audioManifest.beatEvents',
        severity: 'error',
        message: `Beat frameIndex ${beat.frameIndex} is out of bounds [0, ${storyboard.totalFrames})`
      });
    }
  }

  // 5. Asset Rig Invariants: Map key consistency, unique ID, skeleton, parts, morph, pose, secondary, emitter
  const rigIds = new Set<string>();
  for (const [mapKey, rig] of rigs.entries()) {
    if (mapKey !== rig.id) {
      errors.push({
        code: 'RIG_MAP_KEY_MISMATCH',
        path: `rigs[${mapKey}]`,
        severity: 'fatal',
        message: `Rig Map key "${mapKey}" does not match rig.id "${rig.id}"`
      });
    }

    if (rigIds.has(rig.id)) {
      errors.push({
        code: 'DUPLICATE_RIG_ID',
        path: `rigs[${mapKey}]`,
        severity: 'fatal',
        message: `Duplicate rig ID: "${rig.id}"`
      });
    }
    rigIds.add(rig.id);

    // Deferred viewAngle warning
    if (rig.viewAngle !== undefined) {
      errors.push({
        code: 'VIEW_ANGLE_DEFERRED',
        path: `rigs[${mapKey}].viewAngle`,
        severity: 'warning',
        message: `Rig "${rig.id}" specifies viewAngle "${rig.viewAngle}" which is deferred in Phase 2.`
      });
    }

    const skeletonJointIds = new Set<string>();
    if (rig.skeleton) {
      const joints = rig.skeleton.joints;
      const rootJoints = joints.filter((j) => j.parentId === null);

      if (rootJoints.length !== 1) {
        errors.push({
          code: 'SKELETON_ROOT_COUNT_INVALID',
          path: `rigs[${mapKey}].skeleton`,
          severity: 'error',
          message: `Rig "${rig.id}" must have exactly 1 root joint (found ${rootJoints.length})`
        });
      }
      if (rootJoints.length === 1 && rootJoints[0].id !== rig.skeleton.rootJointId) {
        errors.push({
          code: 'SKELETON_ROOT_ID_MISMATCH',
          path: `rigs[${mapKey}].skeleton.rootJointId`,
          severity: 'error',
          message: 'rootJointId does not point to the actual root joint'
        });
      }

      for (const joint of joints) {
        if (skeletonJointIds.has(joint.id)) {
          errors.push({
            code: 'DUPLICATE_JOINT_ID',
            path: `rigs[${mapKey}].skeleton.joints`,
            severity: 'error',
            message: `Duplicate joint ID "${joint.id}" in rig "${rig.id}"`
          });
        }
        skeletonJointIds.add(joint.id);
      }

      // Detect joint hierarchy cycles
      const jointMap = new Map(joints.map((j) => [j.id, j]));
      for (const joint of joints) {
        let curr = joint.parentId;
        const visited = new Set<string>([joint.id]);
        while (curr !== null) {
          if (visited.has(curr)) {
            errors.push({
              code: 'SKELETON_CYCLE_DETECTED',
              path: `rigs[${mapKey}].skeleton`,
              severity: 'fatal',
              message: `Cycle detected at joint "${joint.id}" in rig "${rig.id}"`
            });
            break;
          }
          visited.add(curr);
          const parent = jointMap.get(curr);
          if (!parent) {
            errors.push({
              code: 'SKELETON_ORPHAN_PARENT',
              path: `rigs[${mapKey}].skeleton`,
              severity: 'error',
              message: `Parent joint "${curr}" not found for joint "${joint.id}"`
            });
            break;
          }
          curr = parent.parentId;
        }

        // Facing direction vs anatomical lower-leg (knee) bend check
        if (
          (rig.facingDirection === 'right' || rig.facingDirection === 'left') &&
          joint.id.includes('leg') &&
          joint.id.includes('lower') &&
          joint.constraintsDeg
        ) {
          if (rig.facingDirection === 'right' && joint.constraintsDeg[1] > 5) {
            errors.push({
              code: 'RIG_KNEE_BEND_INVERTED',
              path: `rigs[${mapKey}].skeleton.joints[${joint.id}].constraintsDeg`,
              severity: 'error',
              message: `Knee joint "${joint.id}" in right-facing rig "${rig.id}" allows forward knee flexion (${joint.constraintsDeg[1]}° > 0°), which causes a moonwalk illusion. Use negative constraints (e.g. [-140, 0]) for backward knee flexion when facing right (+X).`
            });
          } else if (rig.facingDirection === 'left' && joint.constraintsDeg[0] < -5) {
            errors.push({
              code: 'RIG_KNEE_BEND_INVERTED',
              path: `rigs[${mapKey}].skeleton.joints[${joint.id}].constraintsDeg`,
              severity: 'error',
              message: `Knee joint "${joint.id}" in left-facing rig "${rig.id}" allows forward knee flexion (${joint.constraintsDeg[0]}° < 0°), which causes a moonwalk illusion. Use positive constraints (e.g. [0, 140]) for backward knee flexion when facing left (-X).`
            });
          }
        }
      }
    }

    // Parts validation
    const partIds = new Set<string>();
    let morphPartCount = 0;
    for (const part of rig.parts) {
      if (partIds.has(part.id)) {
        errors.push({
          code: 'PART_DUPLICATE_ID',
          path: `rigs[${mapKey}].parts`,
          severity: 'error',
          message: `Duplicate part ID "${part.id}" in rig "${rig.id}"`
        });
      }
      partIds.add(part.id);

      if (part.jointId !== null) {
        if (!rig.skeleton) {
          errors.push({
            code: 'PART_SKELETON_REQUIRED',
            path: `rigs[${mapKey}].parts[${part.id}]`,
            severity: 'error',
            message: `Part "${part.id}" references joint "${part.jointId}", but rig "${rig.id}" has no skeleton.`
          });
        } else if (!skeletonJointIds.has(part.jointId)) {
          errors.push({
            code: 'PART_JOINT_NOT_FOUND',
            path: `rigs[${mapKey}].parts[${part.id}]`,
            severity: 'error',
            message: `Part "${part.id}" references joint "${part.jointId}" which does not exist in skeleton.`
          });
        }
      }

      if (part.shape.kind === 'morph') {
        morphPartCount++;
      }
    }

    if (morphPartCount > 1) {
      errors.push({
        code: 'MORPH_PART_DUPLICATE',
        path: `rigs[${mapKey}].parts`,
        severity: 'error',
        message: `Rig "${rig.id}" contains ${morphPartCount} morph parts; at most one morph part is allowed per rig.`
      });
    }

    if (morphPartCount === 1 && !rig.morphTopology) {
      errors.push({
        code: 'MORPH_PART_WITHOUT_TOPOLOGY',
        path: `rigs[${mapKey}].parts`,
        severity: 'error',
        message: `Rig "${rig.id}" contains a morph part but has no morphTopology defined.`
      });
    }

    // Morph topology validation & C0 continuity
    if (rig.morphTopology) {
      const morphNames = new Set<string>();
      const baseSegments = rig.morphTopology.baseSegments;
      const baseCount = baseSegments.length;

      // Check C0 continuity of baseSegments: p3_s = p0_{s+1}
      for (let s = 0; s < baseCount - 1; s++) {
        const p3 = baseSegments[s].p3;
        const nextP0 = baseSegments[s + 1].p0;
        if (Math.abs(p3[0] - nextP0[0]) > 1e-6 || Math.abs(p3[1] - nextP0[1]) > 1e-6) {
          errors.push({
            code: 'MORPH_C0_DISCONTINUITY',
            path: `rigs[${mapKey}].morphTopology.baseSegments[${s}]`,
            severity: 'error',
            message: `Base segments C0 discontinuity between segment ${s} endpoint [${p3}] and segment ${s + 1} startpoint [${nextP0}].`
          });
        }
      }

      for (const target of rig.morphTopology.targets) {
        if (morphNames.has(target.name)) {
          errors.push({
            code: 'DUPLICATE_MORPH_TARGET_NAME',
            path: `rigs[${mapKey}].morphTopology.targets`,
            severity: 'error',
            message: `Duplicate morph target name "${target.name}" in rig "${rig.id}"`
          });
        }
        morphNames.add(target.name);

        if (target.segments.length !== baseCount) {
          errors.push({
            code: 'MORPH_SEGMENT_COUNT_MISMATCH',
            path: `rigs[${mapKey}].morphTopology.targets[${target.name}]`,
            severity: 'fatal',
            message: `Morph target segment count for "${target.name}" (${target.segments.length}) != base (${baseCount})`
          });
        } else {
          // Check C0 continuity of target segments
          for (let s = 0; s < target.segments.length - 1; s++) {
            const p3 = target.segments[s].p3;
            const nextP0 = target.segments[s + 1].p0;
            if (Math.abs(p3[0] - nextP0[0]) > 1e-6 || Math.abs(p3[1] - nextP0[1]) > 1e-6) {
              errors.push({
                code: 'MORPH_C0_DISCONTINUITY',
                path: `rigs[${mapKey}].morphTopology.targets[${target.name}].segments[${s}]`,
                severity: 'error',
                message: `Morph target "${target.name}" C0 discontinuity between segment ${s} endpoint [${p3}] and segment ${s + 1} startpoint [${nextP0}].`
              });
            }
          }
        }
      }
    }

    // Pose interpolation validation
    if (rig.poseInterpolation) {
      const { keyframes, interpolationMode, loopFrames } = rig.poseInterpolation;
      if (interpolationMode === 'cubic_spline') {
        for (const kf of keyframes) {
          if (kf.easing !== undefined) {
            errors.push({
              code: 'POSE_EASING_IGNORED',
              path: `rigs[${mapKey}].poseInterpolation.keyframes`,
              severity: 'warning',
              message: `Keyframe easing is ignored in cubic_spline mode for rig "${rig.id}".`
            });
            break;
          }
        }
      }

      // Keyframe ordering
      for (let k = 0; k < keyframes.length; k++) {
        if (k > 0 && keyframes[k].frame <= keyframes[k - 1].frame) {
          errors.push({
            code: 'POSE_KEYFRAME_ORDER',
            path: `rigs[${mapKey}].poseInterpolation.keyframes[${k}]`,
            severity: 'error',
            message: `Pose keyframes must have strictly ascending frame numbers (found ${keyframes[k].frame} after ${keyframes[k - 1].frame}).`
          });
        }

        // Check duplicate joints in keyframe and joint existence
        const jointSeen = new Set<string>();
        for (const jt of keyframes[k].jointTransforms) {
          if (jointSeen.has(jt.jointId)) {
            errors.push({
              code: 'POSE_DUPLICATE_JOINT_IN_KEYFRAME',
              path: `rigs[${mapKey}].poseInterpolation.keyframes[${k}].jointTransforms`,
              severity: 'error',
              message: `Duplicate joint "${jt.jointId}" in keyframe ${keyframes[k].frame} for rig "${rig.id}".`
            });
          }
          jointSeen.add(jt.jointId);

          if (!skeletonJointIds.has(jt.jointId)) {
            errors.push({
              code: 'POSE_JOINT_NOT_FOUND',
              path: `rigs[${mapKey}].poseInterpolation.keyframes[${k}].jointTransforms[${jt.jointId}]`,
              severity: 'error',
              message: `Pose transform references joint "${jt.jointId}" which does not exist in skeleton.`
            });
          }
        }
      }

      if (loopFrames !== undefined) {
        if (keyframes[0].frame !== 0) {
          errors.push({
            code: 'POSE_KEYFRAME_ORDER',
            path: `rigs[${mapKey}].poseInterpolation.keyframes[0]`,
            severity: 'error',
            message: `First pose keyframe must be at frame 0 when loopFrames is set for rig "${rig.id}".`
          });
        }
        const lastFrame = keyframes[keyframes.length - 1].frame;
        if (lastFrame > loopFrames) {
          errors.push({
            code: 'POSE_KEYFRAME_ORDER',
            path: `rigs[${mapKey}].poseInterpolation.keyframes[${keyframes.length - 1}]`,
            severity: 'error',
            message: `Last pose keyframe frame (${lastFrame}) exceeds loopFrames (${loopFrames}) for rig "${rig.id}".`
          });
        }
      }
    }

    // Secondary motion validation & joint pivot attachment verification
    for (const sm of rig.secondaryMotion) {
      if (!skeletonJointIds.has(sm.jointId)) {
        errors.push({
          code: 'SECONDARY_JOINT_NOT_FOUND',
          path: `rigs[${mapKey}].secondaryMotion[${sm.jointId}]`,
          severity: 'error',
          message: `Secondary motion references joint "${sm.jointId}" which does not exist in skeleton.`
        });
      } else {
        for (const part of rig.parts) {
          if (part.jointId === sm.jointId) {
            const pivotDist = computePartPivotDistance(part);
            if (pivotDist > 3.0) {
              errors.push({
                code: 'PART_DETACHED_FROM_JOINT_PIVOT',
                path: `rigs[${mapKey}].parts[${part.id}].localOffset2D`,
                severity: 'error',
                message: `Secondary-motion part "${part.id}" on joint "${sm.jointId}" in rig "${rig.id}" is detached from the joint pivot [0, 0] by ${pivotDist.toFixed(2)} units (localOffset2D: [${part.localOffset2D[0]}, ${part.localOffset2D[1]}]), causing it to float and orbit in mid-air. Set part localOffset2D to [0, 0] and anchor root vertices at [0, 0].`,
                relatedIds: [rig.id, sm.jointId, part.id]
              });
            }
          }
        }
      }
    }

    // Particle emitter validation
    if (rig.type === 'particle_emitter') {
      if (!rig.emitter) {
        errors.push({
          code: 'EMITTER_REQUIRED',
          path: `rigs[${mapKey}].emitter`,
          severity: 'error',
          message: `Rig "${rig.id}" is of type "particle_emitter" and must have an emitter defined.`
        });
      } else {
        const burstCount = rig.emitter.audio?.onsetBurstCount ?? 0;
        const fps = storyboard.fps;
        const lifetimeFrames = rig.emitter.lifetimeFrames;
        const maxBurstsOverLifetime = burstCount > 0
          ? Math.max(1, Math.ceil(lifetimeFrames / Math.max(1, Math.floor(fps * 0.25))))
          : 0;
        const estimatedBurstParticles = maxBurstsOverLifetime * burstCount;
        const estimatedContinuousParticles = Math.ceil(
          rig.emitter.ratePerSecond * (lifetimeFrames / fps)
        );
        const estimatedMax = estimatedContinuousParticles + estimatedBurstParticles;

        if (estimatedMax > rig.emitter.maxParticles) {
          errors.push({
            code: 'EMITTER_CAPACITY',
            path: `rigs[${mapKey}].emitter.maxParticles`,
            severity: 'error',
            message: `Emitter capacity error in rig "${rig.id}": estimated active particles (${estimatedMax}) exceeds maxParticles (${rig.emitter.maxParticles}).`
          });
        }
      }
    } else if (rig.emitter) {
      errors.push({
        code: 'EMITTER_FORBIDDEN',
        path: `rigs[${mapKey}].emitter`,
        severity: 'error',
        message: `Rig "${rig.id}" is of type "${rig.type}" but defines an emitter (only "particle_emitter" rigs can define emitter).`
      });
    }
  }

  return {
    isValid: errors.filter((e) => e.severity === 'fatal' || e.severity === 'error').length === 0,
    errors
  };
}

/**
 * Validates cross-contract choreography consistency against Storyboard shots and Asset Rigs.
 */
export function validateChoreography(
  choreography: ChoreographyContract,
  storyboard: DirectorStoryboardContract,
  rigs: Map<string, AssetRigContract>,
  options?: { validateFraming?: boolean }
): ValidationReport {
  const errors: ValidationErrorItem[] = [];

  const shotMap = new Map(storyboard.shots.map((s) => [s.id, s]));
  const trackPairs = new Set<string>();

  for (let t = 0; t < choreography.tracks.length; t++) {
    const track = choreography.tracks[t];
    const pairKey = `${track.shotId}:${track.rigId}`;

    if (trackPairs.has(pairKey)) {
      errors.push({
        code: 'TRACK_DUPLICATE',
        path: `choreography.tracks[${t}]`,
        severity: 'error',
        message: `Duplicate track for shot "${track.shotId}" and rig "${track.rigId}".`
      });
    }
    trackPairs.add(pairKey);

    const shot = shotMap.get(track.shotId);
    if (!shot) {
      errors.push({
        code: 'TRACK_SHOT_NOT_FOUND',
        path: `choreography.tracks[${t}].shotId`,
        severity: 'error',
        message: `Track references unknown shot "${track.shotId}".`
      });
    }

    const rig = rigs.get(track.rigId);
    if (!rig) {
      errors.push({
        code: 'TRACK_RIG_NOT_FOUND',
        path: `choreography.tracks[${t}].rigId`,
        severity: 'error',
        message: `Track references unknown rig "${track.rigId}".`
      });
    }

    if (shot && rig) {
      if (!shot.activeRigIds.includes(track.rigId)) {
        errors.push({
          code: 'TRACK_RIG_NOT_ACTIVE_IN_SHOT',
          path: `choreography.tracks[${t}].rigId`,
          severity: 'error',
          message: `Rig "${track.rigId}" is not declared in shot "${shot.id}" activeRigIds.`
        });
      }

      // Check transform keyframes
      const keyframes = track.transform.keyframes;
      for (let k = 0; k < keyframes.length; k++) {
        const kf = keyframes[k];
        if (k > 0 && kf.frame <= keyframes[k - 1].frame) {
          errors.push({
            code: 'TRACK_KEYFRAME_ORDER',
            path: `choreography.tracks[${t}].transform.keyframes[${k}]`,
            severity: 'error',
            message: `Track transform keyframes must be strictly ascending (found frame ${kf.frame} after ${keyframes[k - 1].frame}).`
          });
        }

        if (
          kf.frame < shot.frameRange.startFrameInclusive ||
          kf.frame >= shot.frameRange.endFrameExclusive
        ) {
          errors.push({
            code: 'TRACK_KEYFRAME_OUT_OF_BOUNDS',
            path: `choreography.tracks[${t}].transform.keyframes[${k}].frame`,
            severity: 'error',
            message: `Keyframe frame ${kf.frame} is out of shot "${shot.id}" range [${shot.frameRange.startFrameInclusive}, ${shot.frameRange.endFrameExclusive}).`
          });
        }

        // Facing direction vs lateral translation check (Moonwalk guard)
        if (k > 0 && (rig.facingDirection === 'right' || rig.facingDirection === 'left')) {
          const prevKf = keyframes[k - 1];
          const dx = kf.position[0] - prevKf.position[0];
          const scaleX = kf.scale?.[0] ?? rig.baseTransform.scale[0];
          const effectiveFacingSign = (rig.facingDirection === 'right' ? 1 : -1) * (scaleX >= 0 ? 1 : -1);
          if (Math.abs(dx) > 1e-3 && dx * effectiveFacingSign < 0) {
            errors.push({
              code: 'TRACK_FACING_DIRECTION_MISMATCH',
              path: `choreography.tracks[${t}].transform.keyframes[${k}].position`,
              severity: 'error',
              message: `Moonwalk detected on rig "${rig.id}" in shot "${shot.id}": rig faces "${rig.facingDirection}" (scaleX=${scaleX}), but translates horizontally by dx=${dx.toFixed(2)} between frames ${prevKf.frame} and ${kf.frame}.`
            });
          }
        }

        // Foreground parallax near-plane clipping guard
        if (
          rig.type === 'parallax_foreground' &&
          shot.cameraStart.target[2] < shot.cameraStart.position[2] &&
          shot.cameraEnd.target[2] < shot.cameraEnd.position[2]
        ) {
          const minSafeCameraZ = Math.min(
            shot.cameraStart.position[2] - shot.cameraStart.nearPlane,
            shot.cameraEnd.position[2] - shot.cameraEnd.nearPlane
          );
          if (kf.position[2] >= minSafeCameraZ) {
            errors.push({
              code: 'FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE',
              path: `choreography.tracks[${t}].transform.keyframes[${k}].position`,
              severity: 'error',
              message: `Foreground rig "${rig.id}" keyframe at frame ${kf.frame} in shot "${shot.id}" has Z=${kf.position[2]} >= camera near-plane boundary (${minSafeCameraZ}), causing the rig to clip behind the camera and vanish mid-shot. Keep foreground Z strictly below ${minSafeCameraZ} (e.g. z = 140).`,
              relatedIds: [shot.id, rig.id]
            });
          }
        }
      }

      // Morph target existence check
      const rigMorphTargets = new Set(rig.morphTopology?.targets.map((tgt) => tgt.name) ?? []);

      for (const [targetName, morphKeys] of Object.entries(track.morphKeyframes)) {
        if (!rigMorphTargets.has(targetName)) {
          errors.push({
            code: 'TRACK_MORPH_TARGET_NOT_FOUND',
            path: `choreography.tracks[${t}].morphKeyframes[${targetName}]`,
            severity: 'error',
            message: `Morph target "${targetName}" does not exist in rig "${rig.id}" morphTopology.`
          });
        }

        for (let m = 0; m < morphKeys.length; m++) {
          if (m > 0 && morphKeys[m].frame <= morphKeys[m - 1].frame) {
            errors.push({
              code: 'TRACK_KEYFRAME_ORDER',
              path: `choreography.tracks[${t}].morphKeyframes[${targetName}][${m}]`,
              severity: 'error',
              message: `Morph keyframes for "${targetName}" must be strictly ascending.`
            });
          }
        }
      }

      for (let b = 0; b < track.morphBindings.length; b++) {
        const binding = track.morphBindings[b];
        if (!rigMorphTargets.has(binding.target)) {
          errors.push({
            code: 'TRACK_MORPH_TARGET_NOT_FOUND',
            path: `choreography.tracks[${t}].morphBindings[${b}].target`,
            severity: 'error',
            message: `Morph binding target "${binding.target}" does not exist in rig "${rig.id}" morphTopology.`
          });
        }
      }
    }
  }

  if (options?.validateFraming) {
    const framingReport = validateSafeFraming(storyboard, choreography, rigs);
    errors.push(...framingReport.errors);
  }

  return {
    isValid: errors.filter((e) => e.severity === 'fatal' || e.severity === 'error').length === 0,
    errors
  };
}

/**
 * Validates camera framing invariants across all shots:
 * 1. CAMERA_DISTANCE_TOO_CLOSE: camera-space distance zc >= 135 units.
 * 2. CHARACTER_OUTSIDE_SAFE_FRAMING: character center screen X in [384, 1536] (0.20*W <= x <= 0.80*W).
 * 3. CHARACTER_HEAD_DECAPITATED: character head screen Y in [194, 594] in CLOSE_UP and MEDIUM shots.
 */
export function validateSafeFraming(
  storyboard: DirectorStoryboardContract,
  choreography: ChoreographyContract,
  rigs: Map<string, AssetRigContract>,
  width = 1920,
  height = 1080
): ValidationReport {
  const errors: ValidationErrorItem[] = [];

  let characterRigId: string | undefined;
  for (const [id, rig] of rigs.entries()) {
    if (rig.type === 'character') {
      characterRigId = id;
      break;
    }
  }

  if (!characterRigId && storyboard.shots.length > 0) {
    characterRigId = storyboard.shots[0].activeRigIds.find((id) => rigs.get(id)?.type === 'character') ?? storyboard.shots[0].activeRigIds[0];
  }

  const charRig = characterRigId ? rigs.get(characterRigId) : undefined;
  const jointIds = new Set(charRig?.skeleton?.joints.map((j) => j.id) ?? []);
  const archetypeId: CharacterArchetypeId = jointIds.has('leg_fl_upper')
    ? 'quadruped_beast'
    : jointIds.has('chassis_core')
      ? 'aerial_drone'
      : 'biped_runner';
  const focusSpec = ANATOMICAL_FOCUS_OFFSETS[archetypeId];
  const fallbackBaseY = ARCHETYPE_CANONICAL_BASE_Y[archetypeId];

  const trackMap = new Map<string, EntityTrack>();
  for (const track of choreography.tracks) {
    trackMap.set(`${track.shotId}:${track.rigId}`, track);
  }

  const sequencer = new ShotSequencer(storyboard);

  for (let sIdx = 0; sIdx < storyboard.shots.length; sIdx++) {
    const shot = storyboard.shots[sIdx];
    const track = characterRigId ? trackMap.get(`${shot.id}:${characterRigId}`) : undefined;

    const fStart = shot.frameRange.startFrameInclusive;
    const fEnd = shot.frameRange.endFrameExclusive;
    const sampleFrames = [
      fStart,
      Math.floor((fStart + fEnd) / 2),
      Math.max(fStart, fEnd - 1)
    ];

    for (const f of sampleFrames) {
      const progress = fEnd > fStart ? (f - fStart) / (fEnd - fStart) : 0;
      const camera = sequencer.interpolateCamera(shot, progress);
      const basis = computeCameraBasis(camera);

      let charPos: Vec3;
      if (track && track.transform.keyframes.length > 0) {
        const kfs = track.transform.keyframes;
        if (f <= kfs[0].frame || kfs.length === 1) {
          charPos = kfs[0].position;
        } else if (f >= kfs[kfs.length - 1].frame) {
          charPos = kfs[kfs.length - 1].position;
        } else {
          let k = 0;
          while (k < kfs.length - 1 && kfs[k + 1].frame <= f) k++;
          const k0 = kfs[k];
          const k1 = kfs[k + 1];
          const u = (f - k0.frame) / (k1.frame - k0.frame);
          charPos = lerpVec3(k0.position, k1.position, u);
        }
      } else {
        charPos = charRig?.baseTransform.position ?? [0, fallbackBaseY, 0];
      }

      const bodyCenterWorldPos: Vec3 = [
        charPos[0] + focusSpec.worldBodyCenterOffsetX,
        charPos[1],
        charPos[2]
      ];
      const pCamChar = worldToCameraSpace(bodyCenterWorldPos, camera, basis);
      const zc = pCamChar[2];

      // 1. Camera Distance: zc >= 135
      if (zc < 135) {
        errors.push({
          code: 'CAMERA_DISTANCE_TOO_CLOSE',
          path: `storyboard.shots[${sIdx}].camera`,
          severity: 'fatal',
          message: `Camera distance zc=${zc.toFixed(2)} < 135 in shot "${shot.id}" at frame ${f} causes scale explosion. Minimum safe distance is 135 units.`,
          relatedIds: [shot.id]
        });
      }

      // 2. Safe Framing Bounds: 384 <= xs <= 1536
      const pScreenChar = projectCameraPointToScreen(pCamChar, camera, width, height);
      if (pScreenChar.x < 384 || pScreenChar.x > 1536) {
        if (shot.framing !== 'EXTREME_WIDE') {
          errors.push({
            code: 'CHARACTER_OUTSIDE_SAFE_FRAMING',
            path: `choreography.tracks[${shot.id}:${characterRigId}].position`,
            severity: 'error',
            message: `Character projected screen X=${pScreenChar.x.toFixed(1)}px is outside safe framing [384, 1536] in shot "${shot.id}" at frame ${f}.`,
            relatedIds: [shot.id]
          });
        }
      }

      // 3. Head Decapitation Guard: 194 <= ys_head <= 594 in CLOSE_UP and MEDIUM shots
      const [hDx, hDy, hDz] = focusSpec.worldHeadOffsetFromRoot;
      const headPos: Vec3 = [charPos[0] + hDx, charPos[1] + hDy, charPos[2] + hDz];
      const pCamHead = worldToCameraSpace(headPos, camera, basis);
      const pScreenHead = projectCameraPointToScreen(pCamHead, camera, width, height);

      if (shot.framing === 'CLOSE_UP' || shot.framing === 'MEDIUM') {
        if (pScreenHead.y < 194 || pScreenHead.y > 594) {
          errors.push({
            code: 'CHARACTER_HEAD_DECAPITATED',
            path: `storyboard.shots[${sIdx}].camera.target`,
            severity: 'error',
            message: `Character head projected screen Y=${pScreenHead.y.toFixed(1)}px is outside safe vertical range [194, 594] in shot "${shot.id}" (${shot.framing}) at frame ${f}. Camera target must align with archetype head/chest focus.`,
            relatedIds: [shot.id]
          });
        }
      }
    }
  }

  return {
    isValid: errors.filter((e) => e.severity === 'fatal' || e.severity === 'error').length === 0,
    errors
  };
}
