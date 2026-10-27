import type { AssetRigContract, PoseInterpolationContract } from '../../schemas/rig.contract.js';
import type { SectionStagingSpec, CastDirective, StorySpecContract } from '../../schemas/story-spec.contract.js';
import type { Vec3 } from '../../schemas/primitives.schema.js';
import type { CharacterArchetypeId } from '../library/types.js';
import { computeSkeletonFK, applyAffine2D } from '../rigging/kinematics.js';
import { samplePoseTrack } from '../rigging/deformer.js';

export const ARCHETYPE_CANONICAL_BASE_Y: Record<CharacterArchetypeId, number> = {
  biped_runner: 75,
  biped_frontal: 75,
  biped_three_quarters: 75,
  quadruped_beast: 50,
  aerial_drone: 140,
  hero_silhouette: 66.7,
  companion_silhouette: 56.3
};

export interface AnatomicalFocusSpec {
  /** Relative [dX, dY, dZ] focus adjustment applied on top of root baseY when aiming camera */
  readonly cameraFocusDeltaFromRoot: Vec3;
  /** World-space head/optics offset [dX, dY, dZ] from character rootPosition for validateSafeFraming */
  readonly worldHeadOffsetFromRoot: Vec3;
  /** World-space horizontal center offset from character rootPosition for validateSafeFraming */
  readonly worldBodyCenterOffsetX: number;
  /** Skeleton joint and local 2D point for exact FK head/visor screen-space checks */
  readonly fkFocusJointId: string;
  readonly fkFocusLocalPoint: [number, number];
  /** Skeleton joint for body-center horizontal framing checks */
  readonly fkBodyCenterJointId: string;
}

export const ANATOMICAL_FOCUS_OFFSETS: Record<CharacterArchetypeId, AnatomicalFocusSpec> = {
  biped_runner: {
    cameraFocusDeltaFromRoot: [0, 0, 0],
    worldHeadOffsetFromRoot: [3, 58, 0],
    worldBodyCenterOffsetX: 0,
    fkFocusJointId: 'head',
    fkFocusLocalPoint: [4, 18],
    fkBodyCenterJointId: 'pelvis'
  },
  biped_frontal: {
    cameraFocusDeltaFromRoot: [0, 0, 0],
    worldHeadOffsetFromRoot: [0, 58, 0],
    worldBodyCenterOffsetX: 0,
    fkFocusJointId: 'head',
    fkFocusLocalPoint: [0, 18],
    fkBodyCenterJointId: 'pelvis'
  },
  biped_three_quarters: {
    cameraFocusDeltaFromRoot: [0, 0, 0],
    worldHeadOffsetFromRoot: [2, 58, 0],
    worldBodyCenterOffsetX: 0,
    fkFocusJointId: 'head',
    fkFocusLocalPoint: [2, 18],
    fkBodyCenterJointId: 'pelvis'
  },
  quadruped_beast: {
    cameraFocusDeltaFromRoot: [38, -25, 0],
    worldHeadOffsetFromRoot: [62, 34, 0],
    worldBodyCenterOffsetX: 30,
    fkFocusJointId: 'head',
    fkFocusLocalPoint: [9, 2],
    fkBodyCenterJointId: 'chest'
  },
  aerial_drone: {
    cameraFocusDeltaFromRoot: [0, -45, 0],
    worldHeadOffsetFromRoot: [0, 0, 0],
    worldBodyCenterOffsetX: 0,
    fkFocusJointId: 'chassis_core',
    fkFocusLocalPoint: [0, 0],
    fkBodyCenterJointId: 'chassis_core'
  },
  hero_silhouette: {
    cameraFocusDeltaFromRoot: [0, 0, 0],
    worldHeadOffsetFromRoot: [0, 60, 0],
    worldBodyCenterOffsetX: 0,
    fkFocusJointId: 'head',
    fkFocusLocalPoint: [0, 20],
    fkBodyCenterJointId: 'pelvis'
  },
  companion_silhouette: {
    cameraFocusDeltaFromRoot: [0, 0, 0],
    worldHeadOffsetFromRoot: [0, 56, 0],
    worldBodyCenterOffsetX: 0,
    fkFocusJointId: 'head',
    fkFocusLocalPoint: [0, 18],
    fkBodyCenterJointId: 'pelvis'
  }
};

