import type { NormalizedCubicBezierSegment, NormalizedMorphTarget } from '../../schemas/rig.contract.js';
import type { MorphKeyframeItem } from '../../schemas/choreography.contract.js';
import type { EmotionalTone } from '../../schemas/story-spec.contract.js';
import type { AudioFrameFeature } from '../../schemas/audio.contract.js';

export interface VocalLyricSpan {
  readonly id?: string;
  readonly text: string;
  readonly emphasis?: number;
  readonly frameRange: {
    readonly startFrameInclusive: number;
    readonly endFrameExclusive: number;
  };
}

export interface VocalPerformanceSolveOptions {
  readonly lyrics?: readonly VocalLyricSpan[];
  readonly shotStartFrame: number;
  readonly shotEndFrame: number;
  readonly emotionalTone?: EmotionalTone;
  readonly availableTargets: ReadonlySet<string>;
  readonly getAudioFeatureAtFrame?: (f: number) => AudioFrameFeature;
}

export const VOCAL_GATE_OPEN_THRESHOLD = 0.18;
export const VOCAL_GATE_CLOSE_THRESHOLD = 0.10;
export const VOCAL_AMPLITUDE_MIN = 0.70;
export const VOCAL_AMPLITUDE_MAX = 1.00;

export function computeVocalBandActivity(feat: AudioFrameFeature): number {
  return 0.45 * feat.bands.mid + 0.35 * feat.bands.highMid + 0.20 * feat.bands.presence;
}

export const BASE_MOUTH_REST_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.2, 0.0], p1: [-1.5, 0.15], p2: [1.5, 0.15], p3: [3.2, 0.0] },
  { p0: [3.2, 0.0], p1: [1.5, -0.15], p2: [-1.5, -0.15], p3: [-3.2, 0.0] }
];

export const MOUTH_OPEN_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.5, 0.4], p1: [-1.6, 2.0], p2: [1.6, 2.0], p3: [3.5, 0.4] },
  { p0: [3.5, 0.4], p1: [1.6, -2.6], p2: [-1.6, -2.6], p3: [-3.5, 0.4] }
];

export const MOUTH_OPEN_O_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-2.2, 0.2], p1: [-1.1, 2.4], p2: [1.1, 2.4], p3: [2.2, 0.2] },
  { p0: [2.2, 0.2], p1: [1.1, -2.5], p2: [-1.1, -2.5], p3: [-2.2, 0.2] }
];

export const MOUTH_WIDE_A_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-4.2, 0.4], p1: [-2.0, 2.5], p2: [2.0, 2.5], p3: [4.2, 0.4] },
  { p0: [4.2, 0.4], p1: [2.0, -3.2], p2: [-2.0, -3.2], p3: [-4.2, 0.4] }
];

export const MOUTH_SMILE_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.8, 1.0], p1: [-1.5, 0.4], p2: [1.5, 0.4], p3: [3.8, 1.0] },
  { p0: [3.8, 1.0], p1: [1.5, -0.4], p2: [-1.5, -0.4], p3: [-3.8, 1.0] }
];

export const BROW_RAISE_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.4, 0.25], p1: [-1.5, 0.85], p2: [1.5, 0.85], p3: [3.4, 0.25] },
  { p0: [3.4, 0.25], p1: [1.5, -0.25], p2: [-1.5, -0.25], p3: [-3.4, 0.25] }
];

export const BROW_FURROW_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.3, -0.15], p1: [-1.2, -0.65], p2: [1.2, -0.65], p3: [3.3, -0.15] },
  { p0: [3.3, -0.15], p1: [1.2, -0.85], p2: [-1.2, -0.85], p3: [-3.3, -0.15] }
];

export const BLINK_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.2, 0.0], p1: [-1.4, 0.12], p2: [1.4, 0.12], p3: [3.2, 0.0] },
  { p0: [3.2, 0.0], p1: [1.4, -0.12], p2: [-1.4, -0.12], p3: [-3.2, 0.0] }
];

export const CANONICAL_BIPED_MORPH_TARGETS: NormalizedMorphTarget[] = [
  { name: 'mouthOpen', segments: MOUTH_OPEN_SEGMENTS },
  { name: 'mouth_open_o', segments: MOUTH_OPEN_O_SEGMENTS },
  { name: 'mouth_wide_a', segments: MOUTH_WIDE_A_SEGMENTS },
  { name: 'mouth_smile', segments: MOUTH_SMILE_SEGMENTS },
  { name: 'browRaise', segments: BROW_RAISE_SEGMENTS },
  { name: 'browFurrow', segments: BROW_FURROW_SEGMENTS },
  { name: 'blink', segments: BLINK_SEGMENTS }
];

