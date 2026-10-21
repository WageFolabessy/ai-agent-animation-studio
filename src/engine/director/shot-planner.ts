import type {
  BeatGrid,
  AudioAnalysisManifest
} from '../../schemas/audio.contract.js';
import type {
  CinematicShot,
  DirectorStoryboardContract,
  StoryboardAct,
  CameraFraming,
  CameraMovement,
  CameraViewpoint,
  CameraEasing,
  EnvironmentZoneType
} from '../../schemas/storyboard.contract.js';
import type { Vec3 } from '../../schemas/primitives.schema.js';
import type { StorySpecContract } from '../../schemas/story-spec.contract.js';
import { THEME_PALETTES } from '../library/environment-kit.js';

export interface CinematicAngleFormula {
  readonly name: string;
  readonly framing: CameraFraming;
  readonly movement: CameraMovement;
  readonly viewpoint: CameraViewpoint;
  readonly fov: number;
  readonly rollDegrees: number;
  readonly camOffsetStart: Vec3;
  readonly camOffsetEnd: Vec3;
  readonly targetOffsetStart: Vec3;
  readonly targetOffsetEnd: Vec3;
  readonly easing: CameraEasing;
}

export const CINEMATIC_ANGLES: readonly CinematicAngleFormula[] = [
  {
    name: 'ESTABLISHING_PANORAMA',
    framing: 'EXTREME_WIDE',
    movement: 'CRANE',
    viewpoint: 'HIGH_ANGLE',
    fov: 60,
    rollDegrees: 0,
    camOffsetStart: [60, 160, 750],
    camOffsetEnd: [60, 100, 650],
    targetOffsetStart: [60, 50, 0],
    targetOffsetEnd: [60, 50, 0],
    easing: 'easeInOutCubic'
  },
  {
    name: 'LOW_ANGLE_HERO',
    framing: 'MEDIUM',
    movement: 'TRACKING',
    viewpoint: 'LOW_ANGLE',
    fov: 48,
    rollDegrees: 0,
    camOffsetStart: [25, -20, 240],
    camOffsetEnd: [25, -20, 240],
    targetOffsetStart: [25, 50, 0],
    targetOffsetEnd: [25, 50, 0],
    easing: 'linear'
  },
  {
    name: 'PURSUIT_OVER_SHOULDER',
    framing: 'WIDE',
    movement: 'DOLLY',
    viewpoint: 'OVER_THE_SHOULDER',
    fov: 52,
    rollDegrees: 3,
    camOffsetStart: [-110, 140, 340],
    camOffsetEnd: [-70, 110, 300],
    targetOffsetStart: [30, 75, 0],
    targetOffsetEnd: [30, 75, 0],
    easing: 'easeInOutSine'
  },
  {
    name: 'ORBIT_CLIMAX',
    framing: 'WIDE',
    movement: 'ORBIT',
    viewpoint: 'OBJECTIVE_THIRD_PERSON',
    fov: 50,
    rollDegrees: 0,
    camOffsetStart: [83, 120, 309],
    camOffsetEnd: [309, 120, 83],
    targetOffsetStart: [0, 50, 0],
    targetOffsetEnd: [0, 50, 0],
    easing: 'easeInOutCubic'
  },
  {
    name: 'FACE_SCREAM_CLOSEUP',
    framing: 'CLOSE_UP',
    movement: 'TRACKING',
    viewpoint: 'OBJECTIVE_THIRD_PERSON',
    fov: 34,
    rollDegrees: -6,
    camOffsetStart: [12, 52, 155],
    camOffsetEnd: [12, 52, 155],
    targetOffsetStart: [12, 52, 0],
    targetOffsetEnd: [12, 52, 0],
    easing: 'linear'
  },
  {
    name: 'DYNAMIC_PROFILE_SPRINT',
    framing: 'MEDIUM',
    movement: 'DOLLY',
    viewpoint: 'OBJECTIVE_THIRD_PERSON',
    fov: 45,
    rollDegrees: 0,
    camOffsetStart: [15, 30, 310],
    camOffsetEnd: [35, 30, 260],
    targetOffsetStart: [25, 30, 0],
    targetOffsetEnd: [25, 30, 0],
    easing: 'easeInOutSine'
  }
];

export interface SnappedBoundariesResult {
  readonly snappedFrames: readonly number[];
  readonly diagnostics: readonly string[];
}

/**
 * Snaps candidate cut frame indices to the nearest musical beat on the beat grid.
 * If |b* - f_cut| <= round(toleranceFraction * framesPerBeat), snaps to b*.
 * Otherwise, preserves f_cut and emits diagnostic 'CUT_OFF_BEAT'.
 */
