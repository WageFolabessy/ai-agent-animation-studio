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
    vRoot = Math.hypot(pNext[0] - transform.position[0], pNext[1] - transform.position[1]);
  } else if (frameIndex > (track.transform.keyframes[0]?.frame ?? frameIndex)) {
    const pPrev = evaluateTrackTransform(track.transform.keyframes, frameIndex - 1).position;
    vRoot = Math.hypot(transform.position[0] - pPrev[0], transform.position[1] - pPrev[1]);
  }

  let timeScale = track.pose?.timeScale ?? 1.0;
  let startPoseFrame = track.pose?.startPoseFrame ?? 0;
  let clipId = track.pose?.clipId;
  let shotStartFrame: number | undefined;

  if (track.pose?.segments && track.pose.segments.length > 0) {
    const seg = track.pose.segments.find(
      (s) => frameIndex >= s.startFrame && frameIndex < s.endFrame
    ) ?? track.pose.segments[track.pose.segments.length - 1];
    if (seg) {
      timeScale = seg.timeScale;
      startPoseFrame = seg.startPoseFrame;
      clipId = seg.clipId;
      shotStartFrame = seg.startFrame;
    }
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
    ...(shotStartFrame !== undefined ? { shotStartFrame } : {})
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
