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
import type { Vec3, CameraTransform } from '../../schemas/primitives.schema.js';
import type { StorySpecContract, SectionStagingSpec } from '../../schemas/story-spec.contract.js';
import { computeCameraBasis } from '../camera/camera-3d.js';
import { THEME_PALETTES } from '../library/environment-kit.js';
import { ArchetypeFactory } from '../library/archetype-factory.js';
import { globalTrajectorySolver, buildUnifiedMotionPlan } from './trajectory-solver.js';

/**
 * Minimum required negative-Z component (-r_z >= 0.15, ~8.6 degrees into -Z half-space)
 * for all 4 viewport frustum corner unit rays at both cameraStart and cameraEnd,
 * including worst-case camera trauma shake perturbations.
 *
 * Half horizontal FOV arithmetic at 16:9 aspect ratio:
 * - 60 deg vertical FOV -> arctan((16/9) * tan(30 deg)) = arctan(1.0264) ~= 45.75 deg
 * - 50 deg vertical FOV -> arctan((16/9) * tan(25 deg)) = arctan(0.8290) ~= 39.66 deg
 */
export const MIN_FRUSTUM_RAY_NEG_Z_MARGIN = 0.15;

export function checkCameraFrustumNegativeZ(
  cam: CameraTransform,
  aspect = 16 / 9,
  shakeRollMarginDeg = 3.0,
  shakePosMargin = 5.0
): { valid: boolean; maxRayZ: number } {
  const fovDeg = cam.projectionMode === 'perspective' ? cam.verticalFovDegrees : 50;
  const tanHalfV = Math.tan((fovDeg * Math.PI) / 360);
  const tanHalfH = aspect * tanHalfV;

  const rollOffsets = [-shakeRollMarginDeg, 0, shakeRollMarginDeg];
  const posShifts: Array<[-1 | 0 | 1, -1 | 0 | 1]> = [
    [0, 0],
    [-1, 1],
    [1, -1]
  ];
  const cornerSigns: Array<[-1 | 1, -1 | 1]> = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ];

  let maxRayZ = -Infinity;

  for (const dRoll of rollOffsets) {
    for (const [sp, st] of posShifts) {
      const perturbed: CameraTransform = {
        ...cam,
        position: [
          cam.position[0] + sp * shakePosMargin,
          cam.position[1],
          cam.position[2] - Math.abs(sp) * shakePosMargin
        ],
        target: [
          cam.target[0] + st * shakePosMargin,
          cam.target[1],
          cam.target[2]
        ],
        rollDegrees: (cam.rollDegrees ?? 0) + dRoll
      };

      const { right: u, up: v, forward: w } = computeCameraBasis(perturbed);
      for (const [sx, sy] of cornerSigns) {
        const rx = w[0] + sx * tanHalfH * u[0] + sy * tanHalfV * v[0];
        const ry = w[1] + sx * tanHalfH * u[1] + sy * tanHalfV * v[1];
        const rz = w[2] + sx * tanHalfH * u[2] + sy * tanHalfV * v[2];
        const len = Math.hypot(rx, ry, rz);
        const unitRz = len > 1e-9 ? rz / len : 0;
        if (unitRz > maxRayZ) {
          maxRayZ = unitRz;
        }
      }
    }
  }

  return {
    valid: maxRayZ <= -MIN_FRUSTUM_RAY_NEG_Z_MARGIN,
    maxRayZ
  };
}

