import fs from 'node:fs';
import path from 'node:path';
import {
  LyricLineSchema,
  type AudioFeatureReader,
  type AudioFrameFeature,
  type LyricLine
} from '../../schemas/audio.contract.js';

export const DEFAULT_MAX_LINE_DURATION_SECONDS = 8.0;
export const MAX_LRC_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB security limit

export interface ParseLrcOptions {
  /** Duration of the target audio timeline in seconds. */
  readonly songDurationSeconds: number;
  /** Video frame rate (30 or 60). */
  readonly fps: 30 | 60;
  /** Total video frames in the target render. */
  readonly totalFrames: number;
  /** Optional start offset in the source song (seconds) when slicing a clip. Default: 0. */
  readonly clipStartSeconds?: number;
  /** Maximum duration of a single lyric line before automatic cutoff. Default: 8.0s. */
  readonly maxLineDurationSeconds?: number;
  /** Optional audio feature reader or callback to compute acoustic emphasis per line. */
  readonly featureSource?: AudioFeatureReader | ((frameIndex: number) => AudioFrameFeature);
  /** Default emphasis when no `featureSource` is provided. Default: 0.75. */
  readonly defaultEmphasis?: number;
}

export interface ParsedLrcResult {
  readonly lyrics: LyricLine[];
  readonly emptyCutoffTimestamps: number[];
}

const METADATA_TAG_REGEX = /^\s*\[(?:ar|ti|al|au|length|by|offset|re|ve):[^\]]*\]\s*$/i;
const TIMESTAMP_GLOBAL_REGEX = /\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function resolveFeatureGetter(
  source?: AudioFeatureReader | ((frameIndex: number) => AudioFrameFeature)
): ((frameIndex: number) => AudioFrameFeature) | undefined {
  if (!source) return undefined;
  if (typeof source === 'function') return source;
  return (f: number) => source.getFrameFeature(f);
}

/**
 * Computes deterministic vocal/lyric emphasis in [0, 1] over [startFrame, endFrame)
 * using weighted mean of `rmsRelativeGlobal` (0.5), `mid` (0.3), and `presence` (0.2).
 */
export function computeLyricEmphasis(
  startFrameInclusive: number,
  endFrameExclusive: number,
  totalFrames: number,
  getFeature?: (frameIndex: number) => AudioFrameFeature,
  defaultEmphasis = 0.75
): number {
  if (!getFeature) {
    return clamp01(defaultEmphasis);
  }
  const start = Math.max(0, Math.min(totalFrames - 1, startFrameInclusive));
  const end = Math.max(start + 1, Math.min(totalFrames, endFrameExclusive));
  let sum = 0;
  let count = 0;
  for (let f = start; f < end; f++) {
    const feat = getFeature(f);
    const score =
      0.5 * feat.rmsRelativeGlobal +
      0.3 * feat.bands.mid +
      0.2 * feat.bands.presence;
    sum += score;
    count++;
  }
  return count > 0 ? clamp01(Number((sum / count).toFixed(4))) : clamp01(defaultEmphasis);
}

/**
 * Parses raw `.lrc` content into sorted, non-overlapping `LyricLine` contracts.
 *
 * Features:
 * 1. Strips metadata header tags (`[ar:...]`, `[ti:...]`, `[al:...]`, `[au:...]`, `[length:...]`, `[by:...]`).
 * 2. Expands multi-timestamp chorus lines (`[00:49.28][03:00.58] Lyric text`) into chronological entries.
 * 3. Records empty timestamp markers (`[00:00.00][00:46.66][00:59.40]`) as structural instrumental cutoffs.
 * 4. Truncates each line's end time at `min(nextLyricStartTime, nextEmptyCutoff, startTime + maxLineDuration, songDuration)`.
 */