interface SyllableToken {
  readonly text: string;
  readonly isRoundedVowel: boolean;
}

function extractSyllables(lineText: string): SyllableToken[] {
  const cleaned = lineText.toLowerCase().replace(/[^a-z\s]/g, ' ').trim();
  if (!cleaned) return [];

  const vowelMatches = cleaned.match(/[aeiouy]+/g);
  if (!vowelMatches || vowelMatches.length === 0) {
    return [{ text: cleaned, isRoundedVowel: false }];
  }

  return vowelMatches.slice(0, 12).map((vowelGroup) => ({
    text: vowelGroup,
    isRoundedVowel: vowelGroup.includes('o') || vowelGroup.includes('u')
  }));
}

function appendStrictlyAscendingKeyframes(
  list: MorphKeyframeItem[],
  candidateFrame: number,
  weight: number,
  shotStartFrame: number,
  shotEndFrame: number
): void {
  const clampedFrame = Math.floor(candidateFrame);
  if (clampedFrame < shotStartFrame || clampedFrame >= shotEndFrame) return;

  const clampedWeight = Number(Math.max(0, Math.min(1, weight)).toFixed(3));
  if (list.length === 0) {
    list.push({ frame: clampedFrame, weight: clampedWeight });
    return;
  }

  const last = list[list.length - 1];
  if (clampedFrame > last.frame) {
    list.push({ frame: clampedFrame, weight: clampedWeight });
  } else if (clampedFrame === last.frame) {
    // Keep the stronger articulation at the same frame
    if (clampedWeight > last.weight) {
      list[list.length - 1] = { frame: clampedFrame, weight: clampedWeight };
    }
  }
}

/**
 * Deterministically synthesizes phoneme-aligned lip-sync and emotional facial morph keyframes
 * from LRC lyric spans and section emotional tone (Pillar 3 of Theatrical Narrative Architecture).
 */
