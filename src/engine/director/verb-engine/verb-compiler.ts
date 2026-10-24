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
    for (let cIdx = 0; cIdx < storyBeatContract.cast.length; cIdx++) {
      const c = storyBeatContract.cast[cIdx];
      simX[c.instanceId] = cIdx === 0 ? -55 : 35;
    }
    for (let i = 0; i < beats.length; i++) {
      beatCharX.push({ ...simX });
      const beat = beats[i];
      const nextSimX = { ...simX };
      for (const a of beat.actions) {
        const cur = simX[a.instanceId] ?? 0;
        const otherId = beat.presentCharacters.find(id => id !== a.instanceId);
        const otherCur = otherId ? simX[otherId] : undefined;
        if (a.verb === 'walk_to') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          if (tPos !== undefined) nextSimX[a.instanceId] = tPos;
          else if (otherCur !== undefined) nextSimX[a.instanceId] = cur <= otherCur ? (cur + otherCur) / 2 - 25 : (cur + otherCur) / 2 + 25;
          else nextSimX[a.instanceId] = -22;
        } else if (a.verb === 'run_to') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          if (tPos !== undefined) nextSimX[a.instanceId] = tPos;
          else if (otherCur !== undefined) nextSimX[a.instanceId] = cur <= otherCur ? (cur + otherCur) / 2 - 20 : (cur + otherCur) / 2 + 20;
          else nextSimX[a.instanceId] = 35;
        } else if (a.verb === 'carry_put_down') {
          const tPos = a.target?.kind === 'position' ? a.target.pos[0] : undefined;
          nextSimX[a.instanceId] = tPos !== undefined ? tPos : -58;
        } else if (a.verb === 'gesture_point') {
          nextSimX[a.instanceId] = cur < -50 ? -45 : cur;
        } else if (a.verb === 'embrace_push_away') {
          if (otherCur !== undefined) {
            const mid = (cur + otherCur) / 2;
            nextSimX[a.instanceId] = cur <= otherCur ? mid - 30 : mid + 30;
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
        focalX = -45;
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

      const activeRigIds = [
        ...beat.presentCharacters,
        ...(rigs.has('coffee_cup') ? ['coffee_cup'] : []),
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

    for (let cIdx = 0; cIdx < storyBeatContract.cast.length; cIdx++) {
      const c = storyBeatContract.cast[cIdx];
      charCurrentX[c.instanceId] = cIdx === 0 ? -55 : 35;
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
          const midX = (currentX + otherCharX) / 2;
          const isLeft = currentX <= otherCharX;
          targetX = isLeft ? midX - 15 : midX + 15;
        } else {
          // Solo walk beside Desk 1
          targetX = -22;
        }
        nextX = targetX;
        const sX = targetX >= currentX ? scaleXBase : -scaleXBase;
        clipId = 'walk_to';

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
            position: [targetX, baseY, 0],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

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
          const midX = (currentX + otherCharX) / 2;
          const isLeft = currentX <= otherCharX;
          targetX = isLeft ? midX - 20 : midX + 20;
        } else {
          targetX = 35;
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
        nextX = currentX;
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
        nextX = currentX;
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
        // Desk 2 is at -86, standing beside it at -58
        const destX = destPos !== undefined ? destPos : -58;
        nextX = destX;
        clipId = 'carry_put_down';
        const walkEndF = startF + Math.floor((endF - startF) * 0.5); // frame 735 (walking X: -22 -> -58)
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
        clipId = 'pop_vocal_sway';
        // Interpersonal clearance guarantee:
        // Midpoint between the two interacting characters
        const midX = otherCharX !== undefined ? (currentX + otherCharX) / 2 : currentX;
        const isLeft = otherCharX !== undefined ? currentX <= otherCharX : true;
        // Closest approach: 5 units on each side of midX (total 10.0 >= MIN_INTERPERSONAL_CLEARANCE 8.0)
        const contactX = isLeft ? midX - 5.0 : midX + 5.0;
        // Separation after push away: 30 units on each side (total 60.0 units clearance)
        const pushedX = isLeft ? midX - 30.0 : midX + 30.0;
        nextX = pushedX;

        const f1 = startF + Math.floor((endF - startF) * 0.35); // Contact / embrace
        const f2 = startF + Math.floor((endF - startF) * 0.65); // Hold embrace, start push
        const sXApproach = isLeft ? scaleXBase : -scaleXBase;
        const sXRecoil = isLeft ? -scaleXBase : scaleXBase;

        keyframes.push(
          {
            frame: startF,
            position: [currentX, baseY, 0],
            rotationZDegrees: 0,
            scale: [sXApproach, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: f1,
            position: [contactX, baseY, 0],
            rotationZDegrees: isLeft ? 4 : -4,
            scale: [sXApproach, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: f2,
            position: [contactX, baseY, 0],
            rotationZDegrees: isLeft ? 4 : -4,
            scale: [sXApproach, scaleYBase],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [pushedX, baseY, 0],
            rotationZDegrees: isLeft ? -8 : 8,
            scale: [sXRecoil, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );

        morphKeyframes.point = [
          { frame: startF, weight: 0.0 },
          { frame: f1, weight: 0.7 },
          { frame: f2, weight: 0.7 },
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

    return {
      track: {
        rigId: instanceId,
        shotId,
        transform: { keyframes },
        pose: { timeScale: action.speedNorm ?? 1.0, startPoseFrame: 0, clipId },
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
          position: [-80, 68, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [-80, 68, 0],
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
      const restPos: [number, number, number] = currentlyReleased ? [-80, 68, 0] : [0, 68, 0];
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
