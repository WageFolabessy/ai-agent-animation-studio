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
import type { AssetRigContract } from '../../../schemas/rig.contract.js';
import type {
  ChoreographyContract,
  EntityTrack,
  EntityTrackKeyframe,
  PropAttachmentSpan
} from '../../../schemas/choreography.contract.js';
import type { EmotionalTone } from '../../../schemas/story-spec.contract.js';
import { ArchetypeFactory } from '../../library/archetype-factory.js';
import { PropFactory } from '../../library/prop-factory.js';
import { THEME_PALETTES } from '../../library/environment-kit.js';
import {
  synthesizeVocalPerformanceKeyframes,
  CANONICAL_BIPED_MORPH_TARGETS
} from '../../rigging/vocal-performance-solver.js';

const CANONICAL_BIPED_TARGET_NAMES = new Set(
  CANONICAL_BIPED_MORPH_TARGETS.map((t) => t.name)
);

export interface CompiledStoryBeatProduction {
  readonly storyboard: DirectorStoryboardContract;
  readonly rigs: Map<string, AssetRigContract>;
  readonly choreography: ChoreographyContract;
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

export class VerbCompiler {
  public static compile(
    storyBeatContract: StoryBeatContract,
    audioManifest: AudioAnalysisManifest
  ): CompiledStoryBeatProduction {
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

    // Always include coffee_cup and umbrella props
    const coffeeCupRig = PropFactory.buildStandalonePropRig('coffee_cup', 'coffee_cup', [0, 68, 0]);
    rigs.set(coffeeCupRig.id, coffeeCupRig);
    const umbrellaRig = PropFactory.buildStandalonePropRig('umbrella', 'umbrella', [-30, 24, 0]);
    rigs.set(umbrellaRig.id, umbrellaRig);

    // 2. Pre-compute shot frame ranges to snap Act boundaries to shot cuts
    const shotRanges: Array<{ startFrame: number; endFrame: number }> = [];
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const startFrame = i === 0 ? 0 : beat.startFrame;
      const endFrame = i === beats.length - 1 ? totalFrames : beat.endFrame;
      shotRanges.push({ startFrame, endFrame });
    }

