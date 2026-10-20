import type {
  DirectorStoryboardContract,
  CinematicShot
} from '../../schemas/storyboard.contract.js';
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
import { ChoreographySystem, evaluateEntityTrack } from './choreography.js';
import { samplePoseTrack, evaluateSecondaryMotion } from '../rigging/deformer.js';

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
    for (const lyric of this.audioManifest.lyrics) {
      const start = lyric.frameRange.startFrameInclusive;
      const end = lyric.frameRange.endFrameExclusive;
      if (frameIndex >= start && frameIndex < end) {
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

    // 2. Base interpolated camera
    const baseCamera = this.sequencer.interpolateCamera(shot, normalizedProgress);

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
    for (const rigId of shot.activeRigIds) {
      const rig = this.rigs.get(rigId);
      if (!rig) continue;

      const track = this.choreoSystem.getTrack(shot.id, rigId);

      if (track) {
        const trackState = evaluateEntityTrack(track, frameIndex, fps, this.getAudioFeature);
        const poseResult = samplePoseTrack(
          rig,
          frameIndex,
          shot.frameRange.startFrameInclusive,
          trackState.timeScale,
          trackState.startPoseFrame
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

    return {
      frameIndex,
      timeSeconds,
      shotId: shot.id,
      camera,
      palette: shot.palette,
      audio,
      lyric,
      entities
    };
  }
}
