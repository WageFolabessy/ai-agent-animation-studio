import type { CameraTransform, Vec3 } from '../../schemas/primitives.schema.js';
import type { AudioFrameFeature } from '../../schemas/audio.contract.js';
import type { ColorLightingPalette } from '../../schemas/storyboard.contract.js';
import { computeCameraBasis } from '../camera/camera-3d.js';
import { evaluateExponentialDecayResponse } from '../math/spring.js';
import { valueNoise1D } from '../math/noise.js';

export interface CameraShakeOptions {
  seed?: number;
  fps?: number;
  tauDecaySeconds?: number;
}

/**
 * Fully deterministic trauma-based camera shake generator.
 * Computes camera translation along camera right/up axes and roll based on historical onset energy.
 */
export class CameraShakeSystem {
  private readonly seed: number;
  private readonly fps: number;
  private readonly tauDecaySeconds: number;

  constructor(options: CameraShakeOptions = {}) {
    this.seed = options.seed ?? 42;
    this.fps = options.fps ?? 30;
    this.tauDecaySeconds = options.tauDecaySeconds ?? 0.35;
  }

  /**
   * Applies trauma-based deterministic camera shake to the input camera transform.
   *
   * @param camera - The base interpolated camera transform for the frame.
   * @param frameIndex - The current frame index.
   * @param getAudioFeatureAtFrame - Function providing audio features for historical frames.
   * @param palette - The current active color lighting palette.
   * @returns A new non-degenerate CameraTransform with shake translation and roll applied.
   */
  public applyShake(
    camera: CameraTransform,
    frameIndex: number,
    getAudioFeatureAtFrame: (f: number) => AudioFrameFeature,
    palette: ColorLightingPalette
  ): CameraTransform {
    if (palette.audioReactiveGain <= 0) {
      return camera;
    }

    const getKick = (f: number): number => {
      const feat = getAudioFeatureAtFrame(f);
      const onset = feat.onsetStrength;
      const bass = feat.bands.bass;
      return Math.min(1, onset * (0.5 + 0.5 * bass) * 0.5 * palette.audioReactiveGain);
    };

    const trauma = Math.min(
      1,
      evaluateExponentialDecayResponse(frameIndex, this.fps, this.tauDecaySeconds, getKick)
    );

    if (trauma <= 1e-5) {
      return camera;
    }

    const shake = trauma * trauma;
    const basis = computeCameraBasis(camera);

    const distToTarget = Math.hypot(
      camera.target[0] - camera.position[0],
      camera.target[1] - camera.position[1],
      camera.target[2] - camera.position[2]
    );

    const maxTrans = Math.min(0.25 * distToTarget, 0.015 * distToTarget);
    const maxRoll = 2.5 * Math.min(1, palette.audioReactiveGain);

    const timeCoord = (frameIndex * 18) / this.fps;
    const nx = valueNoise1D(this.seed, 0, timeCoord);
    const ny = valueNoise1D(this.seed, 1, timeCoord);
    const nRoll = valueNoise1D(this.seed, 2, timeCoord);

    const deltaX = shake * maxTrans * nx;
    const deltaY = shake * maxTrans * ny;
    const deltaRoll = shake * maxRoll * nRoll;

    const offset: Vec3 = [
      deltaX * basis.right[0] + deltaY * basis.up[0],
      deltaX * basis.right[1] + deltaY * basis.up[1],
      deltaX * basis.right[2] + deltaY * basis.up[2]
    ];

    const newPos: Vec3 = [
      camera.position[0] + offset[0],
      camera.position[1] + offset[1],
      camera.position[2] + offset[2]
    ];

    const newTarget: Vec3 = [
      camera.target[0] + offset[0],
      camera.target[1] + offset[1],
      camera.target[2] + offset[2]
    ];

    const newRoll = Math.max(-180, Math.min(180, (camera.rollDegrees ?? 0) + deltaRoll));

    let shakenCam: CameraTransform;
    if (camera.projectionMode === 'perspective') {
      shakenCam = {
        ...camera,
        position: newPos,
        target: newTarget,
        rollDegrees: newRoll
      };
    } else {
      shakenCam = {
        ...camera,
        position: newPos,
        target: newTarget,
        rollDegrees: newRoll
      };
    }

    // Verify basis non-degeneracy
    computeCameraBasis(shakenCam);
    return shakenCam;
  }
}