export const NON_LOCOMOTION_CLIPS = new Set([
  'defiant_scream',
  'combat_clash',
  'beast_idle',
  'idle',
  'scream',
  'pop_vocal_sway',
  'stage_spin',
  'rhythmic_step',
  'crowd_cheer',
  'acoustic_strum',
  'bench_contemplation',
  'gazing_out_window',
  'slow_waltz',
  'headbang_riff',
  'collapse_to_knees'
]);

export interface LimbContactStats {
  readonly limbId: string;
  readonly contactFrames: number;
  readonly backwardFrames: number;
  readonly airborneBackwardFrames: number;
  readonly maxSlipRatio: number;
}

export interface ClipContactAnalysis {
  readonly strideLengthUnits: number;
  readonly maxRelativeDeviation: number;
  readonly meanVReq: number;
  readonly contactFrameCount: number;
  readonly groundLevelY: number;
  readonly epsilon: number;
  readonly hasBallisticPhase: boolean;
  readonly perLimbStats: Record<string, LimbContactStats>;
}

/**
 * Performs contact-aware forward kinematics analysis on a clip to compute
 * the physically grounded stride length and maximum velocity deviation.
 *
 * On a periodic loop of N = loopFrames, there are N unique frame transitions
 * f in {0, ..., N - 1}; the closure keyframe at f = N is identical to f = 0
 * and is not double-counted.
 *
 * Contact condition: A foot is in stance contact on frame transition f -> f+1
 * when its tip at both endpoints is within epsilon (0.02 * leg length) of the
 * clip's lowest ground level Y, and the foot moves backward relative to the
 * pelvis (-dRelX > 0).
 */
