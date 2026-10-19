import fs from 'node:fs';
import path from 'node:path';
import { createRenderConfig } from '../src/config/render-config.js';
import { RenderPipeline } from '../src/renderer/pipeline.js';
import { PipelineMemorySampler } from '../src/diagnostics/memory-sampler.js';
import { TimingProfiler } from '../src/diagnostics/timing.js';
import { SvgBuilder } from '../src/engine/compositor/svg-builder.js';
import type { CameraTransform, Vec3 } from '../src/schemas/primitives.schema.js';
import { computeCameraBasis } from '../src/engine/camera/camera-3d.js';
import {
  projectToScreen,
  clipAndProjectLine,
  clipAndProjectPolygon
} from '../src/engine/camera/projection.js';
import {
  evaluateSmokeBenchmarkGates,
  HARD_RSS_LIMIT_MB,
  MIN_FPS
} from '../src/diagnostics/benchmark-gates.js';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';
import { probeVideo, assertBt709Tv } from '../src/diagnostics/ffprobe.js';
import { OUTPUT_DIR } from '../src/config/paths.js';

// Deterministic Mulberry32 PRNG
function createMulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate 40 static 3D stars
const rng = createMulberry32(0xdeadbeef);
const stars3D: Vec3[] = Array.from({ length: 40 }, () => [
  (rng() - 0.5) * 800,
  (rng() - 0.5) * 500,
  -100 - rng() * 300
]);

// 8 3D cube vertices at origin
const cubeVertices: Vec3[] = [
  [-60, -60, -60],
  [60, -60, -60],
  [60, 60, -60],
  [-60, 60, -60],
  [-60, -60, 60],
  [60, -60, 60],
  [60, 60, 60],
  [-60, 60, 60]
];

// 6 cube faces
const cubeFaces: number[][] = [
  [0, 1, 2, 3], // Front
  [5, 4, 7, 6], // Back
  [4, 0, 3, 7], // Left
  [1, 5, 6, 2], // Right
  [3, 2, 6, 7], // Top
  [4, 5, 1, 0]  // Bottom
];

