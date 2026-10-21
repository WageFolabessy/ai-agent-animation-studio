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
  EnvironmentZoneType
} from '../../schemas/storyboard.contract.js';
import type { StorySpecContract } from '../../schemas/story-spec.contract.js';
import { THEME_PALETTES } from '../library/environment-kit.js';

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

      // Vary camera framing: alternating wide -> medium -> close-up
      const framings: CameraFraming[] = ['WIDE', 'MEDIUM', 'CLOSE_UP'];
      const framing = framings[shotIndex % framings.length];
      const movement: CameraMovement = framing === 'WIDE' ? 'TRACKING' : framing === 'MEDIUM' ? 'DOLLY' : 'STATIC';

      const palette = THEME_PALETTES[secSpec.colorThemeId] ?? THEME_PALETTES.CYBERPUNK_CYAN;

      const zoneMap: Record<string, EnvironmentZoneType> = {
        industrial_city: 'ROOFTOP',
        orbital_station: 'REACTOR',
        neon_chasm: 'BRIDGE',
        synth_grid: 'HIGHWAY'
      };
      const environmentZone = zoneMap[secSpec.environmentKitId] ?? 'ROOFTOP';

      const cameraZ = framing === 'CLOSE_UP' ? -65 : framing === 'MEDIUM' ? -75 : -85;
      const cameraFov = framing === 'CLOSE_UP' ? 36 : framing === 'MEDIUM' ? 45 : 55;

      const shot: CinematicShot = {
        id: `shot_${shotIndex.toString().padStart(2, '0')}`,
        shotIndex,
        actNumber,
        frameRange: { startFrameInclusive: fStart, endFrameExclusive: fEnd },
        framing,
        movement,
        viewpoint: 'OBJECTIVE_THIRD_PERSON',
        cameraStart: {
          position: [fStart * 0.5, 75, cameraZ],
          target: [fStart * 0.5 + 40, 75, 0],
          up: [0, 1, 0],
          nearPlane: 0.1,
          farPlane: 2000,
          rollDegrees: 0,
          verticalFovDegrees: cameraFov,
          projectionMode: 'perspective'
        },
        cameraEnd: {
          position: [movement === 'STATIC' ? fStart * 0.5 : fEnd * 0.5, 75, cameraZ],
          target: [movement === 'STATIC' ? fStart * 0.5 + 40 : fEnd * 0.5 + 40, 75, 0],
          up: [0, 1, 0],
          nearPlane: 0.1,
          farPlane: 2000,
          rollDegrees: 0,
          verticalFovDegrees: cameraFov,
          projectionMode: 'perspective'
        },
        cameraEasing: 'easeInOutCubic',
        palette,
        narrativeAction: `${secSpec.narrativeIntent} (${framing})`,
        activeRigIds: castRigIds,
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
