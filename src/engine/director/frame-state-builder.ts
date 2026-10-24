import type { DirectorStoryboardContract } from '../../schemas/storyboard.contract.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../../schemas/audio.contract.js';
import type { AssetRigContract } from '../../schemas/rig.contract.js';
import type { ChoreographyContract } from '../../schemas/choreography.contract.js';
import type {
  FrameStateContract,
  ActiveEntityState,
  ActiveLyricState
} from '../../schemas/frame.contract.js';
import { ShotSequencer } from './shot-sequencer.js';
import { CameraShakeSystem } from './camera-shake.js';
import { ChoreographySystem, evaluateEntityTrack, type EvaluatedTrackState } from './choreography.js';
import { samplePoseTrack, evaluateSecondaryMotion } from '../rigging/deformer.js';
import { computeCameraBasis } from '../camera/camera-3d.js';
import { computeSkeletonFK, applyAffine2D } from '../rigging/kinematics.js';
import { CANONICAL_BIPED_SOCKETS } from '../library/prop-factory.js';

export interface FrameStateBuilderOptions {
  storyboard: DirectorStoryboardContract;
  audioManifest: AudioAnalysisManifest;
  rigs: Map<string, AssetRigContract>;
  choreography: ChoreographyContract;
  getAudioFeatureAtFrame: (f: number) => AudioFrameFeature;
  seed?: number;
}

/**
 * Pure frame state builder that transforms high-level storyboard, audio, and choreography
 * contracts into an exact FrameStateContract for any requested frame index.
 */
export class FrameStateBuilder {
  private readonly storyboard: DirectorStoryboardContract;
  private readonly audioManifest: AudioAnalysisManifest;
  private readonly rigs: Map<string, AssetRigContract>;
  private readonly sequencer: ShotSequencer;
  private readonly shakeSystem: CameraShakeSystem;
  private readonly choreoSystem: ChoreographySystem;
  private readonly getAudioFeature: (f: number) => AudioFrameFeature;

  constructor(options: FrameStateBuilderOptions) {
    this.storyboard = options.storyboard;
    this.audioManifest = options.audioManifest;
    this.rigs = options.rigs;
    this.sequencer = new ShotSequencer(options.storyboard);
    this.shakeSystem = new CameraShakeSystem({
      seed: options.seed ?? 42,
      fps: options.storyboard.fps
    });
    this.choreoSystem = new ChoreographySystem(options.choreography);
    this.getAudioFeature = options.getAudioFeatureAtFrame;
  }