export function parseLrcContent(rawLrc: string, options: ParseLrcOptions): ParsedLrcResult {
  const {
    songDurationSeconds,
    fps,
    totalFrames,
    clipStartSeconds = 0,
    maxLineDurationSeconds = DEFAULT_MAX_LINE_DURATION_SECONDS,
    featureSource,
    defaultEmphasis = 0.75
  } = options;

  if (!Number.isFinite(songDurationSeconds) || songDurationSeconds <= 0) {
    throw new Error(`Invalid songDurationSeconds: ${songDurationSeconds}`);
  }
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) {
    throw new Error(`Invalid totalFrames: ${totalFrames}`);
  }

  // 1. Extract [offset: +/- ms] tag if present
  let offsetSeconds = 0;
  const offsetMatch = /\[offset:\s*([+-]?\d+)\s*\]/i.exec(rawLrc);
  if (offsetMatch && offsetMatch[1] !== undefined) {
    const offsetMs = Number.parseInt(offsetMatch[1], 10);
    if (Number.isFinite(offsetMs)) {
      offsetSeconds = offsetMs / 1000.0;
    }
  }

  const rawCandidates: Array<{ absStartTime: number; text: string; lineOrder: number }> = [];
  const rawAbsCutoffs: number[] = [];

  const lines = rawLrc.split(/\r?\n/);
  let lineOrder = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || METADATA_TAG_REGEX.test(trimmed)) {
      continue;
    }

    const timestamps: number[] = [];
    TIMESTAMP_GLOBAL_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TIMESTAMP_GLOBAL_REGEX.exec(trimmed)) !== null) {
      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseFloat(match[2]);
      if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
        const absSeconds = minutes * 60 + seconds + offsetSeconds;
        timestamps.push(absSeconds);
      }
    }

    if (timestamps.length === 0) {
      continue;
    }

    // Extract lyric body by removing all [mm:ss.xx] tags
    const text = trimmed.replace(TIMESTAMP_GLOBAL_REGEX, '').trim();

    if (text.length === 0) {
      for (const t of timestamps) {
        rawAbsCutoffs.push(Number(t.toFixed(4)));
      }
    } else {
      for (const t of timestamps) {
        rawCandidates.push({
          absStartTime: t,
          text,
          lineOrder: lineOrder++
        });
      }
    }
  }

  // Sort candidate lyrics chronologically by absolute time
  rawCandidates.sort((a, b) => {
    if (Math.abs(a.absStartTime - b.absStartTime) > 1e-6) {
      return a.absStartTime - b.absStartTime;
    }
    return a.lineOrder - b.lineOrder;
  });

  // Sort empty cutoffs ascending and deduplicate
  rawAbsCutoffs.sort((a, b) => a - b);
  const deduplicatedCutoffs: number[] = [];
  for (const c of rawAbsCutoffs) {
    if (
      deduplicatedCutoffs.length === 0 ||
      Math.abs(c - deduplicatedCutoffs[deduplicatedCutoffs.length - 1]) > 1e-4
    ) {
      deduplicatedCutoffs.push(c);
    }
  }

  const clipEndSeconds = clipStartSeconds + songDurationSeconds;
  const minCutoffDelta = 1 / fps;

  // Process candidates: determine absolute end times and filter/clip to clip window
  interface PreprocessedLyric {
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
  }
  const preprocessed: PreprocessedLyric[] = [];

  for (let i = 0; i < rawCandidates.length; i++) {
    const cand = rawCandidates[i];
    const nextCandAbs =
      i + 1 < rawCandidates.length ? rawCandidates[i + 1].absStartTime : Number.POSITIVE_INFINITY;

    let nextCutoffAbs = Number.POSITIVE_INFINITY;
    for (const c of deduplicatedCutoffs) {
      if (c > cand.absStartTime + minCutoffDelta) {
        nextCutoffAbs = c;
        break;
      }
    }

    const absEndTime = Math.min(
      nextCandAbs,
      nextCutoffAbs,
      cand.absStartTime + maxLineDurationSeconds
    );

    // Filter against clip window:
    if (absEndTime <= clipStartSeconds || cand.absStartTime >= clipEndSeconds) {
      continue;
    }

    // Clip bounds if line started before clipStartSeconds or ends after clipEndSeconds
    const effectiveStartAbs = Math.max(clipStartSeconds, cand.absStartTime);
    const effectiveEndAbs = Math.min(clipEndSeconds, absEndTime);

    if (effectiveEndAbs > effectiveStartAbs) {
      preprocessed.push({
        startTimeSeconds: Number((effectiveStartAbs - clipStartSeconds).toFixed(4)),
        endTimeSeconds: Number((effectiveEndAbs - clipStartSeconds).toFixed(4)),
        text: cand.text
      });
    }
  }

  // Relative empty cutoffs inside the clip window
  const emptyCutoffTimestamps: number[] = [];
  for (const c of deduplicatedCutoffs) {
    const rel = c - clipStartSeconds;
    if (rel >= 0 && rel <= songDurationSeconds) {
      emptyCutoffTimestamps.push(Number(rel.toFixed(4)));
    }
  }

  // Deduplicate candidates that land on the exact same start frame (keep first)
  const deduplicated: Array<{
    startFrame: number;
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
  }> = [];

  for (const item of preprocessed) {
    const startFrame = Math.max(0, Math.min(totalFrames - 1, Math.round(item.startTimeSeconds * fps)));
    if (
      deduplicated.length > 0 &&
      deduplicated[deduplicated.length - 1].startFrame >= startFrame
    ) {
      continue;
    }
    deduplicated.push({
      startFrame,
      startTimeSeconds: item.startTimeSeconds,
      endTimeSeconds: item.endTimeSeconds,
      text: item.text
    });
  }

  const getFeature = resolveFeatureGetter(featureSource);
  const lyrics: LyricLine[] = [];

  for (let i = 0; i < deduplicated.length; i++) {
    const current = deduplicated[i];
    const nextStartFrame =
      i + 1 < deduplicated.length ? deduplicated[i + 1].startFrame : totalFrames;

    const startFrameInclusive = current.startFrame;
    const unclampedEndFrame = Math.round(current.endTimeSeconds * fps);
    const maxAllowedEndFrame = Math.min(totalFrames, nextStartFrame);
    const endFrameExclusive = Math.max(
      startFrameInclusive + 1,
      Math.min(maxAllowedEndFrame, unclampedEndFrame)
    );

    if (endFrameExclusive <= startFrameInclusive || startFrameInclusive >= totalFrames) {
      continue;
    }

    // Align startTimeSeconds and endTimeSeconds with quantized frame boundaries within <= 1 frame
    const alignedStartSeconds = Number((startFrameInclusive / fps).toFixed(4));
    const alignedEndSeconds = Number((endFrameExclusive / fps).toFixed(4));
    const startTimeSeconds =
      Math.abs(Math.round(current.startTimeSeconds * fps) - startFrameInclusive) <= 1
        ? Number(current.startTimeSeconds.toFixed(4))
        : alignedStartSeconds;
    const candidateEndSeconds =
      Math.abs(Math.round(current.endTimeSeconds * fps) - endFrameExclusive) <= 1 &&
      current.endTimeSeconds > startTimeSeconds
        ? Number(current.endTimeSeconds.toFixed(4))
        : alignedEndSeconds;
    const endTimeSeconds =
      candidateEndSeconds > startTimeSeconds
        ? candidateEndSeconds
        : Number((startTimeSeconds + 1 / fps).toFixed(4));

    const emphasis = computeLyricEmphasis(
      startFrameInclusive,
      endFrameExclusive,
      totalFrames,
      getFeature,
      defaultEmphasis
    );

    const lyricLine: LyricLine = LyricLineSchema.parse({
      id: `lyric-${lyrics.length}`,
      frameRange: {
        startFrameInclusive,
        endFrameExclusive
      },
      startTimeSeconds,
      endTimeSeconds,
      text: current.text,
      emphasis
    });

    lyrics.push(lyricLine);
  }

  return {
    lyrics,
    emptyCutoffTimestamps
  };
}

