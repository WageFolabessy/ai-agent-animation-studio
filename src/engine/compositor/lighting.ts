import type { ColorLightingPalette } from '../../schemas/storyboard.contract.js';
import type { AudioFrameFeature } from '../../schemas/audio.contract.js';
import { mixHexColors, computeLitShadedColors } from '../math/color.js';
import { evaluateSpringResponse } from '../math/spring.js';
import type { SvgBuilder } from './svg-builder.js';

export interface LightingPulseResult {
  pulse: number;
  backdropTop: string;
  backdropBottom: string;
  haloOpacity: number;
  haloRadius: number;
  spotlightIntensity: number;
  hazeOpacity: number;
  strobeFlash: number;
}

/**
 * Computes continuous analytical lighting pulse and backdrop gradient colors.
 * pulse = clamp01(a*rms + b*bass + c*spring(onset)) * audioReactiveGain
 */
export function computeLightingPulse(
  frameIndex: number,
  fps: number,
  palette: ColorLightingPalette,
  getAudioFeatureAtFrame: (f: number) => AudioFrameFeature,
  onsetFrames: readonly number[] = []
): LightingPulseResult {
  const currentAudio = getAudioFeatureAtFrame(frameIndex);
  const onsetSet = onsetFrames.length > 0 ? new Set(onsetFrames) : null;

  const onsetSpring = evaluateSpringResponse(
    frameIndex,
    fps,
    0.7, // zeta
    14,  // omega
    (f) => {
      const featOnset = getAudioFeatureAtFrame(f).onsetStrength;
      const discreteImpulse = onsetSet?.has(f) ? 1.0 : 0.0;
      return Math.max(featOnset, discreteImpulse);
    }
  );

  const rawPulse =
    0.3 * currentAudio.rms +
    0.35 * currentAudio.bands.bass +
    0.35 * Math.min(1, onsetSpring);

  const pulse = Math.max(0, Math.min(1, rawPulse * palette.audioReactiveGain));

  const baseTop = palette.background;
  const baseBottom = mixHexColors(
    palette.background,
    palette.ambientLightColor,
    palette.ambientIntensity * 0.4
  );

  // Pulse tint towards accent
  const backdropTop = mixHexColors(baseTop, palette.accent, 0.25 * pulse);
  const backdropBottom = mixHexColors(baseBottom, palette.accent, 0.35 * pulse);

  const haloOpacity = 0.45 * pulse;
  const haloRadius = 150 + 100 * pulse;

  // Theatrical Stage Atmosphere (Pillar 3 & Stage 3)
  const spotlightIntensity = Math.max(0.15, Math.min(0.9, 0.25 + 0.65 * pulse));
  const hazeOpacity = Math.max(0.05, Math.min(0.28, 0.08 + 0.16 * currentAudio.bands.bass));
  const strobeFlash = onsetSpring > 0.68 ? Math.min(0.35, (onsetSpring - 0.68) * 1.05) : 0;

  return {
    pulse,
    backdropTop,
    backdropBottom,
    haloOpacity,
    haloRadius,
    spotlightIntensity,
    hazeOpacity,
    strobeFlash
  };
}

/**
 * Registers a shared 2-stop linear gradient oriented along the key light direction.
 */
export function registerKeyLightGradient(
  builder: SvgBuilder,
  id: string,
  baseColor: string,
  palette: ColorLightingPalette
): string {
  const { litColor, shadedColor } = computeLitShadedColors(baseColor, palette);

  const kx = palette.keyLightDirection[0];
  const ky = palette.keyLightDirection[1];
  const x1 = kx >= 0 ? 0 : 1;
  const y1 = ky >= 0 ? 0 : 1;
  const x2 = kx >= 0 ? 1 : 0;
  const y2 = ky >= 0 ? 1 : 0;

  builder.addLinearGradient(id, {
    x1,
    y1,
    x2,
    y2,
    stops: [
      { offset: 0, color: litColor },
      { offset: 1, color: shadedColor }
    ]
  });

  return id;
}
