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

    // Always include coffee_cup prop
    const propRig = PropFactory.buildStandalonePropRig('coffee_cup', 'coffee_cup', [25, 35, 0]);
    rigs.set(propRig.id, propRig);

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
        'coffee_cup'
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
    let leadCurrentX = -50;
    let propHeld = false;
    let propHeldBy: string | null = null;

    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const shot = shots[i];
      const startF = shot.frameRange.startFrameInclusive;
      const endF = shot.frameRange.endFrameExclusive;

      const action = beat.actions.find((a) => a.instanceId === leadId) ?? {
        instanceId: leadId,
        verb: 'walk_to' as const,
        speedNorm: 1.0,
        intensityNorm: 0.7
      };

      const characterTracks = VerbCompiler.compileCharacterAction(
        leadId,
        shot.id,
        startF,
        endF,
        action,
        leadCurrentX
      );

      leadCurrentX = characterTracks.nextX;
      tracks.push(characterTracks.track);

      // Handle prop state & track
      const propTrackResult = VerbCompiler.compilePropAction(
        'coffee_cup',
        shot.id,
        startF,
        endF,
        leadId,
        action,
        propHeld,
        propHeldBy
      );

      propHeld = propTrackResult.propHeld;
      propHeldBy = propTrackResult.propHeldBy;
      tracks.push(propTrackResult.track);
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
    currentX: number
  ): { track: EntityTrack; nextX: number } {
    const lastF = endF - 1;
    const keyframes: EntityTrackKeyframe[] = [];
    const morphKeyframes: Record<string, Array<{ frame: number; weight: number }>> = {};
    let nextX = currentX;
    let clipId = 'pop_vocal_sway';

    switch (action.verb) {
      case 'walk_to': {
        const targetX = 15; // Walk toward desk at X = 25
        nextX = targetX;
        const sX = targetX >= currentX ? 1.35 : -1.35;
        clipId = 'pop_vocal_sway';

        keyframes.push(
          {
            frame: startF,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [sX, 1.45],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [targetX, 75, 0],
            rotationZDegrees: 0,
            scale: [sX, 1.45],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }

      case 'reach_and_grasp': {
        nextX = 15;
        clipId = 'pop_vocal_sway';
        const reachF = startF + Math.floor((endF - startF) * 0.4);

        keyframes.push(
          {
            frame: startF,
            position: [15, 75, 0],
            rotationZDegrees: 0,
            scale: [1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [15, 75, 0],
            rotationZDegrees: 0,
            scale: [1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          }
        );

        // Hand morphs to grasp fist
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
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 1,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [0.95, 1.42],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 2,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [0.45, 1.40],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 3,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [-0.45, 1.40],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 4,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [-0.95, 1.42],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: turnF0 + 5,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [-1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [-1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          }
        );
        break;
      }

      case 'carry_put_down': {
        const destX = -35;
        nextX = destX;
        const releaseF = startF + Math.floor((endF - startF) * 0.7);

        keyframes.push(
          {
            frame: startF,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [-1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: releaseF,
            position: [destX, 75, 0],
            rotationZDegrees: 0,
            scale: [-1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [destX, 75, 0],
            rotationZDegrees: 0,
            scale: [-1.35, 1.45],
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

      case 'gesture_point': {
        nextX = currentX;
        keyframes.push(
          {
            frame: startF,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [1.35, 1.45],
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

      default: {
        keyframes.push(
          {
            frame: startF,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [1.35, 1.45],
            opacity: 1,
            easing: 'linear'
          },
          {
            frame: lastF,
            position: [currentX, 75, 0],
            rotationZDegrees: 0,
            scale: [1.35, 1.45],
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