export function snapShotBoundariesToBeats(
  rawFrames: readonly number[],
  beatGrid?: BeatGrid,
  toleranceFraction = 0.2
): SnappedBoundariesResult {
  if (!beatGrid || beatGrid.beatFrameIndices.length === 0) {
    return {
      snappedFrames: [...rawFrames],
      diagnostics: []
    };
  }

  const { beatFrameIndices, framesPerBeat } = beatGrid;
  const tolerance = Math.max(1, Math.round(toleranceFraction * framesPerBeat));
  const diagnostics: string[] = [];
  const snappedFrames: number[] = [];

  for (const f of rawFrames) {
    if (f === 0) {
      snappedFrames.push(0);
      continue;
    }

    // Binary / linear search for closest beat
    let closestBeat = beatFrameIndices[0];
    let minDiff = Math.abs(closestBeat - f);

    for (let i = 1; i < beatFrameIndices.length; i++) {
      const b = beatFrameIndices[i];
      const diff = Math.abs(b - f);
      if (diff < minDiff) {
        minDiff = diff;
        closestBeat = b;
      } else if (b > f && diff > minDiff) {
        break; // Passed the local minimum
      }
    }

    if (minDiff <= tolerance) {
      snappedFrames.push(closestBeat);
    } else {
      snappedFrames.push(f);
      diagnostics.push(`[CUT_OFF_BEAT] Frame ${f} is ${minDiff} frames away from nearest beat ${closestBeat} (tolerance: ${tolerance})`);
    }
  }

  return { snappedFrames, diagnostics };
}

/**
 * Compiles a declarative StorySpecContract + AudioAnalysisManifest into a fully resolved,
 * invariant-compliant DirectorStoryboardContract with beat-snapped cuts and energy-expanded shots.
 */