  private findActiveLyric(frameIndex: number): ActiveLyricState | null {
    const lyrics = this.audioManifest.lyrics;
    let low = 0;
    let high = lyrics.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const lyric = lyrics[mid];
      const start = lyric.frameRange.startFrameInclusive;
      const end = lyric.frameRange.endFrameExclusive;

      if (frameIndex < start) {
        high = mid - 1;
      } else if (frameIndex >= end) {
        low = mid + 1;
      } else {
        const duration = end - start;
        const progress = duration > 0 ? (frameIndex - start) / duration : 0;
        return {
          lineId: lyric.id,
          text: lyric.text,
          progress: Math.max(0, Math.min(1, progress)),
          emphasis: lyric.emphasis
        };
      }
    }
    return null;
  }

  public buildFrameState(frameIndex: number): FrameStateContract {
    const fps = this.storyboard.fps;
    const timeSeconds = frameIndex / fps;

    // 1. Identify active shot & normalized progress
    const { shot, normalizedProgress } = this.sequencer.getShotForFrame(frameIndex);

    // 2. Base interpolated camera (with optional theatrical CAMERA_PAN transition-in)
    let baseCamera = this.sequencer.interpolateCamera(shot, normalizedProgress);
    let transitionOverlayOpacity: number | undefined;

    if (shot.transitionIn && shot.transitionIn.durationFrames > 0) {
      const localFrame = frameIndex - shot.frameRange.startFrameInclusive;
      if (localFrame >= 0 && localFrame < shot.transitionIn.durationFrames) {
        const u = localFrame / shot.transitionIn.durationFrames;
        if (shot.transitionIn.type === 'CROSS_FADE') {
          transitionOverlayOpacity = Number(((1 - u) * 0.85).toFixed(3));
        } else if (shot.transitionIn.type === 'CAMERA_PAN') {
          const panShift = (1 - u) * (1 - u) * -40;
          baseCamera = {
            ...baseCamera,
            position: [
              baseCamera.position[0] + panShift,
              baseCamera.position[1],
              baseCamera.position[2]
            ],
            target: [
              baseCamera.target[0] + panShift,
              baseCamera.target[1],
              baseCamera.target[2]
            ]
          };
        }
      }
    }

    // 3. Audio-reactive camera trauma shake
    const camera = this.shakeSystem.applyShake(
      baseCamera,
      frameIndex,
      this.getAudioFeature,
      shot.palette
    );

    // 4. Audio features
    const audio = this.getAudioFeature(frameIndex);

    // 5. Active lyric caption
    const lyric = this.findActiveLyric(frameIndex);

    // 6. Active entities for the shot
    const entities: ActiveEntityState[] = [];
    const evaluatedTrackMap = new Map<string, EvaluatedTrackState>();

    for (const rigId of shot.activeRigIds) {
      const rig = this.rigs.get(rigId);
      if (!rig) continue;

      const track = this.choreoSystem.getTrack(shot.id, rigId);

      if (track) {
        const trackState = evaluateEntityTrack(track, frameIndex, fps, this.getAudioFeature);
        evaluatedTrackMap.set(rigId, trackState);

        const poseResult = samplePoseTrack(
          rig,
          frameIndex,
          shot.frameRange.startFrameInclusive,
          trackState.timeScale,
          trackState.startPoseFrame,
          trackState.clipId,
          trackState.vRoot
        );

        const jointAngles = evaluateSecondaryMotion(
          rig,
          frameIndex,
          fps,
          this.getAudioFeature,
          poseResult.jointAngles
        );

        entities.push({
          rigId,
          worldPosition: trackState.worldPosition,
          worldRotationZDegrees: trackState.worldRotationZDegrees,
          scale: trackState.scale,
          jointAngles,
          jointOffsets: poseResult.jointOffsets,
          morphWeights: trackState.morphWeights,
          opacity: trackState.opacity
        });
      } else {
        // Fallback to static rig defaults
        entities.push({
          rigId,
          worldPosition: rig.baseTransform.position,
          worldRotationZDegrees: rig.baseTransform.rotationZDegrees,
          scale: rig.baseTransform.scale,
          jointAngles: {},
          jointOffsets: {},
          morphWeights: {},
          opacity: 1
        });
      }
    }

    // Dynamic prop attachment pass: project attached props from owner's FK socket in camera plane
    for (const entity of entities) {
      const trackState = evaluatedTrackMap.get(entity.rigId);
      const span = trackState?.activeAttachmentSpan;
      if (!span) continue;

      const ownerEntity = entities.find((e) => e.rigId === span.ownerRigId);
      const ownerRig = this.rigs.get(span.ownerRigId);
      if (!ownerEntity || !ownerRig?.skeleton) continue;

      const fkMap = computeSkeletonFK(ownerRig.skeleton, ownerEntity.jointAngles, ownerEntity.jointOffsets);
      const socket = ownerRig.sockets?.find((s) => s.id === span.socketId) ??
        CANONICAL_BIPED_SOCKETS.find((s) => s.id === span.socketId);

      const jointId = socket ? socket.jointId : span.socketId;
      const localOffset = socket ? socket.localOffset2D : [0, 0];
      const jointTransform = fkMap.get(jointId);

      if (jointTransform) {
        const socketLocal = applyAffine2D(jointTransform, localOffset as [number, number]);
        const sx = ownerEntity.scale[0] !== 0 ? ownerEntity.scale[0] : 1;
        const sy = ownerEntity.scale[1] !== 0 ? ownerEntity.scale[1] : 1;
        const scaledX = socketLocal[0] * sx;
        const scaledY = socketLocal[1] * sy;
        const rotRad = (ownerEntity.worldRotationZDegrees * Math.PI) / 180;
        const cosR = Math.cos(rotRad);
        const sinR = Math.sin(rotRad);
        const rotX = scaledX * cosR - scaledY * sinR;
        const rotY = scaledX * sinR + scaledY * cosR;

        const basis = computeCameraBasis(camera);
        entity.worldPosition = [
          ownerEntity.worldPosition[0] + rotX * basis.right[0] + rotY * basis.up[0] - 1e-3 * basis.forward[0],
          ownerEntity.worldPosition[1] + rotX * basis.right[1] + rotY * basis.up[1] - 1e-3 * basis.forward[1],
          ownerEntity.worldPosition[2] + rotX * basis.right[2] + rotY * basis.up[2] - 1e-3 * basis.forward[2]
        ];
        entity.scale = [
          Math.sign(ownerEntity.scale[0] || 1) * Math.abs(entity.scale[0]),
          entity.scale[1]
        ];
        // Enforce upright prop orientation against gravity unless inheritSocketRotation is set
        entity.worldRotationZDegrees = 0;
      }
    }

    return {
      frameIndex,
      timeSeconds,
      shotId: shot.id,
      camera,
      palette: shot.palette,
      audio,
      lyric,
      entities,
      ...(transitionOverlayOpacity !== undefined ? { transitionOverlayOpacity } : {})
    };
  }
}
