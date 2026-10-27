import type {
  StoryBeatContract,
  CharacterActionDirective
} from '../../../schemas/story-beat.contract.js';
import type { AudioAnalysisManifest } from '../../../schemas/audio.contract.js';
import type {
  DirectorStoryboardContract,
  CinematicShot,
  ColorLightingPalette,
  CameraFraming,
  CameraMovement,
  StoryboardAct
} from '../../../schemas/storyboard.contract.js';
import type { CameraTransform } from '../../../schemas/primitives.schema.js';
import type { AssetRigContract } from '../../../schemas/rig.contract.js';
import {
  CHOREOGRAPHY_CONTRACT_VERSION,
  type ChoreographyContract,
  type EntityTrack,
  type EntityTrackKeyframe,
  type PropAttachmentSpan,
  type PoseSegment,
  type IkTarget,
  type GazeTarget
} from '../../../schemas/choreography.contract.js';
import type { EmotionalTone } from '../../../schemas/story-spec.contract.js';
import type { NarrativePropId, RigSocketSlot } from '../../../schemas/prop.contract.js';
import { ArchetypeFactory } from '../../library/archetype-factory.js';
import { PropFactory } from '../../library/prop-factory.js';
import { VERB_CONSTANTS, type ValidFps, type CanonicalActNumber } from './verb-constants.js';

const HALF = 0.5;
const EPSILON_SPEED = 1e-3;
const EPSILON_DISTANCE = 1e-4;

import { THEME_PALETTES } from '../../library/environment-kit.js';
import {
  synthesizeVocalPerformanceKeyframes,
  CANONICAL_BIPED_MORPH_TARGETS
} from '../../rigging/vocal-performance-solver.js';
import {
  evaluateTrackTransform,
  evaluateMorphKeyframes
} from '../choreography.js';

const CANONICAL_BIPED_TARGET_NAMES = new Set(
  CANONICAL_BIPED_MORPH_TARGETS.map((t) => t.name)
);

export interface UnfulfilledTimingEntry {
  readonly beatId: string;
  readonly instanceId: string;
  readonly verb: string;
  readonly requestedDistance: number;
  readonly availableFrames: number;
  readonly actualDurationFrames: number;
  readonly chosenClipId: string;
  readonly timeScale: number;
  readonly reason: string;
}

export interface ShotSubdivisionEntry {
  readonly originalBeatId: string;
  readonly subShotId: string;
  readonly subShotIndex: number;
  readonly frameRange: { startFrameInclusive: number; endFrameExclusive: number };
}

export interface PropRuntimeState {
  held: boolean;
  heldBy: string | null;
  released: boolean;
  currentPosition: [number, number, number];
  currentRotationZ: number;
}

export interface UnreachableTargetEntry {
  readonly beatId: string;
  readonly instanceId: string;
  readonly verb: string;
  readonly requestedDistance: number;
  readonly achievableDistance: number;
  readonly durationFrames: number;
  readonly minimumFramesNeeded: number;
  readonly suggestedSpeedNorm?: number;
}

export interface InvisibleCutEntry {
  readonly boundaryFrame: number;
  readonly fromShotId: string;
  readonly toShotId: string;
  readonly framingDifference: number;
  readonly angleDifferenceDeg: number;
  readonly reason: string;
}

export interface VerbCompileReport {
  readonly unfulfilledTiming: UnfulfilledTimingEntry[];
  readonly unreachableTargets: UnreachableTargetEntry[];
  readonly shotSubdivisions: ShotSubdivisionEntry[];
  readonly reachClamps: Array<{
    readonly beatId: string;
    readonly instanceId: string;
    readonly target: [number, number, number];
    readonly clampedReach: number;
    readonly maxReach: number;
  }>;
  readonly invisibleCuts: InvisibleCutEntry[];
}

export interface CompiledStoryBeatProduction {
  readonly storyboard: DirectorStoryboardContract;
  readonly rigs: Map<string, AssetRigContract>;
  readonly choreography: ChoreographyContract;
  readonly compileReport: VerbCompileReport;
}

export interface LocomotionPlanResult {
  readonly chosenClipId: string;
  readonly loopFrames: number;
  readonly strideLengthUnits: number;
  readonly timeScale: number;
  readonly tMove: number;
  readonly arriveF: number;
  readonly vActual: number;
  readonly isEarlyArrival: boolean;
  readonly isUnreachable?: boolean;
  readonly requestedDistance?: number;
  readonly achievableDistance?: number;
  readonly minimumFramesNeeded?: number;
  readonly suggestedSpeedNorm?: number;
  readonly unfulfilledReason?: string;
}

const PALETTE_TONE_MAP: Record<string, ColorLightingPalette> = {
  defiant: THEME_PALETTES.CRIMSON_FURY,
  menacing: THEME_PALETTES.CRIMSON_FURY,
  melancholic: THEME_PALETTES.MIDNIGHT_VOID,
  reflective: THEME_PALETTES.CYBERPUNK_CYAN,
  tender: THEME_PALETTES.SUNSET_GOLD,
  euphoric: THEME_PALETTES.SUNSET_GOLD,
  chaotic: THEME_PALETTES.VOLTAGE_ORANGE
};

const FRAMING_DISTANCE_MAP = VERB_CONSTANTS.FRAMING_DISTANCE_MAP;

function lerpCameraTransform(c1: CameraTransform, c2: CameraTransform, u: number): CameraTransform {
  if (c1.projectionMode === 'perspective' && c2.projectionMode === 'perspective') {
    return {
      projectionMode: 'perspective',
      position: [
        c1.position[0] + (c2.position[0] - c1.position[0]) * u,
        c1.position[1] + (c2.position[1] - c1.position[1]) * u,
        c1.position[2] + (c2.position[2] - c1.position[2]) * u
      ],
      target: [
        c1.target[0] + (c2.target[0] - c1.target[0]) * u,
        c1.target[1] + (c2.target[1] - c1.target[1]) * u,
        c1.target[2] + (c2.target[2] - c1.target[2]) * u
      ],
      up: [
        c1.up[0] + (c2.up[0] - c1.up[0]) * u,
        c1.up[1] + (c2.up[1] - c1.up[1]) * u,
        c1.up[2] + (c2.up[2] - c1.up[2]) * u
      ],
      rollDegrees: (c1.rollDegrees ?? 0) + ((c2.rollDegrees ?? 0) - (c1.rollDegrees ?? 0)) * u,
      verticalFovDegrees: (c1.verticalFovDegrees ?? VERB_CONSTANTS.DEFAULT_CAMERA_FOV) + ((c2.verticalFovDegrees ?? VERB_CONSTANTS.DEFAULT_CAMERA_FOV) - (c1.verticalFovDegrees ?? VERB_CONSTANTS.DEFAULT_CAMERA_FOV)) * u,
      nearPlane: c1.nearPlane,
      farPlane: c1.farPlane
    };
  }
  return c1;
}

export class VerbCompiler {
  public static readonly MIN_BEAT_LENGTH_FRAMES = VERB_CONSTANTS.MIN_BEAT_LENGTH_FRAMES;

  public static deriveRigArmMetrics(
    rig: AssetRigContract | undefined,
    hand: 'hand_l' | 'hand_r'
  ): {
    readonly shoulderOffset: [number, number];
    readonly upperArmLength: number;
    readonly lowerArmLength: number;
    readonly maxReach: number;
  } {
    const isLeft = hand === 'hand_l';
    const upperArmId = isLeft ? 'arm_l_upper' : 'arm_r_upper';
    const lowerArmId = isLeft ? 'arm_l_lower' : 'arm_r_lower';

    const skeleton = rig?.skeleton;
    const upperJoint = skeleton?.joints.find((j) => j.id === upperArmId);
    const lowerJoint = skeleton?.joints.find((j) => j.id === lowerArmId);
    const torsoJoint = skeleton?.joints.find((j) => j.id === 'torso');

    const upperLen = upperJoint?.length ?? VERB_CONSTANTS.DEFAULT_UPPER_ARM_LENGTH;
    const lowerLen = lowerJoint?.length ?? VERB_CONSTANTS.DEFAULT_LOWER_ARM_LENGTH;

    const torsoX = torsoJoint?.localOffset2D[0] ?? 0;
    const torsoY = torsoJoint?.localOffset2D[1] ?? VERB_CONSTANTS.DEFAULT_TORSO_OFFSET_Y;

    const upperX =
      upperJoint?.localOffset2D[0] ??
      (isLeft ? -VERB_CONSTANTS.DEFAULT_SHOULDER_OFFSET_X : VERB_CONSTANTS.DEFAULT_SHOULDER_OFFSET_X);
    const upperY = upperJoint?.localOffset2D[1] ?? VERB_CONSTANTS.DEFAULT_SHOULDER_OFFSET_Y;

    const shoulderLocalX = torsoX + upperX;
    const shoulderLocalY = torsoY + upperY;

    return {
      shoulderOffset: [shoulderLocalX, shoulderLocalY],
      upperArmLength: upperLen,
      lowerArmLength: lowerLen,
      maxReach: upperLen + lowerLen
    };
  }

  /**
   * Derives clip duration in frames from rig clip data (loopFrames or last keyframe frame).
   * Falls back to fallbackFrames if the clip or keyframes are not found.
   */
  public static getClipDuration(
    rig: AssetRigContract | undefined,
    clipId: string,
    fallbackFrames: number = 0
  ): number {
    const clip = rig?.poseClips?.[clipId];
    if (!clip) {
      return fallbackFrames;
    }
    if (typeof clip.loopFrames === 'number' && clip.loopFrames > 0) {
      return clip.loopFrames;
    }
    if (clip.keyframes && clip.keyframes.length > 0) {
      const lastKeyframe = clip.keyframes[clip.keyframes.length - 1];
      if (typeof lastKeyframe?.frame === 'number' && lastKeyframe.frame > 0) {
        return lastKeyframe.frame;
      }
    }
    return fallbackFrames;
  }

  public static resolveInitialPropPlacement(
    propId: string,
    beats: StoryBeatContract['beats'],
    cast?: StoryBeatContract['cast'],
    activeRigs?: Map<string, AssetRigContract>
  ): [number, number, number] {
    for (const b of beats) {
      if (b.set.landmarkPlacements && b.set.landmarkPlacements[propId]) {
        return [...b.set.landmarkPlacements[propId]];
      }
    }

    for (const b of beats) {
      for (const a of b.actions) {
        if (
          (a.associatedPropId === propId || (a.target?.kind === 'prop' && a.target.propId === propId)) &&
          a.target?.kind === 'position'
        ) {
          return [...a.target.pos];
        }
      }
    }

    for (const b of beats) {
      for (const a of b.actions) {
        if (a.associatedPropId === propId) {
          const char = cast?.find((c) => c.instanceId === a.instanceId) ?? cast?.[0];
          const charRig = char ? activeRigs?.get(char.instanceId) : undefined;
          const hand: 'hand_l' | 'hand_r' = a.propSocket === 'hand_l' ? 'hand_l' : 'hand_r';
          const armMetrics = VerbCompiler.deriveRigArmMetrics(charRig, hand);
          const isCompanion = char?.archetypeId === 'companion_silhouette';
          const baseY = isCompanion ? VERB_CONSTANTS.COMPANION_BASE_Y : VERB_CONSTANTS.HERO_BASE_Y;
          const scaleY = isCompanion ? VERB_CONSTANTS.COMPANION_SCALE_Y : VERB_CONSTANTS.HERO_SCALE_Y;
          const handY = baseY + (armMetrics.shoulderOffset[1] - armMetrics.upperArmLength) * scaleY;
          return [0, handY, 0];
        }
      }
    }

    const firstSet = beats[0]?.set;
    throw new Error(
      `Unable to determine initial placement for prop "${propId}": ` +
        `prop has no landmark placement on set kit "${firstSet?.kitId ?? 'unknown'}", ` +
        `has no explicit verb target position, and is not associated with any character hand socket.`
    );
  }

