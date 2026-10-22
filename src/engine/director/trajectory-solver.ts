import type { AssetRigContract, PoseInterpolationContract } from '../../schemas/rig.contract.js';
import type { SectionStagingSpec, CastDirective } from '../../schemas/story-spec.contract.js';
import type { Vec3 } from '../../schemas/primitives.schema.js';
import { computeSkeletonFK, applyAffine2D } from '../rigging/kinematics.js';
import { samplePoseTrack } from '../rigging/deformer.js';

export const NON_LOCOMOTION_CLIPS = new Set(['defiant_scream', 'combat_clash']);

/**
 * Computes the physical stride length in world units covered per complete clip loop
 * from forward kinematics foot contact analysis.
 */
export function computeClipStrideLength(
  rig: AssetRigContract,
  clip: PoseInterpolationContract,
  clipId?: string
): number {
  if (clip.strideLengthUnits !== undefined && clip.strideLengthUnits > 0) {
    return clip.strideLengthUnits;
  }

  if (clipId && NON_LOCOMOTION_CLIPS.has(clipId)) {
    return 0;
  }

  if (!rig.skeleton || !clip.keyframes || clip.keyframes.length === 0) {
    return 36.0;
  }

  const loopFrames = clip.loopFrames ?? 24;

  // Identify foot joints (biped legs or quadruped paws)
  const footJoints = rig.skeleton.joints.filter((j) => {
    const id = j.id.toLowerCase();
    return (
      id.includes('lower') ||
      id.includes('foot') ||
      id.includes('paw') ||
      id.includes('shin') ||
      id.includes('hoof')
    );
  });

  if (footJoints.length === 0) {
    return 36.0;
  }

  // Sample FK foot positions across the entire loop cycle
  const rootId = rig.skeleton.rootJointId;
  const frameSamples: Array<{
    frame: number;
    pelvisX: number;
    feet: Array<{ id: string; x: number; y: number }>;
  }> = [];

  for (let f = 0; f <= loopFrames; f++) {
    const pose = samplePoseTrack(rig, f, 0, 1.0, 0, clipId);
    const fk = computeSkeletonFK(rig.skeleton, pose.jointAngles, pose.jointOffsets);

    const pelvisAff = fk.get(rootId);
    const pelvisPos = pelvisAff ? applyAffine2D(pelvisAff, [0, 0]) : [0, 0];

    const feet = footJoints.map((j) => {
      const aff = fk.get(j.id);
      const tip = aff ? applyAffine2D(aff, [0, -j.length]) : [0, 0];
      return { id: j.id, x: tip[0], y: tip[1] };
    });

    frameSamples.push({ frame: f, pelvisX: pelvisPos[0], feet });
  }

  let totalStride = 0;

  for (let f = 0; f < loopFrames; f++) {
    const curr = frameSamples[f];
    const next = frameSamples[f + 1];

    for (let jIdx = 0; jIdx < footJoints.length; jIdx++) {
      const currFt = curr.feet[jIdx];
      const nextFt = next.feet[jIdx];

      // Backward relative movement of foot defines the stance propulsion phase
      const dxRel = (nextFt.x - next.pelvisX) - (currFt.x - curr.pelvisX);
      if (dxRel < 0) {
        totalStride += -dxRel;
      }
    }
  }

  if (totalStride < 1.0) {
    return 36.0;
  }

  return Number(totalStride.toFixed(2));
}

export interface PhysicalMotionSolveResult {
  timeScale: number;
  speedPerFrame: number;
  strideLengthUnits: number;
}

/**
 * Calculates physically grounded timeScale and speedPerFrame, eliminating foot slide.
 */
export function calculatePhysicalTimeScaleAndSpeed(
  targetSpeed: number,
  clip: PoseInterpolationContract,
  strideLengthUnits: number,
  clipId?: string
): PhysicalMotionSolveResult {
  if (strideLengthUnits <= 0 || (clipId && NON_LOCOMOTION_CLIPS.has(clipId))) {
    return {
      timeScale: 1.0,
      speedPerFrame: 0,
      strideLengthUnits: 0
    };
  }

  const loopFrames = clip.loopFrames ?? 24;
  // physical timeScale = (speedPerFrame * clip.loopFrames) / strideLengthUnits
  const rawTimeScale = (targetSpeed * loopFrames) / strideLengthUnits;

  // Clamp to safe engine bounds [0.05, 3.0]
  const timeScale = Number(Math.max(0.05, Math.min(3.0, rawTimeScale)).toFixed(2));
  const speedPerFrame = targetSpeed;

  return {
    timeScale,
    speedPerFrame,
    strideLengthUnits
  };
}

/**
 * Single source of truth continuous character trajectory solver.
 * Used identically by both choreography-solver and shot-planner camera framing.
 */
export class TrajectorySolver {
  /**
   * Computes the exact continuous world position for an entity at frame f.
   */
  public computeWorldPos(
    frame: number,
    section: SectionStagingSpec,
    instanceId?: string
  ): Vec3 {
    const baseX = frame * 0.45;
    const baseY = 75;
    const baseZ = 0;

    const directive = section.castDirectives.find(
      (d: CastDirective) => !instanceId || d.instanceId === instanceId
    ) ?? section.castDirectives[0];

    if (!directive || !directive.waypoints || directive.waypoints.length === 0) {
      return [Number(baseX.toFixed(2)), baseY, baseZ];
    }

    const secDuration = Math.max(1, section.endFrame - section.startFrame);
    const tau = Math.max(0, Math.min(1, (frame - section.startFrame) / secDuration));

    const wps = directive.waypoints;
    let wpA = wps[0];
    let wpB = wps[wps.length - 1];

    for (let i = 0; i < wps.length - 1; i++) {
      if (tau >= wps[i].frameProgress && tau <= wps[i + 1].frameProgress) {
        wpA = wps[i];
        wpB = wps[i + 1];
        break;
      }
    }

    const span = Math.max(1e-6, wpB.frameProgress - wpA.frameProgress);
    const alpha = Math.max(0, Math.min(1, (tau - wpA.frameProgress) / span));

    const normX = wpA.stagePosNorm[0] + (wpB.stagePosNorm[0] - wpA.stagePosNorm[0]) * alpha;
    const normY = wpA.stagePosNorm[1] + (wpB.stagePosNorm[1] - wpA.stagePosNorm[1]) * alpha;
    const normZ = wpA.stagePosNorm[2] + (wpB.stagePosNorm[2] - wpA.stagePosNorm[2]) * alpha;

    const worldX = baseX + normX * 120;
    const worldY = baseY + normY * 20;
    const worldZ = baseZ + normZ * 10;

    return [
      Number(worldX.toFixed(2)),
      Number(worldY.toFixed(2)),
      Number(worldZ.toFixed(2))
    ];
  }
}

export const globalTrajectorySolver = new TrajectorySolver();
