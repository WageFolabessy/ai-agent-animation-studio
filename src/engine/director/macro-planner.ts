import type {
  DirectorStoryboardContract,
  StoryboardAct,
  CinematicShot,
  CameraFraming,
  CameraMovement,
  CameraViewpoint,
  CameraEasing,
  ColorLightingPalette,
  EnvironmentZoneType
} from '../../schemas/storyboard.contract.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../../schemas/audio.contract.js';
import { CANONICAL_RIG_IDS } from '../../agents/director-agent.js';
import {
  AcousticTimelineSegmenter,
  THEMATIC_PALETTES,
  type AcousticPersonalityType
} from './acoustic-segmenter.js';

export { THEMATIC_PALETTES };

export type MusicalSectionType =
  | 'INTRO'
  | 'VERSE_1'
  | 'CHORUS_1'
  | 'VERSE_2'
  | 'GUITAR_SOLO'
  | 'CHORUS_2'
  | 'OUTRO'
  | AcousticPersonalityType
  | string;

export interface MusicalSectionDescriptor {
  sectionType: MusicalSectionType;
  title: string;
  narrativeArc: string;
  startFrame: number;
  endFrame: number;
  actNumber: 1 | 2 | 3;
  palette: ColorLightingPalette;
  hasPursuitDrone: boolean;
  zoneType: EnvironmentZoneType;
  acousticPersonality?: AcousticPersonalityType;
}

/**
 * Decomposes an AudioAnalysisManifest into distinct musical sections mapped to 3 continuous Acts.
 * If getAudioFeatureAtFrame is provided, uses autonomous acoustic energy contouring.
 * Otherwise, uses proportional template segmentation.
 */