export function compileStorySpecToStoryboard(
  spec: StorySpecContract,
  manifest: AudioAnalysisManifest
): DirectorStoryboardContract {
  const { totalFrames, fps } = manifest.metadata;
  const castRigIds = spec.cast.map((c) => c.instanceId);

  // 1. Compute 3 Acts contiguous boundaries
  const act1Boundary = Math.round(totalFrames * 0.25);
  const act2Boundary = Math.round(totalFrames * 0.75);

  const acts: [StoryboardAct, StoryboardAct, StoryboardAct] = [
    {
      actNumber: 1,
      title: 'Act I: Exposition & World Staging',
      narrativeArc: `${spec.title} - Exposition in ${spec.overallMood}`,
      frameRange: { startFrameInclusive: 0, endFrameExclusive: act1Boundary }
    },
    {
      actNumber: 2,
      title: 'Act II: Dynamic Pursuit & Conflict',
      narrativeArc: 'Escalation of kinetic tempo and environment transitions',
      frameRange: { startFrameInclusive: act1Boundary, endFrameExclusive: act2Boundary }
    },
    {
      actNumber: 3,
      title: 'Act III: Climax & Resolution',
      narrativeArc: 'Virtuosic resolution and final thematic coda',
      frameRange: { startFrameInclusive: act2Boundary, endFrameExclusive: totalFrames }
    }
  ];

  // 2. Map sections to frame spans
  const sectionCount = spec.sections.length;
  const sectionDuration = totalFrames / sectionCount;
  const shots: CinematicShot[] = [];

  let currentFrame = 0;
  let shotIndex = 0;

  for (let sIdx = 0; sIdx < sectionCount; sIdx++) {
    const secSpec = spec.sections[sIdx];
    const sectionStart = Math.round(sIdx * sectionDuration);
    const sectionEnd = sIdx === sectionCount - 1 ? totalFrames : Math.round((sIdx + 1) * sectionDuration);
    const sectionFrames = sectionEnd - sectionStart;

    // Energy-dependent shot duration: lerp(12s, 3.5s, cameraIntensity)
    const energy = Math.max(0, Math.min(1, secSpec.cameraIntensity));
    const targetShotSec = 12.0 - energy * (12.0 - 3.5);
    const targetShotFrames = Math.max(Math.round(fps * 2.5), Math.round(targetShotSec * fps));
    const shotsInSection = Math.max(1, Math.round(sectionFrames / targetShotFrames));

    const rawCutInterval = sectionFrames / shotsInSection;
    const rawCuts: number[] = [];
    for (let c = 1; c < shotsInSection; c++) {
      rawCuts.push(Math.round(sectionStart + c * rawCutInterval));
    }

    const { snappedFrames } = snapShotBoundariesToBeats(rawCuts, manifest.beatGrid);
    const cutPoints = [sectionStart, ...snappedFrames, sectionEnd];

    // Build shots for this section
    for (let i = 0; i < cutPoints.length - 1; i++) {
      const fStart = i === 0 && sIdx === 0 ? 0 : currentFrame;
      const fEnd = cutPoints[i + 1];
      if (fEnd <= fStart) continue;

      // Determine Act Number
      const midFrame = (fStart + fEnd) / 2;
      const actNumber: 1 | 2 | 3 = midFrame < act1Boundary ? 1 : midFrame < act2Boundary ? 2 : 3;

      // 6-Angle cinematic state machine
      const angle = CINEMATIC_ANGLES[shotIndex % CINEMATIC_ANGLES.length];
      const framing = angle.framing;
      const movement = angle.movement;
      const viewpoint = angle.viewpoint;
      const cameraFov = angle.fov;

      // Character horizontal progress: 0.45 units per frame, root baseline Y = 75, Z = 0
      const charStartX = fStart * 0.45;
      const charEndX = fEnd * 0.45;
      const charBaseY = 75;

      const camStartPos: Vec3 = [
        Number((charStartX + angle.camOffsetStart[0]).toFixed(2)),
        Number((charBaseY + angle.camOffsetStart[1]).toFixed(2)),
        Number(angle.camOffsetStart[2].toFixed(2))
      ];
      const camStartTarget: Vec3 = [
        Number((charStartX + angle.targetOffsetStart[0]).toFixed(2)),
        Number((charBaseY + angle.targetOffsetStart[1]).toFixed(2)),
        Number(angle.targetOffsetStart[2].toFixed(2))
      ];

      const camEndPos: Vec3 = [
        Number((charEndX + angle.camOffsetEnd[0]).toFixed(2)),
        Number((charBaseY + angle.camOffsetEnd[1]).toFixed(2)),
        Number(angle.camOffsetEnd[2].toFixed(2))
      ];
      const camEndTarget: Vec3 = [
        Number((charEndX + angle.targetOffsetEnd[0]).toFixed(2)),
        Number((charBaseY + angle.targetOffsetEnd[1]).toFixed(2)),
        Number(angle.targetOffsetEnd[2].toFixed(2))
      ];

      // Exclude foreground parallax rigs on CLOSE_UP shots (Gap 2)
      const activeRigIds = framing === 'CLOSE_UP'
        ? castRigIds.filter((id) => !id.includes('foreground') && !id.includes('fg_'))
        : castRigIds;

      const palette = THEME_PALETTES[secSpec.colorThemeId] ?? THEME_PALETTES.CYBERPUNK_CYAN;

      const zoneMap: Record<string, EnvironmentZoneType> = {
        industrial_city: 'ROOFTOP',
        orbital_station: 'REACTOR',
        neon_chasm: 'BRIDGE',
        synth_grid: 'HIGHWAY'
      };
      const environmentZone = zoneMap[secSpec.environmentKitId] ?? 'ROOFTOP';

      const shot: CinematicShot = {
        id: `shot_${shotIndex.toString().padStart(2, '0')}`,
        shotIndex,
        actNumber,
        frameRange: { startFrameInclusive: fStart, endFrameExclusive: fEnd },
        framing,
        movement,
        viewpoint,
        cameraStart: {
          position: camStartPos,
          target: camStartTarget,
          up: [0, 1, 0],
          nearPlane: 0.1,
          farPlane: 2000,
          rollDegrees: angle.rollDegrees,
          verticalFovDegrees: cameraFov,
          projectionMode: 'perspective'
        },
        cameraEnd: {
          position: camEndPos,
          target: camEndTarget,
          up: [0, 1, 0],
          nearPlane: 0.1,
          farPlane: 2000,
          rollDegrees: angle.rollDegrees,
          verticalFovDegrees: cameraFov,
          projectionMode: 'perspective'
        },
        cameraEasing: angle.easing,
        palette,
        narrativeAction: `${secSpec.narrativeIntent} (${angle.name})`,
        activeRigIds: activeRigIds.length > 0 ? activeRigIds : castRigIds,
        environmentZone
      };

      shots.push(shot);
      currentFrame = fEnd;
      shotIndex++;
    }
  }

  // Final sanity check: Contiguity enforcement
  if (shots.length > 0 && shots[shots.length - 1].frameRange.endFrameExclusive !== totalFrames) {
    (shots[shots.length - 1].frameRange as { endFrameExclusive: number }).endFrameExclusive = totalFrames;
  }

  return {
    projectId: spec.projectId,
    resolution: { width: 1920, height: 1080 },
    fps: fps === 60 ? 60 : 30,
    totalFrames,
    acts,
    shots
  };
}