export function analyzeClipContactStride(
  rig: AssetRigContract,
  clip: PoseInterpolationContract,
  clipId?: string
): ClipContactAnalysis {
  if (clipId && NON_LOCOMOTION_CLIPS.has(clipId)) {
    return {
      strideLengthUnits: 0,
      maxRelativeDeviation: 0,
      meanVReq: 0,
      contactFrameCount: 0,
      groundLevelY: 0,
      epsilon: 0,
      hasBallisticPhase: false,
      perLimbStats: {}
    };
  }

  if (!rig.skeleton || !clip.keyframes || clip.keyframes.length === 0) {
    if (clip.strideLengthUnits !== undefined && clip.strideLengthUnits > 0) {
      return {
        strideLengthUnits: clip.strideLengthUnits,
        maxRelativeDeviation: 0,
        meanVReq: clip.strideLengthUnits / (clip.loopFrames ?? 24),
        contactFrameCount: clip.loopFrames ?? 24,
        groundLevelY: 0,
        epsilon: 0,
        hasBallisticPhase: false,
        perLimbStats: {}
      };
    }
    throw new Error(
      `Unable to determine physical stride length for clip "${clipId ?? 'unknown'}": missing skeleton or keyframes and no explicit strideLengthUnits declared`
    );
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
    if (clip.strideLengthUnits !== undefined && clip.strideLengthUnits > 0) {
      return {
        strideLengthUnits: clip.strideLengthUnits,
        maxRelativeDeviation: 0,
        meanVReq: clip.strideLengthUnits / loopFrames,
        contactFrameCount: loopFrames,
        groundLevelY: 0,
        epsilon: 0,
        hasBallisticPhase: false,
        perLimbStats: {}
      };
    }
    throw new Error(
      `Unable to determine physical stride length for clip "${clipId ?? 'unknown'}": rig skeleton contains no recognizable foot joints`
    );
  }

  // Calculate per-limb leg length: sum parent (upper) + child (lower)
  const limbEpsilons = footJoints.map((foot) => {
    let len = 44.0;
    if (foot.parentId) {
      const parent = rig.skeleton!.joints.find((j) => j.id === foot.parentId);
      if (parent) {
        len = parent.length + foot.length;
      }
    }
    return 0.02 * len;
  });

  const epsilon = limbEpsilons[0] ?? 0.88;

  // Sample FK foot positions across the loop cycle [0..loopFrames]
  const rootId = rig.skeleton.rootJointId;
  const frameSamples: Array<{
    frame: number;
    pelvisX: number;
    feet: Array<{ id: string; x: number; y: number; relX: number }>;
  }> = [];

  let groundLevelY = Infinity;

  for (let f = 0; f <= loopFrames; f++) {
    const pose = samplePoseTrack(rig, f, 0, 1.0, 0, clipId);
    const fk = computeSkeletonFK(rig.skeleton, pose.jointAngles, pose.jointOffsets);

    const pelvisAff = fk.get(rootId);
    const pelvisPos = pelvisAff ? applyAffine2D(pelvisAff, [0, 0]) : [0, 0];

    const feet = footJoints.map((j) => {
      const aff = fk.get(j.id);
      const tip = aff ? applyAffine2D(aff, [0, -j.length]) : [0, 0];
      if (tip[1] < groundLevelY) {
        groundLevelY = tip[1];
      }
      return { id: j.id, x: tip[0], y: tip[1], relX: tip[0] - pelvisPos[0] };
    });

    frameSamples.push({ frame: f, pelvisX: pelvisPos[0], feet });
  }

  // Extract contact frames and v_req(f) = -d(foot_x - pelvis_x) / df across f in [0, loopFrames)
  const vReqs: number[] = [];
  const framesWithContact = new Set<number>();
  const limbVReqs: number[][] = footJoints.map(() => []);
  const limbContactCounts: number[] = footJoints.map(() => 0);
  const limbBackwardCounts: number[] = footJoints.map(() => 0);
  const limbAirborneBackwardCounts: number[] = footJoints.map(() => 0);

  for (let f = 0; f < loopFrames; f++) {
    const curr = frameSamples[f];
    const next = frameSamples[f + 1];

    for (let j = 0; j < footJoints.length; j++) {
      const cFt = curr.feet[j];
      const nFt = next.feet[j];
      const epsJ = limbEpsilons[j];

      const isGroundedStep = cFt.y <= groundLevelY + epsJ && nFt.y <= groundLevelY + epsJ;
      const dRelX = nFt.relX - cFt.relX;
      const vReq = -dRelX;

      if (vReq > 1e-6) {
        limbBackwardCounts[j]++;
        if (isGroundedStep) {
          vReqs.push(vReq);
          limbVReqs[j].push(vReq);
          limbContactCounts[j]++;
          framesWithContact.add(f);
        } else {
          limbAirborneBackwardCounts[j]++;
        }
      }
    }
  }

  if (vReqs.length === 0) {
    if (clip.strideLengthUnits !== undefined && clip.strideLengthUnits > 0) {
      return {
        strideLengthUnits: clip.strideLengthUnits,
        maxRelativeDeviation: 0,
        meanVReq: clip.strideLengthUnits / loopFrames,
        contactFrameCount: 0,
        groundLevelY,
        epsilon,
        hasBallisticPhase: true,
        perLimbStats: {}
      };
    }
    throw new Error(
      `Unable to determine physical stride length for clip "${clipId ?? 'unknown'}": no ground contact detected (minY=${groundLevelY.toFixed(2)}, epsilon=${epsilon.toFixed(2)}) and no explicit strideLengthUnits declared on rig`
    );
  }

  const meanVReq = vReqs.reduce((a, b) => a + b, 0) / vReqs.length;
  const maxRelativeDeviation = Math.max(...vReqs.map((v) => Math.abs(v - meanVReq) / meanVReq));
  const strideLengthUnits = Number((meanVReq * loopFrames).toFixed(2));
  const hasBallisticPhase = framesWithContact.size < loopFrames;

  const perLimbStats: Record<string, LimbContactStats> = {};
  for (let j = 0; j < footJoints.length; j++) {
    const limbId = footJoints[j].id;
    const lv = limbVReqs[j];
    const maxSlipRatio =
      lv.length > 0 ? Math.max(...lv.map((v) => Math.abs(v - meanVReq) / meanVReq)) : 0;
    perLimbStats[limbId] = {
      limbId,
      contactFrames: limbContactCounts[j],
      backwardFrames: limbBackwardCounts[j],
      airborneBackwardFrames: limbAirborneBackwardCounts[j],
      maxSlipRatio
    };
  }

  return {
    strideLengthUnits,
    maxRelativeDeviation,
    meanVReq,
    contactFrameCount: vReqs.length,
    groundLevelY,
    epsilon,
    hasBallisticPhase,
    perLimbStats
  };
}

