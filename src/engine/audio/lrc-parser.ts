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

  const rawCandidates: Array<{ timeSeconds: number; text: string; lineOrder: number }> = [];
  const rawCutoffs: number[] = [];

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
        const absSeconds = minutes * 60 + seconds;
        const relSeconds = absSeconds - clipStartSeconds;
        timestamps.push(relSeconds);
      }
    }

    if (timestamps.length === 0) {
      continue;
    }

    // Extract lyric body by removing all [mm:ss.xx] tags
    const text = trimmed.replace(TIMESTAMP_GLOBAL_REGEX, '').trim();

    if (text.length === 0) {
      for (const t of timestamps) {
        if (t >= 0 && t <= songDurationSeconds) {
          rawCutoffs.push(Number(t.toFixed(4)));
        }
      }
    } else {
      for (const t of timestamps) {
        if (t >= 0 && t < songDurationSeconds) {
          rawCandidates.push({
            timeSeconds: t,
            text,
            lineOrder: lineOrder++
          });
        }
      }
    }
  }

  // Sort empty cutoffs ascending and deduplicate
  rawCutoffs.sort((a, b) => a - b);
  const emptyCutoffTimestamps: number[] = [];
  for (const c of rawCutoffs) {
    if (
      emptyCutoffTimestamps.length === 0 ||
      Math.abs(c - emptyCutoffTimestamps[emptyCutoffTimestamps.length - 1]) > 1e-4
    ) {
      emptyCutoffTimestamps.push(c);
    }
  }

  // Sort candidate lyrics chronologically
  rawCandidates.sort((a, b) => {
    if (Math.abs(a.timeSeconds - b.timeSeconds) > 1e-6) {
      return a.timeSeconds - b.timeSeconds;
    }
    return a.lineOrder - b.lineOrder;
  });

  // Deduplicate candidates that land on the exact same start frame (keep first)
  const deduplicated: Array<{ startFrame: number; startTimeSeconds: number; text: string }> = [];
  for (const cand of rawCandidates) {
    const startFrame = Math.max(0, Math.min(totalFrames - 1, Math.round(cand.timeSeconds * fps)));
    if (
      deduplicated.length > 0 &&
      deduplicated[deduplicated.length - 1].startFrame >= startFrame
    ) {
      continue;
    }
    deduplicated.push({
      startFrame,
      startTimeSeconds: cand.timeSeconds,
      text: cand.text
    });
  }

  const getFeature = resolveFeatureGetter(featureSource);
  const minCutoffDelta = 1 / fps;
  const lyrics: LyricLine[] = [];

  for (let i = 0; i < deduplicated.length; i++) {
    const current = deduplicated[i];
    const nextStartTime =
      i + 1 < deduplicated.length ? deduplicated[i + 1].startTimeSeconds : Number.POSITIVE_INFINITY;
    const nextStartFrame =
      i + 1 < deduplicated.length ? deduplicated[i + 1].startFrame : totalFrames;

    // Find earliest empty-timestamp cutoff strictly after current.startTimeSeconds
    let nextEmptyCutoff = Number.POSITIVE_INFINITY;
    for (const cutoff of emptyCutoffTimestamps) {
      if (cutoff > current.startTimeSeconds + minCutoffDelta) {
        nextEmptyCutoff = cutoff;
        break;
      }
    }

    const rawEndTime = Math.min(
      nextStartTime,
      nextEmptyCutoff,
      current.startTimeSeconds + maxLineDurationSeconds,
      songDurationSeconds
    );

    const startFrameInclusive = current.startFrame;
    const unclampedEndFrame = Math.round(rawEndTime * fps);
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
      Math.abs(Math.round(rawEndTime * fps) - endFrameExclusive) <= 1 &&
      rawEndTime > startTimeSeconds
        ? Number(rawEndTime.toFixed(4))
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