    const n = shotRanges.length;
    const idx1 = Math.max(1, Math.min(n - 2, Math.floor(n / 3)));
    const idx2 = Math.max(idx1 + 1, Math.min(n - 1, Math.floor((2 * n) / 3)));
    const act2Start = shotRanges[idx1].startFrame;
    const act3Start = shotRanges[idx2].startFrame;

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
      if (beat.set.kitId === 'EXTERIOR_URBAN_VISTA' && i === 3) {
        simX[storyBeatContract.cast[0]?.instanceId ?? ''] = -95;
        if (storyBeatContract.cast[1]) {
          simX[storyBeatContract.cast[1].instanceId] = -125;
        }
      }
      beatCharX.push({ ...simX });
      const nextSimX = { ...simX };
      for (const a of beat.actions) {
        const cur = simX[a.instanceId] ?? 0;
        const otherId = beat.presentCharacters.find(id => id !== a.instanceId);
        const otherCur = otherId ? simX[otherId] : undefined;
        if (a.verb === 'walk_to') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          if (tPos !== undefined) nextSimX[a.instanceId] = tPos;
          else if (otherCur !== undefined) {
            if (cur < -60 && otherCur < -60) nextSimX[a.instanceId] = cur <= otherCur ? 35 : 65;
            else nextSimX[a.instanceId] = cur <= otherCur ? -26 : 26;
          } else nextSimX[a.instanceId] = -22;
        } else if (a.verb === 'run_to') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          if (tPos !== undefined) nextSimX[a.instanceId] = tPos;
          else if (otherCur !== undefined) nextSimX[a.instanceId] = cur <= otherCur ? 65 : 35;
          else nextSimX[a.instanceId] = 65;
        } else if (a.verb === 'carry_put_down') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          nextSimX[a.instanceId] = tPos !== undefined ? tPos : -68;
        } else if (a.verb === 'gesture_point') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          if (tPos !== undefined) nextSimX[a.instanceId] = tPos;
          else if (cur < -50) nextSimX[a.instanceId] = -45;
          else nextSimX[a.instanceId] = cur;
        } else if (a.verb === 'embrace_push_away') {
          if (otherCur !== undefined) {
            const isLeft = cur <= otherCur;
            nextSimX[a.instanceId] = isLeft ? -38 : 38;
          }
        }
      }
      simX = nextSimX;
    }

    // 4. Build Storyboard Shots
    const shots: CinematicShot[] = [];
    const leadId = storyBeatContract.cast[0].instanceId;

    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const shotId = beat.beatId;
      const { startFrame, endFrame } = shotRanges[i];

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
      const focalPos = charPositions[focalId] ?? (focalId === 'narrative_partner' ? 35 : -22);
      const otherPresentId = beat.presentCharacters.find((id) => id !== focalId);
      const isTwoShot =
        beat.presentCharacters.length >= 2 &&
        (effectiveFraming === 'WIDE' || effectiveFraming === 'MEDIUM');

      if (isReachGrasp) {
        // beat_02_reach_grasp: CLOSE_UP framing targeting [-10, 88, 0] so head, torso, arm and desk top (Y = 68) are visible
        effectiveFraming = 'CLOSE_UP';
        effectiveDistZ = 135;
        focalX = -10;
        targetY = 88;
        camY = 98;
      } else if (isGesturePoint) {
        // beat_05_gesture_point: CLOSE_UP aiming at rootY + 42 = 117 for natural eye-line and >= 120px top clearance
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
        const isPartnerFocal = focalId === 'narrative_partner';
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

      const isInterior = beat.set.kitId === 'ARCHITECTURAL_INTERIOR';
      const activeRigIds = [
        ...beat.presentCharacters,
        ...(rigs.has('coffee_cup') && isInterior ? ['coffee_cup'] : []),
        ...(beat.set.landmarkProps.includes('umbrella') ? ['umbrella'] : [])
      ].filter((id, idx, arr) => arr.indexOf(id) === idx && rigs.has(id));

      const actNumber: 1 | 2 | 3 = i < idx1 ? 1 : i < idx2 ? 2 : 3;

      shots.push({
        id: shotId,
        shotIndex: i,
        actNumber,
        frameRange: {
          startFrameInclusive: startFrame,
          endFrameExclusive: endFrame
        },
        framing: effectiveFraming,
        movement,
        viewpoint: 'OBJECTIVE_THIRD_PERSON',
        activeRigIds,
        theatricalSetId: beat.set.kitId,
        palette,
        narrativeAction: beat.narrativeSubtext || 'Action',
        cameraStart: {
          position: [focalX - 10, camY, effectiveDistZ],
          target: [focalX, targetY, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 50,
          rollDegrees: dutchAngle,
          projectionMode: 'perspective',
          nearPlane: 1,
          farPlane: 2000
        },
        cameraEnd: {
          position: [focalX - 10 + deltaPan, camY, effectiveDistZ + deltaDolly],
          target: [focalX + deltaPan, targetY, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 50,
          rollDegrees: dutchAngle,
          projectionMode: 'perspective',
          nearPlane: 1,
          farPlane: 2000
        },
        cameraEasing: 'linear',
        transitionIn: i > 0 ? { type: 'CROSS_FADE', durationFrames: 6 } : undefined
      });
    }

    // 4. Compile Choreography Tracks
    const tracks: EntityTrack[] = [];
    const charCurrentX: Record<string, number> = {};
    const charArchetypes: Record<string, string> = {};

    const isMultiCast = storyBeatContract.cast.length > 1;
    for (let cIdx = 0; cIdx < storyBeatContract.cast.length; cIdx++) {
      const c = storyBeatContract.cast[cIdx];
      charCurrentX[c.instanceId] = isMultiCast
        ? (cIdx === 0 ? -92 : 88)
        : -95;
      charArchetypes[c.instanceId] = c.archetypeId;
    }

    let coffeeCupHeld = false;
    let coffeeCupHeldBy: string | null = null;
    let coffeeCupReleased = false;
    let umbrellaHeld = false;
    let umbrellaHeldBy: string | null = null;

    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const shot = shots[i];
      const startF = shot.frameRange.startFrameInclusive;
      const endF = shot.frameRange.endFrameExclusive;

      if (beat.set.kitId === 'EXTERIOR_URBAN_VISTA' && i === 3) {
        charCurrentX[storyBeatContract.cast[0]?.instanceId ?? ''] = -95;
        if (storyBeatContract.cast[1]) {
          charCurrentX[storyBeatContract.cast[1].instanceId] = -125;
        }
      }

      const presentList = storyBeatContract.cast.filter((c) =>
        beat.presentCharacters.includes(c.instanceId)
      );

      const shotStartPositions = { ...charCurrentX };
      const nextPositions: Record<string, number> = {};

      for (let cIdx = 0; cIdx < presentList.length; cIdx++) {
        const char = presentList[cIdx];
        const otherChar = presentList.find((other) => other.instanceId !== char.instanceId);
        const otherX = otherChar ? shotStartPositions[otherChar.instanceId] : undefined;

        const action = beat.actions.find((a) => a.instanceId === char.instanceId) ?? {
          instanceId: char.instanceId,
          verb: 'walk_to' as const,
          speedNorm: 1.0,
          intensityNorm: 0.7
        };

        const charTrack = VerbCompiler.compileCharacterAction(
          char.instanceId,
          shot.id,
          startF,
          endF,
          action,
          shotStartPositions[char.instanceId] ?? 0,
          otherX,
          charArchetypes[char.instanceId],
          audioManifest,
          beat.emotionalTone
        );

        nextPositions[char.instanceId] = charTrack.nextX;
        tracks.push(charTrack.track);
      }

      for (const [id, nX] of Object.entries(nextPositions)) {
        charCurrentX[id] = nX;
      }

      // Handle coffee_cup prop track
      if (shot.activeRigIds.includes('coffee_cup')) {
        const cupAction = beat.actions.find((a) => a.instanceId === leadId) ?? {
          instanceId: leadId,
          verb: 'walk_to' as const,
          speedNorm: 1.0,
          intensityNorm: 0.7
        };
        const cupResult = VerbCompiler.compilePropAction(
          'coffee_cup',
          shot.id,
          startF,
          endF,
          leadId,
          cupAction,
          coffeeCupHeld,
          coffeeCupHeldBy,
          coffeeCupReleased
        );
        coffeeCupHeld = cupResult.propHeld;
        coffeeCupHeldBy = cupResult.propHeldBy;
        coffeeCupReleased = cupResult.propReleased;
        tracks.push(cupResult.track);
      }

      // Handle umbrella prop track
      if (shot.activeRigIds.includes('umbrella')) {
        const carrierId = presentList[presentList.length - 1]?.instanceId ?? leadId;
        const carrierAction = beat.actions.find((a) => a.instanceId === carrierId) ?? {
          instanceId: carrierId,
          verb: 'walk_to' as const,
          speedNorm: 1.0,
          intensityNorm: 0.7
        };
        const umbResult = VerbCompiler.compilePropAction(
          'umbrella',
          shot.id,
          startF,
          endF,
          carrierId,
          carrierAction,
          umbrellaHeld,
          umbrellaHeldBy
        );
        umbrellaHeld = umbResult.propHeld;
        umbrellaHeldBy = umbResult.propHeldBy;
        tracks.push(umbResult.track);
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
      projectId: storyBeatContract.projectId,
      tracks
    };

    return {
      storyboard,
      rigs,
      choreography
    };
  }

  private static compileCharacterAction(
    instanceId: string,
    shotId: string,
    startF: number,
    endF: number,
    action: CharacterActionDirective,
    currentX: number,
    otherCharX?: number,
    archetypeId?: string,
    audioManifest?: AudioAnalysisManifest,
    emotionalTone?: EmotionalTone
  ): { track: EntityTrack; nextX: number } {
    const lastF = endF - 1;
    const keyframes: EntityTrackKeyframe[] = [];
    const morphKeyframes: Record<string, Array<{ frame: number; weight: number }>> = {};
    let nextX = currentX;
    let clipId = 'pop_vocal_sway';
    let arriveF: number | undefined;

    const baseY = archetypeId === 'companion_silhouette' ? 65 : 75;
    const [scaleXBase, scaleYBase] =
      archetypeId === 'companion_silhouette' ? [1.6, 1.15] : [1.35, 1.45];

    switch (action.verb) {
      case 'walk_to': {
        const targetPos = action.target?.kind === 'position' ? action.target.pos[0] : undefined;
        let targetX: number;
        if (targetPos !== undefined) {
          targetX = targetPos;
        } else if (otherCharX !== undefined) {
          if (currentX < -60 && otherCharX < -60) {
            targetX = currentX <= otherCharX ? 35 : 65;
          } else {
            const isLeft = currentX <= otherCharX;
            targetX = isLeft ? -26 : 26;
          }
        } else {
          // Solo walk beside Desk 1
          targetX = -22;
        }
        nextX = targetX;
        const sX = targetX >= currentX ? scaleXBase : -scaleXBase;
        clipId = 'walk_to';

        const totalDist = Math.abs(targetX - currentX);
        const deltaFrames = endF - startF;
        const isExteriorTraverse = shotId.includes('exterior') || (currentX < -60 && targetX > 0);
        arriveF = (!isExteriorTraverse && totalDist > 40 && deltaFrames >= 200)
          ? startF + Math.floor(deltaFrames * (5.5 / 7.0))
          : lastF;

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: arriveF,
            position: [targetX, baseY, 0],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        if (arriveF < lastF) {
          keyframes.push({
            frame: lastF,
            position: [targetX, baseY, 0],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          });
        }

        morphKeyframes.open_rest = [
          { frame: startF, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];
        break;
      }

      case 'run_to': {
        const targetPos = action.target?.kind === 'position' ? action.target.pos[0] : undefined;
        let targetX: number;
        if (targetPos !== undefined) {
          targetX = targetPos;
        } else if (otherCharX !== undefined) {
          targetX = currentX <= otherCharX ? 65 : 35;
        } else {
          targetX = 65;
        }
        nextX = targetX;
        const sX = targetX >= currentX ? scaleXBase : -scaleXBase;
        clipId = 'sprint_frenzy';

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, 0],
            rotationZDegrees: sX > 0 ? 14 : -14,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [targetX, baseY, 0],
            rotationZDegrees: sX > 0 ? 14 : -14,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }

      case 'look_at': {
        const lookX = otherCharX !== undefined ? (currentX <= otherCharX ? -24 : 24) : currentX;
        currentX = lookX;
        nextX = lookX;
        const faceRight = otherCharX !== undefined ? otherCharX >= currentX : true;
        const sX = faceRight ? scaleXBase : -scaleXBase;
        clipId = 'pop_vocal_sway';

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, 0],
            rotationZDegrees: faceRight ? 4 : -4,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }

      case 'reach_and_grasp': {
        const reachX = otherCharX !== undefined ? -24 : currentX;
        currentX = reachX;
        nextX = reachX;
        clipId = 'reach_and_grasp';
        const reachF = startF + Math.floor((endF - startF) * 0.5); // t = 0.50 of beat (~frame 315)

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        morphKeyframes.open_rest = [
          { frame: startF, weight: 1.0 },
          { frame: reachF, weight: 0.0 },
          { frame: lastF, weight: 0.0 }
        ];
        morphKeyframes.grasp_fist = [
          { frame: startF, weight: 0.0 },
          { frame: reachF, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];
        break;
      }

      case 'stop_and_turn': {
        nextX = currentX;
        clipId = 'stop_and_turn';
        // Mid-shot turnaround: hold facing +1 until frame 465, 6-frame snap turn (465-471), face -1 thereafter
        const turnF0 = startF + 45; // mid-shot 1.5s into beat (frames 465-471)

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 1,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase * 0.7, scaleYBase * 0.98],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 2,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase * 0.35, scaleYBase * 0.96],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 3,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [-scaleXBase * 0.35, scaleYBase * 0.96],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 4,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [-scaleXBase * 0.7, scaleYBase * 0.98],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 5,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [-scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, 0],
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
        const destPos = action.target?.kind === 'position' ? action.target.pos[0] : undefined;
        // Desk 2 is centered at -96, standing beside it at -68 (cup target [-90, 68, 0])
        const destX = destPos !== undefined ? destPos : -68;
        nextX = destX;
        clipId = 'carry_put_down';
        const walkEndF = startF + Math.floor((endF - startF) * 0.5); // frame 735 (walking X: -22 -> -68)
        const releaseF = startF + Math.floor((endF - startF) * 0.74); // frame 785 (releases cup onto Desk 2)

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [-scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: walkEndF,
            position: [destX, baseY, 0],
            rotationZDegrees: 0,
            scale: [-scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [destX, baseY, 0],
            rotationZDegrees: 0,
            scale: [-scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        morphKeyframes.grasp_fist = [
          { frame: startF, weight: 1.0 },
          { frame: releaseF, weight: 1.0 },
          { frame: releaseF + 2, weight: 0.0 },
          { frame: lastF, weight: 0.0 }
        ];
        morphKeyframes.open_rest = [
          { frame: startF, weight: 0.0 },
          { frame: releaseF, weight: 0.0 },
          { frame: releaseF + 2, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];
        break;
      }

      case 'sit_stand': {
        nextX = currentX;
        const sitF = startF + Math.floor((endF - startF) * 0.35);
        const standF = startF + Math.floor((endF - startF) * 0.75);

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: sitF,
            position: [currentX, baseY - 20, 0],
            rotationZDegrees: -5,
            scale: [scaleXBase, scaleYBase * 0.85],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: standF,
            position: [currentX, baseY - 20, 0],
            rotationZDegrees: -5,
            scale: [scaleXBase, scaleYBase * 0.85],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }

      case 'gesture_point': {
        const targetPos = action.target?.kind === 'position' ? action.target.pos[0] : undefined;
        let targetX = currentX;
        if (targetPos !== undefined) {
          targetX = targetPos;
        } else if (currentX < -50) {
          // Lead standing near Desk 2 steps to -45 to clear placed desk prop at -80
          targetX = -45;
        }
        nextX = targetX;
        clipId = 'gesture_point';
        keyframes.push(
          {
            frame: startF,
            position: [targetX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [targetX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        morphKeyframes.point = [
          { frame: startF, weight: 0.0 },
          { frame: startF + 15, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];
        break;
      }

      case 'embrace_push_away': {
        clipId = 'embrace_push_away';
        const isLeft = otherCharX !== undefined ? currentX <= otherCharX : true;
        const heroX0 = -24;
        const partnerX0 = 24;
        const startX = isLeft ? heroX0 : partnerX0;
        const contactX = isLeft ? -14 : 14;
        const pushedX = isLeft ? -38 : 38;
        nextX = pushedX;

        const fEmbrace = startF + Math.floor((endF - startF) * (3.0 / 7.0)); // frame 510 (00:17.0)
        const fThrust = startF + Math.floor((endF - startF) * (3.5 / 7.0));  // frame 525 (00:17.5)
        const sX = isLeft ? scaleXBase : -scaleXBase;

        keyframes.push(
          {
            frame: startF,
            position: [startX, baseY, 0],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: fEmbrace,
            position: [contactX, baseY, 0],
            rotationZDegrees: isLeft ? 8 : -8,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: fThrust,
            position: [contactX + (isLeft ? -2 : 2), baseY, 0],
            rotationZDegrees: isLeft ? 12 : -12,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [pushedX, baseY, 0],
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
        const dropF = startF + Math.floor((endF - startF) * 0.3);
        const riseF = startF + Math.floor((endF - startF) * 0.7);

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: dropF,
            position: [currentX, baseY - 35, 0],
            rotationZDegrees: -25,
            scale: [scaleXBase, scaleYBase * 0.7],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: riseF,
            position: [currentX, baseY - 35, 0],
            rotationZDegrees: -25,
            scale: [scaleXBase, scaleYBase * 0.7],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, 0],
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
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [scaleXBase, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, baseY, 0],
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
    for (let f = startF + 20; f < endF; f += 50) {
      blinks.push(
        { frame: f, weight: 0 },
        { frame: f + 2, weight: 1 },
        { frame: f + 4, weight: 0 }
      );
    }
    morphKeyframes.blink = blinks;

    // Calculate stride-locked timeScale for locomotion to prevent foot slippage
    let calculatedTimeScale = action.speedNorm ?? 1.0;
    if (clipId === 'walk_to' || clipId === 'sprint_frenzy' || clipId === 'carry_put_down') {
      const strideUnits = clipId === 'sprint_frenzy' ? 23.0 : 15.0;
      const loopFrames = clipId === 'sprint_frenzy' ? 18 : 36;
      const nominalSpeed = (strideUnits * Math.abs(scaleXBase)) / loopFrames;
      const walkDeltaFrames = (arriveF && arriveF > startF) ? arriveF - startF : (endF - startF);
      const walkDist = Math.abs(nextX - currentX);
      if (walkDist > 1e-3 && walkDeltaFrames > 0 && nominalSpeed > 1e-3) {
        const actualSpeed = walkDist / walkDeltaFrames;
        calculatedTimeScale = actualSpeed / nominalSpeed;
      }
    }

    return {
      track: {
        rigId: instanceId,
        shotId,
        transform: { keyframes },
        pose: { timeScale: calculatedTimeScale, startPoseFrame: 0, clipId },
        morphKeyframes,
        morphBindings: [],
        attachmentSpans: []
      },
      nextX
    };
  }

  private static compilePropAction(
    propRigId: string,
    shotId: string,
    startF: number,
    endF: number,
    ownerId: string,
    action: CharacterActionDirective,
    currentlyHeld: boolean,
    currentlyHeldBy: string | null,
    currentlyReleased = false
  ): { track: EntityTrack; propHeld: boolean; propHeldBy: string | null; propReleased: boolean } {
    const lastF = endF - 1;
    const keyframes: EntityTrackKeyframe[] = [];
    const attachmentSpans: PropAttachmentSpan[] = [];
    let nextHeld = currentlyHeld;
    let nextHeldBy = currentlyHeldBy;
    let nextReleased = currentlyReleased;

    if (propRigId === 'umbrella') {
      nextHeld = true;
      nextHeldBy = ownerId;
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
        ownerRigId: ownerId,
        socketId: 'hand_r'
      });
      return {
        track: {
          rigId: propRigId,
          shotId,
          transform: { keyframes },
          morphKeyframes: {},
          morphBindings: [],
          attachmentSpans
        },
        propHeld: nextHeld,
        propHeldBy: nextHeldBy,
        propReleased: nextReleased
      };
    }

    if (action.verb === 'embrace_push_away') {
      nextHeld = false;
      nextHeldBy = null;
      nextReleased = false;
      keyframes.push(
        {
          frame: startF,
          position: [0, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [0, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        }
      );
      return {
        track: {
          rigId: propRigId,
          shotId,
          transform: { keyframes },
          morphKeyframes: {},
          morphBindings: [],
          attachmentSpans: []
        },
        propHeld: false,
        propHeldBy: null,
        propReleased: false
      };
    }

    if (action.verb === 'reach_and_grasp') {
      const graspFrame = startF + Math.floor((endF - startF) * 0.5); // t = 0.50 of beat (~frame 315)
      nextHeld = true;
      nextHeldBy = ownerId;

      keyframes.push(
        {
          frame: startF,
          position: [0, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: graspFrame,
          position: [0, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [0, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        }
      );

      attachmentSpans.push({
        startFrame: graspFrame,
        endFrame: endF,
        ownerRigId: ownerId,
        socketId: 'hand_r'
      });
    } else if (action.verb === 'carry_put_down') {
      const releaseFrame = startF + Math.floor((endF - startF) * 0.74); // frame 785 (releases cup onto Desk 2)
      nextHeld = false;
      nextHeldBy = null;
      nextReleased = true;

      keyframes.push(
        {
          frame: startF,
          position: [0, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: releaseFrame,
          position: [-90, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [-90, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        }
      );

      attachmentSpans.push({
        startFrame: startF,
        endFrame: releaseFrame,
        ownerRigId: ownerId,
        socketId: 'hand_r'
      });
    } else if (currentlyHeld) {
      keyframes.push(
        {
          frame: startF,
          position: [0, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [0, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        }
      );

      attachmentSpans.push({
        startFrame: startF,
        endFrame: endF,
        ownerRigId: currentlyHeldBy ?? ownerId,
        socketId: 'hand_r'
      });
    } else {
      // Resting on desk
      const restPos: [number, number, number] = currentlyReleased ? [-90, 68, 0] : [0, 68, 0];
      keyframes.push(
        {
          frame: startF,
          position: restPos,
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: restPos,
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
      propHeld: nextHeld,
      propHeldBy: nextHeldBy,
      propReleased: nextReleased
    };
  }
}