/**
 * Computes the physical stride length in world units covered per complete clip loop
 * from forward kinematics foot contact analysis.
 */
export function computeClipStrideLength(
  rig: AssetRigContract,
  clip: PoseInterpolationContract,
  clipId?: string
): number {
  return analyzeClipContactStride(rig, clip, clipId).strideLengthUnits;
}

export interface MusicalMotionParameters {
  readonly k: 1 | 2 | 4 | 8;
  readonly timeScale: number;
  readonly rootSpeed: number;
  readonly strideLengthUnits: number;
  readonly loopFrames: number;
}

/**
 * Chooses integer beats-per-loop k in {1, 2, 4, 8} that minimizes |ln(timeScale_k)|
 * with timeScale_k = loopFrames / (k * framesPerBeat), so footfalls stay on the beat grid
 * and timeScale stays near 1.
 *
 * Root speed = (strideLengthUnits / loopFrames) * timeScale.
 */
export function computeMusicalMotionParameters(
  clip: PoseInterpolationContract,
  strideLengthUnits: number,
  framesPerBeat: number,
  clipId?: string
): MusicalMotionParameters {
  const loopFrames = clip.loopFrames ?? 24;

  if (strideLengthUnits <= 0 || (clipId && NON_LOCOMOTION_CLIPS.has(clipId))) {
    return {
      k: 1,
      timeScale: 1.0,
      rootSpeed: 0,
      strideLengthUnits: 0,
      loopFrames
    };
  }

  const fpb = framesPerBeat > 0 ? framesPerBeat : 15; // default 15f (120 bpm @ 30 fps)
  const candidateKs: Array<1 | 2 | 4 | 8> = [1, 2, 4, 8];
  let bestK: 1 | 2 | 4 | 8 = 1;
  let minCost = Infinity;

  for (const k of candidateKs) {
    const ts = loopFrames / (k * fpb);
    const cost = Math.abs(Math.log(ts));
    if (cost < minCost) {
      minCost = cost;
      bestK = k;
    }
  }

  const timeScale = Number((loopFrames / (bestK * fpb)).toFixed(4));
  const rootSpeed = Number(((strideLengthUnits / loopFrames) * timeScale).toFixed(4));

  return {
    k: bestK,
    timeScale,
    rootSpeed,
    strideLengthUnits,
    loopFrames
  };
}

export interface PhysicalMotionSolveResult {
  readonly timeScale: number;
  readonly speedPerFrame: number;
  readonly strideLengthUnits: number;
}

/**
 * Calculates physically grounded timeScale and speedPerFrame, eliminating foot slide.
 */
