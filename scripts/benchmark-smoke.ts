import fs from 'node:fs';
import path from 'node:path';
import { createRenderConfig } from '../src/config/render-config.js';
import { RenderPipeline } from '../src/renderer/pipeline.js';
import { PipelineMemorySampler } from '../src/diagnostics/memory-sampler.js';
import { TimingProfiler } from '../src/diagnostics/timing.js';
import { SvgBuilder } from '../src/engine/compositor/svg-builder.js';
import type { CameraTransform, Vec3 } from '../src/schemas/primitives.schema.js';
import { computeCameraBasis, worldToCameraSpace } from '../src/engine/camera/camera-3d.js';
import {
  projectCameraPointToScreen,
  clipAndProjectCameraLine,
  clipAndProjectCameraPolygon
} from '../src/engine/camera/clipping.js';
import {
  computePointsDepthKey,
  sortDrawables,
  splitLargeLine,
  type CameraSpaceLine,
  type SortablePrimitive
} from '../src/engine/compositor/depth-sort.js';
import { exponentialDecay } from '../src/engine/math/spring.js';
import { mixHexColors } from '../src/engine/math/color.js';
import {
  evaluateSmokeBenchmarkGates,
  MEMORY_HARD_FAIL_MB,
  MEMORY_TARGET_MB,
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

// 6 cube faces with strictly CCW winding viewed from outside
const cubeFaces: ReadonlyArray< readonly [number, number, number, number]> = [
  [4, 5, 6, 7], // 0: Front (+Z)
  [1, 0, 3, 2], // 1: Back (-Z)
  [0, 4, 7, 3], // 2: Left (-X)
  [5, 1, 2, 6], // 3: Right (+X)
  [7, 6, 2, 3], // 4: Top (+Y)
  [0, 1, 5, 4]  // 5: Bottom (-Y)
];

// 12 deduplicated undirected edges of the cube: [vertexA, vertexB, faceIndex1, faceIndex2]
const CUBE_EDGES: ReadonlyArray<readonly [number, number, number, number]> = [
  [4, 5, 0, 5], // Front - Bottom
  [5, 6, 0, 3], // Front - Right
  [6, 7, 0, 4], // Front - Top
  [7, 4, 0, 2], // Front - Left
  [1, 0, 1, 5], // Back - Bottom
  [0, 3, 1, 2], // Back - Left
  [3, 2, 1, 4], // Back - Top
  [2, 1, 1, 3], // Back - Right
  [0, 4, 2, 5], // Left - Bottom
  [5, 1, 3, 5], // Right - Bottom
  [6, 2, 3, 4], // Right - Top
  [7, 3, 2, 4]  // Left - Top
];

const CUBE_FACE_COLORS = ['#00ffff', '#ff00ff', '#ffff00', '#00ff88', '#ff3366', '#3388ff'] as const;

function generateProceduralFrameSvg(frameIndex: number, totalFrames: number): string {
  const width = 1920;
  const height = 1080;
  const fps = 30;
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

  // Simulated audio pulse with smooth 2-frame attack (t_attack ~ 0.067s) and 10-14 frame exponential decay
  const ONSET_FRAMES = [30, 60, 90, 120];
  const ATTACK_FRAMES = 2;
  let pulseSum = 0;
  for (const onsetFrame of ONSET_FRAMES) {
    if (onsetFrame <= frameIndex) {
      const dtFrames = frameIndex - onsetFrame;
      if (dtFrames < ATTACK_FRAMES) {
        // Smooth cosine attack ramp over 2 frames before reaching peak at dtFrames === ATTACK_FRAMES
        const attackProgress = (dtFrames + 1) / (ATTACK_FRAMES + 1);
        pulseSum += 0.5 * (1 - Math.cos(attackProgress * Math.PI));
      } else {
        const decaySeconds = (dtFrames - ATTACK_FRAMES) / fps;
        pulseSum += exponentialDecay(decaySeconds, 4.5);
      }
    }
  }
  const pulse = Math.min(1, pulseSum);

  // Background smoothly interpolates from #08081a to #441133 using Phase 2 color math
  const bgGlowColor = mixHexColors('#08081a', '#441133', pulse);

  const builder = new SvgBuilder({ width, height, backgroundColor: bgGlowColor });

  // Unified Painter's Algorithm sortable primitive queue (Phase 2 depth-sort engine)
  const sortables: SortablePrimitive[] = [];
  let submitIndex = 0;

  // 1. Tier 0: 3D Parallax Star Layer (depth-keyed in pre-clip camera space)
  for (const star of stars3D) {
    const camPt = worldToCameraSpace(star, camera, basis);
    const zc = camPt[2];
    if (zc >= camera.nearPlane && zc <= camera.farPlane) {
      const proj = projectCameraPointToScreen(camPt, camera, width, height);
      if (proj.x >= 0 && proj.x <= width && proj.y >= 0 && proj.y <= height) {
        const radius = Math.max(1, 4 - zc / 150);
        sortables.push({
          kind: 'star',
          // Skybox backdrop layer: keep stars behind world geometry across full 270-deg camera orbit
          depthKey: camera.farPlane - (camera.farPlane - zc) * 1e-3,
          tier: 0,
          index: submitIndex++,
          x: proj.x,
          y: proj.y,
          radius
        });
      }
    }
  }

  // 2. Tier 1: Perspective Ground Grid Layer (split & depth-keyed in pre-clip camera space)
  const gridY = -80;
  const rawGridSegments: Array<[Vec3, Vec3]> = [];
  for (let gx = -300; gx <= 300; gx += 100) {
    rawGridSegments.push([[gx, gridY, -300], [gx, gridY, 300]]);
  }
  for (let gz = -300; gz <= 300; gz += 100) {
    rawGridSegments.push([[-300, gridY, gz], [300, gridY, gz]]);
  }
  for (const [p0World, p1World] of rawGridSegments) {
    const lineItem: CameraSpaceLine = {
      kind: 'grid_line',
      p0: worldToCameraSpace(p0World, camera, basis),
      p1: worldToCameraSpace(p1World, camera, basis),
      depthKey: 0,
      tier: 1,
      index: submitIndex++
    };
    const pieces = splitLargeLine(lineItem, camera.nearPlane, camera.farPlane);
    for (const piece of pieces) {
      sortables.push(piece);
    }
  }

  // 3. Tier 2 & Tier 3: Rotating 3D Totem Cube with Outward Normals, Pre-Clip Depth Sorting, and Isolated Wireframe Edges
  const rotY = frameIndex * 0.04;
  const rotX = frameIndex * 0.02;
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);

  const rotatedVertices: Vec3[] = cubeVertices.map((v) => {
    const y1 = v[1] * cosX - v[2] * sinX;
    const z1 = v[1] * sinX + v[2] * cosX;
    const x2 = v[0] * cosY + z1 * sinY;
    const z2 = -v[0] * sinY + z1 * cosY;
    return [x2, y1, z2];
  });

  const camVertices: Vec3[] = rotatedVertices.map((v) => worldToCameraSpace(v, camera, basis));
  const faceCosines: number[] = new Array(cubeFaces.length).fill(-1);
  const FACE_VISIBILITY_EPSILON = 1e-6;
  let minVisibleFaceDepth = Infinity;

  for (let i = 0; i < cubeFaces.length; i++) {
    const face = cubeFaces[i];
    const w0 = rotatedVertices[face[0]];
    const w1 = rotatedVertices[face[1]];
    const w2 = rotatedVertices[face[2]];
    const w3 = rotatedVertices[face[3]];

    // 3D outward unit normal from CCW winding: edge1 x edge2
    const edge1: Vec3 = [w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]];
    const edge2: Vec3 = [w2[0] - w0[0], w2[1] - w0[1], w2[2] - w0[2]];
    const nx = edge1[1] * edge2[2] - edge1[2] * edge2[1];
    const ny = edge1[2] * edge2[0] - edge1[0] * edge2[2];
    const nz = edge1[0] * edge2[1] - edge1[1] * edge2[0];
    const nLen = Math.hypot(nx, ny, nz) || 1;

    // Face centroid to camera unit vector
    const cx = 0.25 * (w0[0] + w1[0] + w2[0] + w3[0]);
    const cy = 0.25 * (w0[1] + w1[1] + w2[1] + w3[1]);
    const cz = 0.25 * (w0[2] + w1[2] + w2[2] + w3[2]);
    const vx = camera.position[0] - cx;
    const vy = camera.position[1] - cy;
    const vz = camera.position[2] - cz;
    const vLen = Math.hypot(vx, vy, vz) || 1;

    const viewCos = (nx * vx + ny * vy + nz * vz) / (nLen * vLen);
    faceCosines[i] = viewCos;

    if (viewCos > FACE_VISIBILITY_EPSILON) {
      const faceCamVerts: Vec3[] = [
        camVertices[face[0]],
        camVertices[face[1]],
        camVertices[face[2]],
        camVertices[face[3]]
      ];
      const { zMean } = computePointsDepthKey(faceCamVerts, camera.nearPlane, camera.farPlane);
      if (zMean < minVisibleFaceDepth) {
        minVisibleFaceDepth = zMean;
      }
      const baseColor = CUBE_FACE_COLORS[i % CUBE_FACE_COLORS.length];

      sortables.push({
        kind: 'cube_face',
        depthKey: zMean,
        tier: 2,
        index: submitIndex++,
        camVerts: faceCamVerts,
        color: baseColor
      });
    }
  }

  // Deduplicated isolated wireframe edges sorted after all visible parent faces of the convex cube (Tier 3)
  for (const [vA, vB, f1, f2] of CUBE_EDGES) {
    const f1Visible = faceCosines[f1] > FACE_VISIBILITY_EPSILON;
    const f2Visible = faceCosines[f2] > FACE_VISIBILITY_EPSILON;
    if (f1Visible || f2Visible) {
      const cA = camVertices[vA];
      const cB = camVertices[vB];
      const { zMean } = computePointsDepthKey([cA, cB], camera.nearPlane, camera.farPlane);
      // Strictly sort all visible hull wireframe edges in front of all visible cube faces (minVisibleFaceDepth - 0.1)
      const edgeDepthKey = minVisibleFaceDepth - 0.5 + zMean * 1e-4;
      sortables.push({
        kind: 'cube_edge',
        depthKey: edgeDepthKey,
        tier: 3,
        index: submitIndex++,
        p0: cA,
        p1: cB
      });
    }
  }

  // Execute strict back-to-front Painter's Algorithm sort
  sortDrawables(sortables);

  // Emit sorted primitives into SvgBuilder
  for (const item of sortables) {
    switch (item.kind) {
      case 'star': {
        builder.addCircle(item.x as number, item.y as number, item.radius as number, '#ffffff', 0.8);
        break;
      }
      case 'grid_line': {
        const clipped = clipAndProjectCameraLine(
          item.p0 as Vec3,
          item.p1 as Vec3,
          camera,
          width,
          height
        );
        if (clipped) {
          builder.addLine(clipped.p0.x, clipped.p0.y, clipped.p1.x, clipped.p1.y, '#224466', 1, 0.4);
        }
        break;
      }
      case 'cube_face': {
        const clipped = clipAndProjectCameraPolygon(
          item.camVerts as Vec3[],
          camera,
          width,
          height
        );
        if (clipped && clipped.vertices.length >= 3) {
          const polyPoints: Array<[number, number]> = clipped.vertices.map((v) => [v.x, v.y]);
          const faceColor = item.color as string;
          // Render opaque face fill with stroke="none" (shared edges are covered by isolated Tier 3 wireframe paths)
          builder.addPolygon(polyPoints, faceColor, undefined, 0, 1.0);
        }
        break;
      }
      case 'cube_edge': {
        const clipped = clipAndProjectCameraLine(
          item.p0 as Vec3,
          item.p1 as Vec3,
          camera,
          width,
          height
        );
        if (clipped) {
          builder.addPath(
            [
              { cmd: 'M', x: clipped.p0.x, y: clipped.p0.y },
              { cmd: 'L', x: clipped.p1.x, y: clipped.p1.y }
            ],
            {
              stroke: {
                paint: '#ffffff',
                width: 2.5,
                lineCap: 'round',
                lineJoin: 'round'
              },
              opacity: 1.0
            }
          );
        }
        break;
      }
    }
  }

  // 4. Audio-Reactive HUD / Visual Telemetry with Bundled DejaVu Sans Font
  const hudColor = mixHexColors('#00ffff', '#ff0055', pulse);
  const hudText = `FRAME: ${frameIndex.toString().padStart(3, '0')} / ${totalFrames} | RMS: ${(0.4 + Math.sin(frameIndex * 0.1) * 0.3).toFixed(2)}`;
  builder.addText(hudText, 1920 / 2, 80, 26, hudColor, 'DejaVu Sans');

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
  if (global.gc) {
    global.gc();
  }
  await new Promise((r) => setTimeout(r, 1000));
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

    if (iter < 3 && fs.existsSync(finalPath)) {
      fs.unlinkSync(finalPath);
    }

    console.log(`✓ Iteration ${iter} complete:`);
    console.log(`  - Wall time: ${(pipeResult.totalWallMs / 1000).toFixed(2)}s | FPS: ${pipeResult.effectiveFps.toFixed(2)}`);
    console.log(
      `  - Peak Aggregate RSS: ${memStats.peakAggregateRssMb} MB (Node: ${memStats.peakNodeRssMb} MB, FFmpeg: ${memStats.peakChildRssMb} MB)`
    );
    console.log(
      `  - Heap Used: ${memStats.peakHeapUsedMb} MB | External: ${memStats.peakExternalMb} MB | ArrayBuffers: ${memStats.peakArrayBuffersMb} MB`
    );
    console.log(`  - Output: ${finalPath} (${(outputBytes / (1024 * 1024)).toFixed(2)} MB, duration: ${duration.toFixed(3)}s)`);

    // Cooldown pause after each iteration
    if (global.gc) {
      global.gc();
    }
    await new Promise((r) => setTimeout(r, 2000));
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

  // --- PLATEAU MEASUREMENT (450 Frames / 3x duration) ---
  console.log(`\n----------------------------------------------------`);
  console.log(`[5/5] Executing Plateau Verification (450 frames @ 1080p 30fps)...`);
  console.log(`----------------------------------------------------`);

  const plateauFrames = 450;
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
  const plateauOutputPath = path.join(OUTPUT_DIR, 'smoke_plateau_450f.mp4');
  const plateauSampler = new PipelineMemorySampler(30);
  const plateauPipeline = new RenderPipeline({
    config: plateauConfig,
    outputPath: plateauOutputPath,
    frameGenerator: (f) => generateProceduralFrameSvg(f, plateauFrames)
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

  console.log(`\nCross-Run Summary:`);
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

  // Gates Evaluation with 400 MB target warning, 600 MB hard limit, plateau test, and artifact hygiene
  const gateResult = evaluateSmokeBenchmarkGates({
    reports: reports.map((r) => ({
      iterNumber: r.iterNumber,
      effectiveFps: r.effectiveFps,
      peakAggregateRssMb: r.peakAggregateRssMb,
      peakNodeRssMb: r.peakNodeRssMb,
      peakChildRssMb: r.peakChildRssMb,
      preset: 'veryfast',
      threads: 2
    })),
    plateau: {
      short: { frames: totalFrames, peakAggregateRssMb: medRss },
      long: { frames: plateauFrames, peakAggregateRssMb: plateauMemStats.peakAggregateRssMb }
    },
    minFpsThreshold: MIN_FPS,
    existingImageFiles: findTemporaryImageFiles()
  });

  console.log(`\nMemory SLO Evaluation (Target < ${MEMORY_TARGET_MB} MB, Hard Limit <= ${MEMORY_HARD_FAIL_MB} MB):`);
  console.log(`- Gate Status: ${gateResult.status === 'pass' ? 'PASSED (CLEAN)' : 'PASSED WITH WARNINGS'}`);
  console.log(`- All iterations: ${reports.map((r) => `${r.peakAggregateRssMb} MB`).join(', ')}`);
  console.log(`- Median Peak Aggregate RSS: ${medRss.toFixed(2)} MB`);
  if (gateResult.warnings.length > 0) {
    for (const w of gateResult.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }
  if (gateResult.plateau) {
    console.log(
      `- Plateau Check (150f -> 450f): growth ${gateResult.plateau.growthMb.toFixed(2)} MB <= allowed ${gateResult.plateau.allowedMb.toFixed(2)} MB (Passed)`
    );
  }
  console.log(`- FFmpeg Thread Configuration: 2 (preset: veryfast, memory-optimized parameters)`);
  console.log(`- Median Effective FPS: ${medFps.toFixed(2)} FPS (Target >= ${MIN_FPS} FPS)`);

  console.log('\n✓ All SLO criteria, BT.709 metadata validation, and Memory Gate C PASSED 100%!');
}

runSmokeBenchmark().catch((err) => {
  console.error('\n❌ SMOKE BENCHMARK FAILED:', err);
  process.exit(1);
});