  public static validateStoryBeatContract(storyBeatContract: StoryBeatContract): void {
    const beats = storyBeatContract.beats;
    if (!beats || beats.length === 0) {
      throw new Error('StoryBeatContract must contain at least one beat');
    }

    const slice = storyBeatContract.sliceFrameRange;
    if (beats[0].startFrame !== slice.startFrame) {
      throw new Error(
        `First beat startFrame (${beats[0].startFrame}) does not align with sliceFrameRange.startFrame (${slice.startFrame})`
      );
    }
    if (beats[beats.length - 1].endFrame !== slice.endFrame) {
      throw new Error(
        `Last beat endFrame (${beats[beats.length - 1].endFrame}) does not align with sliceFrameRange.endFrame (${slice.endFrame})`
      );
    }

    const validCastIds = new Set(storyBeatContract.cast.map((c) => c.instanceId));

    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const duration = beat.endFrame - beat.startFrame;

      if (beat.startFrame >= beat.endFrame) {
        throw new Error(
          `Beat "${beat.beatId}" has invalid frame range [${beat.startFrame}, ${beat.endFrame})`
        );
      }

      if (duration < VerbCompiler.MIN_BEAT_LENGTH_FRAMES) {
        throw new Error(
          `Beat "${beat.beatId}" duration (${duration} frames) is shorter than minimum length ${VerbCompiler.MIN_BEAT_LENGTH_FRAMES}`
        );
      }

      if (i > 0) {
        const prev = beats[i - 1];
        if (beat.startFrame < prev.endFrame) {
          throw new Error(
            `Beats "${prev.beatId}" and "${beat.beatId}" overlap: [${prev.startFrame}, ${prev.endFrame}) and [${beat.startFrame}, ${beat.endFrame})`
          );
        }
        if (beat.startFrame > prev.endFrame) {
          throw new Error(
            `Gap detected between beat "${prev.beatId}" (end ${prev.endFrame}) and beat "${beat.beatId}" (start ${beat.startFrame})`
          );
        }
      }

      for (const charId of beat.presentCharacters) {
        if (!validCastIds.has(charId)) {
          throw new Error(
            `Beat "${beat.beatId}" references undefined character instanceId "${charId}" in presentCharacters`
          );
        }
      }

      if (beat.camera?.focalCharacterId && !validCastIds.has(beat.camera.focalCharacterId)) {
        throw new Error(
          `Beat "${beat.beatId}" references undefined character instanceId "${beat.camera.focalCharacterId}" as camera focalCharacterId`
        );
      }

      const landmarkPropSet = new Set(beat.set.landmarkProps ?? []);
      for (const a of beat.actions) {
        if (!validCastIds.has(a.instanceId)) {
          throw new Error(
            `Beat "${beat.beatId}" action references undefined character instanceId "${a.instanceId}"`
          );
        }
        if (a.target?.kind === 'character' && !validCastIds.has(a.target.targetId)) {
          throw new Error(
            `Beat "${beat.beatId}" action target references undefined character targetId "${a.target.targetId}"`
          );
        }
        if (a.associatedPropId && !landmarkPropSet.has(a.associatedPropId)) {
          throw new Error(
            `Beat "${beat.beatId}" action references associatedPropId "${a.associatedPropId}" not present in set.landmarkProps`
          );
        }
        if (a.target?.kind === 'prop' && !landmarkPropSet.has(a.target.propId)) {
          throw new Error(
            `Beat "${beat.beatId}" action target references prop "${a.target.propId}" not present in set.landmarkProps`
          );
        }
      }
    }
  }

  public static compile(
    storyBeatContract: StoryBeatContract,
    audioManifest?: AudioAnalysisManifest
  ): CompiledStoryBeatProduction {
    VerbCompiler.validateStoryBeatContract(storyBeatContract);

    const fps: ValidFps = storyBeatContract.fps === VERB_CONSTANTS.FPS_60 ? VERB_CONSTANTS.FPS_60 : VERB_CONSTANTS.FPS_30;
    const totalFrames = storyBeatContract.sliceFrameRange.endFrame;
    const beats = storyBeatContract.beats;

    // 1. Build Rigs
    const rigs = new Map<string, AssetRigContract>();
    for (const castItem of storyBeatContract.cast) {
      const rig = ArchetypeFactory.build({
        instanceId: castItem.instanceId,
        spec: {
          instanceId: castItem.instanceId,
          archetypeId: castItem.archetypeId,
          scale: 1.0,
          paletteOverrides: castItem.palette,
          accessories: []
        },
        fps
      });
      rigs.set(rig.id, rig);
    }

    const propIds = new Set<string>();
    for (const b of beats) {
      for (const p of b.set.landmarkProps ?? []) {
        if (PropFactory.isNarrativePropId(p)) propIds.add(p);
      }
      for (const a of b.actions) {
        if (a.associatedPropId && PropFactory.isNarrativePropId(a.associatedPropId)) {
          propIds.add(a.associatedPropId);
        }
        if (a.target?.kind === 'prop' && PropFactory.isNarrativePropId(a.target.propId)) {
          propIds.add(a.target.propId);
        }
      }
    }

    const propStates = new Map<string, PropRuntimeState>();
    for (const propId of propIds) {
      const basePos = VerbCompiler.resolveInitialPropPlacement(propId, beats, storyBeatContract.cast);
      const propRig = PropFactory.buildStandalonePropRig(propId as NarrativePropId, propId, basePos);
      rigs.set(propRig.id, propRig);
      propStates.set(propId, {
        held: false,
        heldBy: null,
        released: false,
        currentPosition: basePos,
        currentRotationZ: 0
      });
    }

    // 2. Deterministic Shot Subdivision when fewer than 3 beats exist
    const shotSubdivisions: ShotSubdivisionEntry[] = [];

    interface IntermediateShotPlan {
      shotId: string;
      beatIndex: number;
      startFrame: number;
      endFrame: number;
      uStart: number;
      uEnd: number;
    }

    const shotPlans: IntermediateShotPlan[] = [];

    if (beats.length === 1) {
      const b = beats[0];
      const L = totalFrames;
      const f1 = Math.max(1, Math.floor(L / VERB_CONSTANTS.CANONICAL_ACT_COUNT));
      const f2 = Math.max(f1 + 1, Math.floor((2 * L) / VERB_CONSTANTS.CANONICAL_ACT_COUNT));

      const ranges = [
        { startFrame: 0, endFrame: f1 },
        { startFrame: f1, endFrame: f2 },
        { startFrame: f2, endFrame: totalFrames }
      ];

      for (let sIdx = 0; sIdx < ranges.length; sIdx++) {
        const r = ranges[sIdx];
        const sId = `${b.beatId}_sub${sIdx + 1}`;
        shotPlans.push({
          shotId: sId,
          beatIndex: 0,
          startFrame: r.startFrame,
          endFrame: r.endFrame,
          uStart: r.startFrame / L,
          uEnd: r.endFrame / L
        });
        shotSubdivisions.push({
          originalBeatId: b.beatId,
          subShotId: sId,
          subShotIndex: sIdx,
          frameRange: { startFrameInclusive: r.startFrame, endFrameExclusive: r.endFrame }
        });
      }
    } else if (beats.length === 2) {
      const b0 = beats[0];
      const b1 = beats[1];
      const L0 = b0.endFrame - b0.startFrame;
      const L1 = b1.endFrame - b1.startFrame;

      if (L0 >= L1) {
        const mid = b0.startFrame + Math.max(1, Math.floor(L0 / 2));
        const sub0_1 = `${b0.beatId}_sub1`;
        const sub0_2 = `${b0.beatId}_sub2`;
        shotPlans.push({
          shotId: sub0_1,
          beatIndex: 0,
          startFrame: b0.startFrame,
          endFrame: mid,
          uStart: 0,
          uEnd: (mid - b0.startFrame) / L0
        });
        shotPlans.push({
          shotId: sub0_2,
          beatIndex: 0,
          startFrame: mid,
          endFrame: b0.endFrame,
          uStart: (mid - b0.startFrame) / L0,
          uEnd: 1.0
        });
        shotSubdivisions.push(
          {
            originalBeatId: b0.beatId,
            subShotId: sub0_1,
            subShotIndex: 0,
            frameRange: { startFrameInclusive: b0.startFrame, endFrameExclusive: mid }
          },
          {
            originalBeatId: b0.beatId,
            subShotId: sub0_2,
            subShotIndex: 1,
            frameRange: { startFrameInclusive: mid, endFrameExclusive: b0.endFrame }
          }
        );
        shotPlans.push({
          shotId: b1.beatId,
          beatIndex: 1,
          startFrame: b1.startFrame,
          endFrame: b1.endFrame,
          uStart: 0,
          uEnd: 1.0
        });
      } else {
        shotPlans.push({
          shotId: b0.beatId,
          beatIndex: 0,
          startFrame: b0.startFrame,
          endFrame: b0.endFrame,
          uStart: 0,
          uEnd: 1.0
        });
        const mid = b1.startFrame + Math.max(1, Math.floor(L1 / 2));
        const sub1_1 = `${b1.beatId}_sub1`;
        const sub1_2 = `${b1.beatId}_sub2`;
        shotPlans.push({
          shotId: sub1_1,
          beatIndex: 1,
          startFrame: b1.startFrame,
          endFrame: mid,
          uStart: 0,
          uEnd: (mid - b1.startFrame) / L1
        });
        shotPlans.push({
          shotId: sub1_2,
          beatIndex: 1,
          startFrame: mid,
          endFrame: b1.endFrame,
          uStart: (mid - b1.startFrame) / L1,
          uEnd: 1.0
        });
        shotSubdivisions.push(
          {
            originalBeatId: b1.beatId,
            subShotId: sub1_1,
            subShotIndex: 0,
            frameRange: { startFrameInclusive: b1.startFrame, endFrameExclusive: mid }
          },
          {
            originalBeatId: b1.beatId,
            subShotId: sub1_2,
            subShotIndex: 1,
            frameRange: { startFrameInclusive: mid, endFrameExclusive: b1.endFrame }
          }
        );
      }
    } else {
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        shotPlans.push({
          shotId: b.beatId,
          beatIndex: i,
          startFrame: i === 0 ? 0 : b.startFrame,
          endFrame: i === beats.length - 1 ? totalFrames : b.endFrame,
          uStart: 0,
          uEnd: 1.0
        });
      }
    }

    const n = shotPlans.length;
    const idx1 = Math.max(1, Math.min(n - 2, Math.floor(n / VERB_CONSTANTS.CANONICAL_ACT_COUNT)));
    const idx2 = Math.max(idx1 + 1, Math.min(n - 1, Math.floor((2 * n) / VERB_CONSTANTS.CANONICAL_ACT_COUNT)));
    const act2Start = shotPlans[idx1].startFrame;
    const act3Start = shotPlans[idx2].startFrame;

    const acts: [StoryboardAct, StoryboardAct, StoryboardAct] = [
      {
        actNumber: 1,
        title: 'Act I - Introduction',
        narrativeArc: 'Exposition & Approach',
        frameRange: { startFrameInclusive: 0, endFrameExclusive: act2Start }
      },
      {
        actNumber: 2,
        title: 'Act II - Turning Point',
        narrativeArc: 'Interaction & Momentum Shift',
        frameRange: { startFrameInclusive: act2Start, endFrameExclusive: act3Start }
      },
      {
        actNumber: VERB_CONSTANTS.CANONICAL_ACT_COUNT,
        title: 'Act III - Climax & Resolution',
        narrativeArc: 'Climax & Departure',
        frameRange: { startFrameInclusive: act3Start, endFrameExclusive: totalFrames }
      }
    ];

    // 3. Pre-simulate character positions per beat for dynamic camera framing
    const beatCharX: Array<Record<string, number>> = [];
    let simX: Record<string, number> = {};
    const isMultiChar = storyBeatContract.cast.length > 1;
    for (let cIdx = 0; cIdx < storyBeatContract.cast.length; cIdx++) {
      const c = storyBeatContract.cast[cIdx];
      simX[c.instanceId] = isMultiChar
        ? (cIdx === 0 ? VERB_CONSTANTS.SIM_TWO_CHAR_LEFT_X : VERB_CONSTANTS.SIM_TWO_CHAR_RIGHT_X) : VERB_CONSTANTS.SIM_HERO_INITIAL_X;
    }
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      if (i > 0 && beat.set.kitId !== beats[i - 1].set.kitId) {
        simX[storyBeatContract.cast[0]?.instanceId ?? ''] = VERB_CONSTANTS.SIM_HERO_INITIAL_X;
        if (storyBeatContract.cast[1]) {
          simX[storyBeatContract.cast[1].instanceId] = VERB_CONSTANTS.SIM_COMPANION_INITIAL_X;
        }
      }
      beatCharX.push({ ...simX });
      const nextSimX = { ...simX };
      for (const a of beat.actions) {
        const cur = simX[a.instanceId] ?? 0;
        const otherId = beat.presentCharacters.find((id) => id !== a.instanceId);
        const otherCur = otherId ? simX[otherId] : undefined;
        if (a.verb === 'walk_to' || a.verb === 'run_to') {
          let tPos: number | undefined;
          if (a.target?.kind === 'position') {
            tPos = a.target.pos[0];
          } else if (a.associatedPropId && rigs.has(a.associatedPropId)) {
            const propPos = rigs.get(a.associatedPropId)!.baseTransform.position;
            tPos = propPos[0] + (cur <= propPos[0] ? -VERB_CONSTANTS.PROP_APPROACH_CLEARANCE : VERB_CONSTANTS.PROP_APPROACH_CLEARANCE);
          } else if (otherCur !== undefined) {
            if (cur < VERB_CONSTANTS.SIM_DEEP_ROOM_THRESHOLD && otherCur < VERB_CONSTANTS.SIM_DEEP_ROOM_THRESHOLD) tPos = cur <= otherCur ? VERB_CONSTANTS.SIM_DEEP_ROOM_FORWARD_LEFT : VERB_CONSTANTS.SIM_DEEP_ROOM_FORWARD_RIGHT; else tPos = cur <= otherCur ? VERB_CONSTANTS.SIM_CROSS_ROOM_POS_A : VERB_CONSTANTS.SIM_CROSS_ROOM_POS_B;
          } else {
            const firstProp = Array.from(rigs.values()).find((r) => r.type === 'prop');
            if (firstProp) {
              const pX = firstProp.baseTransform.position[0];
              tPos = pX + (cur <= pX ? -VERB_CONSTANTS.PROP_APPROACH_CLEARANCE : VERB_CONSTANTS.PROP_APPROACH_CLEARANCE);
            } else {
              tPos = a.verb === 'run_to' ? VERB_CONSTANTS.SIM_DEEP_ROOM_FORWARD_RIGHT : Math.min(VERB_CONSTANTS.PROP_APPROACH_CLEARANCE, -cur * VERB_CONSTANTS.BLINK_INTERVAL_RATIO);
            }
          }

          const deltaF = beat.endFrame - beat.startFrame;
          const moveF = deltaF > 1 ? deltaF - 1 : deltaF;
          const charArchetype = storyBeatContract.cast.find((c) => c.instanceId === a.instanceId)?.archetypeId;
          const charScaleX = charArchetype === 'companion_silhouette' ? VERB_CONSTANTS.COMPANION_SCALE_X : VERB_CONSTANTS.HERO_SCALE_X;
          const maxDist = VERB_CONSTANTS.MAX_GAIT_TIME_SCALE * ((VERB_CONSTANTS.RUN_STRIDE_LENGTH * charScaleX) / VERB_CONSTANTS.RUN_LOOP_FRAMES) * moveF;
          const requestedDist = Math.abs(tPos - cur);
          if (requestedDist > maxDist) {
            const dir = tPos >= cur ? 1 : -1;
            nextSimX[a.instanceId] = cur + dir * maxDist;
          } else {
            nextSimX[a.instanceId] = tPos;
          }
        } else if (a.verb === 'carry_put_down') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          nextSimX[a.instanceId] = tPos !== undefined ? tPos : (cur <= 0 ? cur - VERB_CONSTANTS.SIM_DEFAULT_STEP_DISTANCE : cur + VERB_CONSTANTS.SIM_DEFAULT_STEP_DISTANCE);
        } else if (a.verb === 'reach_and_grasp') {
          const nextHasEmbrace = i + 1 < beats.length && beats[i + 1].actions.some((act) => act.verb === 'embrace_push_away');
          if (nextHasEmbrace && cur < VERB_CONSTANTS.SIM_CONFRONT_END_X) {
            nextSimX[a.instanceId] = VERB_CONSTANTS.SIM_CONFRONT_END_X;
          }
        } else if (a.verb === 'gesture_point') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          if (tPos !== undefined) nextSimX[a.instanceId] = tPos;
          else if (cur < VERB_CONSTANTS.SIM_WALL_THRESHOLD) nextSimX[a.instanceId] = cur + VERB_CONSTANTS.SIM_RETREAT_STEP_DISTANCE;
          else nextSimX[a.instanceId] = cur;
        } else if (a.verb === 'embrace_push_away') {
          if (otherCur !== undefined) {
            const isLeft = cur <= otherCur;
            const recoilEnd = VERB_CONSTANTS.EMBRACE_CONTACT_HALF_SEPARATION + VERB_CONSTANTS.RECOIL_SEPARATION_DISTANCE;
            nextSimX[a.instanceId] = isLeft ? -recoilEnd : recoilEnd;
          }
        }
      }
      simX = nextSimX;
    }

    // 4. Build Base Beat Camera Specs and Storyboard Shots
    const baseBeatShots = beats.map((beat, i) => {
      const framing: CameraFraming =
        beat.camera.framing === 'INSERT' ? 'EXTREME_CLOSE_UP' : beat.camera.framing;
      const movement: CameraMovement =
        beat.camera.movement === 'ARC' ? 'ORBIT' : beat.camera.movement;

      const palette = PALETTE_TONE_MAP[beat.emotionalTone] ?? THEME_PALETTES.CYBERPUNK_CYAN;
      const distZ = FRAMING_DISTANCE_MAP[framing] ?? VERB_CONSTANTS.DEFAULT_FALLBACK_CAM_DIST_Z;

      const isReachGrasp = beat.actions.some((a) => a.verb === 'reach_and_grasp');
      const isGesturePoint = beat.actions.some((a) => a.verb === 'gesture_point');
      const hasOverheadProp =
        beat.set.landmarkProps?.includes('umbrella') ||
        beat.actions.some((a) => a.associatedPropId === 'umbrella');

      // Camera focal point, target, and headroom math
      let focalX: number;
      let targetY: number;
      let camY: number;
      let effectiveFraming = framing;
      let effectiveDistZ: number = distZ;

      const lookOffset = beat.camera.lookRoom === 'left' ? -VERB_CONSTANTS.CAM_LOOK_ROOM_OFFSET : beat.camera.lookRoom === 'right' ? VERB_CONSTANTS.CAM_LOOK_ROOM_OFFSET : 0;
      const charPositions = beatCharX[i];
      const focalId = beat.camera.focalCharacterId;
      const focalPos = charPositions[focalId] ?? 0;
      const otherPresentId = beat.presentCharacters.find((id) => id !== focalId);
      const isTwoShot =
        beat.presentCharacters.length >= 2 &&
        (effectiveFraming === 'WIDE' || effectiveFraming === 'MEDIUM');

      if (isReachGrasp) {
        effectiveFraming = 'CLOSE_UP';
        effectiveDistZ = beat.presentCharacters.length >= 2
          ? VERB_CONSTANTS.CAM_CLOSE_UP_OVERHEAD_DIST_Z
          : VERB_CONSTANTS.CAM_CLOSE_UP_REACH_DIST_Z;
        focalX = VERB_CONSTANTS.CAM_CLOSE_UP_REACH_FOCAL_X;
        targetY = VERB_CONSTANTS.CAM_CLOSE_UP_REACH_TARGET_Y;
        camY = VERB_CONSTANTS.CAM_CLOSE_UP_REACH_CAM_Y;
      } else if (isGesturePoint) {
        effectiveFraming = 'CLOSE_UP';
        effectiveDistZ = hasOverheadProp ? VERB_CONSTANTS.CAM_CLOSE_UP_OVERHEAD_DIST_Z : FRAMING_DISTANCE_MAP.CLOSE_UP;
        focalX = focalPos;
        targetY = hasOverheadProp ? VERB_CONSTANTS.CAM_CLOSE_UP_OVERHEAD_TARGET_Y : VERB_CONSTANTS.CAM_CLOSE_UP_BASE_TARGET_Y;
        camY = hasOverheadProp ? VERB_CONSTANTS.CAM_CLOSE_UP_OVERHEAD_CAM_Y : VERB_CONSTANTS.CAM_CLOSE_UP_BASE_CAM_Y;
      } else if (isTwoShot && otherPresentId) {
        const otherPos = charPositions[otherPresentId] ?? 0;
        const midX = (focalPos + otherPos) / 2;
        focalX = midX + lookOffset;
        targetY = effectiveFraming === 'WIDE' ? VERB_CONSTANTS.CAM_WIDE_TARGET_Y : VERB_CONSTANTS.CAM_MEDIUM_TARGET_Y;
        camY = targetY + VERB_CONSTANTS.CAM_TWO_SHOT_OFFSET_Y;
      } else {
        focalX = focalPos + lookOffset;
        const focalCast = storyBeatContract.cast.find((c) => c.instanceId === focalId);
        const isPartnerFocal =
          focalCast?.role === 'PARTNER' || focalCast?.archetypeId === 'companion_silhouette';
        targetY =
          effectiveFraming === 'EXTREME_CLOSE_UP'
            ? isPartnerFocal
              ? VERB_CONSTANTS.CAM_HEADROOM_TARGET_Y
              : VERB_CONSTANTS.CAM_CLOSE_UP_REACH_TARGET_Y
            : effectiveFraming === 'CLOSE_UP'
              ? isPartnerFocal
                ? (hasOverheadProp ? VERB_CONSTANTS.CAM_EXTREME_CLOSE_UP_OVERHEAD_TARGET_Y : VERB_CONSTANTS.CAM_EXTREME_CLOSE_UP_BASE_TARGET_Y)
                : (hasOverheadProp ? VERB_CONSTANTS.CAM_CLOSE_UP_OVERHEAD_TARGET_Y : VERB_CONSTANTS.CAM_CLOSE_UP_BASE_TARGET_Y)
              : VERB_CONSTANTS.CAM_WIDE_TARGET_Y;
        camY = targetY + VERB_CONSTANTS.CAM_TWO_SHOT_OFFSET_Y;
        if (hasOverheadProp && effectiveFraming === 'CLOSE_UP') {
          effectiveDistZ = Math.max(effectiveDistZ, VERB_CONSTANTS.CAM_CLOSE_UP_OVERHEAD_DIST_Z);
        }
      }

      const deltaPan = movement === 'PAN' ? VERB_CONSTANTS.CAM_PAN_DELTA_X : 0;
      const deltaDolly = movement === 'DOLLY' ? -VERB_CONSTANTS.SIM_DEEP_ROOM_FORWARD_LEFT : 0;
      const dutchAngle = (isReachGrasp || isGesturePoint) ? 0 : (beat.camera.dutchAngleDeg ?? 0);

      const activePropIds: string[] = [];
      for (const propId of propIds) {
        let introducedInScene = false;
        for (let j = 0; j <= i; j++) {
          if (beats[j].set.kitId !== beat.set.kitId) {
            introducedInScene = false;
            continue;
          }
          if (
            beats[j].set.landmarkProps?.includes(propId) ||
            beats[j].actions.some(
              (a) => a.associatedPropId === propId || (a.target?.kind === 'prop' && a.target.propId === propId)
            )
          ) {
            introducedInScene = true;
          }
        }
        if (introducedInScene) {
          activePropIds.push(propId);
        }
      }

      const activeRigIds = [
        ...beat.presentCharacters,
        ...activePropIds
      ].filter((id, idx, arr) => arr.indexOf(id) === idx && rigs.has(id));

      const cameraStart: CameraTransform = {
        position: [focalX - VERB_CONSTANTS.CAM_TWO_SHOT_OFFSET_Y, camY, effectiveDistZ],
        target: [focalX, targetY, 0],
        up: [0, 1, 0],
        verticalFovDegrees: VERB_CONSTANTS.DEFAULT_CAMERA_FOV,
        rollDegrees: dutchAngle,
        projectionMode: 'perspective',
        nearPlane: 1,
        farPlane: VERB_CONSTANTS.DEFAULT_FAR_PLANE
      };

      const cameraEnd: CameraTransform = {
        position: [focalX - VERB_CONSTANTS.CAM_TWO_SHOT_OFFSET_Y + deltaPan, camY, effectiveDistZ + deltaDolly],
        target: [focalX + deltaPan, targetY, 0],
        up: [0, 1, 0],
        verticalFovDegrees: VERB_CONSTANTS.DEFAULT_CAMERA_FOV,
        rollDegrees: dutchAngle,
        projectionMode: 'perspective',
        nearPlane: 1,
        farPlane: VERB_CONSTANTS.DEFAULT_FAR_PLANE
      };

      return {
        effectiveFraming,
        movement,
        palette,
        activeRigIds,
        cameraStart,
        cameraEnd
      };
    });

    const shots: CinematicShot[] = [];
    const invisibleCuts: InvisibleCutEntry[] = [];

    for (let j = 0; j < shotPlans.length; j++) {
      const sp = shotPlans[j];
      const beat = beats[sp.beatIndex];
      const base = baseBeatShots[sp.beatIndex];
      const actNumber: CanonicalActNumber = (j < idx1 ? 1 : j < idx2 ? 2 : VERB_CONSTANTS.CANONICAL_ACT_COUNT) as CanonicalActNumber;
      const prevActNumber: CanonicalActNumber | undefined = j > 0
        ? ((j - 1 < idx1 ? 1 : j - 1 < idx2 ? 2 : VERB_CONSTANTS.CANONICAL_ACT_COUNT) as CanonicalActNumber)
        : undefined;

      const camStart = sp.uStart === 0
        ? base.cameraStart
        : lerpCameraTransform(base.cameraStart, base.cameraEnd, sp.uStart);
      const camEnd = sp.uEnd === 1.0
        ? base.cameraEnd
        : lerpCameraTransform(base.cameraStart, base.cameraEnd, sp.uEnd);

      const shotDuration = sp.endFrame - sp.startFrame;
      const prevShotDuration = j > 0 ? (shotPlans[j - 1].endFrame - shotPlans[j - 1].startFrame) : shotDuration;
      const maxClamp = Math.min(shotDuration, prevShotDuration);

      let transType: 'cut' | 'dissolve' | 'dip_to_black';
      let transDuration: number;

      const prevSetKitId = j > 0 ? beats[shotPlans[j - 1].beatIndex].set.kitId : undefined;
      if (beat.transition) {
        transType = beat.transition;
        transDuration = beat.transition === 'cut'
          ? 0
          : Math.min(maxClamp, beat.transitionDurationFrames ?? VERB_CONSTANTS.TRANSITION_DEFAULT_DIP_FRAMES);
      } else if (j === 0) {
        transType = 'dip_to_black';
        transDuration = Math.min(shotDuration, VERB_CONSTANTS.TRANSITION_DEFAULT_DIP_FRAMES);
      } else if (prevActNumber !== undefined && actNumber !== prevActNumber && beat.set.kitId !== prevSetKitId) {
        transType = 'dip_to_black';
        transDuration = Math.min(maxClamp, VERB_CONSTANTS.TRANSITION_DEFAULT_DIP_FRAMES);
      } else {
        transType = 'cut';
        transDuration = 0;
      }

      let transOutType: 'cut' | 'dissolve' | 'dip_to_black' | undefined;
      let transOutDuration = 0;
      if (j === shotPlans.length - 1) {
        transOutType = 'dip_to_black';
        transOutDuration = Math.min(shotDuration, VERB_CONSTANTS.TRANSITION_DEFAULT_DIP_FRAMES);
      }

      shots.push({
        id: sp.shotId,
        shotIndex: j,
        actNumber,
        frameRange: {
          startFrameInclusive: sp.startFrame,
          endFrameExclusive: sp.endFrame
        },
        framing: base.effectiveFraming,
        movement: base.movement,
        viewpoint: 'OBJECTIVE_THIRD_PERSON',
        activeRigIds: base.activeRigIds,
        theatricalSetId: beat.set.kitId,
        palette: base.palette,
        narrativeAction: beat.narrativeSubtext || 'Action',
        cameraStart: camStart,
        cameraEnd: camEnd,
        cameraEasing: 'linear',
        transitionIn: { type: transType, durationFrames: transDuration },
        ...(transOutType ? { transitionOut: { type: transOutType, durationFrames: transOutDuration } } : {})
      });

      if (j > 0) {
        const camPrev = shots[j - 1].cameraEnd;
        const camNext = camStart;
        const framingDiff = Math.abs(camPrev.position[2] - camNext.position[2]);
        const rollDiff = Math.abs((camPrev.rollDegrees ?? 0) - (camNext.rollDegrees ?? 0));
        const dx1 = camPrev.target[0] - camPrev.position[0];
        const dz1 = camPrev.target[2] - camPrev.position[2];
        const dx2 = camNext.target[0] - camNext.position[0];
        const dz2 = camNext.target[2] - camNext.position[2];
        const angle1 = Math.atan2(dx1, dz1) / VERB_CONSTANTS.DEG_TO_RAD;
        const angle2 = Math.atan2(dx2, dz2) / VERB_CONSTANTS.DEG_TO_RAD;
        let angleDiff = Math.abs(angle1 - angle2);
        if (angleDiff > VERB_CONSTANTS.HALF_CIRCLE_DEG) angleDiff = VERB_CONSTANTS.FULL_CIRCLE_DEG - angleDiff;
        const totalAngleDiff = rollDiff + angleDiff;

        if (
          framingDiff < VERB_CONSTANTS.CAMERA_FRAMING_INVISIBLE_CUT_TOLERANCE &&
          totalAngleDiff < VERB_CONSTANTS.CAMERA_ANGLE_INVISIBLE_CUT_TOLERANCE_DEG
        ) {
          invisibleCuts.push({
            boundaryFrame: sp.startFrame,
            fromShotId: shots[j - 1].id,
            toShotId: sp.shotId,
            framingDifference: Number(framingDiff.toFixed(2)),
            angleDifferenceDeg: Number(totalAngleDiff.toFixed(2)),
            reason: `Adjacent cameras differ by only ${framingDiff.toFixed(1)} units in framing and ${totalAngleDiff.toFixed(1)}° in angle, below detection tolerance.`
          });
        }
      }
    }

    // 5. Compile Choreography Tracks
    const tracks: EntityTrack[] = [];
    const charCurrentPos: Record<string, [number, number, number]> = {};
    const charArchetypes: Record<string, string> = {};
    const charPoseClockState: Record<string, { clock: number; lastClip?: { clipId: string; loopFrames: number } }> = {};
    const unfulfilledTiming: UnfulfilledTimingEntry[] = [];
    const unreachableTargets: UnreachableTargetEntry[] = [];
    const leadId = storyBeatContract.cast[0].instanceId;

    const isMultiCast = storyBeatContract.cast.length > 1;
    for (let cIdx = 0; cIdx < storyBeatContract.cast.length; cIdx++) {
      const c = storyBeatContract.cast[cIdx];
      const startX = isMultiCast
        ? (cIdx === 0 ? VERB_CONSTANTS.SIM_TWO_CHAR_LEFT_X : VERB_CONSTANTS.SIM_TWO_CHAR_RIGHT_X) : VERB_CONSTANTS.SIM_HERO_INITIAL_X;
      const baseY = c.archetypeId === 'companion_silhouette' ? VERB_CONSTANTS.COMPANION_BASE_Y : VERB_CONSTANTS.HERO_BASE_Y;
      charCurrentPos[c.instanceId] = [startX, baseY, 0];
      charArchetypes[c.instanceId] = c.archetypeId;
      charPoseClockState[c.instanceId] = { clock: 0 };
    }

    const reachClamps: Array<{
      readonly beatId: string;
      readonly instanceId: string;
      readonly target: [number, number, number];
      readonly clampedReach: number;
      readonly maxReach: number;
    }> = [];

    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const beatStartF = i === 0 ? 0 : beat.startFrame;
      const beatEndF = i === beats.length - 1 ? totalFrames : beat.endFrame;

      if (i > 0 && beat.set.kitId !== beats[i - 1].set.kitId) {
        charCurrentPos[storyBeatContract.cast[0]?.instanceId ?? ''] = [VERB_CONSTANTS.SIM_HERO_INITIAL_X, VERB_CONSTANTS.HERO_BASE_Y, 0];
        if (storyBeatContract.cast[1]) {
          charCurrentPos[storyBeatContract.cast[1].instanceId] = [VERB_CONSTANTS.SIM_COMPANION_INITIAL_X, VERB_CONSTANTS.COMPANION_BASE_Y, 0];
        }
      }

      const presentList = storyBeatContract.cast.filter((c) =>
        beat.presentCharacters.includes(c.instanceId)
      );

      const shotStartPositions = { ...charCurrentPos };
      const nextPositions: Record<string, [number, number, number]> = {};
      const beatTracks: EntityTrack[] = [];

      // Overhead personal prop holder resolution:
      // Attach overhead personal props to trailing/shielded character in parallel movement
      const umbrellaActive =
        baseBeatShots[i].activeRigIds.includes('umbrella') && propStates.has('umbrella');
      const explicitUmbrellaAction = beat.actions.find((a) => a.associatedPropId === 'umbrella');
      let resolvedUmbrellaHolderId = explicitUmbrellaAction?.instanceId;

      if (umbrellaActive && !resolvedUmbrellaHolderId) {
        const pState = propStates.get('umbrella')!;
        if (pState.held && pState.heldBy && beat.presentCharacters.includes(pState.heldBy)) {
          resolvedUmbrellaHolderId = pState.heldBy;
        } else if (presentList.length > 1) {
          const sortedByTrailing = [...presentList].sort((a, b) => {
            const posXA = shotStartPositions[a.instanceId]?.[0] ?? 0;
            const posXB = shotStartPositions[b.instanceId]?.[0] ?? 0;
            const actA = beat.actions.find((act) => act.instanceId === a.instanceId);
            const actB = beat.actions.find((act) => act.instanceId === b.instanceId);
            const tA = actA?.target?.kind === 'position' ? actA.target.pos[0] : posXA;
            const tB = actB?.target?.kind === 'position' ? actB.target.pos[0] : posXB;
            const netDir = (tA - posXA) + (tB - posXB);
            return netDir >= 0 ? posXA - posXB : posXB - posXA;
          });
          resolvedUmbrellaHolderId = sortedByTrailing[0]?.instanceId;
        } else {
          resolvedUmbrellaHolderId = presentList[0]?.instanceId;
        }
      }

      const nextBeatHasEmbrace =
        i + 1 < beats.length && beats[i + 1].actions.some((a) => a.verb === 'embrace_push_away');

      for (let cIdx = 0; cIdx < presentList.length; cIdx++) {
        const char = presentList[cIdx];
        const otherChar = presentList.find((other) => other.instanceId !== char.instanceId);
        const otherPos = otherChar ? shotStartPositions[otherChar.instanceId] : undefined;

        let action = beat.actions.find((a) => a.instanceId === char.instanceId);
        if (action) {
          if (umbrellaActive) {
            if (char.instanceId === resolvedUmbrellaHolderId && !action.associatedPropId) {
              action = { ...action, associatedPropId: 'umbrella' };
            } else if (char.instanceId !== resolvedUmbrellaHolderId && action.associatedPropId === 'umbrella') {
              const { associatedPropId: _, ...rest } = action;
              action = rest as CharacterActionDirective;
            }
          }
        } else {
          action = {
            instanceId: char.instanceId,
            verb: 'walk_to' as const,
            speedNorm: 1.0, intensityNorm: VERB_CONSTANTS.DEFAULT_INTENSITY_NORM,
            ...(umbrellaActive && char.instanceId === resolvedUmbrellaHolderId ? { associatedPropId: 'umbrella' } : {})
          };
        }

        const charTrack = VerbCompiler.compileCharacterAction(
          char.instanceId,
          beat.beatId,
          beatStartF,
          beatEndF,
          action,
          shotStartPositions[char.instanceId] ?? [0, VERB_CONSTANTS.HERO_BASE_Y, 0],
          otherPos,
          charArchetypes[char.instanceId],
          audioManifest,
          beat.emotionalTone,
          charPoseClockState[char.instanceId],
          unfulfilledTiming,
          rigs,
          reachClamps,
          unreachableTargets,
          nextBeatHasEmbrace
        );

        nextPositions[char.instanceId] = charTrack.nextPos;
        charPoseClockState[char.instanceId] = charTrack.nextClockState;
        beatTracks.push(charTrack.track);
      }

      for (const [id, nPos] of Object.entries(nextPositions)) {
        charCurrentPos[id] = nPos;
      }

      // Compile active prop tracks for this shot
      for (const propId of baseBeatShots[i].activeRigIds) {
        if (!propStates.has(propId)) continue;
        const pState = propStates.get(propId)!;

        let actorId = leadId;
        let actorAction = beat.actions.find((a) => a.instanceId === leadId);

        if (propId === 'umbrella' && resolvedUmbrellaHolderId) {
          actorId = resolvedUmbrellaHolderId;
          actorAction = beat.actions.find((a) => a.instanceId === actorId) ?? {
            instanceId: actorId,
            verb: 'walk_to' as const,
            speedNorm: 1.0, intensityNorm: VERB_CONSTANTS.DEFAULT_INTENSITY_NORM,
            associatedPropId: 'umbrella'
          };
        } else {
          const specificAction = beat.actions.find(
            (a) =>
              a.associatedPropId === propId ||
              (a.target?.kind === 'prop' && a.target.propId === propId)
          );
          if (specificAction) {
            actorId = specificAction.instanceId;
            actorAction = specificAction;
          } else if (pState.held && pState.heldBy && beat.presentCharacters.includes(pState.heldBy)) {
            actorId = pState.heldBy;
            actorAction = beat.actions.find((a) => a.instanceId === actorId);
          } else if (pState.held && !pState.released) {
            actorId = presentList[presentList.length - 1]?.instanceId ?? leadId;
            actorAction = beat.actions.find((a) => a.instanceId === actorId);
          } else if (beat.set.landmarkProps.includes(propId) && !pState.released) {
            actorId = presentList[presentList.length - 1]?.instanceId ?? leadId;
            actorAction = beat.actions.find((a) => a.instanceId === actorId);
          }
        }

        const effectiveAction: CharacterActionDirective = actorAction ?? {
          instanceId: actorId,
          verb: 'walk_to' as const,
          speedNorm: 1.0,
          intensityNorm: VERB_CONSTANTS.DEFAULT_INTENSITY_NORM
        };

        const charPos = shotStartPositions[actorId] ?? [0, VERB_CONSTANTS.HERO_BASE_Y, 0];
        const charNextPos = nextPositions[actorId] ?? charPos;
        const charRig = rigs.get(actorId);

        const propResult = VerbCompiler.compilePropAction(
          propId,
          beat.beatId,
          beatStartF,
          beatEndF,
          actorId,
          effectiveAction,
          pState,
          charPos,
          charNextPos,
          charRig,
          nextBeatHasEmbrace
        );

        propStates.set(propId, propResult.nextState);
        beatTracks.push(propResult.track);
      }

      // Map beat tracks to shots
      const plansForBeat = shotPlans.filter((sp) => sp.beatIndex === i);
      if (plansForBeat.length === 1 && plansForBeat[0].shotId === beat.beatId) {
        for (const bt of beatTracks) {
          tracks.push(bt);
        }
      } else {
        for (const sp of plansForBeat) {
          for (const bt of beatTracks) {
            tracks.push(
              VerbCompiler.sliceTrackForSubShot(bt, sp.shotId, sp.startFrame, sp.endFrame)
            );
          }
        }
      }
    }

    const storyboard: DirectorStoryboardContract = {
      projectId: storyBeatContract.projectId,
      resolution: { width: VERB_CONSTANTS.CANVAS_WIDTH, height: VERB_CONSTANTS.CANVAS_HEIGHT },
      fps,
      totalFrames,
      acts,
      shots
    };

    const choreography: ChoreographyContract = {
      version: CHOREOGRAPHY_CONTRACT_VERSION,
      projectId: storyBeatContract.projectId,
      tracks
    };

    return {
      storyboard,
      rigs,
      choreography,
      compileReport: {
        unfulfilledTiming,
        unreachableTargets,
        shotSubdivisions,
        reachClamps,
        invisibleCuts
      }
    };
  }

  /**
   * Slices a parent beat's compiled track into a sub-shot frame range [startF, endF).
   * Ensures transforms, pose segments, and morphs are exact and continuous across sub-shot boundaries.
   */
  public static sliceTrackForSubShot(
    parentTrack: EntityTrack,
    subShotId: string,
    startF: number,
    endF: number
  ): EntityTrack {
    const lastF = endF - 1;
    const parentKeyframes = parentTrack.transform.keyframes;

    const tStart = evaluateTrackTransform(parentKeyframes, startF);
    const tLast = evaluateTrackTransform(parentKeyframes, lastF);

    const subKeyframes: EntityTrackKeyframe[] = [
      {
        frame: startF,
        position: tStart.position,
        rotationZDegrees: tStart.rotationZDegrees,
        scale: tStart.scale,
        opacity: tStart.opacity,
        easing: 'linear'
      }
    ];

    for (const kf of parentKeyframes) {
      if (kf.frame > startF && kf.frame < lastF) {
        subKeyframes.push({ ...kf });
      }
    }

    if (lastF > startF) {
      subKeyframes.push({
        frame: lastF,
        position: tLast.position,
        rotationZDegrees: tLast.rotationZDegrees,
        scale: tLast.scale,
        opacity: tLast.opacity,
        easing: 'linear'
      });
    }

    let subPose: EntityTrack['pose'];
    if (parentTrack.pose) {
      const parentPose = parentTrack.pose;
      if (parentPose.segments && parentPose.segments.length > 0) {
        const subSegments: PoseSegment[] = [];
        for (const seg of parentPose.segments) {
          if (seg.endFrame > startF && seg.startFrame < endF) {
            const s0 = Math.max(startF, seg.startFrame);
            const s1 = Math.min(endF, seg.endFrame);
            const poseOffset = (s0 - seg.startFrame) * seg.timeScale;
            subSegments.push({
              startFrame: s0,
              endFrame: s1,
              clipId: seg.clipId,
              timeScale: seg.timeScale,
              startPoseFrame: seg.startPoseFrame + poseOffset
            });
          }
        }
        subPose = {
          clipId: subSegments[0]?.clipId ?? parentPose.clipId,
          timeScale: subSegments[0]?.timeScale ?? parentPose.timeScale ?? 1,
          startPoseFrame: subSegments[0]?.startPoseFrame ?? parentPose.startPoseFrame ?? 0,
          segments: subSegments
        };
      } else {
        const timeScale = parentPose.timeScale ?? 1.0;
        const baseStartPose = parentPose.startPoseFrame ?? 0;
        const parentStartF = parentKeyframes[0]?.frame ?? startF;
        const startPoseFrame = baseStartPose + (startF - parentStartF) * timeScale;
        subPose = {
          clipId: parentPose.clipId,
          timeScale,
          startPoseFrame
        };
      }
    }

    const subMorphKeyframes: Record<string, Array<{ frame: number; weight: number }>> = {};
    if (parentTrack.morphKeyframes) {
      for (const [channel, mKeyframes] of Object.entries(parentTrack.morphKeyframes)) {
        if (!mKeyframes || mKeyframes.length === 0) continue;
        const wStart = evaluateMorphKeyframes(mKeyframes, startF);
        const wLast = evaluateMorphKeyframes(mKeyframes, lastF);
        const subM: Array<{ frame: number; weight: number }> = [{ frame: startF, weight: wStart }];
        for (const mkf of mKeyframes) {
          if (mkf.frame > startF && mkf.frame < lastF) {
            subM.push({ frame: mkf.frame, weight: mkf.weight });
          }
        }
        if (lastF > startF) {
          subM.push({ frame: lastF, weight: wLast });
        }
        subMorphKeyframes[channel] = subM;
      }
    }

    let subAttachmentSpans: PropAttachmentSpan[] | undefined;
    if (parentTrack.attachmentSpans) {
      const list: PropAttachmentSpan[] = [];
      for (const span of parentTrack.attachmentSpans) {
        if (span.endFrame > startF && span.startFrame < endF) {
          const s0 = Math.max(startF, span.startFrame);
          const s1 = Math.min(endF, span.endFrame);
          if (s1 > s0) {
            list.push({
              ownerRigId: span.ownerRigId,
              socketId: span.socketId,
              startFrame: s0,
              endFrame: s1
            });
          }
        }
      }
      if (list.length > 0) subAttachmentSpans = list;
    }

    let subIkTargets: IkTarget[] | undefined;
    if (parentTrack.ikTargets && parentTrack.ikTargets.length > 0) {
      const list: IkTarget[] = [];
      for (const ik of parentTrack.ikTargets) {
        if (ik.frame !== undefined) {
          if (ik.frame >= startF && ik.frame < endF) {
            list.push({ ...ik });
          }
        } else if (ik.startFrame !== undefined && ik.endFrame !== undefined) {
          if (ik.endFrame > startF && ik.startFrame < endF) {
            list.push({
              ...ik,
              startFrame: Math.max(startF, ik.startFrame),
              endFrame: Math.min(endF, ik.endFrame)
            });
          }
        } else {
          list.push({ ...ik });
        }
      }
      if (list.length > 0) subIkTargets = list;
    }

    let subGazeTargets: GazeTarget[] | undefined;
    if (parentTrack.gazeTargets && parentTrack.gazeTargets.length > 0) {
      const list: GazeTarget[] = [];
      for (const gaze of parentTrack.gazeTargets) {
        if (gaze.frame !== undefined) {
          if (gaze.frame >= startF && gaze.frame < endF) {
            list.push({ ...gaze });
          }
        } else if (gaze.startFrame !== undefined && gaze.endFrame !== undefined) {
          if (gaze.endFrame > startF && gaze.startFrame < endF) {
            list.push({
              ...gaze,
              startFrame: Math.max(startF, gaze.startFrame),
              endFrame: Math.min(endF, gaze.endFrame)
            });
          }
        } else {
          list.push({ ...gaze });
        }
      }
      if (list.length > 0) subGazeTargets = list;
    }

    return {
      shotId: subShotId,
      rigId: parentTrack.rigId,
      transform: { keyframes: subKeyframes },
      pose: subPose,
      morphKeyframes: subMorphKeyframes,
      morphBindings: parentTrack.morphBindings ? [...parentTrack.morphBindings] : [],
      attachmentSpans: subAttachmentSpans,
      ikTargets: subIkTargets,
      gazeTargets: subGazeTargets
    };
  }

  /**
   * Plans contact-locked gait locomotion according to physical stride constraints:
   * timeScale = v * loopFrames / (|scaleX| * strideLengthUnits) within [0.6, 1.6].
   */
  public static planLocomotionGait(
    distance: number,
    availableFrames: number,
    speedNorm: number,
    scaleX: number,
    isRunVerb: boolean,
    targetArriveF?: number
  ): LocomotionPlanResult {
    const absScaleX = Math.abs(scaleX) || 1.0;
    const loopWalk = VERB_CONSTANTS.WALK_LOOP_FRAMES;
    const strideWalk = VERB_CONSTANTS.WALK_STRIDE_LENGTH;
    const vNomWalk = (strideWalk * absScaleX) / loopWalk;

    const loopRun = VERB_CONSTANTS.RUN_LOOP_FRAMES;
    const strideRun = VERB_CONSTANTS.RUN_STRIDE_LENGTH;
    const vNomRun = (strideRun * absScaleX) / loopRun;

    if (distance < EPSILON_SPEED || availableFrames <= 0) {
      return {
        chosenClipId: 'idle',
        loopFrames: VERB_CONSTANTS.IDLE_LOOP_FRAMES, strideLengthUnits: 0,
        timeScale: 1.0,
        tMove: availableFrames,
        arriveF: availableFrames,
        vActual: 0,
        isEarlyArrival: false
      };
    }

    let maxMoveFrames = availableFrames;
    if (targetArriveF !== undefined && targetArriveF > 0 && targetArriveF < availableFrames) {
      maxMoveFrames = targetArriveF;
    }

    // Maximum physically achievable speed across valid gaits (max timeScale = 1.6 on fastest clip sprint_frenzy)
    const vMax = VERB_CONSTANTS.MAX_GAIT_TIME_SCALE * vNomRun;
    const maxAchievableDistance = vMax * maxMoveFrames;

    if (distance > maxAchievableDistance + EPSILON_DISTANCE) {
      const achievableDistance = Number(maxAchievableDistance.toFixed(VERB_CONSTANTS.PRECISION_DECIMALS));
      const tMove = maxMoveFrames;
      const vActual = vMax;
      const timeScale = VERB_CONSTANTS.MAX_GAIT_TIME_SCALE;
      const minimumFramesNeeded = Math.ceil(distance / vMax);
      const suggestedSpeedNorm = Number((distance / (maxMoveFrames * vNomRun)).toFixed(2));
      const isEarlyArrival = tMove < availableFrames;

      return {
        chosenClipId: 'sprint_frenzy',
        loopFrames: loopRun,
        strideLengthUnits: strideRun,
        timeScale,
        tMove,
        arriveF: tMove,
        vActual,
        isEarlyArrival,
        isUnreachable: true,
        requestedDistance: distance,
        achievableDistance,
        minimumFramesNeeded,
        suggestedSpeedNorm,
        unfulfilledReason: `Target distance ${distance} unreachable in ${availableFrames} frames (max ${achievableDistance.toFixed(1)}); moved at max speed and stopped at farthest point`
      };
    }

    const vReq = distance / maxMoveFrames;
    const vDesired = Math.max(vReq, vReq * speedNorm);

    let chosenClipId = isRunVerb ? 'sprint_frenzy' : 'walk_to';
    let chosenLoop = isRunVerb ? loopRun : loopWalk;
    let chosenStride = isRunVerb ? strideRun : strideWalk;
    let targetSpeed = vDesired;
    let unfulfilledReason: string | undefined;

    const tsWalk = vDesired / vNomWalk;
    const tsRun = vDesired / vNomRun;

    if (isRunVerb) {
      if (tsRun >= VERB_CONSTANTS.MIN_GAIT_TIME_SCALE && tsRun <= VERB_CONSTANTS.MAX_GAIT_TIME_SCALE) {
        chosenClipId = 'sprint_frenzy';
        chosenLoop = loopRun;
        chosenStride = strideRun;
        targetSpeed = vDesired;
      } else if (tsRun < VERB_CONSTANTS.MIN_GAIT_TIME_SCALE) {
        if (tsWalk >= VERB_CONSTANTS.MIN_GAIT_TIME_SCALE && tsWalk <= VERB_CONSTANTS.MAX_GAIT_TIME_SCALE) {
          chosenClipId = 'walk_to';
          chosenLoop = loopWalk;
          chosenStride = strideWalk;
          targetSpeed = vDesired;
        } else if (tsWalk < VERB_CONSTANTS.MIN_GAIT_TIME_SCALE) {
          chosenClipId = 'walk_to';
          chosenLoop = loopWalk;
          chosenStride = strideWalk;
          targetSpeed = VERB_CONSTANTS.MIN_GAIT_TIME_SCALE * vNomWalk;
          unfulfilledReason = 'Speed below minimum valid gait timeScale 0.6; arrived early and held in place';
        } else {
          chosenClipId = 'sprint_frenzy';
          chosenLoop = loopRun;
          chosenStride = strideRun;
          targetSpeed = VERB_CONSTANTS.MIN_GAIT_TIME_SCALE * vNomRun;
          unfulfilledReason = 'Speed below minimum run timeScale 0.6; arrived early and held in place';
        }
      } else {
        chosenClipId = 'sprint_frenzy';
        chosenLoop = loopRun;
        chosenStride = strideRun;
        targetSpeed = VERB_CONSTANTS.MAX_GAIT_TIME_SCALE * vNomRun;
        unfulfilledReason = 'Target beyond maximum locomotion speed; clamped to max timeScale 1.6';
      }
    } else {
      if (tsWalk >= VERB_CONSTANTS.MIN_GAIT_TIME_SCALE && tsWalk <= VERB_CONSTANTS.MAX_GAIT_TIME_SCALE) {
        chosenClipId = 'walk_to';
        chosenLoop = loopWalk;
        chosenStride = strideWalk;
        targetSpeed = vDesired;
      } else if (tsWalk > VERB_CONSTANTS.MAX_GAIT_TIME_SCALE) {
        if (tsRun >= VERB_CONSTANTS.MIN_GAIT_TIME_SCALE && tsRun <= VERB_CONSTANTS.MAX_GAIT_TIME_SCALE) {
          chosenClipId = 'sprint_frenzy';
          chosenLoop = loopRun;
          chosenStride = strideRun;
          targetSpeed = vDesired;
        } else if (tsRun < VERB_CONSTANTS.MIN_GAIT_TIME_SCALE) {
          chosenClipId = 'sprint_frenzy';
          chosenLoop = loopRun;
          chosenStride = strideRun;
          targetSpeed = VERB_CONSTANTS.MIN_GAIT_TIME_SCALE * vNomRun;
          unfulfilledReason = 'Switched to run at min timeScale 0.6; arrived early and held in place';
        } else {
          chosenClipId = 'sprint_frenzy';
          chosenLoop = loopRun;
          chosenStride = strideRun;
          targetSpeed = VERB_CONSTANTS.MAX_GAIT_TIME_SCALE * vNomRun;
          unfulfilledReason = 'Target beyond maximum locomotion speed; clamped to max timeScale 1.6';
        }
      } else {
        chosenClipId = 'walk_to';
        chosenLoop = loopWalk;
        chosenStride = strideWalk;
        targetSpeed = VERB_CONSTANTS.MIN_GAIT_TIME_SCALE * vNomWalk;
        unfulfilledReason = 'Speed below minimum walk timeScale 0.6; arrived early and held in place';
      }
    }

    const rawFrames = Math.max(1, Math.round(distance / targetSpeed));
    const tMove = Math.min(availableFrames, rawFrames);
    const vActual = distance / tMove;
    const rawTimeScale = (vActual * chosenLoop) / (chosenStride * absScaleX);
    const timeScale = Number(Math.max(VERB_CONSTANTS.MIN_GAIT_TIME_SCALE, Math.min(VERB_CONSTANTS.MAX_GAIT_TIME_SCALE, rawTimeScale)).toFixed(VERB_CONSTANTS.PRECISION_DECIMALS));
    const isEarlyArrival = tMove < availableFrames;

    return {
      chosenClipId,
      loopFrames: chosenLoop,
      strideLengthUnits: chosenStride,
      timeScale,
      tMove,
      arriveF: tMove,
      vActual,
      isEarlyArrival,
      ...(isEarlyArrival || unfulfilledReason
        ? { unfulfilledReason: unfulfilledReason ?? 'Arrived early at contact-locked speed and held in place' }
        : {})
    };
  }

  private static compileCharacterAction(
    instanceId: string,
    shotId: string,
    startF: number,
    endF: number,
    action: CharacterActionDirective,
    currentPos: [number, number, number],
    otherCharPos?: [number, number, number],
    archetypeId?: string,
    audioManifest?: AudioAnalysisManifest,
    emotionalTone?: EmotionalTone,
    charPoseClockState?: { clock: number; lastClip?: { clipId: string; loopFrames: number } },
    unfulfilledTiming?: UnfulfilledTimingEntry[],
    activeRigs?: Map<string, AssetRigContract>,
    reachClamps?: Array<{
      readonly beatId: string;
      readonly instanceId: string;
      readonly target: [number, number, number];
      readonly clampedReach: number;
      readonly maxReach: number;
    }>,
    unreachableTargets?: UnreachableTargetEntry[],
    releaseBeforeEnd?: boolean
  ): {
    track: EntityTrack;
    nextPos: [number, number, number];
    nextX: number;
    nextClockState: { clock: number; lastClip: { clipId: string; loopFrames: number } };
  } {
    const lastF = endF - 1;
    const keyframes: EntityTrackKeyframe[] = [];
    const morphKeyframes: Record<string, Array<{ frame: number; weight: number }>> = {};
    const segments: PoseSegment[] = [];
    const ikTargets: IkTarget[] = [];
    const gazeTargets: GazeTarget[] = [];
    const charRig = activeRigs?.get(instanceId);

    const baseY = archetypeId === 'companion_silhouette' ? VERB_CONSTANTS.COMPANION_BASE_Y : VERB_CONSTANTS.HERO_BASE_Y;
    const [scaleXBase, scaleYBase] =
      archetypeId === 'companion_silhouette' ? [VERB_CONSTANTS.COMPANION_SCALE_X, VERB_CONSTANTS.COMPANION_SCALE_Y] : [VERB_CONSTANTS.HERO_SCALE_X, VERB_CONSTANTS.HERO_SCALE_Y];

    let currentX = currentPos[0];
    let nextPos: [number, number, number] = [currentX, baseY, currentPos[2]];
    let nextX = currentX;
    let clipId = 'pop_vocal_sway';
    let calculatedTimeScale = action.speedNorm ?? 1.0;
    let nextClockState: { clock: number; lastClip: { clipId: string; loopFrames: number } } | undefined;

    switch (action.verb) {
      case 'walk_to':
      case 'run_to': {
        const isRunVerb = action.verb === 'run_to';
        const targetPosDirective = action.target?.kind === 'position' ? action.target.pos : undefined;
        let targetPos: [number, number, number];

        if (targetPosDirective) {
          targetPos = [targetPosDirective[0], baseY, targetPosDirective[2]];
        } else if (action.target?.kind === 'character') {
          const otherP = otherCharPos ?? [0, baseY, 0];
          const clearance = VERB_CONSTANTS.CHARACTER_INTERACTION_CLEARANCE;
          const isLeft = currentPos[0] <= otherP[0];
          targetPos = [otherP[0] + (isLeft ? -clearance : clearance), baseY, otherP[2]];
        } else if (action.target?.kind === 'prop') {
          const propRig = activeRigs?.get(action.target.propId);
          const pPos = propRig?.baseTransform.position ?? [0, baseY, 0];
          const isLeft = currentPos[0] <= pPos[0];
          targetPos = [pPos[0] + (isLeft ? -VERB_CONSTANTS.CAM_LOOK_ROOM_OFFSET : VERB_CONSTANTS.CAM_LOOK_ROOM_OFFSET), baseY, pPos[2]];
        } else if (action.associatedPropId && activeRigs?.has(action.associatedPropId)) {
          const propRig = activeRigs.get(action.associatedPropId);
          const pPos = propRig?.baseTransform.position ?? [0, baseY, 0];
          const isLeft = currentPos[0] <= pPos[0];
          targetPos = [pPos[0] + (isLeft ? -VERB_CONSTANTS.PROP_APPROACH_CLEARANCE : VERB_CONSTANTS.PROP_APPROACH_CLEARANCE), baseY, pPos[2]];
        } else if (otherCharPos !== undefined) {
          if (currentPos[0] < VERB_CONSTANTS.SIM_DEEP_ROOM_THRESHOLD && otherCharPos[0] < VERB_CONSTANTS.SIM_DEEP_ROOM_THRESHOLD) {
            targetPos = [currentPos[0] <= otherCharPos[0] ? VERB_CONSTANTS.SIM_DEEP_ROOM_FORWARD_LEFT : VERB_CONSTANTS.SIM_DEEP_ROOM_FORWARD_RIGHT, baseY, 0];
          } else {
            const isLeft = currentPos[0] <= otherCharPos[0];
            targetPos = [isLeft ? VERB_CONSTANTS.SIM_CROSS_ROOM_POS_A : VERB_CONSTANTS.SIM_CROSS_ROOM_POS_B, baseY, 0];
          }
        } else {
          const firstProp = activeRigs ? Array.from(activeRigs.values()).find((r) => r.type === 'prop') : undefined;
          if (firstProp) {
            const pX = firstProp.baseTransform.position[0];
            targetPos = [pX + (currentPos[0] <= pX ? -VERB_CONSTANTS.PROP_APPROACH_CLEARANCE : VERB_CONSTANTS.PROP_APPROACH_CLEARANCE), baseY, 0];
          } else {
            targetPos = [currentPos[0] < 0 ? currentPos[0] + VERB_CONSTANTS.HERO_BASE_Y : currentPos[0] - VERB_CONSTANTS.HERO_BASE_Y, baseY, 0];
          }
        }

        nextPos = targetPos;
        nextX = targetPos[0];

        const dx = targetPos[0] - currentPos[0];
        const dz = targetPos[2] - currentPos[2];
        const totalDist = Math.hypot(dx, dz);
        const deltaFrames = endF - startF;
        const moveFrames = deltaFrames > 1 ? deltaFrames - 1 : deltaFrames;
        const sX = targetPos[0] >= currentPos[0] ? scaleXBase : -scaleXBase;

        const isExteriorTraverse = shotId.includes('exterior') || (currentPos[0] < VERB_CONSTANTS.SIM_DEEP_ROOM_THRESHOLD && targetPos[0] > 0);
        const forceEarlyArrival = !targetPosDirective && !isExteriorTraverse && totalDist > VERB_CONSTANTS.SIM_TRAVERSE_DISTANCE_THRESHOLD && deltaFrames >= VERB_CONSTANTS.SIM_TRAVERSE_FRAMES_THRESHOLD;

        const plan = VerbCompiler.planLocomotionGait(
          totalDist,
          moveFrames,
          action.speedNorm ?? 1.0,
          scaleXBase,
          isRunVerb,
          forceEarlyArrival ? Math.floor(moveFrames * VERB_CONSTANTS.DEFAULT_EARLY_ARRIVAL_RATIO) : undefined
        );

        clipId = plan.chosenClipId;
        calculatedTimeScale = plan.timeScale;
        const arriveF = Math.min(lastF, startF + plan.tMove);

        let actualTargetPos = targetPos;
        if (plan.isUnreachable) {
          const achievableDist = plan.achievableDistance ?? totalDist;
          const ratio = totalDist > EPSILON_DISTANCE ? achievableDist / totalDist : 1.0;
          const actualX = currentPos[0] + dx * ratio;
          const actualZ = currentPos[2] + dz * ratio;
          actualTargetPos = [actualX, baseY, actualZ];
          nextPos = actualTargetPos;
          nextX = actualX;

          if (unreachableTargets) {
            unreachableTargets.push({
              beatId: shotId,
              instanceId,
              verb: action.verb,
              requestedDistance: totalDist,
              achievableDistance: achievableDist,
              durationFrames: deltaFrames,
              minimumFramesNeeded: plan.minimumFramesNeeded ?? Math.ceil(totalDist / (VERB_CONSTANTS.MAX_GAIT_TIME_SCALE * ((VERB_CONSTANTS.RUN_STRIDE_LENGTH * scaleXBase) / VERB_CONSTANTS.RUN_LOOP_FRAMES))),
              suggestedSpeedNorm: plan.suggestedSpeedNorm
            });
          }
        } else {
          nextPos = targetPos;
          nextX = targetPos[0];
        }

        const rotZ = isRunVerb || plan.chosenClipId === 'sprint_frenzy' ? (sX > 0 ? VERB_CONSTANTS.RUN_FORWARD_TILT_DEG : -VERB_CONSTANTS.RUN_FORWARD_TILT_DEG) : 0;
        keyframes.push(
          {
            frame: startF,
            position: [currentPos[0], baseY, currentPos[2]],
            rotationZDegrees: rotZ,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: arriveF,
            position: [actualTargetPos[0], baseY, actualTargetPos[2]],
            rotationZDegrees: rotZ,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        if (arriveF < lastF) {
          keyframes.push({
            frame: lastF,
            position: [actualTargetPos[0], baseY, actualTargetPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          });
        }

        if (action.associatedPropId) {
          const hand: 'hand_l' | 'hand_r' = action.propSocket === 'hand_l' ? 'hand_l' : 'hand_r';
          const shoulderWorldY = baseY + (VERB_CONSTANTS.DEFAULT_TORSO_OFFSET_Y + VERB_CONSTANTS.DEFAULT_SHOULDER_OFFSET_Y) * scaleYBase;
          const overheadDx = (sX >= 0 ? 1 : -1) * VERB_CONSTANTS.OVERHEAD_PROP_OFFSET_X;
          const overheadDy = VERB_CONSTANTS.OVERHEAD_PROP_OFFSET_Y;
          ikTargets.push(
            {
              hand,
              targetWorld: [currentPos[0] + overheadDx, shoulderWorldY + overheadDy, currentPos[2]],
              weight: 1.0,
              frame: startF
            },
            {
              hand,
              targetWorld: [actualTargetPos[0] + overheadDx, shoulderWorldY + overheadDy, actualTargetPos[2]],
              weight: 1.0,
              frame: arriveF
            }
          );
          if (arriveF < lastF) {
            ikTargets.push({
              hand,
              targetWorld: [actualTargetPos[0] + overheadDx, shoulderWorldY + overheadDy, actualTargetPos[2]],
              weight: 1.0,
              frame: lastF
            });
          }
        }

        morphKeyframes.open_rest = [
          { frame: startF, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];

        // Carry normalized clip phase across clip changes
        const prevClock = charPoseClockState?.clock ?? 0;
        const prevClip = charPoseClockState?.lastClip;
        let startPose0 = 0;
        if (prevClip && prevClip.loopFrames > 0) {
          const normPhase = (((prevClock % prevClip.loopFrames) + prevClip.loopFrames) % prevClip.loopFrames) / prevClip.loopFrames;
          startPose0 = Number((normPhase * plan.loopFrames).toFixed(VERB_CONSTANTS.PRECISION_DECIMALS));
        }

        if (plan.isEarlyArrival && arriveF < endF) {
          segments.push({
            startFrame: startF,
            endFrame: arriveF,
            clipId: plan.chosenClipId,
            timeScale: plan.timeScale,
            startPoseFrame: startPose0
          });

          const clockAtArrive = startPose0 + plan.tMove * plan.timeScale;
          const holdClipId = 'idle';
          const holdLoop = VERB_CONSTANTS.IDLE_LOOP_FRAMES;
          const normPhaseHold = (((clockAtArrive % plan.loopFrames) + plan.loopFrames) % plan.loopFrames) / plan.loopFrames;
          const startPoseHold = Number((normPhaseHold * holdLoop).toFixed(VERB_CONSTANTS.PRECISION_DECIMALS));

          segments.push({
            startFrame: arriveF,
            endFrame: endF,
            clipId: holdClipId,
            timeScale: 1.0,
            startPoseFrame: startPoseHold
          });

          nextClockState = {
            clock: startPoseHold + (endF - arriveF) * 1.0,
            lastClip: { clipId: holdClipId, loopFrames: holdLoop }
          };

          if (unfulfilledTiming && !plan.isUnreachable) {
            unfulfilledTiming.push({
              beatId: shotId,
              instanceId,
              verb: action.verb,
              requestedDistance: totalDist,
              availableFrames: deltaFrames,
              actualDurationFrames: plan.tMove,
              chosenClipId: plan.chosenClipId,
              timeScale: plan.timeScale,
              reason: plan.unfulfilledReason ?? 'Arrived early at contact-locked speed and held in place'
            });
          }
        } else {
          segments.push({
            startFrame: startF,
            endFrame: endF,
            clipId: plan.chosenClipId,
            timeScale: plan.timeScale,
            startPoseFrame: startPose0
          });

          nextClockState = {
            clock: startPose0 + deltaFrames * plan.timeScale,
            lastClip: { clipId: plan.chosenClipId, loopFrames: plan.loopFrames }
          };

          if (plan.unfulfilledReason && unfulfilledTiming) {
            unfulfilledTiming.push({
              beatId: shotId,
              instanceId,
              verb: action.verb,
              requestedDistance: totalDist,
              availableFrames: deltaFrames,
              actualDurationFrames: plan.tMove,
              chosenClipId: plan.chosenClipId,
              timeScale: plan.timeScale,
              reason: plan.unfulfilledReason
            });
          }
        }
        break;
      }

      case 'look_at': {
        const targetPosDirective = action.target?.kind === 'position' ? action.target.pos : undefined;
        const targetX = targetPosDirective ? targetPosDirective[0] : currentX;
        const otherCharX = otherCharPos ? otherCharPos[0] : undefined;
        nextX = targetX;
        nextPos = [targetX, baseY, currentPos[2]];
        const faceRight = otherCharX !== undefined ? otherCharX >= targetX : true;
        const sX = faceRight ? scaleXBase : -scaleXBase;
        clipId = 'pop_vocal_sway';

        if (action.associatedPropId) {
          const hand: 'hand_l' | 'hand_r' = action.propSocket === 'hand_l' ? 'hand_l' : 'hand_r';
          const shoulderWorldY = baseY + (VERB_CONSTANTS.DEFAULT_TORSO_OFFSET_Y + VERB_CONSTANTS.DEFAULT_SHOULDER_OFFSET_Y) * scaleYBase;
          const overheadDx = (sX >= 0 ? 1 : -1) * VERB_CONSTANTS.OVERHEAD_PROP_OFFSET_X;
          const overheadDy = VERB_CONSTANTS.OVERHEAD_PROP_OFFSET_Y;
          ikTargets.push(
            {
              hand,
              targetWorld: [targetX + overheadDx, shoulderWorldY + overheadDy, currentPos[2]],
              weight: 1.0,
              frame: startF
            },
            {
              hand,
              targetWorld: [targetX + overheadDx, shoulderWorldY + overheadDy, currentPos[2]],
              weight: 1.0,
              frame: lastF
            }
          );
        }

        keyframes.push(
          {
            frame: startF,
            position: [targetX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [targetX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }

      case 'reach_and_grasp': {
        const duration = endF - startF;
        const graspOffset = Math.max(2, Math.min(Math.round(duration * HALF), duration - 2));
        const graspFrame = startF + graspOffset;
        const reachStartF = startF + Math.max(0, Math.floor(graspOffset * VERB_CONSTANTS.REACH_ANTICIPATION_RATIO));
        const graspSnapStartF = Math.max(startF, graspFrame - VERB_CONSTANTS.HAND_MORPH_SNAP_FRAMES);

        const propId = action.associatedPropId ?? (action.target?.kind === 'prop' ? action.target.propId : undefined);
        const propRig = propId && activeRigs?.has(propId) ? activeRigs.get(propId) : undefined;
        let propPos: [number, number, number];
        if (propRig) {
          propPos = propRig.baseTransform.position;
        } else if (action.target?.kind === 'position') {
          propPos = action.target.pos;
        } else {
          const defaultSign = scaleXBase >= 0 ? 1 : -1;
          propPos = [
            currentPos[0] + defaultSign * VERB_CONSTANTS.PROP_APPROACH_CLEARANCE,
            baseY + VERB_CONSTANTS.DEFAULT_SHOULDER_OFFSET_Y * scaleYBase,
            currentPos[2]
          ];
        }
        const socketId = VerbCompiler.resolvePropSocket(action, propPos, currentPos);
        const hand: 'hand_l' | 'hand_r' = socketId === 'hand_l' ? 'hand_l' : 'hand_r';
        const reachSign = propPos[0] >= currentX ? 1 : -1;
        const sXReach = reachSign * Math.abs(scaleXBase);

        // Deficit-based reach lowering: upright standing reach for waist-height surfaces, automatic crouch for low targets
        const armMetrics = VerbCompiler.deriveRigArmMetrics(charRig, hand);
        const shoulderWorldX = currentX + (hand === 'hand_r' ? armMetrics.shoulderOffset[0] : -armMetrics.shoulderOffset[0]) * sXReach;
        const uprightShoulderWorldY = baseY + (armMetrics.shoulderOffset[1] - VERB_CONSTANTS.REACH_SHOULDER_SETTLE_Y) * scaleYBase;
        const distUpright = Math.hypot(propPos[0] - shoulderWorldX, propPos[1] - uprightShoulderWorldY);
        const armReachVertical = armMetrics.maxReach * Math.max(Math.abs(scaleXBase), Math.abs(scaleYBase));
        const reachDeficit = Math.max(0, distUpright - VERB_CONSTANTS.REACH_ARM_EFFICIENCY_FACTOR * armReachVertical);
        const crouchDropY = Math.min(
          VERB_CONSTANTS.REACH_MAX_CROUCH_DROP_Y,
          Math.max(0, reachDeficit * VERB_CONSTANTS.REACH_DEFICIT_CROUCH_SCALE)
        );
        const crouchRootY = propPos[1] < baseY
          ? Number((baseY - crouchDropY).toFixed(VERB_CONSTANTS.PRECISION_DECIMALS))
          : baseY;
        const crouchRotZ = crouchDropY > VERB_CONSTANTS.REACH_UPRIGHT_CROUCH_THRESHOLD
          ? -reachSign * Math.min(
              VERB_CONSTANTS.REACH_MAX_TORSO_LEAN_DEG,
              Math.round(VERB_CONSTANTS.REACH_BASE_TORSO_LEAN_DEG + reachDeficit * VERB_CONSTANTS.REACH_DEFICIT_LEAN_SCALE)
            )
          : 0;

        const loweredShoulderWorldY = crouchRootY + (armMetrics.shoulderOffset[1] - VERB_CONSTANTS.REACH_SHOULDER_SETTLE_Y) * scaleYBase;
        const localDistToProp = Math.hypot(
          (propPos[0] - shoulderWorldX) / Math.abs(scaleXBase),
          (propPos[1] - loweredShoulderWorldY) / Math.abs(scaleYBase)
        );
        const distToProp = localDistToProp * Math.abs(scaleXBase);
        const maxReach = armMetrics.maxReach * Math.abs(scaleXBase);
        if (distToProp > maxReach && reachClamps) {
          reachClamps.push({
            beatId: shotId,
            instanceId,
            target: propPos,
            clampedReach: maxReach,
            maxReach
          });
        }

        const liftF = Math.min(lastF, Math.max(graspFrame + 1, startF + Math.round(duration * VERB_CONSTANTS.CARRY_LIFT_START_RATIO)));
        const carryHoldPos: [number, number, number] = [
          currentX + reachSign * VERB_CONSTANTS.CARRY_HAND_FORWARD_OFFSET_X,
          baseY + VERB_CONSTANTS.CARRY_HAND_HEIGHT_OFFSET_Y,
          currentPos[2]
        ];

        if (releaseBeforeEnd && duration >= VERB_CONSTANTS.WALK_LOOP_FRAMES) {
          const putBackF = Math.min(lastF - 1, Math.max(liftF + 1, startF + Math.round(duration * VERB_CONSTANTS.CARRY_PUT_BACK_RATIO)));
          const putBackSnapEndF = Math.min(lastF, putBackF + VERB_CONSTANTS.HAND_MORPH_SNAP_FRAMES);
          const endX = otherCharPos !== undefined && currentX < VERB_CONSTANTS.SIM_CONFRONT_END_X
            ? VERB_CONSTANTS.SIM_CONFRONT_END_X
            : currentX;
          const sXEnd = otherCharPos !== undefined
            ? (otherCharPos[0] >= endX ? Math.abs(scaleXBase) : -Math.abs(scaleXBase))
            : scaleXBase;

          ikTargets.push(
            {
              hand,
              targetWorld: propPos,
              weight: 0.0,
              frame: reachStartF
            },
            {
              hand,
              targetWorld: propPos,
              weight: 1.0,
              frame: graspFrame
            },
            {
              hand,
              targetWorld: [propPos[0], propPos[1] + VERB_CONSTANTS.OVERHEAD_PROP_OFFSET_Y, propPos[2]],
              weight: 1.0,
              frame: liftF
            },
            {
              hand,
              targetWorld: propPos,
              weight: 1.0,
              frame: putBackF
            },
            {
              hand,
              targetWorld: propPos,
              weight: 0.0,
              frame: putBackSnapEndF
            },
            {
              hand,
              targetWorld: propPos,
              weight: 0.0,
              frame: lastF
            }
          );

          keyframes.push(
            {
              frame: startF,
              position: [currentX, baseY, currentPos[2]],
              rotationZDegrees: 0,
              scale: [sXReach, scaleYBase],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: graspFrame,
              position: [currentX, crouchRootY, currentPos[2]],
              rotationZDegrees: crouchRotZ,
              scale: [sXReach, scaleYBase],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: liftF,
              position: [currentX, baseY, currentPos[2]],
              rotationZDegrees: 0,
              scale: [sXReach, scaleYBase],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: putBackF,
              position: [currentX, crouchRootY, currentPos[2]],
              rotationZDegrees: crouchRotZ,
              scale: [sXReach, scaleYBase],
              opacity: 1,
              easing: 'linear'
            }
          );
          if (putBackSnapEndF < lastF) {
            keyframes.push({
              frame: putBackSnapEndF,
              position: [currentX, baseY, currentPos[2]],
              rotationZDegrees: 0,
              scale: [sXReach, scaleYBase],
              opacity: 1,
              easing: 'easeOutQuad'
            });
          }
          keyframes.push({
            frame: lastF,
            position: [endX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [sXEnd, scaleYBase],
            opacity: 1,
            easing: 'linear'
          });

          morphKeyframes.open_rest = [
            { frame: startF, weight: 1.0 },
            ...(graspSnapStartF > startF ? [{ frame: graspSnapStartF, weight: 1.0 }] : []),
            { frame: graspFrame, weight: 0.0 },
            { frame: putBackF, weight: 0.0 },
            { frame: putBackSnapEndF, weight: 1.0 },
            ...(putBackSnapEndF < lastF ? [{ frame: lastF, weight: 1.0 }] : [])
          ];
          morphKeyframes.grasp_fist = [
            { frame: startF, weight: 0.0 },
            ...(graspSnapStartF > startF ? [{ frame: graspSnapStartF, weight: 0.0 }] : []),
            { frame: graspFrame, weight: 1.0 },
            { frame: putBackF, weight: 1.0 },
            { frame: putBackSnapEndF, weight: 0.0 },
            ...(putBackSnapEndF < lastF ? [{ frame: lastF, weight: 0.0 }] : [])
          ];

          nextX = endX;
          nextPos = [endX, baseY, currentPos[2]];
        } else {
          ikTargets.push(
            {
              hand,
              targetWorld: propPos,
              weight: 0.0,
              frame: reachStartF
            },
            {
              hand,
              targetWorld: propPos,
              weight: 1.0,
              frame: graspFrame
            },
            {
              hand,
              targetWorld: carryHoldPos,
              weight: 1.0,
              frame: lastF
            }
          );

          keyframes.push(
            {
              frame: startF,
              position: [currentX, baseY, currentPos[2]],
              rotationZDegrees: 0,
              scale: [sXReach, scaleYBase],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: graspFrame,
              position: [currentX, crouchRootY, currentPos[2]],
              rotationZDegrees: crouchRotZ,
              scale: [sXReach, scaleYBase],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: lastF,
              position: [currentX, baseY, currentPos[2]],
              rotationZDegrees: 0,
              scale: [sXReach, scaleYBase],
              opacity: 1,
              easing: 'linear'
            }
          );

          morphKeyframes.open_rest = [
            { frame: startF, weight: 1.0 },
            ...(graspSnapStartF > startF ? [{ frame: graspSnapStartF, weight: 1.0 }] : []),
            { frame: graspFrame, weight: 0.0 },
            { frame: lastF, weight: 0.0 }
          ];
          morphKeyframes.grasp_fist = [
            { frame: startF, weight: 0.0 },
            ...(graspSnapStartF > startF ? [{ frame: graspSnapStartF, weight: 0.0 }] : []),
            { frame: graspFrame, weight: 1.0 },
            { frame: lastF, weight: 1.0 }
          ];

          nextX = currentX;
          nextPos = [currentX, baseY, currentPos[2]];
        }

        clipId = 'reach_and_grasp';
        break;
      }

      case 'stop_and_turn': {
        nextX = currentX;
        nextPos = [currentX, baseY, currentPos[2]];
        clipId = 'stop_and_turn';
        const duration = endF - startF;
        const turnOffset = Math.max(2, Math.min(Math.floor(duration * VERB_CONSTANTS.TURN_TIMING_RATIO), duration - VERB_CONSTANTS.TRANSITION_CROSS_FADE_FRAMES));
        const turnF0 = startF + turnOffset;
        const facingSign = scaleXBase >= 0 ? 1 : -1;
        const carryHeightY = baseY + VERB_CONSTANTS.CARRY_HAND_HEIGHT_OFFSET_Y;
        const carryDx = VERB_CONSTANTS.CARRY_HAND_FORWARD_OFFSET_X;

        ikTargets.push(
          {
            hand: 'hand_r',
            targetWorld: [currentX + facingSign * carryDx, carryHeightY, currentPos[2]],
            weight: 1.0,
            frame: startF
          },
          {
            hand: 'hand_r',
            targetWorld: [currentX + facingSign * carryDx, carryHeightY, currentPos[2]],
            weight: 1.0,
            frame: turnF0
          },
          {
            hand: 'hand_r',
            targetWorld: [currentX - facingSign * carryDx, carryHeightY, currentPos[2]],
            weight: 1.0,
            frame: turnF0 + VERB_CONSTANTS.TURN_FRAME_OFFSET_5
          },
          {
            hand: 'hand_r',
            targetWorld: [currentX - facingSign * carryDx, carryHeightY, currentPos[2]],
            weight: 1.0,
            frame: lastF
          }
        );

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 1,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase * VERB_CONSTANTS.TURN_SCALE_STEP_1, scaleYBase * VERB_CONSTANTS.TURN_SCALE_Y_STEP_1],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 2,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase * VERB_CONSTANTS.TURN_SCALE_STEP_2, scaleYBase * VERB_CONSTANTS.TURN_SCALE_Y_STEP_2],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + VERB_CONSTANTS.CANONICAL_ACT_COUNT,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [-scaleXBase * VERB_CONSTANTS.TURN_SCALE_STEP_2, scaleYBase * VERB_CONSTANTS.TURN_SCALE_Y_STEP_2],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + VERB_CONSTANTS.PRECISION_DECIMALS,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [-scaleXBase * VERB_CONSTANTS.TURN_SCALE_STEP_1, scaleYBase * VERB_CONSTANTS.TURN_SCALE_Y_STEP_1],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + VERB_CONSTANTS.TURN_FRAME_OFFSET_5,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [-scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [-scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        morphKeyframes.grasp_fist = [
          { frame: startF, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];
        break;
      }

      case 'carry_put_down': {
        const duration = endF - startF;
        const destPosDirective = action.target?.kind === 'position' ? action.target.pos : undefined;
        let charDestX: number;
        let destPos: [number, number, number];

        if (destPosDirective !== undefined) {
          destPos = [...destPosDirective];
          charDestX = destPos[0] + (currentPos[0] >= destPos[0] ? VERB_CONSTANTS.PROP_APPROACH_CLEARANCE : -VERB_CONSTANTS.PROP_APPROACH_CLEARANCE);
        } else {
          charDestX = currentPos[0] <= 0 ? currentPos[0] - VERB_CONSTANTS.SIM_DEFAULT_STEP_DISTANCE : currentPos[0] + VERB_CONSTANTS.SIM_DEFAULT_STEP_DISTANCE;
          let surfaceY = 0;
          for (const rig of activeRigs?.values() ?? []) {
            if (rig.type === 'prop' && rig.baseTransform.position[1] > 0) {
              surfaceY = rig.baseTransform.position[1];
              break;
            }
          }
          if (surfaceY === 0) {
            surfaceY = currentPos[1];
          }
          destPos = [
            charDestX + (charDestX <= currentPos[0] ? -VERB_CONSTANTS.PROP_APPROACH_CLEARANCE : VERB_CONSTANTS.PROP_APPROACH_CLEARANCE),
            surfaceY,
            currentPos[2]
          ];
        }

        nextX = charDestX;
        nextPos = [charDestX, baseY, currentPos[2]];
        clipId = 'carry_put_down';
        const walkDeltaFrames = Math.max(1, Math.min(Math.floor(duration * HALF), duration - VERB_CONSTANTS.PRECISION_DECIMALS));
        const walkEndF = startF + walkDeltaFrames;
        const releaseOffset = Math.max(walkDeltaFrames + 1, Math.min(Math.round(duration * VERB_CONSTANTS.CARRY_RELEASE_RATIO), duration - VERB_CONSTANTS.CANONICAL_ACT_COUNT));
        const releaseF = startF + releaseOffset;
        const releaseEndF = Math.min(lastF, releaseF + 2);

        const walkDist = Math.abs(charDestX - currentPos[0]);
        const sX = charDestX >= currentPos[0] ? scaleXBase : -scaleXBase;
        const facingSign = sX >= 0 ? 1 : -1;

        if (walkDist > 2.0) {
          const walkPlan = VerbCompiler.planLocomotionGait(
            walkDist,
            walkDeltaFrames,
            action.speedNorm ?? 1.0,
            scaleXBase,
            false
          );

          if (walkPlan.isUnreachable) {
            const achievableDist = walkPlan.achievableDistance ?? walkDist;
            charDestX = currentPos[0] + facingSign * achievableDist;
            nextX = charDestX;
            nextPos = [charDestX, baseY, currentPos[2]];
            if (unreachableTargets) {
              unreachableTargets.push({
                beatId: shotId,
                instanceId,
                verb: action.verb,
                requestedDistance: walkDist,
                achievableDistance: achievableDist,
                durationFrames: duration,
                minimumFramesNeeded: walkPlan.minimumFramesNeeded ?? Math.ceil(walkDist / (VERB_CONSTANTS.MAX_GAIT_TIME_SCALE * ((VERB_CONSTANTS.RUN_STRIDE_LENGTH * scaleXBase) / VERB_CONSTANTS.RUN_LOOP_FRAMES))),
                suggestedSpeedNorm: walkPlan.suggestedSpeedNorm
              });
            }
          }

          const prevClock = charPoseClockState?.clock ?? 0;
          const prevClip = charPoseClockState?.lastClip;
          let startPose0 = 0;
          if (prevClip && prevClip.loopFrames > 0) {
            const normPhase = (((prevClock % prevClip.loopFrames) + prevClip.loopFrames) % prevClip.loopFrames) / prevClip.loopFrames;
            startPose0 = Number((normPhase * walkPlan.loopFrames).toFixed(VERB_CONSTANTS.PRECISION_DECIMALS));
          }

          segments.push({
            startFrame: startF,
            endFrame: walkEndF,
            clipId: walkPlan.chosenClipId,
            timeScale: walkPlan.timeScale,
            startPoseFrame: startPose0
          });

          const carryPutDownLoop = VerbCompiler.getClipDuration(charRig, 'carry_put_down', endF - walkEndF);
          const crouchPoseFrame = Math.round(carryPutDownLoop * HALF);
          const crouchDuration = endF - walkEndF;
          const crouchTimeScale = crouchDuration > 0 ? (carryPutDownLoop - crouchPoseFrame) / crouchDuration : 1.0;
          segments.push({
            startFrame: walkEndF,
            endFrame: endF,
            clipId: 'carry_put_down',
            timeScale: crouchTimeScale,
            startPoseFrame: crouchPoseFrame
          });

          nextClockState = {
            clock: crouchPoseFrame + crouchDuration * crouchTimeScale,
            lastClip: { clipId: 'carry_put_down', loopFrames: carryPutDownLoop }
          };
        } else {
          const walkSpeed = walkDist / walkDeltaFrames;
          const nominalWalkSpeed = (VERB_CONSTANTS.WALK_STRIDE_LENGTH * Math.abs(scaleXBase)) / VERB_CONSTANTS.WALK_LOOP_FRAMES;
          calculatedTimeScale = walkDist > EPSILON_SPEED
            ? Math.max(VERB_CONSTANTS.MIN_GAIT_TIME_SCALE, Math.min(VERB_CONSTANTS.MAX_GAIT_TIME_SCALE, walkSpeed / nominalWalkSpeed))
            : 1.0;
        }

        const socketId = action.propSocket ?? 'hand_r';
        const hand: 'hand_l' | 'hand_r' = socketId === 'hand_l' ? 'hand_l' : 'hand_r';

        // Deficit-based reach lowering at put-down destination
        const armMetrics = VerbCompiler.deriveRigArmMetrics(charRig, hand);
        const shoulderWorldX = charDestX + (hand === 'hand_r' ? armMetrics.shoulderOffset[0] : -armMetrics.shoulderOffset[0]) * sX;
        const uprightShoulderWorldY = baseY + (armMetrics.shoulderOffset[1] - VERB_CONSTANTS.REACH_SHOULDER_SETTLE_Y) * scaleYBase;
        const distUpright = Math.hypot(destPos[0] - shoulderWorldX, destPos[1] - uprightShoulderWorldY);
        const armReachVertical = armMetrics.maxReach * Math.max(Math.abs(scaleXBase), Math.abs(scaleYBase));
        const reachDeficit = Math.max(0, distUpright - VERB_CONSTANTS.REACH_ARM_EFFICIENCY_FACTOR * armReachVertical);
        const crouchDropY = Math.min(
          VERB_CONSTANTS.REACH_MAX_CROUCH_DROP_Y,
          Math.max(0, reachDeficit * VERB_CONSTANTS.REACH_DEFICIT_CROUCH_SCALE)
        );
        const crouchRootY = destPos[1] < baseY
          ? Number((baseY - crouchDropY).toFixed(VERB_CONSTANTS.PRECISION_DECIMALS))
          : baseY;
        const crouchRotZ = crouchDropY > VERB_CONSTANTS.REACH_UPRIGHT_CROUCH_THRESHOLD
          ? -facingSign * Math.min(
              VERB_CONSTANTS.REACH_MAX_TORSO_LEAN_DEG,
              Math.round(VERB_CONSTANTS.REACH_BASE_TORSO_LEAN_DEG + reachDeficit * VERB_CONSTANTS.REACH_DEFICIT_LEAN_SCALE)
            )
          : 0;

        const loweredShoulderWorldY = crouchRootY + (armMetrics.shoulderOffset[1] - VERB_CONSTANTS.REACH_SHOULDER_SETTLE_Y) * scaleYBase;
        const localDistToDest = Math.hypot(
          (destPos[0] - shoulderWorldX) / Math.abs(scaleXBase),
          (destPos[1] - loweredShoulderWorldY) / Math.abs(scaleYBase)
        );
        const distToDest = localDistToDest * Math.abs(scaleXBase);
        const maxReach = armMetrics.maxReach * Math.abs(scaleXBase);
        if (distToDest > maxReach && reachClamps) {
          reachClamps.push({
            beatId: shotId,
            instanceId,
            target: destPos,
            clampedReach: maxReach,
            maxReach
          });
        }

        const carryDx = VERB_CONSTANTS.CARRY_HAND_FORWARD_OFFSET_X;
        const carryHeightY = baseY + VERB_CONSTANTS.CARRY_HAND_HEIGHT_OFFSET_Y;

        ikTargets.push(
          {
            hand,
            targetWorld: [currentPos[0] + facingSign * carryDx, carryHeightY, currentPos[2]],
            weight: 1.0,
            frame: startF
          },
          {
            hand,
            targetWorld: [charDestX + facingSign * carryDx, carryHeightY, currentPos[2]],
            weight: 1.0,
            frame: walkEndF
          },
          {
            hand,
            targetWorld: destPos,
            weight: 1.0,
            frame: releaseF - 1
          },
          {
            hand,
            targetWorld: destPos,
            weight: 1.0,
            frame: releaseF
          },
          {
            hand,
            targetWorld: destPos,
            weight: 0.0,
            frame: releaseEndF
          },
          {
            hand,
            targetWorld: destPos,
            weight: 0.0,
            frame: lastF
          }
        );

        keyframes.push(
          {
            frame: startF,
            position: [currentPos[0], baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: walkEndF,
            position: [charDestX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        if (releaseF - 1 > walkEndF) {
          keyframes.push({
            frame: releaseF - 1,
            position: [charDestX, crouchRootY, currentPos[2]],
            rotationZDegrees: crouchRotZ,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          });
        }
        keyframes.push(
          {
            frame: releaseF,
            position: [charDestX, crouchRootY, currentPos[2]],
            rotationZDegrees: crouchRotZ,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [charDestX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        morphKeyframes.grasp_fist = [
          { frame: startF, weight: 1.0 },
          { frame: releaseF, weight: 1.0 },
          { frame: releaseEndF, weight: 0.0 },
          { frame: lastF, weight: 0.0 }
        ];
        morphKeyframes.open_rest = [
          { frame: startF, weight: 0.0 },
          { frame: releaseF, weight: 0.0 },
          { frame: releaseEndF, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];
        break;
      }

      case 'sit_stand': {
        nextX = currentX;
        nextPos = [currentX, baseY, currentPos[2]];
        const duration = endF - startF;
        const sitF = startF + Math.max(2, Math.min(Math.floor(duration * VERB_CONSTANTS.SIT_CONTACT_RATIO), duration - VERB_CONSTANTS.PRECISION_DECIMALS));
        const standF = startF + Math.max(sitF - startF + 2, Math.min(Math.floor(duration * VERB_CONSTANTS.SIT_STAND_TRANSITION_RATIO), duration - 2));

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: sitF,
            position: [currentX, baseY - VERB_CONSTANTS.SIT_DROP_Y, currentPos[2]],
            rotationZDegrees: -VERB_CONSTANTS.TURN_FRAME_OFFSET_5,
            scale: [scaleXBase, scaleYBase * VERB_CONSTANTS.SIT_SQUASH_SCALE_Y],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: standF,
            position: [currentX, baseY - VERB_CONSTANTS.SIT_DROP_Y, currentPos[2]],
            rotationZDegrees: -VERB_CONSTANTS.TURN_FRAME_OFFSET_5,
            scale: [scaleXBase, scaleYBase * VERB_CONSTANTS.SIT_SQUASH_SCALE_Y],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }

      case 'gesture_point': {
        const targetPosDirective = action.target?.kind === 'position' ? action.target.pos[0] : undefined;
        let targetX = currentX;
        if (targetPosDirective !== undefined) {
          targetX = targetPosDirective;
        } else if (currentX < VERB_CONSTANTS.SIM_WALL_THRESHOLD) {
          targetX = currentX + VERB_CONSTANTS.SIM_RETREAT_STEP_DISTANCE;
        }
        nextX = targetX;
        nextPos = [targetX, baseY, currentPos[2]];
        clipId = 'gesture_point';
        const duration = endF - startF;
        const pointOffset = Math.max(1, Math.min(Math.floor(duration * VERB_CONSTANTS.POINT_ANTICIPATION_RATIO), duration - 2));
        const pointF = startF + pointOffset;

        const hand: 'hand_l' | 'hand_r' = action.propSocket === 'hand_l' ? 'hand_l' : 'hand_r';
        const charRig = activeRigs?.get(instanceId);
        const armMetrics = VerbCompiler.deriveRigArmMetrics(charRig, hand);
        const maxArmReachWorld = armMetrics.maxReach * Math.abs(scaleXBase);
        const shoulderWorldX = targetX + (hand === 'hand_r' ? armMetrics.shoulderOffset[0] : -armMetrics.shoulderOffset[0]) * scaleXBase;
        const shoulderWorldY = baseY + armMetrics.shoulderOffset[1] * scaleYBase;
        const facingSign = scaleXBase >= 0 ? 1 : -1;

        let pointTarget: [number, number, number];
        if (action.target?.kind === 'direction') {
          const rad = action.target.facingDeg * VERB_CONSTANTS.DEG_TO_RAD;
          pointTarget = [targetX + VERB_CONSTANTS.FPS_60 * Math.cos(rad), baseY + VERB_CONSTANTS.FPS_60 * Math.sin(rad), currentPos[2]];
        } else {
          pointTarget = [
            shoulderWorldX + facingSign * (VERB_CONSTANTS.POINT_EXTEND_X_FACTOR * maxArmReachWorld),
            shoulderWorldY + (VERB_CONSTANTS.POINT_EXTEND_Y_FACTOR * maxArmReachWorld),
            currentPos[2]
          ];
        }

        const distToPoint = Math.hypot(pointTarget[0] - shoulderWorldX, pointTarget[1] - shoulderWorldY);
        const maxReach = armMetrics.maxReach * Math.abs(scaleXBase);
        if (distToPoint > maxReach && reachClamps) {
          reachClamps.push({
            beatId: shotId,
            instanceId,
            target: pointTarget,
            clampedReach: maxReach,
            maxReach
          });
        }

        ikTargets.push(
          {
            hand,
            targetWorld: pointTarget,
            weight: 0.0,
            frame: startF
          },
          {
            hand,
            targetWorld: pointTarget,
            weight: 1.0,
            frame: pointF
          },
          {
            hand,
            targetWorld: pointTarget,
            weight: 1.0,
            frame: lastF
          }
        );

        keyframes.push(
          {
            frame: startF,
            position: [targetX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [targetX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        const pointSnapStartF = Math.max(startF, pointF - VERB_CONSTANTS.HAND_MORPH_SNAP_FRAMES);
        morphKeyframes.open_rest = [
          { frame: startF, weight: 1.0 },
          ...(pointSnapStartF > startF ? [{ frame: pointSnapStartF, weight: 1.0 }] : []),
          { frame: pointF, weight: 0.0 },
          { frame: lastF, weight: 0.0 }
        ];
        morphKeyframes.point = [
          { frame: startF, weight: 0.0 },
          ...(pointSnapStartF > startF ? [{ frame: pointSnapStartF, weight: 0.0 }] : []),
          { frame: pointF, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];
        break;
      }

      case 'embrace_push_away': {
        clipId = 'embrace_push_away';
        const otherCharX = otherCharPos ? otherCharPos[0] : undefined;
        const isLeft = otherCharX !== undefined ? currentX <= otherCharX : true;
        const startX = currentX;
        const contactX = isLeft ? -VERB_CONSTANTS.EMBRACE_CONTACT_HALF_SEPARATION : VERB_CONSTANTS.EMBRACE_CONTACT_HALF_SEPARATION;
        const recoilDelta = VERB_CONSTANTS.RECOIL_SEPARATION_DISTANCE;
        const pushedX = isLeft ? contactX - recoilDelta : contactX + recoilDelta;
        const zPos = isLeft ? currentPos[2] : VERB_CONSTANTS.EMBRACE_PARTNER_DEPTH_Z;
        nextX = pushedX;
        nextPos = [pushedX, baseY, currentPos[2]];

        const duration = endF - startF;
        const fStepInArrive = startF + Math.max(1, Math.min(Math.round(duration * VERB_CONSTANTS.EMBRACE_STEP_IN_RATIO), duration - VERB_CONSTANTS.TURN_FRAME_OFFSET_5));
        const fEmbrace = startF + Math.max(fStepInArrive - startF + 1, Math.min(Math.round(duration * VERB_CONSTANTS.EMBRACE_CONTACT_RATIO), duration - VERB_CONSTANTS.PRECISION_DECIMALS));
        const fThrust = startF + Math.max(fEmbrace - startF + 1, Math.min(Math.round(duration * VERB_CONSTANTS.EMBRACE_THRUST_RATIO), duration - 2));
        const recoilTargetF = startF + Math.max(fThrust - startF + 1, Math.min(Math.round(duration * VERB_CONSTANTS.EMBRACE_RECOIL_ARRIVE_RATIO), duration - 1));
        const sX = isLeft ? scaleXBase : -scaleXBase;

        // Step-in locomotion sub-span
        const stepDist = Math.abs(contactX - startX);
        const stepFrames = fStepInArrive - startF;
        if (stepDist > 1.0 && stepFrames > 0) {
          const stepPlan = VerbCompiler.planLocomotionGait(
            stepDist,
            stepFrames,
            action.speedNorm ?? 1.0,
            sX,
            false
          );
          segments.push({
            startFrame: startF,
            endFrame: fStepInArrive,
            clipId: 'walk_to',
            timeScale: stepPlan.timeScale,
            startPoseFrame: 0
          });
        }

        // Contact embrace/thrust sub-span
        segments.push({
          startFrame: fStepInArrive,
          endFrame: fThrust,
          clipId: 'embrace_push_away',
          timeScale: 1.0,
          startPoseFrame: VERB_CONSTANTS.SIM_DEEP_ROOM_FORWARD_RIGHT
        });

        // Recoil push-away sub-span
        const recoilDist = Math.abs(pushedX - contactX);
        const recoilFrames = Math.max(1, recoilTargetF - fThrust);
        let recoilArriveF = recoilTargetF;
        if (recoilDist > 1.0 && recoilFrames > 0) {
          const recoilPlan = VerbCompiler.planLocomotionGait(
            recoilDist,
            recoilFrames,
            VERB_CONSTANTS.RECOIL_SPEED_NORM,
            -sX,
            false
          );
          recoilArriveF = Math.min(lastF, Math.max(fThrust + recoilPlan.tMove, recoilTargetF));
          segments.push({
            startFrame: fThrust,
            endFrame: recoilArriveF,
            clipId: recoilPlan.chosenClipId,
            timeScale: recoilPlan.timeScale,
            startPoseFrame: 0
          });
          if (recoilArriveF < endF) {
            segments.push({
              startFrame: recoilArriveF,
              endFrame: endF,
              clipId: 'idle',
              timeScale: 1.0,
              startPoseFrame: 0
            });
          }
        }

        nextClockState = {
          clock: recoilFrames * 1.0,
          lastClip: { clipId: 'walk_to', loopFrames: VERB_CONSTANTS.WALK_LOOP_FRAMES }
        };

        const otherContactX = -contactX;
        const wrapTargetR: [number, number, number] = [
          otherContactX + (isLeft ? VERB_CONSTANTS.EMBRACE_WRAP_REACH_PAST_X : -VERB_CONSTANTS.EMBRACE_WRAP_REACH_PAST_X),
          baseY + VERB_CONSTANTS.EMBRACE_WRAP_SHOULDER_Y_OFFSET,
          zPos
        ];
        const wrapTargetL: [number, number, number] = [
          otherContactX + (isLeft ? VERB_CONSTANTS.EMBRACE_WRAP_REACH_PAST_X - 2 : -(VERB_CONSTANTS.EMBRACE_WRAP_REACH_PAST_X - 2)),
          baseY + VERB_CONSTANTS.EMBRACE_WRAP_LOWER_Y_OFFSET,
          zPos
        ];
        const thrustTarget: [number, number, number] = [
          otherContactX + (isLeft ? -VERB_CONSTANTS.PRECISION_DECIMALS : VERB_CONSTANTS.PRECISION_DECIMALS),
          baseY + VERB_CONSTANTS.EMBRACE_WRAP_SHOULDER_Y_OFFSET,
          zPos
        ];
        const fArmRaise = Math.max(startF, fStepInArrive - VERB_CONSTANTS.EMBRACE_ARM_RAISE_LEAD_FRAMES);
        const ikReleaseF = Math.min(recoilArriveF, fThrust + VERB_CONSTANTS.HAND_MORPH_SNAP_FRAMES);

        ikTargets.push(
          {
            hand: 'hand_r',
            targetWorld: wrapTargetR,
            weight: 0.0,
            frame: fArmRaise
          },
          {
            hand: 'hand_r',
            targetWorld: wrapTargetR,
            weight: 1.0,
            frame: fStepInArrive
          },
          {
            hand: 'hand_r',
            targetWorld: wrapTargetR,
            weight: 1.0,
            frame: fEmbrace
          },
          {
            hand: 'hand_r',
            targetWorld: thrustTarget,
            weight: 1.0,
            frame: fThrust
          },
          {
            hand: 'hand_r',
            targetWorld: thrustTarget,
            weight: 0.0,
            frame: ikReleaseF
          },
          {
            hand: 'hand_l',
            targetWorld: wrapTargetL,
            weight: 0.0,
            frame: fArmRaise
          },
          {
            hand: 'hand_l',
            targetWorld: wrapTargetL,
            weight: 1.0,
            frame: fStepInArrive
          },
          {
            hand: 'hand_l',
            targetWorld: wrapTargetL,
            weight: 1.0,
            frame: fEmbrace
          },
          {
            hand: 'hand_l',
            targetWorld: thrustTarget,
            weight: 1.0,
            frame: fThrust
          },
          {
            hand: 'hand_l',
            targetWorld: thrustTarget,
            weight: 0.0,
            frame: ikReleaseF
          }
        );

        keyframes.push(
          {
            frame: startF,
            position: [startX, baseY, zPos],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'easeOutQuad'
          },
          {
            frame: fStepInArrive,
            position: [contactX, baseY, zPos],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: fEmbrace,
            position: [contactX, baseY, zPos],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: fThrust,
            position: [contactX, baseY, zPos],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'easeOutQuad'
          },
          {
            frame: recoilArriveF,
            position: [pushedX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        if (recoilArriveF < lastF) {
          keyframes.push({
            frame: lastF,
            position: [pushedX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          });
        }

        morphKeyframes.open_rest = [
          { frame: startF, weight: 1.0 },
          { frame: fEmbrace, weight: 1.0 - VERB_CONSTANTS.EMBRACE_CONTACT_WEIGHT },
          { frame: fThrust, weight: 0.0 },
          { frame: ikReleaseF, weight: 1.0 },
          ...(ikReleaseF < lastF ? [{ frame: lastF, weight: 1.0 }] : [])
        ];
        morphKeyframes.grasp_fist = [
          { frame: startF, weight: 0.0 },
          { frame: fEmbrace, weight: VERB_CONSTANTS.EMBRACE_CONTACT_WEIGHT },
          { frame: fThrust, weight: 1.0 },
          { frame: ikReleaseF, weight: 0.0 },
          ...(ikReleaseF < lastF ? [{ frame: lastF, weight: 0.0 }] : [])
        ];
        break;
      }

      case 'fall_recover': {
        nextX = currentX;
        nextPos = [currentX, baseY, currentPos[2]];
        const duration = endF - startF;
        const dropF = startF + Math.max(2, Math.min(Math.floor(duration * VERB_CONSTANTS.FALL_DROP_RATIO), duration - VERB_CONSTANTS.PRECISION_DECIMALS));
        const riseF = startF + Math.max(dropF - startF + 2, Math.min(Math.floor(duration * VERB_CONSTANTS.TURN_SCALE_STEP_1), duration - 2));

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: dropF,
            position: [currentX, baseY - VERB_CONSTANTS.SIM_DEEP_ROOM_FORWARD_LEFT, currentPos[2]],
            rotationZDegrees: -VERB_CONSTANTS.FALL_TILT_DEG,
            scale: [scaleXBase, scaleYBase * VERB_CONSTANTS.TURN_SCALE_STEP_1],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: riseF,
            position: [currentX, baseY - VERB_CONSTANTS.SIM_DEEP_ROOM_FORWARD_LEFT, currentPos[2]],
            rotationZDegrees: -VERB_CONSTANTS.FALL_TILT_DEG,
            scale: [scaleXBase, scaleYBase * VERB_CONSTANTS.TURN_SCALE_STEP_1],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }

      default: {
        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }
    }

    // Synthesize vocal lip-sync and facial expression morph keyframes from lyrics
    if (audioManifest?.lyrics && audioManifest.lyrics.length > 0) {
      const vocalMorphs = synthesizeVocalPerformanceKeyframes({
        lyrics: audioManifest.lyrics,
        shotStartFrame: startF,
        shotEndFrame: endF,
        emotionalTone,
        availableTargets: CANONICAL_BIPED_TARGET_NAMES
      });
      for (const [mName, mKeys] of Object.entries(vocalMorphs)) {
        morphKeyframes[mName] = mKeys;
      }
    }

    // Natural blinking
    const blinks: Array<{ frame: number; weight: number }> = [];
    const blinkDuration = endF - startF;
    const blinkStep = Math.max(VERB_CONSTANTS.IDLE_LOOP_FRAMES, Math.floor(blinkDuration * VERB_CONSTANTS.BLINK_INTERVAL_RATIO));
    for (
      let f = startF + Math.min(VERB_CONSTANTS.PROP_APPROACH_CLEARANCE, Math.floor(blinkDuration * VERB_CONSTANTS.FALL_DROP_RATIO));
      f + VERB_CONSTANTS.BLINK_DURATION_FRAMES <= lastF;
      f += blinkStep
    ) {
      blinks.push(
        { frame: f, weight: 0 },
        { frame: f + 2, weight: 1 },
        { frame: f + VERB_CONSTANTS.BLINK_DURATION_FRAMES, weight: 0 }
      );
    }
    morphKeyframes.blink = blinks;

    // Build default segment and phase continuity if not created by locomotion
    const loopFramesMap: Record<string, number> = {
      walk_to: VERB_CONSTANTS.WALK_LOOP_FRAMES,
      sprint_frenzy: VERB_CONSTANTS.RUN_LOOP_FRAMES,
      pop_vocal_sway: VERB_CONSTANTS.POP_SWAY_LOOP_FRAMES,
      idle: VERB_CONSTANTS.IDLE_LOOP_FRAMES
    };
    const rigClipDuration = VerbCompiler.getClipDuration(charRig, clipId, 0);
    const clipLoop = rigClipDuration > 0 ? rigClipDuration : (loopFramesMap[clipId] ?? (endF - startF));
    const prevClock = charPoseClockState?.clock ?? 0;
    const prevClip = charPoseClockState?.lastClip;
    const ONE_SHOT_ACTION_VERBS = new Set([
      'reach_and_grasp',
      'stop_and_turn',
      'carry_put_down',
      'gesture_point',
      'embrace_push_away',
      'sit_stand',
      'fall_recover'
    ]);

    let startPose0 = 0;
    if (ONE_SHOT_ACTION_VERBS.has(action.verb)) {
      startPose0 = 0;
      calculatedTimeScale = Number(((clipLoop / Math.max(1, endF - startF)) * (action.speedNorm ?? 1.0)).toFixed(VERB_CONSTANTS.PRECISION_DECIMALS));
    } else if (prevClip && prevClip.loopFrames > 0) {
      const normPhase = (((prevClock % prevClip.loopFrames) + prevClip.loopFrames) % prevClip.loopFrames) / prevClip.loopFrames;
      startPose0 = Number((normPhase * clipLoop).toFixed(VERB_CONSTANTS.PRECISION_DECIMALS));
    }

    if (segments.length === 0) {
      segments.push({
        startFrame: startF,
        endFrame: endF,
        clipId,
        timeScale: calculatedTimeScale,
        startPoseFrame: startPose0
      });
    }

    if (!nextClockState) {
      nextClockState = {
        clock: startPose0 + (endF - startF) * calculatedTimeScale,
        lastClip: { clipId, loopFrames: clipLoop }
      };
    }

    // Gaze direction targeting
    let gazeWorldPos: [number, number, number] | undefined;
    if (action.gazeTarget) {
      if (action.gazeTarget.kind === 'position') {
        gazeWorldPos = action.gazeTarget.pos;
      } else if (action.gazeTarget.kind === 'character') {
        gazeWorldPos = otherCharPos ?? [0, baseY, 0];
      } else if (action.gazeTarget.kind === 'prop') {
        const pRig = activeRigs?.get(action.gazeTarget.propId);
        gazeWorldPos = pRig?.baseTransform.position ?? [0, baseY, 0];
      } else if (action.gazeTarget.kind === 'direction') {
        const rad = action.gazeTarget.facingDeg * VERB_CONSTANTS.DEG_TO_RAD;
        gazeWorldPos = [currentX + VERB_CONSTANTS.GAZE_DEFAULT_LOOK_DISTANCE * Math.cos(rad), baseY + VERB_CONSTANTS.GAZE_DEFAULT_LOOK_DISTANCE * Math.sin(rad), currentPos[2]];
      }
    } else if (action.verb === 'look_at') {
      const eyeWorldY = baseY + (VERB_CONSTANTS.DEFAULT_TORSO_OFFSET_Y + VERB_CONSTANTS.DEFAULT_SHOULDER_OFFSET_Y + VERB_CONSTANTS.DEFAULT_LOWER_ARM_LENGTH) * scaleYBase;
      if (otherCharPos !== undefined) {
        gazeWorldPos = [otherCharPos[0], eyeWorldY, otherCharPos[2]];
      } else {
        const facingSign = scaleXBase >= 0 ? 1 : -1;
        gazeWorldPos = [currentX + VERB_CONSTANTS.GAZE_DEFAULT_LOOK_DISTANCE * facingSign, eyeWorldY, currentPos[2]];
      }
    } else if (action.verb === 'gesture_point') {
      const facingSign = scaleXBase >= 0 ? 1 : -1;
      const hand: 'hand_l' | 'hand_r' = action.propSocket === 'hand_l' ? 'hand_l' : 'hand_r';
      const charRig = activeRigs?.get(instanceId);
      const armMetrics = VerbCompiler.deriveRigArmMetrics(charRig, hand);
      const shoulderWorldX = nextX + (hand === 'hand_r' ? armMetrics.shoulderOffset[0] : -armMetrics.shoulderOffset[0]) * scaleXBase;
      const shoulderWorldY = baseY + armMetrics.shoulderOffset[1] * scaleYBase;
      const maxArmReachWorld = armMetrics.maxReach * Math.abs(scaleXBase);
      gazeWorldPos = [
        shoulderWorldX + facingSign * (VERB_CONSTANTS.POINT_EXTEND_X_FACTOR * maxArmReachWorld),
        shoulderWorldY + (VERB_CONSTANTS.POINT_EXTEND_Y_FACTOR * maxArmReachWorld),
        currentPos[2]
      ];
    }

    if (gazeWorldPos) {
      gazeTargets.push({
        targetWorld: gazeWorldPos,
        weight: 1.0,
        startFrame: startF,
        endFrame: endF
      });
    }

    return {
      track: {
        rigId: instanceId,
        shotId,
        transform: { keyframes },
        pose: {
          timeScale: calculatedTimeScale,
          startPoseFrame: segments[0]?.startPoseFrame ?? startPose0,
          clipId,
          segments
        },
        morphKeyframes,
        morphBindings: [],
        attachmentSpans: [],
        ikTargets,
        gazeTargets
      },
      nextPos,
      nextX,
      nextClockState
    };
  }

  private static resolvePropSocket(
    action: CharacterActionDirective,
    propPos: [number, number, number],
    ownerPos: [number, number, number]
  ): RigSocketSlot {
    if (action.propSocket) {
      return action.propSocket;
    }
    if (action.associatedPropId) {
      return 'hand_r';
    }
    return propPos[0] < ownerPos[0] ? 'hand_l' : 'hand_r';
  }

  private static compilePropAction(
    propRigId: string,
    shotId: string,
    startF: number,
    endF: number,
    actorId: string,
    action: CharacterActionDirective,
    propState: PropRuntimeState,
    ownerPos: [number, number, number],
    ownerTargetPos: [number, number, number],
    _ownerRig?: AssetRigContract,
    releaseBeforeEnd?: boolean
  ): {
    track: EntityTrack;
    nextState: PropRuntimeState;
  } {
    const lastF = endF - 1;
    const duration = endF - startF;
    const keyframes: EntityTrackKeyframe[] = [];
    const attachmentSpans: PropAttachmentSpan[] = [];
    const initialPos = propState.currentPosition;
    let nextHeld = propState.held;
    let nextHeldBy = propState.heldBy;
    let nextReleased = propState.released;
    let nextPos: [number, number, number] = [...initialPos];

    const socketId = VerbCompiler.resolvePropSocket(action, initialPos, ownerPos);

    if (action.verb === 'embrace_push_away') {
      nextHeld = false;
      nextHeldBy = null;
      nextReleased = false;
      keyframes.push(
        {
          frame: startF,
          position: initialPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: initialPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        }
      );
    } else if (action.verb === 'reach_and_grasp') {
      const graspOffset = Math.max(2, Math.min(Math.round(duration * HALF), duration - 2));
      const graspFrame = startF + graspOffset;
      const liftF = Math.min(lastF, Math.max(graspFrame + 1, startF + Math.round(duration * VERB_CONSTANTS.CARRY_LIFT_START_RATIO)));
      const putBackF = Math.min(lastF - 1, Math.max(liftF + 1, startF + Math.round(duration * VERB_CONSTANTS.CARRY_PUT_BACK_RATIO)));
      const shouldPutBack = Boolean(releaseBeforeEnd && duration >= VERB_CONSTANTS.WALK_LOOP_FRAMES);
      nextHeld = !shouldPutBack;
      nextHeldBy = shouldPutBack ? null : actorId;
      nextReleased = shouldPutBack;

      keyframes.push(
        {
          frame: startF,
          position: initialPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: graspFrame,
          position: initialPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: initialPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        }
      );

      attachmentSpans.push({
        startFrame: graspFrame,
        endFrame: shouldPutBack ? putBackF : endF,
        ownerRigId: actorId,
        socketId
      });
    } else if (action.verb === 'carry_put_down') {
      const destPosDirective = action.target?.kind === 'position' ? action.target.pos : undefined;
      let destPos: [number, number, number];
      if (destPosDirective !== undefined) {
        destPos = [...destPosDirective];
      } else {
        const charDestX = ownerPos[0] <= 0 ? ownerPos[0] - VERB_CONSTANTS.SIM_DEFAULT_STEP_DISTANCE : ownerPos[0] + VERB_CONSTANTS.SIM_DEFAULT_STEP_DISTANCE;
        destPos = [
          charDestX + (charDestX <= ownerPos[0] ? -VERB_CONSTANTS.PROP_APPROACH_CLEARANCE : VERB_CONSTANTS.PROP_APPROACH_CLEARANCE),
          initialPos[1],
          initialPos[2]
        ];
      }
      const walkDeltaFrames = Math.max(1, Math.min(Math.floor(duration * HALF), duration - VERB_CONSTANTS.PRECISION_DECIMALS));
      const releaseOffset = Math.max(walkDeltaFrames + 1, Math.min(Math.round(duration * VERB_CONSTANTS.CARRY_RELEASE_RATIO), duration - VERB_CONSTANTS.CANONICAL_ACT_COUNT));
      const releaseFrame = startF + releaseOffset;
      nextHeld = false;
      nextHeldBy = null;
      nextReleased = true;
      nextPos = destPos;

      keyframes.push(
        {
          frame: startF,
          position: initialPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: releaseFrame,
          position: destPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: destPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        }
      );

      attachmentSpans.push({
        startFrame: startF,
        endFrame: releaseFrame,
        ownerRigId: actorId,
        socketId
      });
    } else if (propState.held || action.associatedPropId === propRigId) {
      nextHeld = true;
      nextHeldBy = propState.heldBy ?? actorId;
      nextReleased = false;

      keyframes.push(
        {
          frame: startF,
          position: [0, 0, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [0, 0, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        }
      );

      attachmentSpans.push({
        startFrame: startF,
        endFrame: endF,
        ownerRigId: propState.heldBy ?? actorId,
        socketId
      });
      nextPos = [ownerTargetPos[0], initialPos[1], ownerTargetPos[2]];
    } else {
      keyframes.push(
        {
          frame: startF,
          position: initialPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: initialPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        }
      );
    }

    return {
      track: {
        rigId: propRigId,
        shotId,
        transform: { keyframes },
        morphKeyframes: {},
        morphBindings: [],
        attachmentSpans
      },
      nextState: {
        held: nextHeld,
        heldBy: nextHeldBy,
        released: nextReleased,
        currentPosition: nextPos,
        currentRotationZ: 0
      }
    };
  }
}