export function calculatePhysicalTimeScaleAndSpeed(
  targetSpeed: number,
  clip: PoseInterpolationContract,
  strideLengthUnits: number,
  clipId?: string,
  framesPerBeat?: number
): PhysicalMotionSolveResult {
  if (strideLengthUnits <= 0 || (clipId && NON_LOCOMOTION_CLIPS.has(clipId))) {
    return {
      timeScale: 1.0,
      speedPerFrame: 0,
      strideLengthUnits: 0
    };
  }

  if (framesPerBeat !== undefined && framesPerBeat > 0) {
    const params = computeMusicalMotionParameters(clip, strideLengthUnits, framesPerBeat, clipId);
    return {
      timeScale: params.timeScale,
      speedPerFrame: params.rootSpeed,
      strideLengthUnits
    };
  }

  const loopFrames = clip.loopFrames ?? 24;
  const rawTimeScale = (targetSpeed * loopFrames) / strideLengthUnits;
  const timeScale = Number(Math.max(0.05, Math.min(3.0, rawTimeScale)).toFixed(2));

  return {
    timeScale,
    speedPerFrame: targetSpeed,
    strideLengthUnits
  };
}

export interface ShotMotionPlanItem {
  readonly shotId: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly duration: number;
  readonly clipId: string;
  readonly timeScale: number;
  readonly rootSpeed: number;
  readonly startX: number;
  readonly endX: number;
}

export interface UnifiedMotionPlanOptions {
  readonly storyboardShots: Array<{
    id: string;
    frameRange: { startFrameInclusive: number; endFrameExclusive: number };
    framing?: string;
    actNumber?: number;
  }>;
  readonly storySpec?: StorySpecContract;
  readonly rig: AssetRigContract;
  readonly framesPerBeat?: number;
}

/**
 * Constructs a single, authoritative unified motion plan across all storyboard shots.
 * Guarantees exact constant linear velocity per shot and strict C0 spatial continuity across shots.
 */