function generateProceduralFrameSvg(frameIndex: number, totalFrames: number): string {
  const width = 1920;
  const height = 1080;
  const progress = frameIndex / totalFrames;

  // Smoothly rotate camera around target
  const angle = progress * Math.PI * 1.5;
  const camDist = 320;
  const camX = Math.sin(angle) * camDist;
  const camZ = Math.cos(angle) * camDist;
  const camY = 80 + Math.sin(progress * Math.PI * 2) * 40;
  const roll = Math.sin(progress * Math.PI * 2) * 5; // Dutch angle roll +-5 deg

  const camera: CameraTransform = {
    projectionMode: 'perspective',
    position: [camX, camY, camZ],
    target: [0, 0, 0],
    up: [0, 1, 0],
    verticalFovDegrees: 60,
    nearPlane: 1,
    farPlane: 2000,
    rollDegrees: roll
  };

  const basis = computeCameraBasis(camera);

  // Simulated audio pulse (transients at frames 30, 60, 90, 120)
  const isAudioOnset = frameIndex === 30 || frameIndex === 60 || frameIndex === 90 || frameIndex === 120;
  const bgGlowColor = isAudioOnset ? '#441133' : '#08081a';

  const builder = new SvgBuilder({ width, height, backgroundColor: bgGlowColor });

  // 1. 3D Parallax Star Layer
  for (const star of stars3D) {
    const proj = projectToScreen(star, camera, basis, width, height);
    if (proj.visible) {
      const radius = Math.max(1, 4 - proj.zDepth / 150);
      builder.addCircle(proj.x, proj.y, radius, '#ffffff', 0.8);
    }
  }

  // 2. Perspective Ground Grid Layer with Primitive Clipping
  const gridY = -80;
  for (let gx = -300; gx <= 300; gx += 100) {
    const line = clipAndProjectLine([gx, gridY, -300], [gx, gridY, 300], camera, basis, width, height);
    if (line) {
      builder.addLine(line.p0.x, line.p0.y, line.p1.x, line.p1.y, '#224466', 1, 0.4);
    }
  }
  for (let gz = -300; gz <= 300; gz += 100) {
    const line = clipAndProjectLine([-300, gridY, gz], [300, gridY, gz], camera, basis, width, height);
    if (line) {
      builder.addLine(line.p0.x, line.p0.y, line.p1.x, line.p1.y, '#224466', 1, 0.4);
    }
  }

  // 3. Rotating 3D Totem Cube with Primitive Polygon Clipping
  const rotY = frameIndex * 0.04;
  const rotX = frameIndex * 0.02;
  const cosY = Math.cos(rotY),
    sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX),
    sinX = Math.sin(rotX);

  const rotatedVertices: Vec3[] = cubeVertices.map((v) => {
    // Rotation X then Y
    const y1 = v[1] * cosX - v[2] * sinX;
    const z1 = v[1] * sinX + v[2] * cosX;
    const x2 = v[0] * cosY + z1 * sinY;
    const z2 = -v[0] * sinY + z1 * cosY;
    return [x2, y1, z2];
  });

  const colors = ['#00ffff', '#ff00ff', '#ffff00', '#00ff88', '#ff3366', '#3388ff'];

  for (let i = 0; i < cubeFaces.length; i++) {
    const face = cubeFaces[i];
    const w0 = rotatedVertices[face[0]];
    const w1 = rotatedVertices[face[1]];
    const w2 = rotatedVertices[face[2]];
    const w3 = rotatedVertices[face[3]];

    // 3D face normal for backface culling
    const edge1: Vec3 = [w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]];
    const edge2: Vec3 = [w2[0] - w0[0], w2[1] - w0[1], w2[2] - w0[2]];
    const normal: Vec3 = [
      edge1[1] * edge2[2] - edge1[2] * edge2[1],
      edge1[2] * edge2[0] - edge1[0] * edge2[2],
      edge1[0] * edge2[1] - edge1[1] * edge2[0]
    ];
    // Vector from face to camera position
    const toCam: Vec3 = [
      camera.position[0] - w0[0],
      camera.position[1] - w0[1],
      camera.position[2] - w0[2]
    ];
    const dot = normal[0] * toCam[0] + normal[1] * toCam[1] + normal[2] * toCam[2];

    if (dot > 0) {
      // Facing camera
      const faceVertices: Vec3[] = [w0, w1, w2, w3];
      const clipped = clipAndProjectPolygon(faceVertices, camera, basis, width, height);
      if (clipped && clipped.vertices.length >= 3) {
        const polyPoints: Array<[number, number]> = clipped.vertices.map((v) => [v.x, v.y]);
        builder.addPolygon(polyPoints, colors[i % colors.length], '#ffffff', 2, 0.85);
      }
    }
  }

  // 4. Audio-Reactive HUD / Visual Telemetry with Bundled DejaVu Sans Font
  const hudText = `FRAME: ${frameIndex.toString().padStart(3, '0')} / ${totalFrames} | RMS: ${(0.4 + Math.sin(frameIndex * 0.1) * 0.3).toFixed(2)}`;
  builder.addText(hudText, 1920 / 2, 80, 26, isAudioOnset ? '#ff0055' : '#00ffff', 'DejaVu Sans');

  return builder.build();
}

