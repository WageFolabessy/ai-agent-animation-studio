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

export interface VerbCompileReport {
  readonly unfulfilledTiming: UnfulfilledTimingEntry[];
  readonly shotSubdivisions: ShotSubdivisionEntry[];
  readonly reachClamps: Array<{
    readonly beatId: string;
    readonly instanceId: string;
    readonly target: [number, number, number];
    readonly clampedReach: number;
    readonly maxReach: number;
  }>;
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

const FRAMING_DISTANCE_MAP: Record<CameraFraming, number> = {
  EXTREME_WIDE: 360,
  WIDE: 260,
  MEDIUM: 180,
  CLOSE_UP: 125,
  EXTREME_CLOSE_UP: 85
};

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
      verticalFovDegrees: (c1.verticalFovDegrees ?? 50) + ((c2.verticalFovDegrees ?? 50) - (c1.verticalFovDegrees ?? 50)) * u,
      nearPlane: c1.nearPlane,
      farPlane: c1.farPlane
    };
  }
  return c1;
}

export class VerbCompiler {
  public static readonly MIN_BEAT_LENGTH_FRAMES = 12;

  public static resolveInitialPropPlacement(
    propId: string,
    beats: StoryBeatContract['beats']
  ): [number, number, number] {
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
    const firstSet = beats[0]?.set;
    if (firstSet?.kitId === 'ARCHITECTURAL_INTERIOR') {
      return [0, 68, 0];
    }
    if (firstSet?.kitId === 'EXTERIOR_URBAN_VISTA') {
      return [-30, 24, 0];
    }
    return [0, 0, 0];
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

    const fps: 30 | 60 = storyBeatContract.fps === 60 ? 60 : 30;
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
      const basePos = VerbCompiler.resolveInitialPropPlacement(propId, beats);
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
      const f1 = Math.max(1, Math.floor(L / 3));
      const f2 = Math.max(f1 + 1, Math.floor((2 * L) / 3));

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
    const idx1 = Math.max(1, Math.min(n - 2, Math.floor(n / 3)));
    const idx2 = Math.max(idx1 + 1, Math.min(n - 1, Math.floor((2 * n) / 3)));
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
        actNumber: 3,
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
        ? (cIdx === 0 ? -92 : 88)
        : -95;
    }
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      if (i > 0 && beat.set.kitId !== beats[i - 1].set.kitId) {
        simX[storyBeatContract.cast[0]?.instanceId ?? ''] = -95;
        if (storyBeatContract.cast[1]) {
          simX[storyBeatContract.cast[1].instanceId] = -125;
        }
      }
      beatCharX.push({ ...simX });
      const nextSimX = { ...simX };
      for (const a of beat.actions) {
        const cur = simX[a.instanceId] ?? 0;
        const otherId = beat.presentCharacters.find((id) => id !== a.instanceId);
        const otherCur = otherId ? simX[otherId] : undefined;
        if (a.verb === 'walk_to') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          if (tPos !== undefined) {
            nextSimX[a.instanceId] = tPos;
          } else if (a.associatedPropId && rigs.has(a.associatedPropId)) {
            const propPos = rigs.get(a.associatedPropId)!.baseTransform.position;
            nextSimX[a.instanceId] = propPos[0] + (cur <= propPos[0] ? -22 : 22);
          } else if (otherCur !== undefined) {
            if (cur < -60 && otherCur < -60) nextSimX[a.instanceId] = cur <= otherCur ? 35 : 65;
            else nextSimX[a.instanceId] = cur <= otherCur ? -34 : 34;
          } else {
            const firstProp = Array.from(rigs.values()).find((r) => r.type === 'prop');
            if (firstProp) {
              const pX = firstProp.baseTransform.position[0];
              nextSimX[a.instanceId] = pX + (cur <= pX ? -22 : 22);
            } else {
              nextSimX[a.instanceId] = Math.min(25, -cur * 0.25);
            }
          }
        } else if (a.verb === 'run_to') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          if (tPos !== undefined) nextSimX[a.instanceId] = tPos;
          else if (otherCur !== undefined) nextSimX[a.instanceId] = cur <= otherCur ? 65 : 35;
          else nextSimX[a.instanceId] = 65;
        } else if (a.verb === 'carry_put_down') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          nextSimX[a.instanceId] = tPos !== undefined ? tPos : (cur <= 0 ? cur - 46 : cur + 46);
        } else if (a.verb === 'gesture_point') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          if (tPos !== undefined) nextSimX[a.instanceId] = tPos;
          else if (cur < -50) nextSimX[a.instanceId] = cur + 23;
          else nextSimX[a.instanceId] = cur;
        } else if (a.verb === 'embrace_push_away') {
          if (otherCur !== undefined) {
            const isLeft = cur <= otherCur;
            nextSimX[a.instanceId] = isLeft ? -48 : 48;
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
      const distZ = FRAMING_DISTANCE_MAP[framing] ?? 200;

      const isReachGrasp = beat.actions.some((a) => a.verb === 'reach_and_grasp');
      const isGesturePoint = beat.actions.some((a) => a.verb === 'gesture_point');

      // Camera focal point, target, and headroom math
      let focalX: number;
      let targetY: number;
      let camY: number;
      let effectiveFraming = framing;
      let effectiveDistZ = distZ;

      const lookOffset = beat.camera.lookRoom === 'left' ? -18 : beat.camera.lookRoom === 'right' ? 18 : 0;
      const charPositions = beatCharX[i];
      const focalId = beat.camera.focalCharacterId;
      const focalPos = charPositions[focalId] ?? 0;
      const otherPresentId = beat.presentCharacters.find((id) => id !== focalId);
      const isTwoShot =
        beat.presentCharacters.length >= 2 &&
        (effectiveFraming === 'WIDE' || effectiveFraming === 'MEDIUM');

      if (isReachGrasp) {
        effectiveFraming = 'CLOSE_UP';
        effectiveDistZ = 135;
        focalX = -10;
        targetY = 88;
        camY = 98;
      } else if (isGesturePoint) {
        effectiveFraming = 'CLOSE_UP';
        effectiveDistZ = FRAMING_DISTANCE_MAP.CLOSE_UP;
        focalX = focalPos;
        targetY = 117;
        camY = 127;
      } else if (isTwoShot && otherPresentId) {
        const otherPos = charPositions[otherPresentId] ?? 0;
        const midX = (focalPos + otherPos) / 2;
        focalX = midX + lookOffset;
        targetY = effectiveFraming === 'WIDE' ? 95 : 105;
        camY = targetY + 10;
      } else {
        focalX = focalPos + lookOffset;
        const focalCast = storyBeatContract.cast.find((c) => c.instanceId === focalId);
        const isPartnerFocal =
          focalCast?.role === 'PARTNER' || focalCast?.archetypeId === 'companion_silhouette';
        targetY =
          effectiveFraming === 'EXTREME_CLOSE_UP'
            ? isPartnerFocal
              ? 80
              : 88
            : effectiveFraming === 'CLOSE_UP'
              ? isPartnerFocal
                ? 103
                : 117
              : 95;
        camY = targetY + 10;
      }

      const deltaPan = movement === 'PAN' ? 30 : 0;
      const deltaDolly = movement === 'DOLLY' ? -35 : 0;
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
        position: [focalX - 10, camY, effectiveDistZ],
        target: [focalX, targetY, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 50,
        rollDegrees: dutchAngle,
        projectionMode: 'perspective',
        nearPlane: 1,
        farPlane: 2000
      };

      const cameraEnd: CameraTransform = {
        position: [focalX - 10 + deltaPan, camY, effectiveDistZ + deltaDolly],
        target: [focalX + deltaPan, targetY, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 50,
        rollDegrees: dutchAngle,
        projectionMode: 'perspective',
        nearPlane: 1,
        farPlane: 2000
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
    for (let j = 0; j < shotPlans.length; j++) {
      const sp = shotPlans[j];
      const beat = beats[sp.beatIndex];
      const base = baseBeatShots[sp.beatIndex];
      const actNumber: 1 | 2 | 3 = j < idx1 ? 1 : j < idx2 ? 2 : 3;

      const camStart = sp.uStart === 0
        ? base.cameraStart
        : lerpCameraTransform(base.cameraStart, base.cameraEnd, sp.uStart);
      const camEnd = sp.uEnd === 1.0
        ? base.cameraEnd
        : lerpCameraTransform(base.cameraStart, base.cameraEnd, sp.uEnd);

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
        transitionIn: j > 0 ? { type: 'CROSS_FADE', durationFrames: 6 } : undefined
      });
    }

    // 5. Compile Choreography Tracks
    const tracks: EntityTrack[] = [];
    const charCurrentPos: Record<string, [number, number, number]> = {};
    const charArchetypes: Record<string, string> = {};
    const charPoseClockState: Record<string, { clock: number; lastClip?: { clipId: string; loopFrames: number } }> = {};
    const unfulfilledTiming: UnfulfilledTimingEntry[] = [];
    const leadId = storyBeatContract.cast[0].instanceId;

    const isMultiCast = storyBeatContract.cast.length > 1;
    for (let cIdx = 0; cIdx < storyBeatContract.cast.length; cIdx++) {
      const c = storyBeatContract.cast[cIdx];
      const startX = isMultiCast
        ? (cIdx === 0 ? -92 : 88)
        : -95;
      const baseY = c.archetypeId === 'companion_silhouette' ? 65 : 75;
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
        charCurrentPos[storyBeatContract.cast[0]?.instanceId ?? ''] = [-95, 75, 0];
        if (storyBeatContract.cast[1]) {
          charCurrentPos[storyBeatContract.cast[1].instanceId] = [-125, 65, 0];
        }
      }

      const presentList = storyBeatContract.cast.filter((c) =>
        beat.presentCharacters.includes(c.instanceId)
      );

      const shotStartPositions = { ...charCurrentPos };
      const nextPositions: Record<string, [number, number, number]> = {};
      const beatTracks: EntityTrack[] = [];

      for (let cIdx = 0; cIdx < presentList.length; cIdx++) {
        const char = presentList[cIdx];
        const otherChar = presentList.find((other) => other.instanceId !== char.instanceId);
        const otherPos = otherChar ? shotStartPositions[otherChar.instanceId] : undefined;

        const action = beat.actions.find((a) => a.instanceId === char.instanceId) ?? {
          instanceId: char.instanceId,
          verb: 'walk_to' as const,
          speedNorm: 1.0,
          intensityNorm: 0.7
        };

        const charTrack = VerbCompiler.compileCharacterAction(
          char.instanceId,
          beat.beatId,
          beatStartF,
          beatEndF,
          action,
          shotStartPositions[char.instanceId] ?? [0, 75, 0],
          otherPos,
          charArchetypes[char.instanceId],
          audioManifest,
          beat.emotionalTone,
          charPoseClockState[char.instanceId],
          unfulfilledTiming,
          rigs,
          reachClamps
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

        const effectiveAction: CharacterActionDirective = actorAction ?? {
          instanceId: actorId,
          verb: 'walk_to' as const,
          speedNorm: 1.0,
          intensityNorm: 0.7
        };

        const charPos = shotStartPositions[actorId] ?? [0, 75, 0];
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
          charRig
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
      resolution: { width: 1920, height: 1080 },
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
        shotSubdivisions,
        reachClamps
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
    const loopWalk = 36;
    const strideWalk = 15.0;
    const vNomWalk = (strideWalk * absScaleX) / loopWalk;

    const loopRun = 18;
    const strideRun = 23.0;
    const vNomRun = (strideRun * absScaleX) / loopRun;

    if (distance < 1e-3 || availableFrames <= 0) {
      return {
        chosenClipId: 'idle',
        loopFrames: 30,
        strideLengthUnits: 0,
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
      if (tsRun >= 0.6 && tsRun <= 1.6) {
        chosenClipId = 'sprint_frenzy';
        chosenLoop = loopRun;
        chosenStride = strideRun;
        targetSpeed = vDesired;
      } else if (tsRun < 0.6) {
        if (tsWalk >= 0.6 && tsWalk <= 1.6) {
          chosenClipId = 'walk_to';
          chosenLoop = loopWalk;
          chosenStride = strideWalk;
          targetSpeed = vDesired;
        } else if (tsWalk < 0.6) {
          chosenClipId = 'walk_to';
          chosenLoop = loopWalk;
          chosenStride = strideWalk;
          targetSpeed = 0.6 * vNomWalk;
          unfulfilledReason = 'Speed below minimum valid gait timeScale 0.6; arrived early and held in place';
        } else {
          chosenClipId = 'sprint_frenzy';
          chosenLoop = loopRun;
          chosenStride = strideRun;
          targetSpeed = 0.6 * vNomRun;
          unfulfilledReason = 'Speed below minimum run timeScale 0.6; arrived early and held in place';
        }
      } else {
        chosenClipId = 'sprint_frenzy';
        chosenLoop = loopRun;
        chosenStride = strideRun;
        targetSpeed = 1.6 * vNomRun;
        unfulfilledReason = 'Target beyond maximum locomotion speed; clamped to max timeScale 1.6';
      }
    } else {
      if (tsWalk >= 0.6 && tsWalk <= 1.6) {
        chosenClipId = 'walk_to';
        chosenLoop = loopWalk;
        chosenStride = strideWalk;
        targetSpeed = vDesired;
      } else if (tsWalk > 1.6) {
        if (tsRun >= 0.6 && tsRun <= 1.6) {
          chosenClipId = 'sprint_frenzy';
          chosenLoop = loopRun;
          chosenStride = strideRun;
          targetSpeed = vDesired;
        } else if (tsRun < 0.6) {
          chosenClipId = 'sprint_frenzy';
          chosenLoop = loopRun;
          chosenStride = strideRun;
          targetSpeed = 0.6 * vNomRun;
          unfulfilledReason = 'Switched to run at min timeScale 0.6; arrived early and held in place';
        } else {
          chosenClipId = 'sprint_frenzy';
          chosenLoop = loopRun;
          chosenStride = strideRun;
          targetSpeed = 1.6 * vNomRun;
          unfulfilledReason = 'Target beyond maximum locomotion speed; clamped to max timeScale 1.6';
        }
      } else {
        chosenClipId = 'walk_to';
        chosenLoop = loopWalk;
        chosenStride = strideWalk;
        targetSpeed = 0.6 * vNomWalk;
        unfulfilledReason = 'Speed below minimum walk timeScale 0.6; arrived early and held in place';
      }
    }

    const rawFrames = Math.max(1, Math.round(distance / targetSpeed));
    const tMove = Math.min(availableFrames, rawFrames);
    const vActual = distance / tMove;
    const rawTimeScale = (vActual * chosenLoop) / (chosenStride * absScaleX);
    const timeScale = Number(Math.max(0.6, Math.min(1.6, rawTimeScale)).toFixed(4));
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
    }>
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

    const baseY = archetypeId === 'companion_silhouette' ? 65 : 75;
    const [scaleXBase, scaleYBase] =
      archetypeId === 'companion_silhouette' ? [1.6, 1.15] : [1.35, 1.45];

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
          const clearance = 26;
          const isLeft = currentPos[0] <= otherP[0];
          targetPos = [otherP[0] + (isLeft ? -clearance : clearance), baseY, otherP[2]];
        } else if (action.target?.kind === 'prop') {
          const propRig = activeRigs?.get(action.target.propId);
          const pPos = propRig?.baseTransform.position ?? [0, baseY, 0];
          const isLeft = currentPos[0] <= pPos[0];
          targetPos = [pPos[0] + (isLeft ? -18 : 18), baseY, pPos[2]];
        } else if (action.associatedPropId && activeRigs?.has(action.associatedPropId)) {
          const propRig = activeRigs.get(action.associatedPropId);
          const pPos = propRig?.baseTransform.position ?? [0, baseY, 0];
          const isLeft = currentPos[0] <= pPos[0];
          targetPos = [pPos[0] + (isLeft ? -22 : 22), baseY, pPos[2]];
        } else if (otherCharPos !== undefined) {
          if (currentPos[0] < -60 && otherCharPos[0] < -60) {
            targetPos = [currentPos[0] <= otherCharPos[0] ? 35 : 65, baseY, 0];
          } else {
            const isLeft = currentPos[0] <= otherCharPos[0];
            targetPos = [isLeft ? -34 : 34, baseY, 0];
          }
        } else {
          const firstProp = activeRigs ? Array.from(activeRigs.values()).find((r) => r.type === 'prop') : undefined;
          if (firstProp) {
            const pX = firstProp.baseTransform.position[0];
            targetPos = [pX + (currentPos[0] <= pX ? -22 : 22), baseY, 0];
          } else {
            targetPos = [currentPos[0] < 0 ? currentPos[0] + 75 : currentPos[0] - 75, baseY, 0];
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

        const isExteriorTraverse = shotId.includes('exterior') || (currentPos[0] < -60 && targetPos[0] > 0);
        const forceEarlyArrival = !targetPosDirective && !isExteriorTraverse && totalDist > 40 && deltaFrames >= 200;

        const plan = VerbCompiler.planLocomotionGait(
          totalDist,
          moveFrames,
          action.speedNorm ?? 1.0,
          scaleXBase,
          isRunVerb,
          forceEarlyArrival ? Math.floor(moveFrames * (5.5 / 7.0)) : undefined
        );

        clipId = plan.chosenClipId;
        calculatedTimeScale = plan.timeScale;
        const arriveF = Math.min(lastF, startF + plan.tMove);

        const rotZ = isRunVerb ? (sX > 0 ? 14 : -14) : 0;
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
            position: [targetPos[0], baseY, targetPos[2]],
            rotationZDegrees: rotZ,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        if (arriveF < lastF) {
          keyframes.push({
            frame: lastF,
            position: [targetPos[0], baseY, targetPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          });
        }

        if (action.associatedPropId) {
          const hand: 'hand_l' | 'hand_r' = action.propSocket === 'hand_l' ? 'hand_l' : 'hand_r';
          const headWorldY = baseY + (18 + 15 + 16) * scaleYBase;
          const overheadDx = (sX >= 0 ? 1 : -1) * 4;
          const overheadDy = 8;
          ikTargets.push(
            {
              hand,
              targetWorld: [currentPos[0] + overheadDx, headWorldY + overheadDy, currentPos[2]],
              weight: 1.0,
              frame: startF
            },
            {
              hand,
              targetWorld: [targetPos[0] + overheadDx, headWorldY + overheadDy, targetPos[2]],
              weight: 1.0,
              frame: lastF
            }
          );
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
          startPose0 = Number((normPhase * plan.loopFrames).toFixed(4));
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
          const holdLoop = 30;
          const normPhaseHold = (((clockAtArrive % plan.loopFrames) + plan.loopFrames) % plan.loopFrames) / plan.loopFrames;
          const startPoseHold = Number((normPhaseHold * holdLoop).toFixed(4));

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

          if (unfulfilledTiming) {
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
          const headWorldY = baseY + (18 + 15 + 16) * scaleYBase;
          const overheadDx = (sX >= 0 ? 1 : -1) * 4;
          const overheadDy = 8;
          ikTargets.push(
            {
              hand,
              targetWorld: [targetX + overheadDx, headWorldY + overheadDy, currentPos[2]],
              weight: 1.0,
              frame: startF
            },
            {
              hand,
              targetWorld: [targetX + overheadDx, headWorldY + overheadDy, currentPos[2]],
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
            rotationZDegrees: faceRight ? 4 : -4,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }

      case 'reach_and_grasp': {
        const duration = endF - startF;
        const graspOffset = Math.max(2, Math.min(Math.round(duration * 0.5), duration - 2));
        const graspFrame = startF + graspOffset;
        const reachStartF = startF + Math.max(0, Math.floor(graspOffset * 0.2));

        const propId = action.associatedPropId ?? (action.target?.kind === 'prop' ? action.target.propId : undefined);
        let propPos: [number, number, number] = [0, 68, 0];
        if (propId && activeRigs?.has(propId)) {
          propPos = activeRigs.get(propId)!.baseTransform.position;
        } else if (action.target?.kind === 'position') {
          propPos = action.target.pos;
        }
        const socketId = VerbCompiler.resolvePropSocket(action, propPos, currentPos);
        const hand: 'hand_l' | 'hand_r' = socketId === 'hand_l' ? 'hand_l' : 'hand_r';

        // Reach distance verification
        const shoulderWorldX = currentX + (hand === 'hand_r' ? 6 : -6) * scaleXBase;
        const shoulderWorldY = baseY + (18 + 15) * scaleYBase;
        const distToProp = Math.hypot(propPos[0] - shoulderWorldX, propPos[1] - shoulderWorldY);
        const maxReach = 34 * Math.abs(scaleXBase);
        if (distToProp > maxReach && reachClamps) {
          reachClamps.push({
            beatId: shotId,
            instanceId,
            target: propPos,
            clampedReach: maxReach,
            maxReach
          });
        }

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
            targetWorld: propPos,
            weight: 1.0,
            frame: lastF
          }
        );

        nextX = currentX;
        nextPos = [currentX, baseY, currentPos[2]];
        clipId = 'reach_and_grasp';

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

        morphKeyframes.open_rest = [
          { frame: startF, weight: 1.0 },
          { frame: graspFrame, weight: 0.0 },
          { frame: lastF, weight: 0.0 }
        ];
        morphKeyframes.grasp_fist = [
          { frame: startF, weight: 0.0 },
          { frame: graspFrame, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];
        break;
      }

      case 'stop_and_turn': {
        nextX = currentX;
        nextPos = [currentX, baseY, currentPos[2]];
        clipId = 'stop_and_turn';
        const duration = endF - startF;
        const turnOffset = Math.max(2, Math.min(Math.floor(duration * 0.25), duration - 6));
        const turnF0 = startF + turnOffset;

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
            scale: [scaleXBase * 0.7, scaleYBase * 0.98],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 2,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [scaleXBase * 0.35, scaleYBase * 0.96],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 3,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [-scaleXBase * 0.35, scaleYBase * 0.96],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 4,
            position: [currentX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [-scaleXBase * 0.7, scaleYBase * 0.98],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 5,
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
          charDestX = destPos[0] + (currentPos[0] >= destPos[0] ? 20 : -20);
        } else {
          charDestX = currentPos[0] <= 0 ? currentPos[0] - 46 : currentPos[0] + 46;
          destPos = [
            charDestX + (charDestX <= currentPos[0] ? -20 : 20),
            68,
            currentPos[2]
          ];
        }

        nextX = charDestX;
        nextPos = [charDestX, baseY, currentPos[2]];
        clipId = 'carry_put_down';
        const walkDeltaFrames = Math.max(1, Math.min(Math.floor(duration * 0.5), duration - 4));
        const walkEndF = startF + walkDeltaFrames;
        const releaseOffset = Math.max(walkDeltaFrames + 1, Math.min(Math.round(duration * (155 / 210)), duration - 3));
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

          const prevClock = charPoseClockState?.clock ?? 0;
          const prevClip = charPoseClockState?.lastClip;
          let startPose0 = 0;
          if (prevClip && prevClip.loopFrames > 0) {
            const normPhase = (((prevClock % prevClip.loopFrames) + prevClip.loopFrames) % prevClip.loopFrames) / prevClip.loopFrames;
            startPose0 = Number((normPhase * walkPlan.loopFrames).toFixed(4));
          }

          segments.push({
            startFrame: startF,
            endFrame: walkEndF,
            clipId: 'walk_to',
            timeScale: walkPlan.timeScale,
            startPoseFrame: startPose0
          });

          const crouchDuration = endF - walkEndF;
          const crouchTimeScale = crouchDuration > 0 ? (210 - 105) / crouchDuration : 1.0;
          segments.push({
            startFrame: walkEndF,
            endFrame: endF,
            clipId: 'carry_put_down',
            timeScale: crouchTimeScale,
            startPoseFrame: 105
          });

          nextClockState = {
            clock: 105 + crouchDuration * crouchTimeScale,
            lastClip: { clipId: 'carry_put_down', loopFrames: 210 }
          };
        } else {
          const walkSpeed = walkDist / walkDeltaFrames;
          const nominalWalkSpeed = (15.0 * Math.abs(scaleXBase)) / 36;
          calculatedTimeScale = walkDist > 1e-3
            ? Math.max(0.6, Math.min(1.6, walkSpeed / nominalWalkSpeed))
            : 1.0;
        }

        const socketId = action.propSocket ?? 'hand_r';
        const hand: 'hand_l' | 'hand_r' = socketId === 'hand_l' ? 'hand_l' : 'hand_r';

        // Reach distance check at put-down destination
        const shoulderWorldX = charDestX + (hand === 'hand_r' ? 6 : -6) * sX;
        const shoulderWorldY = baseY + (18 + 15) * scaleYBase;
        const distToDest = Math.hypot(destPos[0] - shoulderWorldX, destPos[1] - shoulderWorldY);
        const maxReach = 34 * Math.abs(scaleXBase);
        if (distToDest > maxReach && reachClamps) {
          reachClamps.push({
            beatId: shotId,
            instanceId,
            target: destPos,
            clampedReach: maxReach,
            maxReach
          });
        }

        const carryDx = 14 * Math.abs(scaleXBase);
        const carryDy = 10 * scaleYBase;

        ikTargets.push(
          {
            hand,
            targetWorld: [currentPos[0] + facingSign * carryDx, shoulderWorldY - carryDy, currentPos[2]],
            weight: 1.0,
            frame: startF
          },
          {
            hand,
            targetWorld: [charDestX + facingSign * carryDx, shoulderWorldY - carryDy, currentPos[2]],
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
        const sitF = startF + Math.max(2, Math.min(Math.floor(duration * 0.35), duration - 4));
        const standF = startF + Math.max(sitF - startF + 2, Math.min(Math.floor(duration * 0.75), duration - 2));

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
            position: [currentX, baseY - 20, currentPos[2]],
            rotationZDegrees: -5,
            scale: [scaleXBase, scaleYBase * 0.85],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: standF,
            position: [currentX, baseY - 20, currentPos[2]],
            rotationZDegrees: -5,
            scale: [scaleXBase, scaleYBase * 0.85],
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
        } else if (currentX < -50) {
          targetX = currentX + 23;
        }
        nextX = targetX;
        nextPos = [targetX, baseY, currentPos[2]];
        clipId = 'gesture_point';
        const duration = endF - startF;
        const pointOffset = Math.max(1, Math.min(Math.floor(duration * 0.25), duration - 2));
        const pointF = startF + pointOffset;

        const hand: 'hand_l' | 'hand_r' = action.propSocket === 'hand_l' ? 'hand_l' : 'hand_r';
        const maxArmReachWorld = 34 * Math.abs(scaleXBase);
        const shoulderWorldX = targetX + (hand === 'hand_r' ? 6 : -6) * scaleXBase;
        const shoulderWorldY = baseY + (18 + 15) * scaleYBase;
        const facingSign = scaleXBase >= 0 ? 1 : -1;

        let pointTarget: [number, number, number];
        if (action.target?.kind === 'direction') {
          const rad = (action.target.facingDeg * Math.PI) / 180;
          pointTarget = [targetX + 60 * Math.cos(rad), baseY + 60 * Math.sin(rad), currentPos[2]];
        } else {
          pointTarget = [
            targetX + facingSign * (0.82 * maxArmReachWorld),
            shoulderWorldY + (0.42 * maxArmReachWorld),
            currentPos[2]
          ];
        }

        const distToPoint = Math.hypot(pointTarget[0] - shoulderWorldX, pointTarget[1] - shoulderWorldY);
        const maxReach = 34 * Math.abs(scaleXBase);
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

        morphKeyframes.point = [
          { frame: startF, weight: 0.0 },
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
        const contactX = isLeft ? -22 : 22;
        const pushedX = isLeft ? -48 : 48;
        nextX = pushedX;
        nextPos = [pushedX, baseY, currentPos[2]];

        const duration = endF - startF;
        const fEmbrace = startF + Math.max(2, Math.min(Math.floor(duration * (3.0 / 7.0)), duration - 4));
        const fThrust = startF + Math.max(fEmbrace - startF + 1, Math.min(Math.floor(duration * (3.5 / 7.0)), duration - 2));
        const sX = isLeft ? scaleXBase : -scaleXBase;

        // Step-in locomotion sub-span
        const stepDist = Math.abs(contactX - startX);
        const stepFrames = fEmbrace - startF;
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
            endFrame: fEmbrace,
            clipId: 'walk_to',
            timeScale: stepPlan.timeScale,
            startPoseFrame: 0
          });
        }

        // Contact embrace/thrust sub-span
        segments.push({
          startFrame: fEmbrace,
          endFrame: fThrust,
          clipId: 'embrace_push_away',
          timeScale: 1.0,
          startPoseFrame: 0
        });

        // Recoil push-away sub-span
        const recoilDist = Math.abs(pushedX - contactX);
        const recoilFrames = endF - fThrust;
        if (recoilDist > 1.0 && recoilFrames > 0) {
          const recoilPlan = VerbCompiler.planLocomotionGait(
            recoilDist,
            recoilFrames,
            action.speedNorm ?? 1.1,
            -sX,
            false
          );
          segments.push({
            startFrame: fThrust,
            endFrame: endF,
            clipId: 'walk_to',
            timeScale: recoilPlan.timeScale,
            startPoseFrame: 0
          });
        }

        nextClockState = {
          clock: recoilFrames * 1.0,
          lastClip: { clipId: 'walk_to', loopFrames: 36 }
        };

        const hand: 'hand_l' | 'hand_r' = isLeft ? 'hand_r' : 'hand_l';
        const partnerContactX = isLeft ? -8 : 8;
        const contactTarget: [number, number, number] = [partnerContactX, baseY + 10, currentPos[2]];

        ikTargets.push(
          {
            hand,
            targetWorld: contactTarget,
            weight: 0.0,
            frame: startF
          },
          {
            hand,
            targetWorld: contactTarget,
            weight: 1.0,
            frame: fEmbrace
          },
          {
            hand,
            targetWorld: contactTarget,
            weight: 1.0,
            frame: fThrust
          },
          {
            hand,
            targetWorld: contactTarget,
            weight: 0.0,
            frame: lastF
          }
        );

        keyframes.push(
          {
            frame: startF,
            position: [startX, baseY, currentPos[2]],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: fEmbrace,
            position: [contactX, baseY, currentPos[2]],
            rotationZDegrees: isLeft ? 8 : -8,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: fThrust,
            position: [contactX + (isLeft ? -2 : 2), baseY, currentPos[2]],
            rotationZDegrees: isLeft ? 12 : -12,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [pushedX, baseY, currentPos[2]],
            rotationZDegrees: isLeft ? -10 : 10,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        morphKeyframes.open_rest = [
          { frame: startF, weight: 1.0 },
          { frame: fThrust, weight: 0.0 },
          { frame: lastF, weight: 1.0 }
        ];
        morphKeyframes.grasp_fist = [
          { frame: startF, weight: 0.0 },
          { frame: fEmbrace, weight: 0.8 },
          { frame: fThrust, weight: 1.0 },
          { frame: lastF, weight: 0.0 }
        ];
        break;
      }

      case 'fall_recover': {
        nextX = currentX;
        nextPos = [currentX, baseY, currentPos[2]];
        const duration = endF - startF;
        const dropF = startF + Math.max(2, Math.min(Math.floor(duration * 0.3), duration - 4));
        const riseF = startF + Math.max(dropF - startF + 2, Math.min(Math.floor(duration * 0.7), duration - 2));

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
            position: [currentX, baseY - 35, currentPos[2]],
            rotationZDegrees: -25,
            scale: [scaleXBase, scaleYBase * 0.7],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: riseF,
            position: [currentX, baseY - 35, currentPos[2]],
            rotationZDegrees: -25,
            scale: [scaleXBase, scaleYBase * 0.7],
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
    const blinkStep = Math.max(30, Math.floor(blinkDuration * 0.4));
    for (
      let f = startF + Math.min(20, Math.floor(blinkDuration * 0.3));
      f + 4 <= lastF;
      f += blinkStep
    ) {
      blinks.push(
        { frame: f, weight: 0 },
        { frame: f + 2, weight: 1 },
        { frame: f + 4, weight: 0 }
      );
    }
    morphKeyframes.blink = blinks;

    // Build default segment and phase continuity if not created by locomotion
    const loopFramesMap: Record<string, number> = {
      walk_to: 36,
      sprint_frenzy: 18,
      pop_vocal_sway: 24,
      idle: 30,
      reach_and_grasp: 210,
      stop_and_turn: 210,
      carry_put_down: 210,
      gesture_point: 210,
      embrace_push_away: 210,
      sit_stand: 210,
      fall_recover: 210
    };
    const clipLoop = loopFramesMap[clipId] ?? (endF - startF);
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
      calculatedTimeScale = Number(((210 / Math.max(1, endF - startF)) * (action.speedNorm ?? 1.0)).toFixed(4));
    } else if (prevClip && prevClip.loopFrames > 0) {
      const normPhase = (((prevClock % prevClip.loopFrames) + prevClip.loopFrames) % prevClip.loopFrames) / prevClip.loopFrames;
      startPose0 = Number((normPhase * clipLoop).toFixed(4));
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
        const rad = (action.gazeTarget.facingDeg * Math.PI) / 180;
        gazeWorldPos = [currentX + 100 * Math.cos(rad), baseY + 100 * Math.sin(rad), currentPos[2]];
      }
    } else if (action.verb === 'look_at') {
      if (otherCharPos !== undefined) {
        gazeWorldPos = [otherCharPos[0], baseY + 15, otherCharPos[2]];
      } else {
        const facingSign = scaleXBase >= 0 ? 1 : -1;
        gazeWorldPos = [currentX + 100 * facingSign, baseY + 15, currentPos[2]];
      }
    } else if (action.verb === 'gesture_point') {
      const facingSign = scaleXBase >= 0 ? 1 : -1;
      const shoulderWorldY = baseY + (18 + 15) * scaleYBase;
      const maxArmReachWorld = 34 * Math.abs(scaleXBase);
      gazeWorldPos = [
        nextX + facingSign * (0.82 * maxArmReachWorld),
        shoulderWorldY + (0.42 * maxArmReachWorld),
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
    _ownerRig?: AssetRigContract
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
      const graspOffset = Math.max(2, Math.min(Math.round(duration * 0.5), duration - 2));
      const graspFrame = startF + graspOffset;
      nextHeld = true;
      nextHeldBy = actorId;
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
        endFrame: endF,
        ownerRigId: actorId,
        socketId
      });
    } else if (action.verb === 'carry_put_down') {
      const destPosDirective = action.target?.kind === 'position' ? action.target.pos : undefined;
      let destPos: [number, number, number];
      if (destPosDirective !== undefined) {
        destPos = [...destPosDirective];
      } else {
        const charDestX = ownerPos[0] <= 0 ? ownerPos[0] - 46 : ownerPos[0] + 46;
        destPos = [
          charDestX + (charDestX <= ownerPos[0] ? -20 : 20),
          initialPos[1],
          initialPos[2]
        ];
      }
      const walkDeltaFrames = Math.max(1, Math.min(Math.floor(duration * 0.5), duration - 4));
      const releaseOffset = Math.max(walkDeltaFrames + 1, Math.min(Math.round(duration * (155 / 210)), duration - 3));
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
      nextPos = ownerTargetPos;
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
