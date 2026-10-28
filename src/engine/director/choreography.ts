import type {
  ChoreographyContract,
  EntityTrack,
  EntityTrackKeyframe,
  MorphBinding,
  PropAttachmentSpan
} from '../../schemas/choreography.contract.js';
import type { Vec2, Vec3 } from '../../schemas/primitives.schema.js';
import type { AudioFrameFeature } from '../../schemas/audio.contract.js';
import { interpolateEasing, lerp, lerpVec2, lerpVec3 } from '../math/easing.js';
import { evaluateSpringResponse } from '../math/spring.js';

export interface EvaluatedTrackState {
  rigId: string;
  worldPosition: Vec3;
  worldRotationZDegrees: number;
  scale: Vec2;
  opacity: number;
  timeScale: number;
  startPoseFrame: number;
  clipId?: string;
  morphWeights: Record<string, number>;
  activeAttachmentSpan?: PropAttachmentSpan;
  vRoot?: number;
  shotStartFrame?: number;
  horizontalDisplacement?: number;
  activeMoveFrames?: number;
  locomotionBlendFactor?: number;
  previousSegment?: {
    clipId: string;
    startPoseFrame: number;
    timeScale: number;
    startFrame: number;
    endFrame: number;
  };
  transitionProgress?: number;
}

export function evaluateTrackTransform(
  keyframes: readonly EntityTrackKeyframe[],
  frameIndex: number
): { position: Vec3; rotationZDegrees: number; scale: Vec2; opacity: number } {
  if (keyframes.length === 0) {
    return {
      position: [0, 0, 0],
      rotationZDegrees: 0,
      scale: [1, 1],
      opacity: 1
    };
  }
  if (keyframes.length === 1 || frameIndex <= keyframes[0].frame) {
    const kf = keyframes[0];
    return {
      position: kf.position,
      rotationZDegrees: kf.rotationZDegrees,
      scale: kf.scale,
      opacity: kf.opacity
    };
  }

  const lastKf = keyframes[keyframes.length - 1];
  if (frameIndex >= lastKf.frame) {
    return {
      position: lastKf.position,
      rotationZDegrees: lastKf.rotationZDegrees,
      scale: lastKf.scale,
      opacity: lastKf.opacity
    };
  }

  let idx = 0;
  while (idx < keyframes.length - 1 && keyframes[idx + 1].frame <= frameIndex) {
    idx++;
  }

  const kf0 = keyframes[idx];
  const kf1 = keyframes[idx + 1];

  const deltaF = kf1.frame - kf0.frame;
  const u = deltaF > 0 ? (frameIndex - kf0.frame) / deltaF : 0;
  const easedU = interpolateEasing(kf0.easing, u);

  return {
    position: lerpVec3(kf0.position, kf1.position, easedU),
    rotationZDegrees: lerp(kf0.rotationZDegrees, kf1.rotationZDegrees, easedU),
    scale: lerpVec2(kf0.scale, kf1.scale, easedU),
    opacity: lerp(kf0.opacity, kf1.opacity, easedU)
  };
}

export function evaluateMorphKeyframes(
  keyframes: ReadonlyArray<{ frame: number; weight: number }>,
  frameIndex: number
): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1 || frameIndex <= keyframes[0].frame) {
    return keyframes[0].weight;
  }
  const last = keyframes[keyframes.length - 1];
  if (frameIndex >= last.frame) {
    return last.weight;
  }
  let idx = 0;
  while (idx < keyframes.length - 1 && keyframes[idx + 1].frame <= frameIndex) {
    idx++;
  }
  const k0 = keyframes[idx];
  const k1 = keyframes[idx + 1];
  const delta = k1.frame - k0.frame;
  if (delta <= 0) return k0.weight;
  const u = (frameIndex - k0.frame) / delta;
  return lerp(k0.weight, k1.weight, u);
}

function getAudioSourceValue(source: MorphBinding['source'], feat: AudioFrameFeature): number {
  switch (source) {
    case 'constant':
      return 1.0;
    case 'audio.rms':
      return feat.rms;
    case 'audio.onsetStrength':
      return feat.onsetStrength;
    case 'audio.bands.bass':
      return feat.bands.bass;
    case 'audio.bands.mid':
      return feat.bands.mid;
    case 'audio.bands.presence':
      return feat.bands.presence;
  }
}

