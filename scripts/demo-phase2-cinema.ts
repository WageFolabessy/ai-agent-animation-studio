import fs from 'node:fs';
import path from 'node:path';
import { createRenderConfig } from '../src/config/render-config.js';
import { RenderPipeline } from '../src/renderer/pipeline.js';
import { PipelineMemorySampler } from '../src/diagnostics/memory-sampler.js';
import { TimingProfiler } from '../src/diagnostics/timing.js';
import {
  evaluateSmokeBenchmarkGates,
  MEMORY_HARD_FAIL_MB,
  MEMORY_TARGET_MB,
  MIN_FPS,
  type GateIterationReport
} from '../src/diagnostics/benchmark-gates.js';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';
import { probeVideo, assertBt709Tv } from '../src/diagnostics/ffprobe.js';
import { OUTPUT_DIR } from '../src/config/paths.js';
import {
  demoStoryboard,
  demoRigsMap,
  demoAudioManifest,
  DemoAudioFeatureReader,
  demoChoreography,
  getDemoEnvironment,
  DEMO_TOTAL_FRAMES,
  DEMO_ONSET_FRAMES,
  DEMO_FPS,
  DEMO_DURATION_SECONDS
} from '../src/demo/phase2-cinema/index.js';
import { validateProjectContracts, validateChoreography } from '../src/schemas/invariants.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor, type SceneBudgetStats } from '../src/engine/compositor/scene-compositor.js';

interface DemoIterationReport extends GateIterationReport {
  iterNumber: number;
  totalWallMs: number;
  effectiveFps: number;
  avgGenMs: number;
  p95GenMs: number;
  avgRasterMs: number;
  p95RasterMs: number;
  avgWriteMs: number;
  p95WriteMs: number;
  peakAggregateRssMb: number;
  peakNodeRssMb: number;
  peakChildRssMb: number;
  peakHeapUsedMb: number;
  peakExternalMb: number;
  peakArrayBuffersMb: number;
  outputBytes: number;
  ffprobeDuration: number;
}

