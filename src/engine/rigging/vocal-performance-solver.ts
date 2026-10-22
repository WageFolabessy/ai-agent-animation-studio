import type { NormalizedCubicBezierSegment, NormalizedMorphTarget } from '../../schemas/rig.contract.js';
import type { MorphKeyframeItem } from '../../schemas/choreography.contract.js';
import type { EmotionalTone } from '../../schemas/story-spec.contract.js';

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
}

export const BASE_MOUTH_REST_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.2, 0.0], p1: [-1.5, 0.35], p2: [1.5, 0.35], p3: [3.2, 0.0] },
  { p0: [3.2, 0.0], p1: [1.5, -0.35], p2: [-1.5, -0.35], p3: [-3.2, 0.0] }
];

export const MOUTH_OPEN_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.5, 0.3], p1: [-1.6, 1.45], p2: [1.6, 1.45], p3: [3.5, 0.3] },
  { p0: [3.5, 0.3], p1: [1.6, -1.75], p2: [-1.6, -1.75], p3: [-3.5, 0.3] }
];

export const MOUTH_OPEN_O_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-2.2, 0.15], p1: [-1.1, 1.55], p2: [1.1, 1.55], p3: [2.2, 0.15] },
  { p0: [2.2, 0.15], p1: [1.1, -1.65], p2: [-1.1, -1.65], p3: [-2.2, 0.15] }
];

export const MOUTH_WIDE_A_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.6, 0.35], p1: [-1.8, 1.65], p2: [1.8, 1.65], p3: [3.6, 0.35] },
  { p0: [3.6, 0.35], p1: [1.8, -1.95], p2: [-1.8, -1.95], p3: [-3.6, 0.35] }
];

export const MOUTH_SMILE_SEGMENTS: NormalizedCubicBezierSegment[] = [
  { p0: [-3.5, 0.55], p1: [-1.5, 0.15], p2: [1.5, 0.15], p3: [3.5, 0.55] },
  { p0: [3.5, 0.55], p1: [1.5, -0.55], p2: [-1.5, -0.55], p3: [-3.5, 0.55] }
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

  for (const line of overlappingLyrics) {
    const lStart = Math.max(shotStartFrame, line.frameRange.startFrameInclusive);
    const lEnd = Math.min(shotEndFrame - 1, line.frameRange.endFrameExclusive - 1);
    const spanFrames = lEnd - lStart;
    if (spanFrames < 3) continue;

    const syllables = extractSyllables(line.text);
    if (syllables.length === 0) continue;

    const emphasis = line.emphasis ?? 0.7;
    const peakWeight = Math.min(0.95, 0.65 + 0.25 * emphasis);
    const step = Math.max(3, Math.floor(spanFrames / syllables.length));

    // Closed mouth right before lyric line begins
    appendStrictlyAscendingKeyframes(wideAKeys, lStart, 0, shotStartFrame, shotEndFrame);
    appendStrictlyAscendingKeyframes(openOKeys, lStart, 0, shotStartFrame, shotEndFrame);

    for (let s = 0; s < syllables.length; s++) {
      const syl = syllables[s];
      const sylStart = lStart + s * step;
      const sylPeak = sylStart + Math.max(1, Math.floor(step * 0.45));
      const sylClose = sylStart + Math.max(2, step - 1);

      if (sylPeak >= lEnd) break;

      if (syl.isRoundedVowel) {
        appendStrictlyAscendingKeyframes(
          openOKeys,
          sylPeak,
          peakWeight,
          shotStartFrame,
          shotEndFrame
        );
        appendStrictlyAscendingKeyframes(openOKeys, sylClose, 0.05, shotStartFrame, shotEndFrame);
        appendStrictlyAscendingKeyframes(wideAKeys, sylPeak, 0.1, shotStartFrame, shotEndFrame);
      } else {
        appendStrictlyAscendingKeyframes(
          wideAKeys,
          sylPeak,
          peakWeight,
          shotStartFrame,
          shotEndFrame
        );
        appendStrictlyAscendingKeyframes(wideAKeys, sylClose, 0.05, shotStartFrame, shotEndFrame);
        appendStrictlyAscendingKeyframes(openOKeys, sylPeak, 0.1, shotStartFrame, shotEndFrame);
      }
    }

    // Close mouth at end of lyric line
    appendStrictlyAscendingKeyframes(wideAKeys, lEnd, 0, shotStartFrame, shotEndFrame);
    appendStrictlyAscendingKeyframes(openOKeys, lEnd, 0, shotStartFrame, shotEndFrame);
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
