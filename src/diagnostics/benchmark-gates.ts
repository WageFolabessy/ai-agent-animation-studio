import { X264_MEMORY_PARAMS } from '../config/render-config.js';

/** Aggregate (Node + FFmpeg) peak RSS at or above this value is reported as a WARNING. */
export const MEMORY_TARGET_MB = 400;
/** Aggregate peak RSS strictly above this value FAILS the gate. */
export const MEMORY_HARD_FAIL_MB = 600;
export const MIN_FPS = 15;

/** Plateau rule: growth between the short and long run may not exceed `max(32 MB, 10 % of short)`. */
export const PLATEAU_MIN_ALLOWED_GROWTH_MB = 32;
export const PLATEAU_ALLOWED_GROWTH_FRACTION = 0.1;

export interface GateIterationReport {
  iterNumber?: number;
  effectiveFps: number;
  peakAggregateRssMb: number;
  peakNodeRssMb?: number;
  peakChildRssMb?: number;
  preset?: string;
  threads?: number;
}

export interface PeakAtFrameCount {
  frames: number;
  peakAggregateRssMb: number;
}

export interface PlateauMeasurement {
  /** Peak measured for the short run. */
  short: PeakAtFrameCount;
  /** Peak measured for a longer run (at least twice as many frames). */
  long: PeakAtFrameCount;
}

export interface GateEvaluationOptions {
  reports: GateIterationReport[];
  plateau?: PlateauMeasurement;
  minFpsThreshold?: number;
  existingImageFiles?: string[];
}

export interface PlateauResult {
  shortFrames: number;
  longFrames: number;
  shortPeakMb: number;
  longPeakMb: number;
  growthMb: number;
  allowedMb: number;
}

export interface GateEvaluationResult {
  success: boolean;
  status: 'pass' | 'pass_with_warnings';
  medianRss: number;
  maxRss: number;
  medianFps: number;
  warnings: string[];
  plateau?: PlateauResult;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Evaluates performance and memory gates across benchmark iterations.
 *
 * Rules (the measured value is always reported, nothing is silently relaxed):
 * 1. Hard fail: any iteration whose aggregate RSS peak is strictly above `MEMORY_HARD_FAIL_MB` (600 MB).
 * 2. Warning: any iteration peak, or the median, at or above `MEMORY_TARGET_MB` (400 MB).
 * 3. Plateau: peak at a longer run may not exceed the short-run peak by more than
 *    `max(32 MB, 10 % of the short peak)`, otherwise a leak is suspected and the gate fails.
 * 4. Performance: median effective FPS must be at least `minFpsThreshold` (default 15).
 * 5. Artifact hygiene: no temporary frame image files (.png/.svg) may exist on disk.
 */
export function evaluateSmokeBenchmarkGates(options: GateEvaluationOptions): GateEvaluationResult {
  const minFps = options.minFpsThreshold ?? MIN_FPS;
  const warnings: string[] = [];

  for (let i = 0; i < options.reports.length; i++) {
    const report = options.reports[i];
    const iterNum = report.iterNumber ?? i + 1;

    if (report.peakAggregateRssMb > MEMORY_HARD_FAIL_MB) {
      const nodeRss = report.peakNodeRssMb !== undefined ? `${report.peakNodeRssMb.toFixed(2)} MB` : 'N/A';
      const childRss = report.peakChildRssMb !== undefined ? `${report.peakChildRssMb.toFixed(2)} MB` : 'N/A';
      const preset = report.preset ?? 'fast';
      const threads = report.threads ?? 2;
      throw new Error(
        `MEMORY GATE FAILED: Iteration ${iterNum} exceeded hard limit of ${MEMORY_HARD_FAIL_MB} MB!\n` +
          `  Iteration: ${iterNum}\n` +
          `  Node RSS: ${nodeRss}\n` +
          `  Child (FFmpeg) RSS: ${childRss}\n` +
          `  Aggregate RSS: ${report.peakAggregateRssMb.toFixed(2)} MB (Hard limit: <= ${MEMORY_HARD_FAIL_MB} MB)\n` +
          `  Preset: ${preset}\n` +
          `  Thread Count: ${threads}\n` +
          `  x264 Params: ${X264_MEMORY_PARAMS}`
      );
    }

    if (report.peakAggregateRssMb >= MEMORY_TARGET_MB) {
      warnings.push(
        `MEMORY TARGET WARNING: Iteration ${iterNum} peak aggregate RSS ${report.peakAggregateRssMb.toFixed(2)} MB ` +
          `is at or above the ${MEMORY_TARGET_MB} MB target (hard limit ${MEMORY_HARD_FAIL_MB} MB).`
      );
    }
  }

  const rssValues = options.reports.map((r) => r.peakAggregateRssMb);
  const medRss = calculateMedian(rssValues);
  const maxRss = rssValues.length > 0 ? Math.max(...rssValues) : 0;
  const medFps = calculateMedian(options.reports.map((r) => r.effectiveFps));

  if (medRss >= MEMORY_TARGET_MB) {
    warnings.push(
      `MEMORY TARGET WARNING: Median peak aggregate RSS ${medRss.toFixed(2)} MB ` +
        `is at or above the ${MEMORY_TARGET_MB} MB target (hard limit ${MEMORY_HARD_FAIL_MB} MB).`
    );
  }

  let plateauResult: PlateauResult | undefined;
  if (options.plateau) {
    const { short, long } = options.plateau;
    if (long.frames < short.frames * 2) {
      throw new Error(
        `PLATEAU GATE INVALID: the long run (${long.frames} frames) must have at least twice the frames of the short run (${short.frames}).`
      );
    }
    const growthMb = long.peakAggregateRssMb - short.peakAggregateRssMb;
    const allowedMb = Math.max(
      PLATEAU_MIN_ALLOWED_GROWTH_MB,
      PLATEAU_ALLOWED_GROWTH_FRACTION * short.peakAggregateRssMb
    );
    plateauResult = {
      shortFrames: short.frames,
      longFrames: long.frames,
      shortPeakMb: short.peakAggregateRssMb,
      longPeakMb: long.peakAggregateRssMb,
      growthMb,
      allowedMb
    };
    if (growthMb > allowedMb) {
      throw new Error(
        `MEMORY PLATEAU FAILED: peak aggregate RSS grew from ${short.peakAggregateRssMb.toFixed(2)} MB ` +
          `(${short.frames} frames) to ${long.peakAggregateRssMb.toFixed(2)} MB (${long.frames} frames): ` +
          `growth ${growthMb.toFixed(2)} MB exceeds allowed ${allowedMb.toFixed(2)} MB. A memory leak is suspected.`
      );
    }
  }

  if (medFps < minFps) {
    throw new Error(
      `PERFORMANCE GATE FAILED: Median FPS (${medFps.toFixed(2)}) is below minimum target of ${minFps} FPS!`
    );
  }

  const junk = options.existingImageFiles ?? [];
  if (junk.length > 0) {
    throw new Error(`ARTIFACT HYGIENE FAILED: Leaked temporary image files found on disk: ${junk.join(', ')}`);
  }

  return {
    success: true,
    status: warnings.length > 0 ? 'pass_with_warnings' : 'pass',
    medianRss: medRss,
    maxRss,
    medianFps: medFps,
    warnings,
    plateau: plateauResult
  };
}