export function synthesizeVocalPerformanceKeyframes(
  options: VocalPerformanceSolveOptions
): Record<string, MorphKeyframeItem[]> {
  const {
    lyrics = [],
    shotStartFrame,
    shotEndFrame,
    emotionalTone = 'reflective',
    availableTargets
  } = options;

  const result: Record<string, MorphKeyframeItem[]> = {};
  if (shotEndFrame <= shotStartFrame) return result;

  const wideAKeys: MorphKeyframeItem[] = [];
  const openOKeys: MorphKeyframeItem[] = [];
  const smileKeys: MorphKeyframeItem[] = [];
  const furrowKeys: MorphKeyframeItem[] = [];

  // 1. Emotional baseline expression across the shot
  if (
    (emotionalTone === 'tender' || emotionalTone === 'euphoric') &&
    availableTargets.has('mouth_smile')
  ) {
    appendStrictlyAscendingKeyframes(smileKeys, shotStartFrame, 0.45, shotStartFrame, shotEndFrame);
    appendStrictlyAscendingKeyframes(
      smileKeys,
      shotEndFrame - 1,
      0.45,
      shotStartFrame,
      shotEndFrame
    );
  }

  if (
    (emotionalTone === 'defiant' ||
      emotionalTone === 'menacing' ||
      emotionalTone === 'melancholic') &&
    availableTargets.has('browFurrow')
  ) {
    appendStrictlyAscendingKeyframes(
      furrowKeys,
      shotStartFrame,
      0.55,
      shotStartFrame,
      shotEndFrame
    );
    appendStrictlyAscendingKeyframes(
      furrowKeys,
      shotEndFrame - 1,
      0.55,
      shotStartFrame,
      shotEndFrame
    );
  }

  // 2. Syllable-level phoneme articulation for overlapping lyrics
  const overlappingLyrics = lyrics.filter(
    (l) =>
      l.frameRange.endFrameExclusive > shotStartFrame &&
      l.frameRange.startFrameInclusive < shotEndFrame
  );

  const getAudioFeatureAtFrame = options.getAudioFeatureAtFrame;

  for (const line of overlappingLyrics) {
    const lStart = Math.max(shotStartFrame, line.frameRange.startFrameInclusive);
    const lEnd = Math.min(shotEndFrame - 1, line.frameRange.endFrameExclusive - 1);
    const spanFrames = lEnd - lStart;
    if (spanFrames < 2) continue;

    const syllables = extractSyllables(line.text);
    if (syllables.length === 0) continue;

    // Natural syllable cadence: each syllable spans 4 to 9 frames at 30 fps (~130ms to 300ms)
    // The sung phrase does not artificially stretch over trailing instrumental gaps
    const framesPerSyllable = Math.max(4, Math.min(9, Math.floor(spanFrames / syllables.length)));
    const sungDuration = Math.min(spanFrames, syllables.length * framesPerSyllable);
    const sungEndFrame = lStart + sungDuration;

    const emphasis = line.emphasis ?? 0.7;
    const basePeakWeight = Math.min(0.95, 0.70 + 0.25 * emphasis);

    // Closed mouth before lyric line starts
    appendStrictlyAscendingKeyframes(wideAKeys, lStart, 0, shotStartFrame, shotEndFrame);
    appendStrictlyAscendingKeyframes(openOKeys, lStart, 0, shotStartFrame, shotEndFrame);

    let gateState = false;

    for (let s = 0; s < syllables.length; s++) {
      const syl = syllables[s];
      const sylStart = lStart + s * framesPerSyllable;
      const sylPeak = sylStart + Math.max(1, Math.floor(framesPerSyllable * 0.45));
      const sylClose = sylStart + Math.max(2, framesPerSyllable - 1);

      if (sylPeak >= lEnd) break;

      let peakWeight = basePeakWeight;
      let isGatedOpen = true;

      if (getAudioFeatureAtFrame) {
        const feat = getAudioFeatureAtFrame(sylPeak);
        const activity = computeVocalBandActivity(feat);
        if (!gateState && activity >= VOCAL_GATE_OPEN_THRESHOLD) {
          gateState = true;
        } else if (gateState && activity < VOCAL_GATE_CLOSE_THRESHOLD) {
          gateState = false;
        }
        isGatedOpen = gateState;
        if (isGatedOpen) {
          const normAct = Math.max(0, Math.min(1, (activity - VOCAL_GATE_CLOSE_THRESHOLD) / 0.35));
          const ampScale = VOCAL_AMPLITUDE_MIN + (VOCAL_AMPLITUDE_MAX - VOCAL_AMPLITUDE_MIN) * normAct;
          peakWeight = Number((basePeakWeight * ampScale).toFixed(3));
        } else {
          peakWeight = 0;
        }
      }

      if (isGatedOpen && peakWeight > 0) {
        if (syl.isRoundedVowel) {
          appendStrictlyAscendingKeyframes(openOKeys, sylPeak, peakWeight, shotStartFrame, shotEndFrame);
          appendStrictlyAscendingKeyframes(openOKeys, sylClose, 0.04, shotStartFrame, shotEndFrame);
          appendStrictlyAscendingKeyframes(wideAKeys, sylPeak, 0.08, shotStartFrame, shotEndFrame);
        } else {
          appendStrictlyAscendingKeyframes(wideAKeys, sylPeak, peakWeight, shotStartFrame, shotEndFrame);
          appendStrictlyAscendingKeyframes(wideAKeys, sylClose, 0.04, shotStartFrame, shotEndFrame);
          appendStrictlyAscendingKeyframes(openOKeys, sylPeak, 0.08, shotStartFrame, shotEndFrame);
        }
      } else {
        appendStrictlyAscendingKeyframes(wideAKeys, sylPeak, 0, shotStartFrame, shotEndFrame);
        appendStrictlyAscendingKeyframes(openOKeys, sylPeak, 0, shotStartFrame, shotEndFrame);
      }
    }

    // Explicitly close mouth at the end of the sung syllables
    appendStrictlyAscendingKeyframes(wideAKeys, sungEndFrame, 0, shotStartFrame, shotEndFrame);
    appendStrictlyAscendingKeyframes(openOKeys, sungEndFrame, 0, shotStartFrame, shotEndFrame);

    // Ensure mouth remains closed through the entire trailing gap up to lEnd
    if (lEnd > sungEndFrame) {
      appendStrictlyAscendingKeyframes(wideAKeys, lEnd, 0, shotStartFrame, shotEndFrame);
      appendStrictlyAscendingKeyframes(openOKeys, lEnd, 0, shotStartFrame, shotEndFrame);
    }
  }

  if (wideAKeys.length > 0 && availableTargets.has('mouth_wide_a')) {
    result.mouth_wide_a = wideAKeys;
  }
  if (openOKeys.length > 0 && availableTargets.has('mouth_open_o')) {
    result.mouth_open_o = openOKeys;
  }
  if (smileKeys.length > 0 && availableTargets.has('mouth_smile')) {
    result.mouth_smile = smileKeys;
  }
  if (furrowKeys.length > 0 && availableTargets.has('browFurrow')) {
    result.browFurrow = furrowKeys;
  }

  return result;
}