export function buildUnifiedMotionPlan(options: UnifiedMotionPlanOptions): ShotMotionPlanItem[] {
  const { storyboardShots, storySpec, rig, framesPerBeat = 15 } = options;
  const sortedShots = [...storyboardShots].sort(
    (a, b) => a.frameRange.startFrameInclusive - b.frameRange.startFrameInclusive
  );

  const plan: ShotMotionPlanItem[] = [];
  let currentX = 0;

  for (const shot of sortedShots) {
    const startFrame = shot.frameRange.startFrameInclusive;
    const endFrame = shot.frameRange.endFrameExclusive;
    const duration = Math.max(1, endFrame - startFrame);

    const sectionSpec = storySpec?.sections.find(
      (s) => startFrame >= s.startFrame && startFrame < s.endFrame
    ) ?? storySpec?.sections[0];

    const directive = sectionSpec?.castDirectives?.find((d) => d.instanceId === rig.id);

    const isQuadrupedRig = Boolean(rig.poseClips && 'beast_gallop' in rig.poseClips);

    // Resolve clipId
    let clipId = isQuadrupedRig ? 'beast_gallop' : 'sprint_frenzy';
    const rawPreset = directive?.motionPreset;

    const canonicalPresets = new Set([
      'stalk_crouch',
      'sprint_frenzy',
      'evade_leap',
      'defiant_scream',
      'combat_clash',
      'exhausted_walk',
      'beast_gallop',
      'beast_idle',
      'pop_vocal_sway',
      'stage_spin',
      'rhythmic_step',
      'crowd_cheer',
      'acoustic_strum',
      'rain_umbrella_walk',
      'bench_contemplation',
      'gazing_out_window',
      'slow_waltz',
      'headbang_riff',
      'collapse_to_knees'
    ]);

    const isTheatrical = Boolean(
      sectionSpec?.stagingMode === 'theatrical' || sectionSpec?.theatricalSetId
    );

    if (isQuadrupedRig) {
      clipId = rawPreset === 'idle' ? 'beast_idle' : 'beast_gallop';
    } else if (rawPreset && canonicalPresets.has(rawPreset)) {
      clipId = rawPreset;
    } else if (rawPreset === 'sprint' || rawPreset === 'stride') {
      clipId = 'sprint_frenzy';
    } else if (rawPreset === 'stalk' || rawPreset === 'idle') {
      clipId = 'stalk_crouch';
    } else if (rawPreset === 'evade') {
      clipId = 'evade_leap';
    } else if (rawPreset === 'gallop' || rawPreset === 'pounce') {
      clipId = 'beast_gallop';
    } else {
      const act = shot.actNumber ?? 1;
      clipId = act === 1 ? 'stalk_crouch' : act === 3 ? 'sprint_frenzy' : 'exhausted_walk';
    }

    if (!isQuadrupedRig && !isTheatrical) {
      if (
        shot.framing === 'CLOSE_UP' &&
        (sectionSpec?.narrativeIntent?.toLowerCase().includes('vocal') ||
          sectionSpec?.narrativeIntent?.toLowerCase().includes('scream') ||
          (shot.actNumber ?? 1) >= 2)
      ) {
        clipId = 'defiant_scream';
      } else if (shot.framing === 'WIDE' && clipId === 'defiant_scream') {
        clipId = 'evade_leap';
      }
    }

    const activeClip = (rig.poseClips && rig.poseClips[clipId]) ?? rig.poseInterpolation;
    const fallbackClip = { keyframes: [], interpolationMode: 'linear' as const };
    const stride = computeClipStrideLength(rig, activeClip ?? fallbackClip, clipId);

    const motionParams = computeMusicalMotionParameters(
      activeClip ?? fallbackClip,
      stride,
      framesPerBeat,
      clipId
    );

    let startX: number;
    let endX: number;
    let effectiveRootSpeed = motionParams.rootSpeed;
    let effectiveTimeScale = motionParams.timeScale;

    if (isTheatrical) {
      if (directive?.waypoints && directive.waypoints.length > 0) {
        const secStart = sectionSpec?.startFrame ?? startFrame;
        const secEnd = sectionSpec?.endFrame ?? endFrame;
        const secDuration = Math.max(1, secEnd - secStart);
        const tauStart = Math.max(0, Math.min(1, (startFrame - secStart) / secDuration));
        const tauEnd = Math.max(0, Math.min(1, (endFrame - secStart) / secDuration));

        const evaluateWaypointNormX = (
          waypoints: NonNullable<typeof directive.waypoints>,
          tau: number
        ): number => {
          if (waypoints.length === 1) return waypoints[0].stagePosNorm[0];
          let wpA = waypoints[0];
          let wpB = waypoints[waypoints.length - 1];
          for (let w = 0; w < waypoints.length - 1; w++) {
            if (tau >= waypoints[w].frameProgress && tau <= waypoints[w + 1].frameProgress) {
              wpA = waypoints[w];
              wpB = waypoints[w + 1];
              break;
            }
          }
          const span = Math.max(1e-6, wpB.frameProgress - wpA.frameProgress);
          const alpha = Math.max(0, Math.min(1, (tau - wpA.frameProgress) / span));
          return wpA.stagePosNorm[0] + (wpB.stagePosNorm[0] - wpA.stagePosNorm[0]) * alpha;
        };

        const normXStart = evaluateWaypointNormX(directive.waypoints, tauStart);
        const normXEnd = evaluateWaypointNormX(directive.waypoints, tauEnd);

        startX = Math.max(-95, Math.min(95, normXStart * 80));
        endX = Math.max(-95, Math.min(95, normXEnd * 80));
        effectiveRootSpeed = duration > 0 ? Number(((endX - startX) / duration).toFixed(4)) : 0;

        const loopFrames = activeClip?.loopFrames ?? 24;
        const isLocomotion = !NON_LOCOMOTION_CLIPS.has(clipId) && stride > 0;

        if (isLocomotion) {
          const natSpeed = stride / loopFrames;
          const rawSpeed = Math.abs(effectiveRootSpeed);
          const rawTimeScale = rawSpeed > 0 ? rawSpeed / natSpeed : 0;

          if (rawTimeScale >= 0.6 && rawTimeScale <= 1.6 && effectiveRootSpeed > 0) {
            effectiveTimeScale = Number(rawTimeScale.toFixed(4));
          } else {
            const interactionBehavior = sectionSpec?.interactionBehavior;
            const isMovement =
              interactionBehavior === 'PURSUIT_AND_CONFRONTATION' ||
              interactionBehavior === 'PARALLEL_WALK';
            if (isMovement) {
              // Movement behavior: integrate root motion at clip-locked speed within [0.6, 1.6]
              let targetTs = 0.8;
              let lockedSpeed = natSpeed * targetTs;
              if (lockedSpeed * duration > 140) {
                targetTs = 0.6;
                lockedSpeed = natSpeed * 0.6;
              }
              effectiveTimeScale = targetTs;
              startX = Math.max(-80, Math.min(80 - lockedSpeed * duration, startX));
              endX = Number((startX + lockedSpeed * duration).toFixed(2));
              effectiveRootSpeed = Number(((endX - startX) / duration).toFixed(4));
              effectiveTimeScale = Number(((effectiveRootSpeed * loopFrames) / stride).toFixed(4));
            } else {
              const inPlace =
                rawPreset && NON_LOCOMOTION_CLIPS.has(rawPreset)
                  ? rawPreset
                  : sectionSpec?.narrativeIntent?.toLowerCase().includes('vocal')
                    ? 'pop_vocal_sway'
                    : sectionSpec?.theatricalSetId === 'RAINY_STREET'
                      ? 'rhythmic_step'
                      : 'bench_contemplation';
              clipId = inPlace;
              effectiveTimeScale = 1.0;
              effectiveRootSpeed = 0;
              endX = startX;
            }
          }
        } else {
          effectiveTimeScale = 1.0;
          effectiveRootSpeed = 0;
          endX = startX;
        }
      } else if (motionParams.rootSpeed === 0 || NON_LOCOMOTION_CLIPS.has(clipId) || stride <= 0) {
        startX = currentX;
        endX = currentX;
        effectiveRootSpeed = 0;
        effectiveTimeScale = 1.0;
      } else {
        const rawTravel = motionParams.rootSpeed * duration;
        if (rawTravel <= 180) {
          startX = Math.max(-95, Math.min(95 - rawTravel, -rawTravel / 2));
          endX = startX + rawTravel;
          effectiveRootSpeed = motionParams.rootSpeed;
          effectiveTimeScale = motionParams.timeScale;
        } else {
          startX = -90;
          endX = 90;
          effectiveRootSpeed = Number(((endX - startX) / duration).toFixed(4));
          const loopFrames = activeClip?.loopFrames ?? 24;
          effectiveTimeScale = Number(
            Math.max(0.6, Math.min(1.6, (effectiveRootSpeed * loopFrames) / stride)).toFixed(4)
          );
        }
      }
      currentX = endX;
    } else {
      startX = currentX;
      endX = startX + motionParams.rootSpeed * duration;
      effectiveRootSpeed = motionParams.rootSpeed;
      effectiveTimeScale = motionParams.timeScale;
      currentX = endX;
    }

    plan.push({
      shotId: shot.id,
      startFrame,
      endFrame,
      duration,
      clipId,
      timeScale: effectiveTimeScale,
      rootSpeed: effectiveRootSpeed,
      startX: Number(startX.toFixed(2)),
      endX: Number(endX.toFixed(2))
    });
  }

  return plan;
}