/**
 * Normalizes Windows drive paths (e.g. `C:\Users\...`) to WSL `/mnt/<drive>/...` paths when
 * running on Linux/WSL2, then resolves to an absolute path.
 */
export function resolveCrossPlatformPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (process.platform === 'linux') {
    const winDriveMatch = /^([A-Za-z]):[\\/](.*)$/.exec(trimmed);
    if (winDriveMatch) {
      const driveLetter = winDriveMatch[1].toLowerCase();
      const restPath = winDriveMatch[2].replace(/\\/g, '/');
      return path.resolve(`/mnt/${driveLetter}/${restPath}`);
    }
  }
  return path.resolve(trimmed);
}

/**
 * Reads an `.lrc` file from disk (enforcing a 2 MiB size cap) and parses it into
 * frame-accurate `LyricLine` contracts.
 */
export function parseLrcFile(lrcFilePath: string, options: ParseLrcOptions): ParsedLrcResult {
  const resolved = resolveCrossPlatformPath(lrcFilePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`LRC path is not a regular file: "${resolved}"`);
  }
  if (stat.size > MAX_LRC_FILE_BYTES) {
    throw new Error(`LRC file exceeds maximum allowed size (${stat.size} bytes)`);
  }
  const content = fs.readFileSync(resolved, 'utf8');
  return parseLrcContent(content, options);
}