export function decomposeMusicalTimeline(
  manifest: AudioAnalysisManifest,
  getAudioFeatureAtFrame?: (frameIndex: number) => AudioFrameFeature
): MusicalSectionDescriptor[] {
  if (getAudioFeatureAtFrame) {
    const segmenter = new AcousticTimelineSegmenter(manifest, {
      getAudioFeatureAtFrame
    });
    return segmenter.segment();
  }

  const totalFrames = manifest.metadata.totalFrames;

  // For short durations (e.g. <= 300 frames demo), map to 3 compact sections
  if (totalFrames <= 300) {
    const act1End = Math.max(1, Math.floor(totalFrames * 0.25));
    const act2End = Math.max(act1End + 1, Math.floor(totalFrames * 0.75));
    return [
      {
        sectionType: 'INTRO',
        title: 'Act I: Industrial Awakening',
        narrativeArc: 'Establishing neon horizon and initial sprint launch.',
        startFrame: 0,
        endFrame: act1End,
        actNumber: 1,
        palette: THEMATIC_PALETTES.CYBERPUNK_CYAN,
        hasPursuitDrone: false,
        zoneType: 'ROOFTOP'
      },
      {
        sectionType: 'VERSE_1',
        title: 'Act II: Kinetic Drive & Velocity',
        narrativeArc: 'High-speed tracking and sweeping orbital kinematics.',
        startFrame: act1End,
        endFrame: act2End,
        actNumber: 2,
        palette: THEMATIC_PALETTES.VOLTAGE_ORANGE,
        hasPursuitDrone: false,
        zoneType: 'HIGHWAY'
      },
      {
        sectionType: 'CHORUS_1',
        title: 'Act III: Cybernetic Convergence',
        narrativeArc: 'Dramatic close-up into runner visor with city continuity.',
        startFrame: act2End,
        endFrame: totalFrames,
        actNumber: 3,
        palette: THEMATIC_PALETTES.CRIMSON_FURY,
        hasPursuitDrone: false,
        zoneType: 'REACTOR'
      }
    ];
  }

  // Full-song musical section decomposition (proportional or LRC-anchored)
  // Approximate proportions for Trashed And Scattered:
  // Act 1: Intro (0.02) + Verse 1 (0.12) + Chorus 1 (0.10) => ~24%
  // Act 2: Verse 2 (0.16) + Thrash / Solo (0.10) => ~26% (total ~50%)
  // Act 3: Chorus 2 / Breakdown (0.20) + Outro (0.30) => ~50% (total 100%)
  const introEnd = Math.max(1, Math.floor(totalFrames * 0.02));
  const verse1End = Math.max(introEnd + 1, Math.floor(totalFrames * 0.14));
  const chorus1End = Math.max(verse1End + 1, Math.floor(totalFrames * 0.24));

  const verse2End = Math.max(chorus1End + 1, Math.floor(totalFrames * 0.40));
  const soloEnd = Math.max(verse2End + 1, Math.floor(totalFrames * 0.50));

  const chorus2End = Math.max(soloEnd + 1, Math.floor(totalFrames * 0.70));
  const outroEnd = totalFrames;

  return [
    {
      sectionType: 'INTRO',
      title: 'Intro: Cold Industrial Horizon',
      narrativeArc: 'Heavy opening guitar riffs, rising chimney smoke, establishing run.',
      startFrame: 0,
      endFrame: introEnd,
      actNumber: 1,
      palette: THEMATIC_PALETTES.CYBERPUNK_CYAN,
      hasPursuitDrone: false,
      zoneType: 'ROOFTOP'
    },
    {
      sectionType: 'VERSE_1',
      title: 'Verse 1: Rapid Fire Cadence',
      narrativeArc: 'Tight tracking shot keeping pace with rapid-fire vocal deliveries.',
      startFrame: introEnd,
      endFrame: verse1End,
      actNumber: 1,
      palette: THEMATIC_PALETTES.CYBERPUNK_CYAN,
      hasPursuitDrone: false,
      zoneType: 'ROOFTOP'
    },
    {
      sectionType: 'CHORUS_1',
      title: 'Chorus 1: Trashed and Scattered',
      narrativeArc: 'Explosive melodic chorus, sweeping orbit, highway gantry and neon lights.',
      startFrame: verse1End,
      endFrame: chorus1End,
      actNumber: 1,
      palette: THEMATIC_PALETTES.VOLTAGE_ORANGE,
      hasPursuitDrone: false,
      zoneType: 'HIGHWAY'
    },
    {
      sectionType: 'VERSE_2',
      title: 'Verse 2: Rising Confrontation',
      narrativeArc: 'Intense lateral movement, flashing warning lights across industrial gantries.',
      startFrame: chorus1End,
      endFrame: verse2End,
      actNumber: 2,
      palette: THEMATIC_PALETTES.VOLTAGE_ORANGE,
      hasPursuitDrone: true,
      zoneType: 'HIGHWAY'
    },
    {
      sectionType: 'GUITAR_SOLO',
      title: 'Twin Guitar Solo: Virtuosic Pursuit',
      narrativeArc: 'Dual harmonized guitar leads, sunset glow, sky-bridge chasm and aerial drone pursuit.',
      startFrame: verse2End,
      endFrame: soloEnd,
      actNumber: 2,
      palette: THEMATIC_PALETTES.SUNSET_GOLD,
      hasPursuitDrone: true,
      zoneType: 'BRIDGE'
    },
    {
      sectionType: 'CHORUS_2',
      title: 'Chorus 2 & Breakdown Climax',
      narrativeArc: 'Peak energy, blood crimson lighting strobes, reactor tunnel portals and siren lights.',
      startFrame: soloEnd,
      endFrame: chorus2End,
      actNumber: 3,
      palette: THEMATIC_PALETTES.CRIMSON_FURY,
      hasPursuitDrone: true,
      zoneType: 'REACTOR'
    },
    {
      sectionType: 'OUTRO',
      title: 'Epic Outro: Atmospheric Transcendence',
      narrativeArc: 'Decelerating melodic riff, expanding dolly out, tunnel exit fading into midnight void.',
      startFrame: chorus2End,
      endFrame: outroEnd,
      actNumber: 3,
      palette: THEMATIC_PALETTES.MIDNIGHT_VOID,
      hasPursuitDrone: false,
      zoneType: 'REACTOR'
    }
  ];
}

export interface FullSongStoryboardOptions {
  audioManifest: AudioAnalysisManifest;
  getAudioFeatureAtFrame?: (frameIndex: number) => AudioFrameFeature;
  useAcousticSegmenter?: boolean;
  projectId?: string;
  targetShotFrames?: number;
}

export const RUNNER_BASE_SPEED = 80; // World units per second at 30 FPS

/**
 * Computes the continuous X world coordinate of the runner at a given frame.
 */