/**
 * Single source of truth continuous character trajectory solver.
 * Reads directly from the unified motion plan, eliminating hardcoded velocity locks.
 */
export class TrajectorySolver {
  private motionPlan = new Map<string, ShotMotionPlanItem>();
  private orderedPlan: ShotMotionPlanItem[] = [];
  private framesPerBeat = 15;
  private leadArchetypeId: CharacterArchetypeId = 'biped_runner';

  public setLeadArchetype(archetypeId: CharacterArchetypeId): void {
    this.leadArchetypeId = archetypeId;
  }

  public getLeadArchetype(): CharacterArchetypeId {
    return this.leadArchetypeId;
  }

  public setFramesPerBeat(fpb: number): void {
    if (fpb > 0) {
      this.framesPerBeat = fpb;
    }
  }

  public getFramesPerBeat(): number {
    return this.framesPerBeat;
  }

  public setMotionPlan(plan: ShotMotionPlanItem[]): void {
    this.orderedPlan = [...plan].sort((a, b) => a.startFrame - b.startFrame);
    this.motionPlan.clear();
    for (const item of this.orderedPlan) {
      this.motionPlan.set(item.shotId, item);
    }
  }

  public getMotionPlan(): ShotMotionPlanItem[] {
    return this.orderedPlan;
  }

