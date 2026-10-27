import type { AssetRigContract } from '../../schemas/rig.contract.js';
import type { Vec2 } from '../../schemas/primitives.schema.js';
import type { AudioFrameFeature } from '../../schemas/audio.contract.js';
import { interpolatePoseEasing, lerp, lerpVec2 } from '../math/easing.js';
import { evaluateSpringResponse } from '../math/spring.js';

export interface SampledPoseResult {
  jointAngles: Record<string, number>;
  jointOffsets: Record<string, Vec2>;
}

function hermiteInterpolate(p0: number, m0: number, p1: number, m1: number, deltaF: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;

  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  return h00 * p0 + h10 * deltaF * m0 + h01 * p1 + h11 * deltaF * m1;
}

/**
 * Samples a rig's keyframed pose at a specific animation clock time, supporting
 * linear, step, and cubic_spline Hermite interpolation with periodic looping.
 */
export function samplePoseTrack(
  rig: AssetRigContract,
  frameIndex: number,
  shotStartFrame: number,
  timeScale = 1.0,
  startPoseFrame = 0,
  clipId?: string,
  rootSpeed?: number
): SampledPoseResult {
  const jointAngles: Record<string, number> = {};
  const jointOffsets: Record<string, Vec2> = {};

  // Initialize with rest joints if skeleton exists
  if (rig.skeleton) {
    for (const joint of rig.skeleton.joints) {
      jointAngles[joint.id] = joint.rotationZDegrees;
      jointOffsets[joint.id] = [joint.localOffset2D[0], joint.localOffset2D[1]];
    }
  }

  const poseContract = (clipId && rig.poseClips?.[clipId]) ?? rig.poseInterpolation;
  if (!poseContract || poseContract.keyframes.length === 0) {
    return { jointAngles, jointOffsets };
  }

  const keyframes = poseContract.keyframes;
  const { loopFrames, interpolationMode } = poseContract;

  // Compute pose clock
  let clock = startPoseFrame + (frameIndex - shotStartFrame) * timeScale;
  if (loopFrames !== undefined && loopFrames > 0) {
    clock = ((clock % loopFrames) + loopFrames) % loopFrames;
  } else {
    clock = Math.max(keyframes[0].frame, Math.min(keyframes[keyframes.length - 1].frame, clock));
  }

  // Handle single keyframe
  if (keyframes.length === 1) {
    for (const jt of keyframes[0].jointTransforms) {
      jointAngles[jt.jointId] = jt.rotationZDegrees;
      if (jt.localOffset2D) jointOffsets[jt.jointId] = jt.localOffset2D;
    }
    return { jointAngles, jointOffsets };
  }

  // Find keyframe interval
  let idx = 0;
  while (idx < keyframes.length - 1 && keyframes[idx + 1].frame <= clock) {
    idx++;
  }

  const kf0 = keyframes[idx];
  const kf1 = keyframes[Math.min(keyframes.length - 1, idx + 1)];

  if (kf0.frame === kf1.frame || clock <= kf0.frame) {
    for (const jt of kf0.jointTransforms) {
      jointAngles[jt.jointId] = jt.rotationZDegrees;
      if (jt.localOffset2D) jointOffsets[jt.jointId] = jt.localOffset2D;
    }
    return { jointAngles, jointOffsets };
  }

  const deltaF = kf1.frame - kf0.frame;
  const u = (clock - kf0.frame) / deltaF;

  if (interpolationMode === 'step') {
    for (const jt of kf0.jointTransforms) {
      jointAngles[jt.jointId] = jt.rotationZDegrees;
      if (jt.localOffset2D) jointOffsets[jt.jointId] = jt.localOffset2D;
    }
    return { jointAngles, jointOffsets };
  }

  const map0 = new Map(kf0.jointTransforms.map((jt) => [jt.jointId, jt]));
  const map1 = new Map(kf1.jointTransforms.map((jt) => [jt.jointId, jt]));

  // Collect all affected joints
  const allJointIds = new Set([...map0.keys(), ...map1.keys()]);

  if (interpolationMode === 'linear') {
    const easedU = interpolatePoseEasing(kf0.easing, u);

    for (const jointId of allJointIds) {
      const restAngle = jointAngles[jointId] ?? 0;
      const a0 = map0.get(jointId)?.rotationZDegrees ?? restAngle;
      const a1 = map1.get(jointId)?.rotationZDegrees ?? restAngle;
      jointAngles[jointId] = lerp(a0, a1, easedU);

      const restOffset = jointOffsets[jointId] ?? [0, 0];
      const o0 = map0.get(jointId)?.localOffset2D ?? restOffset;
      const o1 = map1.get(jointId)?.localOffset2D ?? restOffset;
      jointOffsets[jointId] = lerpVec2(o0, o1, easedU);
    }
  } else if (interpolationMode === 'cubic_spline') {
    // Hermite cubic spline interpolation with periodic loop unwrapping
    const N = keyframes.length;
    const isLooping = loopFrames !== undefined && loopFrames > 0;
    const hasClosureKeyframe =
      isLooping &&
      N >= 2 &&
      keyframes[0].frame === 0 &&
      keyframes[N - 1].frame === loopFrames;
    const periodCount = hasClosureKeyframe ? N - 1 : N;

    const prevIdx = isLooping ? (idx - 1 + periodCount) % periodCount : Math.max(0, idx - 1);
    const nextIdx = isLooping ? (idx + 2) % periodCount : Math.min(N - 1, idx + 2);

    const prevKf = keyframes[prevIdx];
    const nextKf = keyframes[nextIdx];

    let prevFrame = prevKf.frame;
    if (isLooping && idx === 0) {
      prevFrame -= loopFrames;
    }

    let nextFrame = nextKf.frame;
    if (isLooping && idx + 2 >= periodCount) {
      nextFrame += loopFrames;
    }

    const dt0 = Math.max(1, kf1.frame - prevFrame);
    const dt1 = Math.max(1, nextFrame - kf0.frame);

    const prevMap = new Map(prevKf.jointTransforms.map((jt) => [jt.jointId, jt]));
    const nextMap = new Map(nextKf.jointTransforms.map((jt) => [jt.jointId, jt]));

    for (const jointId of allJointIds) {
      const restAngle = jointAngles[jointId] ?? 0;
      const p0 = map0.get(jointId)?.rotationZDegrees ?? restAngle;
      const p1 = map1.get(jointId)?.rotationZDegrees ?? restAngle;
      const pPrev = prevMap.get(jointId)?.rotationZDegrees ?? p0;
      const pNext = nextMap.get(jointId)?.rotationZDegrees ?? p1;

      // Non-uniform finite differences with unwrapped periodic intervals
      const m0 = (p1 - pPrev) / dt0;
      const m1 = (pNext - p0) / dt1;

      jointAngles[jointId] = hermiteInterpolate(p0, m0, p1, m1, deltaF, u);

      // Offsets
      const restOffset = jointOffsets[jointId] ?? [0, 0];
      const o0 = map0.get(jointId)?.localOffset2D ?? restOffset;
      const o1 = map1.get(jointId)?.localOffset2D ?? restOffset;
      const oPrev = prevMap.get(jointId)?.localOffset2D ?? o0;
      const oNext = nextMap.get(jointId)?.localOffset2D ?? o1;

      const mx0 = (o1[0] - oPrev[0]) / dt0;
      const mx1 = (oNext[0] - o0[0]) / dt1;
      const my0 = (o1[1] - oPrev[1]) / dt0;
      const my1 = (oNext[1] - o0[1]) / dt1;

      jointOffsets[jointId] = [
        hermiteInterpolate(o0[0], mx0, o1[0], mx1, deltaF, u),
        hermiteInterpolate(o0[1], my0, o1[1], my1, deltaF, u)
      ];
    }
  }

  const isKneelingOrSittingClip =
    clipId === 'sit_down' ||
    clipId === 'fall_knees' ||
    clipId === 'collapse_to_knees' ||
    clipId === 'bench_contemplation';
  const isReachClip = clipId === 'reach_and_grasp' || clipId === 'carry_put_down';
  if (rootSpeed !== undefined && !isKneelingOrSittingClip && rig.skeleton?.joints.some((j) => j.id === 'leg_l_upper')) {
    const STANDING_REST_LEG_ANGLES: Record<string, number> = {
      leg_l_upper: 4,
      leg_l_lower: -6,
      leg_r_upper: -4,
      leg_r_lower: -6
    };
    if (rootSpeed < 0.03) {
      for (const [jId, angle] of Object.entries(STANDING_REST_LEG_ANGLES)) {
        jointAngles[jId] = angle;
      }
      if (!isReachClip) {
        jointOffsets['pelvis'] = [0, 0];
      }
    } else if (rootSpeed < 0.18) {
      const blendFactor = (rootSpeed - 0.03) / 0.15;
      for (const [jId, angle] of Object.entries(STANDING_REST_LEG_ANGLES)) {
        jointAngles[jId] = lerp(angle, jointAngles[jId] ?? angle, blendFactor);
      }
      if (!isReachClip) {
        jointOffsets['pelvis'] = lerpVec2([0, 0], jointOffsets['pelvis'] ?? [0, 0], blendFactor);
      }
    }
  }

  return { jointAngles, jointOffsets };
}