export function computeRunnerTrajectoryX(frame: number, fps = 30): number {
  return Number(((frame / fps) * RUNNER_BASE_SPEED).toFixed(2));
}

/**
 * Generates a full-song DirectorStoryboardContract that strictly complies with:
 * - Exactly 3 contiguous Acts covering [0, totalFrames).
 * - Continuous, non-overlapping shots aligned with act boundaries.
 * - Near-plane safety (rig-fg-pipes excluded on close-up shots).
 * - Cinematic variety across framing, camera movements, and thematic palettes.
 */
export function generateFullSongStoryboard(
  options: FullSongStoryboardOptions
): DirectorStoryboardContract {
  const { audioManifest, projectId = 'full-song-cinema-production' } = options;
  const totalFrames = audioManifest.metadata.totalFrames;
  const fps: 30 | 60 = audioManifest.metadata.fps === 60 ? 60 : 30;
  const targetShotFrames = options.targetShotFrames ?? 180; // ~6.0s average shot length

  const shouldUseSegmenter =
    options.useAcousticSegmenter === true ||
    (options.useAcousticSegmenter !== false && options.getAudioFeatureAtFrame !== undefined);

  const sections: MusicalSectionDescriptor[] = shouldUseSegmenter
    ? new AcousticTimelineSegmenter(audioManifest, {
        getAudioFeatureAtFrame: options.getAudioFeatureAtFrame
      }).segment()
    : decomposeMusicalTimeline(audioManifest);

  // Group sections by Act to determine exact Act boundaries
  const act1Sections = sections.filter((s) => s.actNumber === 1);
  const act2Sections = sections.filter((s) => s.actNumber === 2);

  const act1End = act1Sections[act1Sections.length - 1].endFrame;
  const act2End = act2Sections[act2Sections.length - 1].endFrame;

  const acts: [StoryboardAct, StoryboardAct, StoryboardAct] = [
    {
      actNumber: 1,
      title: 'Act I: Exposition & Initial Velocity',
      narrativeArc:
        'Establish world vista, initial sprint stride, and velocity buildup.',
      frameRange: { startFrameInclusive: 0, endFrameExclusive: act1End }
    },
    {
      actNumber: 2,
      title: 'Act II: Confrontation & Peak Kinetic Drive',
      narrativeArc:
        'Intense pursuit, virtuosic sonic progression, and dynamic aerial drone encounter.',
      frameRange: { startFrameInclusive: act1End, endFrameExclusive: act2End }
    },
    {
      actNumber: 3,
      title: 'Act III: Climax Breakdown & Transcendence',
      narrativeArc:
        'Peak sonic intensity, reactor tunnel breakdown, and atmospheric transcendence.',
      frameRange: { startFrameInclusive: act2End, endFrameExclusive: totalFrames }
    }
  ];

  const shots: CinematicShot[] = [];
  let shotIndex = 0;

  // Shot choreography templates to cycle through for high cinematic variety
  interface ShotPattern {
    framing: CameraFraming;
    movement: CameraMovement;
    viewpoint: CameraViewpoint;
    easing: CameraEasing;
    camStartZ: number;
    camEndZ: number;
    rollDegrees: number;
    includeFgPipes: boolean;
  }

  const patterns: ShotPattern[] = [
    {
      framing: 'EXTREME_WIDE',
      movement: 'DOLLY',
      viewpoint: 'LOW_ANGLE',
      easing: 'easeInOutCubic',
      camStartZ: 420,
      camEndZ: 260,
      rollDegrees: -1.5,
      includeFgPipes: true
    },
    {
      framing: 'MEDIUM',
      movement: 'TRACKING',
      viewpoint: 'OBJECTIVE_THIRD_PERSON',
      easing: 'linear',
      camStartZ: 260,
      camEndZ: 250,
      rollDegrees: 2.0,
      includeFgPipes: true
    },
    {
      framing: 'WIDE',
      movement: 'ORBIT',
      viewpoint: 'OVER_THE_SHOULDER',
      easing: 'easeInOutSine',
      camStartZ: 240,
      camEndZ: 230,
      rollDegrees: -3.0,
      includeFgPipes: true
    },
    {
      framing: 'CLOSE_UP',
      movement: 'DOLLY',
      viewpoint: 'POV_FIRST_PERSON',
      easing: 'easeOutQuad',
      camStartZ: 110,
      camEndZ: 95,
      rollDegrees: 0,
      includeFgPipes: false // STRICT NEAR-PLANE SAFETY: fg-pipes is at z=140, exclude on close-ups
    }
  ];

  for (const section of sections) {
    const sectionDuration = section.endFrame - section.startFrame;
    const shotCount = Math.max(1, Math.round(sectionDuration / targetShotFrames));
    const nominalShotLen = Math.floor(sectionDuration / shotCount);

    let currentStart = section.startFrame;

    for (let s = 0; s < shotCount; s++) {
      const isLastInSection = s === shotCount - 1;
      const currentEnd = isLastInSection ? section.endFrame : currentStart + nominalShotLen;
      const pattern = patterns[(shotIndex + s) % patterns.length];

      // Zone-specific active rigs
      const activeRigs: string[] = [
        CANONICAL_RIG_IDS.RUNNER,
        CANONICAL_RIG_IDS.RUNNER_AURA
      ];

      switch (section.zoneType) {
        case 'ROOFTOP':
          activeRigs.push(
            CANONICAL_RIG_IDS.SKYLINE,
            CANONICAL_RIG_IDS.FACTORIES,
            CANONICAL_RIG_IDS.SMOKE_CHIMNEY
          );
          if (pattern.includeFgPipes) {
            activeRigs.push(CANONICAL_RIG_IDS.FG_PIPES);
          }
          break;

        case 'HIGHWAY':
          activeRigs.push(
            CANONICAL_RIG_IDS.FACTORIES,
            CANONICAL_RIG_IDS.HIGHWAY_GANTRY,
            CANONICAL_RIG_IDS.NEON_BILLBOARD
          );
          if (pattern.includeFgPipes) {
            activeRigs.push(CANONICAL_RIG_IDS.FG_PIPES);
          }
          break;

        case 'BRIDGE':
          activeRigs.push(
            CANONICAL_RIG_IDS.SKYLINE,
            CANONICAL_RIG_IDS.BRIDGE_PYLON
          );
          break;

        case 'REACTOR':
          activeRigs.push(
            CANONICAL_RIG_IDS.REACTOR_CORE,
            CANONICAL_RIG_IDS.HIGHWAY_GANTRY
          );
          break;
      }

      if (section.hasPursuitDrone) {
        activeRigs.push(CANONICAL_RIG_IDS.PURSUIT_DRONE);
      }

      // Compute camera positions in runner world coordinates
      const startX = computeRunnerTrajectoryX(currentStart, fps);
      const endX = computeRunnerTrajectoryX(currentEnd, fps);

      const shot: CinematicShot = {
        id: `shot-${shotIndex}`,
        shotIndex,
        actNumber: section.actNumber,
        frameRange: {
          startFrameInclusive: currentStart,
          endFrameExclusive: currentEnd
        },
        framing: pattern.framing,
        movement: pattern.movement,
        viewpoint: pattern.viewpoint,
        cameraStart: {
          projectionMode: 'perspective',
          position: [startX - 40, 120, pattern.camStartZ],
          target: [startX + 20, 95, 0],
          up: [0, 1, 0],
          verticalFovDegrees: pattern.framing === 'CLOSE_UP' ? 35 : 50,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: pattern.rollDegrees
        },
        cameraEnd: {
          projectionMode: 'perspective',
          position: [endX, 115, pattern.camEndZ],
          target: [endX + 40, 95, 0],
          up: [0, 1, 0],
          verticalFovDegrees: pattern.framing === 'CLOSE_UP' ? 35 : 50,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: -pattern.rollDegrees
        },
        cameraEasing: pattern.easing,
        palette: section.palette,
        narrativeAction: `[Zone: ${section.zoneType}] ${section.title}: ${pattern.framing} ${pattern.movement} shot following the cybernetic runner across ${section.narrativeArc}`,
        activeRigIds: activeRigs,
        environmentZone: section.zoneType
      };

      shots.push(shot);
      currentStart = currentEnd;
      shotIndex++;
    }
  }

  return {
    projectId,
    resolution: { width: 1920, height: 1080 },
    fps,
    totalFrames,
    acts,
    shots
  };
}