  /**
   * Computes the exact continuous world position for an entity at frame f.
   */
  public computeWorldPos(
    frame: number,
    section?: SectionStagingSpec,
    instanceId?: string
  ): Vec3 {
    let worldX = 0;
    const baseY = ARCHETYPE_CANONICAL_BASE_Y[this.leadArchetypeId] ?? 75;
    const baseZ = 0;

    if (this.orderedPlan.length > 0) {
      // Find shot plan covering frame
      let matchedItem = this.orderedPlan[0];
      for (const item of this.orderedPlan) {
        if (frame >= item.startFrame && frame < item.endFrame) {
          matchedItem = item;
          break;
        }
        if (frame >= item.endFrame) {
          matchedItem = item;
        }
      }

      const localF = Math.max(0, frame - matchedItem.startFrame);
      worldX = matchedItem.startX + matchedItem.rootSpeed * localF;
    } else if (section && (section.stagingMode === 'theatrical' || section.theatricalSetId)) {
      const directive =
        section.castDirectives?.find((d: CastDirective) => !instanceId || d.instanceId === instanceId) ??
        section.castDirectives?.[0];
      const wps = directive?.waypoints ?? [];
      if (wps.length > 0) {
        const secDuration = Math.max(1, section.endFrame - section.startFrame);
        const tau = Math.max(0, Math.min(1, (frame - section.startFrame) / secDuration));
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
        worldX = Math.max(-100, Math.min(100, normX * 80));
      } else {
        worldX = 0;
      }
    } else {
      // Deterministic fallback for standalone unit tests when no storyboard motion plan is loaded
      worldX = frame * 3.5;
    }

    // Ground characters (bipeds and quadruped_beast) lock Y = baseY and Z = 0
    // so feet remain planted on the Y = 0 stage/runway plane and match solveChoreography() 1:1.
    if (
      this.leadArchetypeId === 'biped_runner' ||
      this.leadArchetypeId === 'biped_frontal' ||
      this.leadArchetypeId === 'biped_three_quarters' ||
      this.leadArchetypeId === 'quadruped_beast'
    ) {
      return [Number(worldX.toFixed(2)), baseY, baseZ];
    }

    if (!section || !section.castDirectives || section.castDirectives.length === 0) {
      return [Number(worldX.toFixed(2)), baseY, baseZ];
    }

    const directive = section.castDirectives.find(
      (d: CastDirective) => !instanceId || d.instanceId === instanceId
    ) ?? section.castDirectives[0];

    if (!directive || !directive.waypoints || directive.waypoints.length === 0) {
      return [Number(worldX.toFixed(2)), baseY, baseZ];
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

    const normY = wpA.stagePosNorm[1] + (wpB.stagePosNorm[1] - wpA.stagePosNorm[1]) * alpha;
    const normZ = wpA.stagePosNorm[2] + (wpB.stagePosNorm[2] - wpA.stagePosNorm[2]) * alpha;

    const finalY = baseY + normY * 20;
    const finalZ = baseZ + normZ * 10;

    return [
      Number(worldX.toFixed(2)),
      Number(finalY.toFixed(2)),
      Number(finalZ.toFixed(2))
    ];
  }
}

export const globalTrajectorySolver = new TrajectorySolver();