interface IterationReport {
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

async function runSmokeBenchmark(): Promise<void> {
  console.log('====================================================');
  console.log('   AI-AGENT ANIMATION STUDIO — SMOKE BENCHMARK      ');
  console.log('====================================================');

  const width = 1920;
  const height = 1080;
  const fps = 30;
  const totalFrames = 150; // 5.0 seconds

  // --- WARM-UP (30 Frames) ---
  console.log('\n[1/4] Running Warm-up (30 frames @ 1080p)...');
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

  const warmupOutputPath = path.join(OUTPUT_DIR, 'warmup.mp4');
  const warmupPipeline = new RenderPipeline({
    config: warmupConfig,
    outputPath: warmupOutputPath,
    frameGenerator: (f) => generateProceduralFrameSvg(f, 30)
  });

  const warmupRes = await warmupPipeline.run();
  if (fs.existsSync(warmupRes.finalOutputPath)) {
    fs.unlinkSync(warmupRes.finalOutputPath);
  }
  console.log('✓ Warm-up complete; warmup metrics discarded.');

  // --- 3 FULL ITERATIONS (150 Frames Each) ---
  const reports: IterationReport[] = [];

  for (let iter = 1; iter <= 3; iter++) {
    console.log(`\n----------------------------------------------------`);
    console.log(`[${iter + 1}/4] Executing Iteration ${iter} / 3 (150 frames @ 1080p 30fps)...`);
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

    const outputPath = iter === 3 ? path.join(OUTPUT_DIR, 'benchmark.mp4') : path.join(OUTPUT_DIR, `smoke_iter_${iter}.mp4`);
    const memorySampler = new PipelineMemorySampler(30);
    const timingProfiler = new TimingProfiler();

    timingProfiler.start();

    const pipeline = new RenderPipeline({
      config: renderConfig,
      outputPath,
      frameGenerator: (f) => generateProceduralFrameSvg(f, totalFrames),
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

    // Probe final committed output with type-safe ffprobe
    const finalPath = pipeResult.finalOutputPath;
    const probe = probeVideo(finalPath);
    const stream = probe.stream;
    const duration = probe.format?.duration ? Number.parseFloat(probe.format.duration) : 0;

    if (stream.codec_name !== 'h264') throw new Error(`Codec is not h264: ${stream.codec_name}`);
    if (stream.width !== 1920 || stream.height !== 1080) {
      throw new Error(`Resolution mismatch: ${stream.width}x${stream.height}`);
    }
    if (stream.pix_fmt !== 'yuv420p') throw new Error(`Pixel format mismatch: ${stream.pix_fmt}`);
    if (probe.frameCount !== 150) throw new Error(`Total frame count is not 150: ${probe.frameCount}`);

    // Validate BT.709 Color Metadata
    assertBt709Tv(stream);

    const durationTolerance = 1 / fps + 0.005; // 0.0383s
    if (Math.abs(duration - 5.0) > durationTolerance) {
      throw new Error(`Duration (${duration}s) exceeds tolerance of 5.0s +- ${durationTolerance.toFixed(4)}s`);
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

    console.log(`✓ Iteration ${iter} complete:`);
    console.log(`  - Wall time: ${(pipeResult.totalWallMs / 1000).toFixed(2)}s | FPS: ${pipeResult.effectiveFps.toFixed(2)}`);
    console.log(
      `  - Peak Aggregate RSS: ${memStats.peakAggregateRssMb} MB (Node: ${memStats.peakNodeRssMb} MB, FFmpeg: ${memStats.peakChildRssMb} MB)`
    );
    console.log(
      `  - Heap Used: ${memStats.peakHeapUsedMb} MB | External: ${memStats.peakExternalMb} MB | ArrayBuffers: ${memStats.peakArrayBuffersMb} MB`
    );
    console.log(`  - Output: ${finalPath} (${(outputBytes / (1024 * 1024)).toFixed(2)} MB, duration: ${duration.toFixed(3)}s)`);

    // Cooldown pause between iterations
    if (iter < 3) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // --- SUMMARY & MEDIAN METRICS ---
  console.log('\n====================================================');
  console.log('       SMOKE BENCHMARK RESULTS SUMMARY (3 RUNS)     ');
  console.log('====================================================');

  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const medWall = median(reports.map((r) => r.totalWallMs));
  const medFps = median(reports.map((r) => r.effectiveFps));
  const medRss = median(reports.map((r) => r.peakAggregateRssMb));
  const medSize = median(reports.map((r) => r.outputBytes));

  console.log(`\nCross-Run Summary:`);
  console.log(`- Median Wall Time: ${(medWall / 1000).toFixed(2)}s`);
  console.log(`- Median Effective FPS: ${medFps.toFixed(2)} FPS`);
  console.log(`- Median Peak Aggregate RSS: ${medRss.toFixed(2)} MB (Hard Constraint Limit < ${HARD_RSS_LIMIT_MB} MB)`);
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

  // Strict Gates Evaluation (Every iteration < 400 MB, Median < 400 MB, FPS >= 15, Zero residue)
  evaluateSmokeBenchmarkGates({
    reports: reports.map((r) => ({
      iterNumber: r.iterNumber,
      effectiveFps: r.effectiveFps,
      peakAggregateRssMb: r.peakAggregateRssMb,
      peakNodeRssMb: r.peakNodeRssMb,
      peakChildRssMb: r.peakChildRssMb,
      preset: 'veryfast',
      threads: 2
    })),
    maxIterationRssThresholdMb: HARD_RSS_LIMIT_MB,
    medRssThresholdMb: HARD_RSS_LIMIT_MB,
    minFpsThreshold: MIN_FPS,
    existingImageFiles: findTemporaryImageFiles()
  });

  console.log(`\nMemory SLO Evaluation (< ${HARD_RSS_LIMIT_MB} MB per iteration & median):`);
  console.log(`- Status: ACHIEVED`);
  console.log(`- All iterations: ${reports.map((r) => `${r.peakAggregateRssMb} MB`).join(', ')} (all < ${HARD_RSS_LIMIT_MB} MB)`);
  console.log(`- Median Peak Aggregate RSS: ${medRss.toFixed(2)} MB`);
  console.log(`- FFmpeg Thread Configuration: 2 (preset: veryfast, memory-optimized parameters)`);
  console.log(`- Median Effective FPS: ${medFps.toFixed(2)} FPS (Target >= ${MIN_FPS} FPS)`);

  console.log('\n✓ All SLO criteria, BT.709 metadata validation, and Memory Gate C PASSED 100%!');
}

runSmokeBenchmark().catch((err) => {
  console.error('\n❌ SMOKE BENCHMARK FAILED:', err);
  process.exit(1);
});