export function assertStoryboardFrustumNegativeZ(
  shots: readonly CinematicShot[],
  aspect = 16 / 9
): void {
  for (const shot of shots) {
    const startCheck = checkCameraFrustumNegativeZ(shot.cameraStart, aspect);
    if (!startCheck.valid) {
      throw new Error(
        `Shot ${shot.id} cameraStart violates -Z frustum ray invariant: maxRayZ=${startCheck.maxRayZ.toFixed(4)} > -${MIN_FRUSTUM_RAY_NEG_Z_MARGIN}`
      );
    }
    const endCheck = checkCameraFrustumNegativeZ(shot.cameraEnd, aspect);
    if (!endCheck.valid) {
      throw new Error(
        `Shot ${shot.id} cameraEnd violates -Z frustum ray invariant: maxRayZ=${endCheck.maxRayZ.toFixed(4)} > -${MIN_FRUSTUM_RAY_NEG_Z_MARGIN}`
      );
    }
  }
}

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
    camOffsetStart: [-179, 120, 265],
    camOffsetEnd: [179, 120, 265],
    targetOffsetStart: [0, 50, 0],
    targetOffsetEnd: [0, 50, 0],
    easing: 'linear'
  },
  {
    name: 'FACE_SCREAM_CLOSEUP',
    framing: 'CLOSE_UP',
    movement: 'TRACKING',
    viewpoint: 'OBJECTIVE_THIRD_PERSON',
    fov: 34,
    rollDegrees: -6,
    camOffsetStart: [12, 48, 155],
    camOffsetEnd: [12, 48, 155],
    targetOffsetStart: [12, 48, 0],
    targetOffsetEnd: [12, 48, 0],
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
 * Shared pure trajectory solver for character world position.
 * Computes exact world-space [X, Y, Z] at any arbitrary frame conditioned on section waypoints.
 * Guarantees Delta X_cam === Delta X_char when camera tracks character position,
 * and enforces monotonically non-decreasing X for right-facing movement (Safeguard 2).
 */
export function computeLeadCharacterWorldPos(
  frame: number,
  section: SectionStagingSpec,
  instanceId?: string
): Vec3 {
  return globalTrajectorySolver.computeWorldPos(frame, section, instanceId);
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

  // 1. Determine section-aligned Act partitioning indices (k1 ~ n/3, k2 ~ 2n/3)
  const sectionCount = spec.sections.length;
  const k1 = Math.max(1, Math.min(sectionCount - 2, Math.round(sectionCount / 3)));
  const k2 = Math.max(k1 + 1, Math.min(sectionCount - 1, Math.round((2 * sectionCount) / 3)));

  // 2. Phase A: Build Shot Skeletons
  interface ShotSkeleton {
    id: string;
    shotIndex: number;
    actNumber: 1 | 2 | 3;
    frameRange: { startFrameInclusive: number; endFrameExclusive: number };
    angle: CinematicAngleFormula;
    secSpec: SectionStagingSpec;
    palette: (typeof THEME_PALETTES)[keyof typeof THEME_PALETTES];
    environmentZone: EnvironmentZoneType;
    activeRigIds: string[];
  }

  const skeletons: ShotSkeleton[] = [];
  let currentFrame = 0;
  let shotIndex = 0;

  for (let sIdx = 0; sIdx < sectionCount; sIdx++) {
    const secSpec = spec.sections[sIdx];
    const sectionStart = secSpec.startFrame;
    const sectionEnd = secSpec.endFrame;
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
    const actNumber: 1 | 2 | 3 = sIdx < k1 ? 1 : sIdx < k2 ? 2 : 3;

    // Build shot skeletons for this section
    for (let i = 0; i < cutPoints.length - 1; i++) {
      const fStart = i === 0 && sIdx === 0 ? 0 : currentFrame;
      const fEnd = cutPoints[i + 1];
      if (fEnd <= fStart) continue;

      const angle = CINEMATIC_ANGLES[shotIndex % CINEMATIC_ANGLES.length];
      const framing = angle.framing;

      const activeRigIds =
        framing === 'CLOSE_UP'
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

      skeletons.push({
        id: `shot_${shotIndex.toString().padStart(2, '0')}`,
        shotIndex,
        actNumber,
        frameRange: { startFrameInclusive: fStart, endFrameExclusive: fEnd },
        angle,
        secSpec,
        palette,
        environmentZone,
        activeRigIds: activeRigIds.length > 0 ? activeRigIds : castRigIds
      });

      currentFrame = fEnd;
      shotIndex++;
    }
  }

  // Final sanity check: Contiguity enforcement on skeletons
  if (
    skeletons.length > 0 &&
    skeletons[skeletons.length - 1].frameRange.endFrameExclusive !== totalFrames
  ) {
    (skeletons[skeletons.length - 1].frameRange as { endFrameExclusive: number }).endFrameExclusive =
      totalFrames;
  }

  // Phase B: Compute Per-Shot Unified Motion Plan
  const leadRigId = castRigIds[0] ?? 'lead';
  const leadRig = ArchetypeFactory.build({
    instanceId: leadRigId,
    spec: {
      instanceId: leadRigId,
      archetypeId: spec.cast[0]?.archetypeId ?? 'biped_runner',
      scale: spec.cast[0]?.scale ?? 1.0,
      accessories: spec.cast[0]?.accessories ?? []
    }
  });

  const effectiveFramesPerBeat =
    manifest.beatGrid?.framesPerBeat && manifest.beatGrid.framesPerBeat > 0
      ? manifest.beatGrid.framesPerBeat
      : (60 / (manifest.metadata.tempoBpm ?? 120)) * (manifest.metadata.fps ?? 30);
  globalTrajectorySolver.setFramesPerBeat(effectiveFramesPerBeat);

  const motionPlan = buildUnifiedMotionPlan({
    storyboardShots: skeletons.map((s) => ({
      id: s.id,
      frameRange: s.frameRange,
      framing: s.angle.framing,
      actNumber: s.actNumber
    })),
    storySpec: spec,
    rig: leadRig,
    framesPerBeat: effectiveFramesPerBeat
  });

  globalTrajectorySolver.setMotionPlan(motionPlan);

  // Phase C: Camera Assignment from Motion Plan
  const shots: CinematicShot[] = skeletons.map((skel) => {
    const fStart = skel.frameRange.startFrameInclusive;
    const fEndLast = Math.max(fStart, skel.frameRange.endFrameExclusive - 1);

    const charStartPos = globalTrajectorySolver.computeWorldPos(fStart, skel.secSpec, leadRigId);
    const charEndPos = globalTrajectorySolver.computeWorldPos(fEndLast, skel.secSpec, leadRigId);

    const camStartPos: Vec3 = [
      Number((charStartPos[0] + skel.angle.camOffsetStart[0]).toFixed(2)),
      Number((charStartPos[1] + skel.angle.camOffsetStart[1]).toFixed(2)),
      Number((charStartPos[2] + skel.angle.camOffsetStart[2]).toFixed(2))
    ];
    const camStartTarget: Vec3 = [
      Number((charStartPos[0] + skel.angle.targetOffsetStart[0]).toFixed(2)),
      Number((charStartPos[1] + skel.angle.targetOffsetStart[1]).toFixed(2)),
      Number((charStartPos[2] + skel.angle.targetOffsetStart[2]).toFixed(2))
    ];

    const camEndPos: Vec3 = [
      Number((charEndPos[0] + skel.angle.camOffsetEnd[0]).toFixed(2)),
      Number((charEndPos[1] + skel.angle.camOffsetEnd[1]).toFixed(2)),
      Number((charEndPos[2] + skel.angle.camOffsetEnd[2]).toFixed(2))
    ];
    const camEndTarget: Vec3 = [
      Number((charEndPos[0] + skel.angle.targetOffsetEnd[0]).toFixed(2)),
      Number((charEndPos[1] + skel.angle.targetOffsetEnd[1]).toFixed(2)),
      Number((charEndPos[2] + skel.angle.targetOffsetEnd[2]).toFixed(2))
    ];

    return {
      id: skel.id,
      shotIndex: skel.shotIndex,
      actNumber: skel.actNumber,
      frameRange: skel.frameRange,
      framing: skel.angle.framing,
      movement: skel.angle.movement,
      viewpoint: skel.angle.viewpoint,
      cameraStart: {
        position: camStartPos,
        target: camStartTarget,
        up: [0, 1, 0],
        nearPlane: 0.1,
        farPlane: 2000,
        rollDegrees: skel.angle.rollDegrees,
        verticalFovDegrees: skel.angle.fov,
        projectionMode: 'perspective'
      },
      cameraEnd: {
        position: camEndPos,
        target: camEndTarget,
        up: [0, 1, 0],
        nearPlane: 0.1,
        farPlane: 2000,
        rollDegrees: skel.angle.rollDegrees,
        verticalFovDegrees: skel.angle.fov,
        projectionMode: 'perspective'
      },
      cameraEasing: skel.angle.easing,
      palette: skel.palette,
      narrativeAction: `${skel.secSpec.narrativeIntent} (${skel.angle.name})`,
      activeRigIds: skel.activeRigIds,
      environmentZone: skel.environmentZone
    };
  });

  // If spec had < 3 sections, partition acts across compiled shots if possible
  if (sectionCount < 3 && shots.length >= 3) {
    const t1 = totalFrames * 0.25;
    const t2 = totalFrames * 0.75;
    let j1 = 1;
    let minD1 = Infinity;
    for (let i = 1; i <= shots.length - 2; i++) {
      const d = Math.abs(shots[i].frameRange.startFrameInclusive - t1);
      if (d < minD1) {
        minD1 = d;
        j1 = i;
      }
    }
    let j2 = j1 + 1;
    let minD2 = Infinity;
    for (let i = j1 + 1; i <= shots.length - 1; i++) {
      const d = Math.abs(shots[i].frameRange.startFrameInclusive - t2);
      if (d < minD2) {
        minD2 = d;
        j2 = i;
      }
    }
    for (let i = 0; i < shots.length; i++) {
      shots[i].actNumber = i < j1 ? 1 : i < j2 ? 2 : 3;
    }
  }

  // Derive exact Act boundaries from section alignment
  const act2Start =
    sectionCount >= 3
      ? spec.sections[k1].startFrame
      : (shots.find((s) => s.actNumber === 2)?.frameRange.startFrameInclusive ?? Math.max(1, Math.floor(totalFrames / 3)));
  const act3Start =
    sectionCount >= 3
      ? spec.sections[k2].startFrame
      : (shots.find((s) => s.actNumber === 3)?.frameRange.startFrameInclusive ?? Math.max(act2Start + 1, Math.floor((2 * totalFrames) / 3)));

  const acts: [StoryboardAct, StoryboardAct, StoryboardAct] = [
    {
      actNumber: 1,
      title: 'Act I: Exposition & World Staging',
      narrativeArc: `${spec.title} - Exposition in ${spec.overallMood}`,
      frameRange: { startFrameInclusive: 0, endFrameExclusive: act2Start }
    },
    {
      actNumber: 2,
      title: 'Act II: Dynamic Pursuit & Conflict',
      narrativeArc: 'Escalation of kinetic tempo and environment transitions',
      frameRange: { startFrameInclusive: act2Start, endFrameExclusive: act3Start }
    },
    {
      actNumber: 3,
      title: 'Act III: Climax & Resolution',
      narrativeArc: 'Virtuosic resolution and final thematic coda',
      frameRange: { startFrameInclusive: act3Start, endFrameExclusive: totalFrames }
    }
  ];

  assertStoryboardFrustumNegativeZ(shots);

  return {
    projectId: spec.projectId,
    resolution: { width: 1920, height: 1080 },
    fps: fps === 60 ? 60 : 30,
    totalFrames,
    acts,
    shots
  };
}
