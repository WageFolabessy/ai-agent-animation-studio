import type { AssetRigContract, PoseInterpolationContract } from '../../schemas/rig.contract.js';
import type { SectionStagingSpec, CastDirective, StorySpecContract } from '../../schemas/story-spec.contract.js';
import type { Vec3 } from '../../schemas/primitives.schema.js';
import { computeSkeletonFK, applyAffine2D } from '../rigging/kinematics.js';
import { samplePoseTrack } from '../rigging/deformer.js';

export const NON_LOCOMOTION_CLIPS = new Set([
  'defiant_scream',
  'combat_clash',
  'beast_idle',
  'idle',
  'scream'
]);

export interface ClipContactAnalysis {
  readonly strideLengthUnits: number;
  readonly maxRelativeDeviation: number;
  readonly meanVReq: number;
  readonly contactFrameCount: number;
  readonly groundLevelY: number;
  readonly epsilon: number;
  readonly hasBallisticPhase: boolean;
}

/**
 * Performs contact-aware forward kinematics analysis on a clip to compute
 * the physically grounded stride length and maximum velocity deviation.
 *
 * Contact condition: A foot is in contact on frames where its tip is within
 * epsilon (0.05 * total leg length) of the clip's lowest ground level Y,
 * and the foot is in stance phase (moving backward relative to the pelvis: -dRelX > 0).
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
      hasBallisticPhase: false
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
        hasBallisticPhase: false
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
        hasBallisticPhase: false
      };
    }
    throw new Error(
      `Unable to determine physical stride length for clip "${clipId ?? 'unknown'}": rig skeleton contains no recognizable foot joints`
    );
  }

  // Calculate total leg length: sum parent (upper) + child (lower)
  let legLength = 46.0; // default for biped
  const firstFoot = footJoints[0];
  if (firstFoot.parentId) {
    const parent = rig.skeleton.joints.find((j) => j.id === firstFoot.parentId);
    if (parent) {
      legLength = parent.length + firstFoot.length;
    }
  }

  // Contact threshold: 5% of total leg length
  const epsilon = 0.05 * legLength;

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

  // Extract contact frames and v_req(f) = -d(foot_x - pelvis_x) / df
  const vReqs: number[] = [];
  const framesWithContact = new Set<number>();

  for (let f = 0; f < loopFrames; f++) {
    const curr = frameSamples[f];
    const next = frameSamples[f + 1];

    for (let j = 0; j < footJoints.length; j++) {
      const cFt = curr.feet[j];
      const nFt = next.feet[j];

      // Contact condition: tip Y is within epsilon of ground level and moving backward
      const isContact = cFt.y <= groundLevelY + epsilon;
      const dRelX = nFt.relX - cFt.relX;
      const vReq = -dRelX;

      if (isContact && vReq > 0) {
        vReqs.push(vReq);
        framesWithContact.add(f);
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
        hasBallisticPhase: true
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

  return {
    strideLengthUnits,
    maxRelativeDeviation,
    meanVReq,
    contactFrameCount: vReqs.length,
    groundLevelY,
    epsilon,
    hasBallisticPhase
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

    // Resolve clipId
    let clipId = 'sprint_frenzy';
    const rawPreset = directive?.motionPreset;

    const canonicalPresets = new Set([
      'stalk_crouch',
      'sprint_frenzy',
      'evade_leap',
      'defiant_scream',
      'combat_clash',
      'exhausted_walk',
      'beast_gallop',
      'beast_idle'
    ]);

    if (rawPreset && canonicalPresets.has(rawPreset)) {
      clipId = rawPreset;
    } else if (rawPreset === 'sprint' || rawPreset === 'stride') {
      clipId = 'sprint_frenzy';
    } else if (rawPreset === 'stalk' || rawPreset === 'idle') {
      clipId = 'stalk_crouch';
    } else if (rawPreset === 'evade') {
      clipId = 'evade_leap';
    } else {
      const act = shot.actNumber ?? 1;
      clipId = act === 1 ? 'stalk_crouch' : act === 3 ? 'sprint_frenzy' : 'exhausted_walk';
    }

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

    const activeClip = (rig.poseClips && rig.poseClips[clipId]) ?? rig.poseInterpolation;
    const fallbackClip = { keyframes: [], interpolationMode: 'linear' as const };
    const stride = computeClipStrideLength(rig, activeClip ?? fallbackClip, clipId);

    const motionParams = computeMusicalMotionParameters(
      activeClip ?? fallbackClip,
      stride,
      framesPerBeat,
      clipId
    );

    const startX = currentX;
    const endX = startX + motionParams.rootSpeed * duration;
    currentX = endX;

    plan.push({
      shotId: shot.id,
      startFrame,
      endFrame,
      duration,
      clipId,
      timeScale: motionParams.timeScale,
      rootSpeed: motionParams.rootSpeed,
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
    const baseY = 75;
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
    } else {
      // Deterministic fallback for standalone unit tests when no storyboard motion plan is loaded
      worldX = frame * 3.5;
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
