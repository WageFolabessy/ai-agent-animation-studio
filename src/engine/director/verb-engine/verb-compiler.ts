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
import { ArchetypeFactory } from '../../library/archetype-factory.js';
import { PropFactory } from '../../library/prop-factory.js';
import { THEME_PALETTES } from '../../library/environment-kit.js';

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
    _audioManifest: AudioAnalysisManifest
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
    const coffeeCupRig = PropFactory.buildStandalonePropRig('coffee_cup', 'coffee_cup', [25, 35, 0]);
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

    // 3. Build Storyboard Shots
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

      // Camera focal point and look-room math
      const lookOffset = beat.camera.lookRoom === 'left' ? -18 : beat.camera.lookRoom === 'right' ? 18 : 0;
      const focalX = 0 + lookOffset;
      const targetY = framing === 'EXTREME_CLOSE_UP' ? 45 : 95;
      const camY = framing === 'EXTREME_CLOSE_UP' ? 55 : 105;

      const deltaPan = movement === 'PAN' ? 30 : 0;
      const deltaDolly = movement === 'DOLLY' ? -35 : 0;

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
        framing,
        movement,
        viewpoint: 'OBJECTIVE_THIRD_PERSON',
        activeRigIds,
        theatricalSetId: beat.set.kitId,
        palette,
        narrativeAction: beat.narrativeSubtext || 'Action',
        cameraStart: {
          position: [focalX - 10, camY, distZ],
          target: [focalX, targetY, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 50,
          rollDegrees: beat.camera.dutchAngleDeg ?? 0,
          projectionMode: 'perspective',
          nearPlane: 1,
          farPlane: 2000
        },
        cameraEnd: {
          position: [focalX - 10 + deltaPan, camY, distZ + deltaDolly],
          target: [focalX + deltaPan, targetY, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 50,
          rollDegrees: beat.camera.dutchAngleDeg ?? 0,
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
      charCurrentX[c.instanceId] = cIdx === 0 ? -45 : 35;
      charArchetypes[c.instanceId] = c.archetypeId;
    }

    let coffeeCupHeld = false;
    let coffeeCupHeldBy: string | null = null;
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
          charArchetypes[char.instanceId]
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
          coffeeCupHeldBy
        );
        coffeeCupHeld = cupResult.propHeld;
        coffeeCupHeldBy = cupResult.propHeldBy;
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
    archetypeId?: string
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
          targetX = 15;
        }
        nextX = targetX;
        const sX = targetX >= currentX ? scaleXBase : -scaleXBase;
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
            position: [targetX, baseY, 0],
            rotationZDegrees: 0,
            scale: [sX, scaleYBase],
            opacity: 1,
            easing: 'linear'
          }
        );
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
        clipId = 'pop_vocal_sway';
        const reachF = startF + Math.floor((endF - startF) * 0.4);

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

        morphKeyframes.grasp_fist = [
          { frame: startF, weight: 0 },
          { frame: reachF, weight: 1.0 },
          { frame: lastF, weight: 1.0 }
        ];
        break;
      }

      case 'stop_and_turn': {
        nextX = currentX;
        const turnF0 = startF + 4;

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
        break;
      }

      case 'carry_put_down': {
        const destPos = action.target?.kind === 'position' ? action.target.pos[0] : undefined;
        const destX = destPos !== undefined ? destPos : -35;
        nextX = destX;
        const releaseF = startF + Math.floor((endF - startF) * 0.7);

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
            frame: releaseF,
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
          { frame: releaseF + 5, weight: 0.0 },
          { frame: lastF, weight: 0.0 }
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
        nextX = currentX;
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

        morphKeyframes.point = [
          { frame: startF, weight: 0.0 },
          { frame: startF + 10, weight: 1.0 },
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
    currentlyHeldBy: string | null
  ): { track: EntityTrack; propHeld: boolean; propHeldBy: string | null } {
    const lastF = endF - 1;
    const keyframes: EntityTrackKeyframe[] = [];
    const attachmentSpans: PropAttachmentSpan[] = [];
    let nextHeld = currentlyHeld;
    let nextHeldBy = currentlyHeldBy;

    if (action.verb === 'reach_and_grasp') {
      const graspFrame = startF + Math.floor((endF - startF) * 0.4);
      nextHeld = true;
      nextHeldBy = ownerId;

      keyframes.push(
        {
          frame: startF,
          position: [25, 35, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: graspFrame,
          position: [25, 35, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [25, 35, 0],
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
      const releaseFrame = startF + Math.floor((endF - startF) * 0.7);
      nextHeld = false;
      nextHeldBy = null;

      keyframes.push(
        {
          frame: startF,
          position: [25, 35, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: releaseFrame,
          position: [-30, 35, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [-30, 35, 0],
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
          position: [0, 35, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [0, 35, 0],
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
      keyframes.push(
        {
          frame: startF,
          position: [25, 35, 0],
          rotationZDegrees: 0,
          scale: [1, 1],
          opacity: 1,
          easing: 'linear'
        },
        {
          frame: lastF,
          position: [25, 35, 0],
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
      propHeldBy: nextHeldBy
    };
  }
}