/**
 * Evaluates secondary spring motion on joints driven by audio features.
 */
export function evaluateSecondaryMotion(
  rig: AssetRigContract,
  frameIndex: number,
  fps: number,
  getAudioFeatureAtFrame: (f: number) => AudioFrameFeature,
  currentJointAngles: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = { ...currentJointAngles };

  if (!rig.secondaryMotion || rig.secondaryMotion.length === 0) {
    return result;
  }

  for (const sm of rig.secondaryMotion) {
    const getDrive = (f: number): number => {
      const feat = getAudioFeatureAtFrame(f);
      switch (sm.drive) {
        case 'audio.onsetStrength':
          return feat.onsetStrength;
        case 'audio.bands.bass':
          return feat.bands.bass;
        case 'audio.rms':
          return feat.rms;
      }
    };

    const rawSpringVal = evaluateSpringResponse(
      frameIndex,
      fps,
      sm.spring.zeta,
      sm.spring.omega,
      getDrive
    );

    // Normalize by omega^2 so unit steady-state drive yields springNorm = 1.0
    const springNorm = rawSpringVal * (sm.spring.omega * sm.spring.omega);
    const cap = sm.maxDeflectionDeg ?? 65;
    const deltaDeg = Math.max(-cap, Math.min(cap, springNorm * sm.gainDegrees));
    result[sm.jointId] = (result[sm.jointId] ?? 0) + deltaDeg;
  }

  return result;
}
