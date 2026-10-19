import type { AudioAnalysisManifest } from './audio.contract.js';
import type { DirectorStoryboardContract } from './storyboard.contract.js';
import type { RenderConfig } from '../config/render-config.js';
import type { AssetRigContract } from './rig.contract.js';

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

      if (!rigs.has(rigId)) {
        errors.push({
          code: 'RIG_NOT_FOUND',
          path: `storyboard.shots[${i}].activeRigIds`,
          severity: 'error',
          message: `Rig ID "${rigId}" is not found in asset rig catalog`,
          relatedIds: [shot.id, rigId]
        });
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

  // 4. Beat and Lyric Invariants: Valid frame ranges [0, totalFrames) & unique IDs
  const lyricIds = new Set<string>();
  for (const lyric of audioManifest.lyrics) {
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

  // 5. Asset Rig Invariants: Unique ID, single root, no cycles, unique morph targets
  const rigIds = new Set<string>();
  for (const [rigId, rig] of rigs.entries()) {
    if (rigIds.has(rig.id)) {
      errors.push({
        code: 'DUPLICATE_RIG_ID',
        path: `rigs[${rigId}]`,
        severity: 'fatal',
        message: `Duplicate rig ID: "${rig.id}"`
      });
    }
    rigIds.add(rig.id);

    if (rig.skeleton) {
      const joints = rig.skeleton.joints;
      const jointIds = new Set<string>();
      const rootJoints = joints.filter((j) => j.parentId === null);

      if (rootJoints.length !== 1) {
        errors.push({
          code: 'SKELETON_ROOT_COUNT_INVALID',
          path: `rigs[${rigId}].skeleton`,
          severity: 'error',
          message: `Rig "${rigId}" must have exactly 1 root joint (found ${rootJoints.length})`
        });
      }
      if (rootJoints.length === 1 && rootJoints[0].id !== rig.skeleton.rootJointId) {
        errors.push({
          code: 'SKELETON_ROOT_ID_MISMATCH',
          path: `rigs[${rigId}].skeleton.rootJointId`,
          severity: 'error',
          message: 'rootJointId does not point to the actual root joint'
        });
      }

      for (const joint of joints) {
        if (jointIds.has(joint.id)) {
          errors.push({
            code: 'DUPLICATE_JOINT_ID',
            path: `rigs[${rigId}].skeleton.joints`,
            severity: 'error',
            message: `Duplicate joint ID "${joint.id}" in rig "${rigId}"`
          });
        }
        jointIds.add(joint.id);
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
              path: `rigs[${rigId}].skeleton`,
              severity: 'fatal',
              message: `Cycle detected at joint "${joint.id}" in rig "${rigId}"`
            });
            break;
          }
          visited.add(curr);
          const parent = jointMap.get(curr);
          if (!parent) {
            errors.push({
              code: 'SKELETON_ORPHAN_PARENT',
              path: `rigs[${rigId}].skeleton`,
              severity: 'error',
              message: `Parent joint "${curr}" not found for joint "${joint.id}"`
            });
            break;
          }
          curr = parent.parentId;
        }
      }
    }

    if (rig.morphTopology) {
      const morphNames = new Set<string>();
      const baseCount = rig.morphTopology.baseSegments.length;
      for (const target of rig.morphTopology.targets) {
        if (morphNames.has(target.name)) {
          errors.push({
            code: 'DUPLICATE_MORPH_TARGET_NAME',
            path: `rigs[${rigId}].morphTopology.targets`,
            severity: 'error',
            message: `Duplicate morph target name "${target.name}" in rig "${rigId}"`
          });
        }
        morphNames.add(target.name);

        if (target.segments.length !== baseCount) {
          errors.push({
            code: 'MORPH_SEGMENT_COUNT_MISMATCH',
            path: `rigs[${rigId}].morphTopology.targets[${target.name}]`,
            severity: 'fatal',
            message: `Morph target segment count for "${target.name}" (${target.segments.length}) != base (${baseCount})`
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