/**
 * Evaluates an entity track's transform, pose settings, and morph weights at a given frame.
 */
export function evaluateEntityTrack(
  track: EntityTrack,
  frameIndex: number,
  fps: number,
  getAudioFeatureAtFrame: (f: number) => AudioFrameFeature
): EvaluatedTrackState {
  const transform = evaluateTrackTransform(track.transform.keyframes, frameIndex);

  const morphWeights: Record<string, number> = {};

  // 1. Keyframed morph weights
  for (const [targetName, keyframes] of Object.entries(track.morphKeyframes ?? {})) {
    morphWeights[targetName] = evaluateMorphKeyframes(keyframes, frameIndex);
  }

  // 2. Audio-reactive and constant morph bindings
  for (const binding of track.morphBindings ?? []) {
    let sourceVal: number;
    if (binding.spring) {
      const rawSpringVal = evaluateSpringResponse(
        frameIndex,
        fps,
        binding.spring.zeta,
        binding.spring.omega,
        (f) => getAudioSourceValue(binding.source, getAudioFeatureAtFrame(f))
      );
      sourceVal = Math.max(
        0,
        Math.min(1.5, rawSpringVal * (binding.spring.omega * binding.spring.omega))
      );
    } else {
      sourceVal = getAudioSourceValue(binding.source, getAudioFeatureAtFrame(frameIndex));
    }

    const boundWeight = Math.max(0, Math.min(1, binding.bias + binding.gain * sourceVal));
    morphWeights[binding.target] = (morphWeights[binding.target] ?? 0) + boundWeight;
  }

  // Final clamp of all weights to [0, 1]
  for (const key of Object.keys(morphWeights)) {
    morphWeights[key] = Math.max(0, Math.min(1, morphWeights[key]));
  }

  const activeAttachmentSpan = (track.attachmentSpans ?? []).find(
    (s) => frameIndex >= s.startFrame && frameIndex < s.endFrame
  );

  let vRoot = 0;
  const lastKfFrame = track.transform.keyframes[track.transform.keyframes.length - 1]?.frame ?? frameIndex;
  if (frameIndex < lastKfFrame) {
    const pNext = evaluateTrackTransform(track.transform.keyframes, frameIndex + 1).position;
    vRoot = Math.hypot(pNext[0] - transform.position[0], pNext[2] - transform.position[2]);
  } else if (frameIndex > (track.transform.keyframes[0]?.frame ?? frameIndex)) {
    const pPrev = evaluateTrackTransform(track.transform.keyframes, frameIndex - 1).position;
    vRoot = Math.hypot(transform.position[0] - pPrev[0], transform.position[2] - pPrev[2]);
  }

  let timeScale = track.pose?.timeScale ?? 1.0;
  let startPoseFrame = track.pose?.startPoseFrame ?? 0;
  let clipId = track.pose?.clipId;
  let shotStartFrame: number | undefined;
  let previousSegment: EvaluatedTrackState['previousSegment'];
  let transitionProgress: number | undefined;

  const TRANSITION_BLEND_FRAMES = 8;

  if (track.pose?.segments && track.pose.segments.length > 0) {
    const segIdx = track.pose.segments.findIndex(
      (s) => frameIndex >= s.startFrame && frameIndex < s.endFrame
    );
    const activeIdx = segIdx >= 0 ? segIdx : track.pose.segments.length - 1;
    const seg = track.pose.segments[activeIdx];
    if (seg) {
      timeScale = seg.timeScale;
      startPoseFrame = seg.startPoseFrame;
      clipId = seg.clipId;
      shotStartFrame = seg.startFrame;

      if (activeIdx > 0 && frameIndex < seg.startFrame + TRANSITION_BLEND_FRAMES) {
        const prevSeg = track.pose.segments[activeIdx - 1];
        previousSegment = {
          clipId: prevSeg.clipId,
          startPoseFrame: prevSeg.startPoseFrame,
          timeScale: prevSeg.timeScale,
          startFrame: prevSeg.startFrame,
          endFrame: prevSeg.endFrame
        };
        transitionProgress = Math.max(0, Math.min(1, (frameIndex - seg.startFrame) / TRANSITION_BLEND_FRAMES));
      }
    }
  }

  // Cumulative horizontal displacement and active move frames since segment start
  const segmentStart = shotStartFrame ?? track.transform.keyframes[0]?.frame ?? 0;
  let horizontalDisplacement = 0;
  let activeMoveFrames = Math.max(0, frameIndex - segmentStart);

  if (frameIndex > segmentStart && track.transform.keyframes.length > 0) {
    let pPrev = evaluateTrackTransform(track.transform.keyframes, segmentStart).position;
    const intermediateKfs = track.transform.keyframes.filter(
      (kf) => kf.frame > segmentStart && kf.frame < frameIndex
    );
    for (const kf of intermediateKfs) {
      horizontalDisplacement += Math.hypot(kf.position[0] - pPrev[0], kf.position[2] - pPrev[2]);
      pPrev = kf.position;
    }
    horizontalDisplacement += Math.hypot(transform.position[0] - pPrev[0], transform.position[2] - pPrev[2]);

    // Check if character arrived and became stationary before frameIndex
    for (let f = segmentStart; f < frameIndex; f++) {
      const pA = evaluateTrackTransform(track.transform.keyframes, f).position;
      const pB = evaluateTrackTransform(track.transform.keyframes, f + 1).position;
      if (Math.hypot(pB[0] - pA[0], pB[2] - pA[2]) < 1e-4) {
        if (Math.hypot(transform.position[0] - pA[0], transform.position[2] - pA[2]) < 1e-4) {
          activeMoveFrames = f - segmentStart;
          break;
        }
      }
    }
  }

  // Locomotion blend factor with minimum-frame hysteresis
  let locomotionBlendFactor = 1.0;
  const LOCOMOTION_STOP_SPEED = 0.03;
  const LOCOMOTION_FULL_SPEED = 0.18;
  const SETTLE_WINDOW_FRAMES = 6;

  if (vRoot < LOCOMOTION_STOP_SPEED) {
    let stopDuration = 0;
    while (stopDuration < SETTLE_WINDOW_FRAMES && frameIndex - stopDuration > 0) {
      const pastFrame = frameIndex - stopDuration - 1;
      const p1 = evaluateTrackTransform(track.transform.keyframes, pastFrame).position;
      const p2 = evaluateTrackTransform(track.transform.keyframes, pastFrame + 1).position;
      const pastV = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]);
      if (pastV >= LOCOMOTION_STOP_SPEED) {
        break;
      }
      stopDuration++;
    }
    locomotionBlendFactor = Math.max(0, 1.0 - (stopDuration + 1) / SETTLE_WINDOW_FRAMES);
  } else if (vRoot < LOCOMOTION_FULL_SPEED) {
    locomotionBlendFactor = (vRoot - LOCOMOTION_STOP_SPEED) / (LOCOMOTION_FULL_SPEED - LOCOMOTION_STOP_SPEED);
  } else {
    locomotionBlendFactor = 1.0;
  }

  return {
    rigId: track.rigId,
    worldPosition: transform.position,
    worldRotationZDegrees: transform.rotationZDegrees,
    scale: transform.scale,
    opacity: transform.opacity,
    timeScale,
    startPoseFrame,
    clipId,
    morphWeights,
    ...(activeAttachmentSpan ? { activeAttachmentSpan } : {}),
    vRoot,
    ...(shotStartFrame !== undefined ? { shotStartFrame } : {}),
    horizontalDisplacement,
    activeMoveFrames,
    locomotionBlendFactor,
    ...(previousSegment ? { previousSegment } : {}),
    ...(transitionProgress !== undefined ? { transitionProgress } : {})
  };
}

export class ChoreographySystem {
  private readonly trackMap = new Map<string, EntityTrack>();

  constructor(choreography: ChoreographyContract) {
    for (const track of choreography.tracks) {
      this.trackMap.set(`${track.shotId}:${track.rigId}`, track);
    }
  }

  public getTrack(shotId: string, rigId: string): EntityTrack | undefined {
    return this.trackMap.get(`${shotId}:${rigId}`);
  }
}