async function main() {
  console.log('================================================================');
  console.log('   PHASE 2 PROCEDURAL CINEMA SEQUENCE BENCHMARK & DEMO RENDER   ');
  console.log('================================================================');

  const width = 1920;
  const height = 1080;
  const fps = DEMO_FPS;
  const totalFrames = DEMO_TOTAL_FRAMES;

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 1. Validate All Project and Choreography Contracts
  console.log('\n[0/5] Validating Project Contracts and Invariants...');
  const baseConfig = createRenderConfig({
    width,
    height,
    fps,
    pixelFormat: 'rgba',
    totalFrames,
    preset: 'veryfast',
    crf: 18,
    threads: 2
  });

  const projectValidation = validateProjectContracts(
    demoAudioManifest,
    demoStoryboard,
    baseConfig,
    demoRigsMap
  );
  if (!projectValidation.isValid) {
    console.error('Fatal / Error validation issues in project contracts:');
    console.error(JSON.stringify(projectValidation.errors, null, 2));
    process.exit(1);
  }

  const choreoValidation = validateChoreography(
    demoChoreography,
    demoStoryboard,
    demoRigsMap
  );
  if (!choreoValidation.isValid) {
    console.error('Fatal / Error validation issues in choreography contract:');
    console.error(JSON.stringify(choreoValidation.errors, null, 2));
    process.exit(1);
  }
  console.log('✓ Project contracts & choreography invariants validated successfully (0 errors/fatal).');

  // Initialize Audio Feature Reader, FrameStateBuilder, and SceneCompositor
  const audioReader = new DemoAudioFeatureReader();
  const stateBuilder = new FrameStateBuilder({
    storyboard: demoStoryboard,
    audioManifest: demoAudioManifest,
    rigs: demoRigsMap,
    choreography: demoChoreography,
    getAudioFeatureAtFrame: (f) => audioReader.getFrameFeature(f)
  });
  const compositor = new SceneCompositor({ width, height, fps });

  // Track aggregate scene budget across frames
  const budgetTracker: SceneBudgetStats = {
    drawablesCount: 0,
    gradientShapesCount: 0,
    particlesCount: 0,
    filtersCount: 0
  };

  const generateFrameSvg = (frameIndex: number): string => {
    const frameState = stateBuilder.buildFrameState(frameIndex);
    const env = getDemoEnvironment(frameState.shotId);
    const result = compositor.renderFrame(
      frameState,
      demoRigsMap,
      env,
      DEMO_ONSET_FRAMES,
      (f) => audioReader.getFrameFeature(f)
    );

    budgetTracker.drawablesCount = Math.max(budgetTracker.drawablesCount, result.stats.drawablesCount);
    budgetTracker.gradientShapesCount = Math.max(budgetTracker.gradientShapesCount, result.stats.gradientShapesCount);
    budgetTracker.particlesCount = Math.max(budgetTracker.particlesCount, result.stats.particlesCount);
    budgetTracker.filtersCount = Math.max(budgetTracker.filtersCount, result.stats.filtersCount);

    return result.svg;
  };

  // 2. Warm-up (30 Frames)
  console.log('\n[1/5] Running Warm-up (30 frames @ 1080p)...');
  const warmupConfig = createRenderConfig({
    width,
    height,
    fps,
    pixelFormat: 'rgba',
    totalFrames: 30,
    preset: 'veryfast',
    crf: 18,
    threads: 2
  });

  const warmupOutputPath = path.join(OUTPUT_DIR, 'p2_warmup.mp4');
  const warmupPipeline = new RenderPipeline({
    config: warmupConfig,
    outputPath: warmupOutputPath,
    frameGenerator: (f) => generateFrameSvg(f)
  });

  const warmupRes = await warmupPipeline.run();
  if (fs.existsSync(warmupRes.finalOutputPath)) {
    fs.unlinkSync(warmupRes.finalOutputPath);
  }
  console.log('✓ Warm-up complete; warmup metrics discarded.');

  // 3. 3 Full Iterations (180 Frames Each)
  const reports: DemoIterationReport[] = [];

  for (let iter = 1; iter <= 3; iter++) {
    console.log(`\n----------------------------------------------------`);
    console.log(`[${iter + 1}/5] Executing Iteration ${iter} / 3 (180 frames @ 1080p 30fps)...`);
    console.log(`----------------------------------------------------`);

    const renderConfig = createRenderConfig({
      width,
      height,
      fps,
      pixelFormat: 'rgba',
      totalFrames,
      preset: 'veryfast',
      crf: 18,
      threads: 2
    });

    const outputPath =
      iter === 3
        ? path.join(OUTPUT_DIR, 'phase2_cinema_demo.mp4')
        : path.join(OUTPUT_DIR, `p2_iter_${iter}.mp4`);

    const memorySampler = new PipelineMemorySampler(30);
    const timingProfiler = new TimingProfiler();

    timingProfiler.start();

    const pipeline = new RenderPipeline({
      config: renderConfig,
      outputPath,
      frameGenerator: (f) => generateFrameSvg(f),
      onFrameRendered: (f, timings) => {
        timingProfiler.recordFrame(f, timings.genMs, timings.rasterMs, timings.writeMs);
      }
    });

    const pipeResult = await pipeline.run((streamer) => {
      const pid = streamer.getChildPid();
      if (pid) {
        memorySampler.start(pid);
      }
    });

    const memStats = memorySampler.stop();
    const timingStats = timingProfiler.stop();

    // Probe final committed output with ffprobe
    const finalPath = pipeResult.finalOutputPath;
    const probe = probeVideo(finalPath);
    const stream = probe.stream;
    const duration = probe.format?.duration ? Number.parseFloat(probe.format.duration) : 0;

    if (stream.codec_name !== 'h264') throw new Error(`Codec is not h264: ${stream.codec_name}`);
    if (stream.width !== 1920 || stream.height !== 1080) {
      throw new Error(`Resolution mismatch: ${stream.width}x${stream.height}`);
    }
    if (stream.pix_fmt !== 'yuv420p') throw new Error(`Pixel format mismatch: ${stream.pix_fmt}`);
    if (probe.frameCount !== totalFrames) throw new Error(`Total frame count is not ${totalFrames}: ${probe.frameCount}`);

    // Validate BT.709 Color Metadata
    assertBt709Tv(stream);

    const durationTolerance = 1 / fps + 0.005; // 0.0383s
    if (Math.abs(duration - DEMO_DURATION_SECONDS) > durationTolerance) {
      throw new Error(`Duration (${duration}s) exceeds tolerance of ${DEMO_DURATION_SECONDS}s +- ${durationTolerance.toFixed(4)}s`);
    }

    const outputStats = fs.statSync(finalPath);
    const outputBytes = outputStats.size;

    reports.push({
      iterNumber: iter,
      totalWallMs: pipeResult.totalWallMs,
      effectiveFps: pipeResult.effectiveFps,
      avgGenMs: timingStats.avgGenMs,
      p95GenMs: timingStats.p95GenMs,
      avgRasterMs: timingStats.avgRasterMs,
      p95RasterMs: timingStats.p95RasterMs,
      avgWriteMs: timingStats.avgWriteMs,
      p95WriteMs: timingStats.p95WriteMs,
      peakAggregateRssMb: memStats.peakAggregateRssMb,
      peakNodeRssMb: memStats.peakNodeRssMb,
      peakChildRssMb: memStats.peakChildRssMb,
      peakHeapUsedMb: memStats.peakHeapUsedMb,
      peakExternalMb: memStats.peakExternalMb,
      peakArrayBuffersMb: memStats.peakArrayBuffersMb,
      outputBytes,
      ffprobeDuration: duration
    });

    // Clean up temporary iteration 1 and 2 outputs
    if (iter < 3 && fs.existsSync(finalPath)) {
      fs.unlinkSync(finalPath);
    }

    console.log(`✓ Iteration ${iter} complete:`);
    console.log(`  - Wall time: ${(pipeResult.totalWallMs / 1000).toFixed(2)}s | FPS: ${pipeResult.effectiveFps.toFixed(2)}`);
    console.log(
      `  - Peak Aggregate RSS: ${memStats.peakAggregateRssMb} MB (Node: ${memStats.peakNodeRssMb} MB, FFmpeg: ${memStats.peakChildRssMb} MB)`
    );
    console.log(
      `  - Output: ${finalPath} (${(outputBytes / (1024 * 1024)).toFixed(2)} MB, duration: ${duration.toFixed(3)}s)`
    );

    // Cooldown pause between iterations
    if (iter < 3) {
      if (global.gc) {
        global.gc();
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // 4. Plateau Measurement (540 Frames / 3x duration)
  console.log(`\n----------------------------------------------------`);
  console.log(`[5/5] Executing Memory Plateau Verification (540 frames @ 1080p 30fps)...`);
  console.log(`----------------------------------------------------`);

  const plateauFrames = 540;
  const plateauConfig = createRenderConfig({
    width,
    height,
    fps,
    pixelFormat: 'rgba',
    totalFrames: plateauFrames,
    preset: 'veryfast',
    crf: 18,
    threads: 2
  });
  const plateauOutputPath = path.join(OUTPUT_DIR, 'p2_plateau_540f.mp4');
  const plateauSampler = new PipelineMemorySampler(30);
  const plateauPipeline = new RenderPipeline({
    config: plateauConfig,
    outputPath: plateauOutputPath,
    frameGenerator: (f) => generateFrameSvg(f % totalFrames)
  });

  const plateauRes = await plateauPipeline.run((streamer) => {
    const pid = streamer.getChildPid();
    if (pid) plateauSampler.start(pid);
  });
  const plateauMemStats = plateauSampler.stop();
  if (fs.existsSync(plateauRes.finalOutputPath)) {
    fs.unlinkSync(plateauRes.finalOutputPath);
  }
  console.log(
    `✓ Plateau run complete: ${plateauFrames} frames in ${(plateauRes.totalWallMs / 1000).toFixed(2)}s | Peak Aggregate RSS: ${plateauMemStats.peakAggregateRssMb} MB`
  );

  // 5. Summary & Quantitative Gate Evaluation
  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const medWall = median(reports.map((r) => r.totalWallMs));
  const medFps = median(reports.map((r) => r.effectiveFps));
  const medRss = median(reports.map((r) => r.peakAggregateRssMb));
  const medSize = median(reports.map((r) => r.outputBytes));

  console.log('\n====================================================');
  console.log('       PHASE 2 CINEMA BENCHMARK RESULTS SUMMARY     ');
  console.log('====================================================');
  console.log(`Cross-Run Summary:`);
  console.log(`- Median Wall Time: ${(medWall / 1000).toFixed(2)}s`);
  console.log(`- Median Effective FPS: ${medFps.toFixed(2)} FPS`);
  console.log(`- Median Peak Aggregate RSS: ${medRss.toFixed(2)} MB (Target < ${MEMORY_TARGET_MB} MB, Hard Limit <= ${MEMORY_HARD_FAIL_MB} MB)`);
  console.log(`- Median Output Size: ${(medSize / (1024 * 1024)).toFixed(2)} MB`);

  console.log('\nPer-Iteration Breakdown:');
  console.table(
    reports.map((r) => ({
      Run: `Run ${r.iterNumber}`,
      FPS: r.effectiveFps.toFixed(1),
      'Wall(s)': (r.totalWallMs / 1000).toFixed(2),
      'Gen avg/p95': `${r.avgGenMs.toFixed(1)} / ${r.p95GenMs.toFixed(1)}ms`,
      'Raster avg/p95': `${r.avgRasterMs.toFixed(1)} / ${r.p95RasterMs.toFixed(1)}ms`,
      'Wait avg/p95': `${r.avgWriteMs.toFixed(1)} / ${r.p95WriteMs.toFixed(1)}ms`,
      'Peak RSS (MB)': r.peakAggregateRssMb,
      'Node RSS (MB)': r.peakNodeRssMb,
      'FFmpeg RSS (MB)': r.peakChildRssMb,
      'Heap (MB)': r.peakHeapUsedMb,
      'Size (MB)': (r.outputBytes / (1024 * 1024)).toFixed(2)
    }))
  );

  console.log('\nScene Budget Measurements (§8.4):');
  console.log(`- Peak Drawables: ${budgetTracker.drawablesCount} / Limit 220`);
  console.log(`- Peak Gradient Shapes: ${budgetTracker.gradientShapesCount} / Limit 100`);
  console.log(`- Peak Live Particles: ${budgetTracker.particlesCount} / Limit 150`);
  console.log(`- Filters / Masks: ${budgetTracker.filtersCount} / Limit 0`);

  // Gate evaluation
  const gateEvaluation = evaluateSmokeBenchmarkGates({
    reports,
    plateau: {
      short: { frames: totalFrames, peakAggregateRssMb: medRss },
      long: { frames: plateauFrames, peakAggregateRssMb: plateauMemStats.peakAggregateRssMb }
    },
    minFpsThreshold: MIN_FPS,
    existingImageFiles: findTemporaryImageFiles(process.cwd())
  });

  console.log(`\nBenchmark Gate Evaluation: ${gateEvaluation.status.toUpperCase()}`);
  if (gateEvaluation.warnings.length > 0) {
    console.log('Warnings:');
    for (const w of gateEvaluation.warnings) {
      console.log(`  - ${w}`);
    }
  }

  if (gateEvaluation.plateau) {
    console.log(
      `Plateau Check: Short (${gateEvaluation.plateau.shortFrames}f) = ${gateEvaluation.plateau.shortPeakMb} MB -> Long (${gateEvaluation.plateau.longFrames}f) = ${gateEvaluation.plateau.longPeakMb} MB (Growth: ${gateEvaluation.plateau.growthMb} MB <= Allowed: ${gateEvaluation.plateau.allowedMb} MB)`
    );
  }

  console.log(`Committed Final Demo Video: ${path.join(OUTPUT_DIR, 'phase2_cinema_demo.mp4')}`);
  console.log('All criteria passed.');
}

main().catch((err) => {
  console.error('\nBenchmark failed with error:', err);
  process.exit(1);
});
