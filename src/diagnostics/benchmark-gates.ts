import { X264_MEMORY_PARAMS } from '../config/render-config.js';

export const HARD_RSS_LIMIT_MB = 400;
export const MIN_FPS = 15;

export interface GateIterationReport {
  iterNumber?: number;
  effectiveFps: number;
  peakAggregateRssMb: number;
  peakNodeRssMb?: number;
  peakChildRssMb?: number;
  preset?: string;
  threads?: number;
}

export interface GateEvaluationOptions {
  reports: GateIterationReport[];
  maxIterationRssThresholdMb?: number;
  medRssThresholdMb?: number;
  minFpsThreshold?: number;
  existingImageFiles?: string[];
}

export interface GateEvaluationResult {
  success: boolean;
  medianRss: number;
  medianFps: number;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Evaluates performance and memory gates across benchmark iterations.
 *
 * Rules:
 * 1. Hard constraint: NO single iteration may reach or exceed maxIterationRssThresholdMb (default 400 MB).
 * 2. Target constraint: Median aggregate RSS must remain below medRssThresholdMb (default 400 MB).
 * 3. Performance constraint: Median effective FPS must be at least minFpsThreshold (default 15 FPS).
 * 4. Artifact hygiene constraint: No temporary frame image files (.png/.svg) may exist on disk.
 */
export function evaluateSmokeBenchmarkGates(options: GateEvaluationOptions): GateEvaluationResult {
  const maxThreshold = options.maxIterationRssThresholdMb ?? HARD_RSS_LIMIT_MB;
  const thresholdRss = options.medRssThresholdMb ?? HARD_RSS_LIMIT_MB;
  const minFps = options.minFpsThreshold ?? MIN_FPS;

  // 1. Evaluate individual iterations: strictly reject any iteration >= maxThreshold
  for (let i = 0; i < options.reports.length; i++) {
    const report = options.reports[i];
    const iterNum = report.iterNumber ?? i + 1;
    if (report.peakAggregateRssMb >= maxThreshold) {
      const nodeRss = report.peakNodeRssMb !== undefined ? `${report.peakNodeRssMb.toFixed(2)} MB` : 'N/A';
      const childRss = report.peakChildRssMb !== undefined ? `${report.peakChildRssMb.toFixed(2)} MB` : 'N/A';
      const preset = report.preset ?? 'fast';
      const threads = report.threads ?? 2;
      throw new Error(
        `MEMORY GATE FAILED: Iteration ${iterNum} exceeded hard constraint of ${maxThreshold} MB!\n` +
          `  Iteration: ${iterNum}\n` +
          `  Node RSS: ${nodeRss}\n` +
          `  Child (FFmpeg) RSS: ${childRss}\n` +
          `  Aggregate RSS: ${report.peakAggregateRssMb.toFixed(2)} MB (Limit: < ${maxThreshold} MB)\n` +
          `  Preset: ${preset}\n` +
          `  Thread Count: ${threads}\n` +
          `  x264 Params: ${X264_MEMORY_PARAMS}`
      );
    }
  }

  const medRss = calculateMedian(options.reports.map((r) => r.peakAggregateRssMb));
  const medFps = calculateMedian(options.reports.map((r) => r.effectiveFps));

  if (medRss >= thresholdRss) {
    throw new Error(
      `MEMORY GATE FAILED: Median Peak Aggregate RSS (${medRss.toFixed(2)} MB) exceeded target limit of ${thresholdRss} MB! ` +
        `(Actual: ${medRss.toFixed(2)} MB, Target: < ${thresholdRss} MB)`
    );
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

  return { success: true, medianRss: medRss, medianFps: medFps };
}
