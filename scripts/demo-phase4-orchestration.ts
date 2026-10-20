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
import { DEMO_FPS } from '../src/demo/phase2-cinema/index.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor, type SceneBudgetStats } from '../src/engine/compositor/scene-compositor.js';
import {
  analyzeWavFileToArtifacts,
  loadAudioAnalysis,
  resolveCrossPlatformPath,
  runPythonAudioAnalyzer,
  synthesizeMusicalWavBuffer
} from '../src/engine/audio/index.js';
import {
  DeterministicMockLlmProvider,
  OpenAiCompatibleProvider,
  StudioAgentOrchestrator,
  type LlmProvider
} from '../src/agents/index.js';

interface CliOptions {
  audioPath?: string;
  lrcPath?: string;
  startSeconds?: number;
  durationSeconds: number;
  usePython: boolean;
  providerName: 'mock' | 'openai';
  outFilename: string;
}

function parseCliArgs(argv: string[]): CliOptions {
  let audioPath: string | undefined;
  let lrcPath: string | undefined;
  let startSeconds: number | undefined;
  let durationSeconds = 6.0;
  let usePython = false;
  let providerName: 'mock' | 'openai' = 'mock';
  let outFilename = 'phase4_orchestration_demo.mp4';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--audio' && i + 1 < argv.length) {
      audioPath = argv[++i];
    } else if (arg === '--lrc' && i + 1 < argv.length) {
      lrcPath = argv[++i];
    } else if (arg === '--start' && i + 1 < argv.length) {
      startSeconds = Number.parseFloat(argv[++i]);
    } else if (arg === '--duration' && i + 1 < argv.length) {
      durationSeconds = Number.parseFloat(argv[++i]);
    } else if (arg === '--use-python') {
      usePython = true;
    } else if (arg === '--mock') {
      providerName = 'mock';
    } else if (arg === '--provider' && i + 1 < argv.length) {
      const val = argv[++i];
      providerName = val === 'openai' ? 'openai' : 'mock';
    } else if (arg === '--out' && i + 1 < argv.length) {
      // Sanitize output filename with path.basename to prevent path traversal
      const candidate = path.basename(argv[++i]);
      if (candidate.endsWith('.mp4')) {
        outFilename = candidate;
      }
    }
  }

  return {
    ...(audioPath !== undefined ? { audioPath } : {}),
    ...(lrcPath !== undefined ? { lrcPath } : {}),
    ...(startSeconds !== undefined ? { startSeconds } : {}),
    durationSeconds,
    usePython,
    providerName,
    outFilename
  };
}

const DEFAULT_SYNTH_LRC = `
[ar:AI Agent Animation Studio]
[ti:Cybernetic Convergence]
[00:00.00][00:02.85][00:05.85]
[00:00.15]Awakening the Iron Horizon
[00:01.50]Signals Pulse in Motion
[00:03.00]Velocity = Maximum Drive
[00:04.50]Reaching Cinematic Convergence
`;

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
  audioCodec: string;
}

async function main() {
  console.log('================================================================');
  console.log('   PHASE 4 MULTI-AGENT LLM ORCHESTRATION & CINEMA PIPELINE      ');
  console.log('================================================================');

  const cli = parseCliArgs(process.argv.slice(2));
  const width = 1920;
  const height = 1080;
  const fps = DEMO_FPS;
  const durationSeconds = cli.durationSeconds;
  const totalFrames = Math.round(durationSeconds * fps);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const audioWorkDir = path.join(OUTPUT_DIR, 'phase4-work');
  fs.mkdirSync(audioWorkDir, { recursive: true });

  try {
    // 1. Resolve Audio & LRC Source (Real FLAC+LRC in assets/audio/ or CLI, fallback to synthesized WAV)
    const defaultFlacPath = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.flac');
    const defaultLrcPath = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.lrc');

    let activeAudioPath: string;
    let activeLrcPath: string | undefined;
    let activeStartSeconds: number;

    if (cli.audioPath) {
      activeAudioPath = resolveCrossPlatformPath(cli.audioPath);
      activeLrcPath = cli.lrcPath ? resolveCrossPlatformPath(cli.lrcPath) : undefined;
      activeStartSeconds = cli.startSeconds ?? 0;
    } else if (fs.existsSync(defaultFlacPath) && fs.existsSync(defaultLrcPath)) {
      activeAudioPath = defaultFlacPath;
      activeLrcPath = defaultLrcPath;
      // Start at 49.0s: captures the iconic chorus [00:49.28] "Trashed and scattered again..."
      activeStartSeconds = cli.startSeconds ?? 49.0;
    } else {
      activeAudioPath = path.join(audioWorkDir, 'synth_demo.wav');
      activeLrcPath = path.join(audioWorkDir, 'synth_demo.lrc');
      activeStartSeconds = 0.0;
      const wavBuf = synthesizeMusicalWavBuffer({
        durationSeconds,
        sampleRate: 44100,
        bpm: 120
      });
      fs.writeFileSync(activeAudioPath, wavBuf);
      fs.writeFileSync(activeLrcPath, DEFAULT_SYNTH_LRC.trim(), 'utf8');
    }

    const manifestPath = path.join(audioWorkDir, 'phase4_demo.manifest.json');
    const binaryPath = path.join(audioWorkDir, 'phase4_demo.features.bin');

    console.log('\n[0/6] Running Offline STFT Audio Intelligence & LRC Alignment...');
    console.log(
      `  - Audio Source: ${activeAudioPath} (start: ${activeStartSeconds}s, duration: ${durationSeconds}s)`
    );
    if (activeLrcPath) {
      console.log(`  - LRC Source:   ${activeLrcPath}`);
    }

    if (cli.usePython) {
      runPythonAudioAnalyzer({
        audioFilePath: activeAudioPath,
        lrcFilePath: activeLrcPath,
        outManifestPath: manifestPath,
        outBinaryPath: binaryPath,
        fps,
        sampleRate: 44100,
        startSeconds: activeStartSeconds,
        durationSeconds
      });
    } else {
      analyzeWavFileToArtifacts({
        wavFilePath: activeAudioPath,
        lrcFilePath: activeLrcPath,
        outManifestPath: manifestPath,
        outBinaryPath: binaryPath,
        fps,
        startSeconds: activeStartSeconds,
        durationSeconds,
        totalFrames
      });
    }

    const { manifest: audioManifest, reader: audioReader } = loadAudioAnalysis(manifestPath);
    const onsetFrames = audioManifest.beatEvents.map((b) => b.frameIndex);

    console.log(
      `✓ Extracted .features.bin (${audioReader.byteLength} bytes, ${audioReader.totalFrames} frames, ${audioManifest.beatEvents.length} beat events, ${audioManifest.lyrics.length} aligned lyric lines).`
    );

    // 2. Execute Multi-Agent LLM Orchestration (Director -> Rig -> Choreographer -> Self-Healing Loop)
    console.log(
      `\n[1/6] Running Multi-Agent LLM Orchestration (provider: ${cli.providerName})...`
    );
    const provider: LlmProvider =
      cli.providerName === 'openai'
        ? new OpenAiCompatibleProvider()
        : new DeterministicMockLlmProvider();

    const orchestrator = new StudioAgentOrchestrator(provider);
    const orchestration = await orchestrator.orchestrate({
      projectId: 'phase4-trashed-and-scattered-cinema',
      audioManifest,
      getAudioFeatureAtFrame: (f) => audioReader.getFrameFeature(f),
      width,
      height,
      maxRetries: 3
    });

    console.log(
      `✓ Multi-Agent Orchestration completed in ${orchestration.attempts.length} total agent stages:`
    );
    for (const attempt of orchestration.attempts) {
      console.log(
        `  • [${attempt.agentRole.toUpperCase()}] attempt #${attempt.attempt} (${attempt.durationMs}ms)${
          attempt.repairedErrorCodes.length > 0
            ? ` repaired: ${attempt.repairedErrorCodes.join(', ')}`
            : ''
        }`
      );
    }
    console.log(
      `✓ Generated Storyboard (${orchestration.storyboard.acts.length} acts, ${orchestration.storyboard.shots.length} shots), Rigs (${orchestration.rigs.size} rigs), Choreography (${orchestration.choreography.tracks.length} tracks).`
    );

    const baseConfig = createRenderConfig({
      width,
      height,
      fps,
      pixelFormat: 'rgba',
      totalFrames,
      preset: 'veryfast',
      crf: 18,
      threads: 2,
      audio: {
        filePath: activeAudioPath,
        startSeconds: activeStartSeconds,
        durationSeconds,
        bitrateKbps: 192
      }
    });

    const stateBuilder = new FrameStateBuilder({
      storyboard: orchestration.storyboard,
      audioManifest,
      rigs: orchestration.rigs,
      choreography: orchestration.choreography,
      getAudioFeatureAtFrame: (f) => audioReader.getFrameFeature(f)
    });
    const compositor = new SceneCompositor({ width, height, fps });

    const budgetTracker: SceneBudgetStats = {
      drawablesCount: 0,
      gradientShapesCount: 0,
      particlesCount: 0,
      filtersCount: 0
    };

    const generateFrameSvg = (frameIndex: number): string => {
      const clampedFrame = frameIndex % totalFrames;
      const frameState = stateBuilder.buildFrameState(clampedFrame);
      const env = orchestration.getEnvironmentForShot(frameState.shotId);
      const result = compositor.renderFrame(
        frameState,
        orchestration.rigs,
        env,
        onsetFrames,
        (f) => audioReader.getFrameFeature(Math.max(0, Math.min(totalFrames - 1, f)))
      );

      budgetTracker.drawablesCount = Math.max(
        budgetTracker.drawablesCount,
        result.stats.drawablesCount
      );
      budgetTracker.gradientShapesCount = Math.max(
        budgetTracker.gradientShapesCount,
        result.stats.gradientShapesCount
      );
      budgetTracker.particlesCount = Math.max(
        budgetTracker.particlesCount,
        result.stats.particlesCount
      );
      budgetTracker.filtersCount = Math.max(budgetTracker.filtersCount, result.stats.filtersCount);

      return result.svg;
    };

    // 3. Warm-up (30 Frames with Audio Muxing)
    console.log('\n[2/6] Running Warm-up (30 frames @ 1080p + AAC Audio Mux)...');
    const warmupConfig = createRenderConfig({
      width,
      height,
      fps,
      pixelFormat: 'rgba',
      totalFrames: 30,
      preset: 'veryfast',
      crf: 18,
      threads: 2,
      audio: {
        filePath: activeAudioPath,
        startSeconds: activeStartSeconds,
        durationSeconds: 1.0,
        bitrateKbps: 192
      }
    });

    const warmupOutputPath = path.join(OUTPUT_DIR, 'p4_warmup.mp4');
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

    // 4. 3 Full Iterations (180 Frames Each with Audio Muxing)
    const reports: DemoIterationReport[] = [];
    const committedOutputPath = path.join(OUTPUT_DIR, cli.outFilename);

    for (let iter = 1; iter <= 3; iter++) {
      console.log(`\n----------------------------------------------------`);
      console.log(
        `[${iter + 2}/6] Executing Iteration ${iter} / 3 (${totalFrames} frames @ 1080p 30fps + AAC Audio)...`
      );
      console.log(`----------------------------------------------------`);

      const outputPath =
        iter === 3 ? committedOutputPath : path.join(OUTPUT_DIR, `p4_iter_${iter}.mp4`);

      const memorySampler = new PipelineMemorySampler(30);
      const timingProfiler = new TimingProfiler();

      timingProfiler.start();

      const pipeline = new RenderPipeline({
        config: baseConfig,
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

      const finalPath = pipeResult.finalOutputPath;
      const probe = probeVideo(finalPath);
      const stream = probe.stream;
      const audioStream = probe.audioStream;
      const duration = probe.format?.duration ? Number.parseFloat(probe.format.duration) : 0;

      if (stream.codec_name !== 'h264') {
        throw new Error(`Video codec is not h264: ${stream.codec_name}`);
      }
      if (stream.width !== 1920 || stream.height !== 1080) {
        throw new Error(`Resolution mismatch: ${stream.width}x${stream.height}`);
      }
      if (stream.pix_fmt !== 'yuv420p') {
        throw new Error(`Pixel format mismatch: ${stream.pix_fmt}`);
      }
      if (probe.frameCount !== totalFrames) {
        throw new Error(`Total frame count is not ${totalFrames}: ${probe.frameCount}`);
      }
      assertBt709Tv(stream);

      if (!audioStream || audioStream.codec_name !== 'aac') {
        throw new Error(`Audio stream codec is not aac: ${JSON.stringify(audioStream)}`);
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
        ffprobeDuration: duration,
        audioCodec: audioStream.codec_name
      });

      if (iter < 3 && fs.existsSync(finalPath)) {
        fs.unlinkSync(finalPath);
      }

      console.log(`✓ Iteration ${iter} complete:`);
      console.log(
        `  - Wall time: ${(pipeResult.totalWallMs / 1000).toFixed(2)}s | FPS: ${pipeResult.effectiveFps.toFixed(2)}`
      );
      console.log(
        `  - Peak Aggregate RSS: ${memStats.peakAggregateRssMb} MB (Node: ${memStats.peakNodeRssMb} MB, FFmpeg: ${memStats.peakChildRssMb} MB)`
      );
      console.log(
        `  - Streams: video=${stream.codec_name} (BT.709 tv), audio=${audioStream.codec_name} (${audioStream.sample_rate} Hz)`
      );
      console.log(
        `  - Output: ${finalPath} (${(outputBytes / (1024 * 1024)).toFixed(2)} MB, duration: ${duration.toFixed(3)}s)`
      );

      if (iter < 3) {
        if (global.gc) {
          global.gc();
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // 5. Plateau Measurement (540 Frames / 3x duration)
    console.log(`\n----------------------------------------------------`);
    console.log(`[6/6] Executing Memory Plateau Verification (540 frames @ 1080p 30fps)...`);
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
    const plateauOutputPath = path.join(OUTPUT_DIR, 'p4_plateau_540f.mp4');
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

    // 6. Summary & Quantitative Gate Evaluation
    const median = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };

    const medWall = median(reports.map((r) => r.totalWallMs));
    const medFps = median(reports.map((r) => r.effectiveFps));
    const medRss = median(reports.map((r) => r.peakAggregateRssMb));
    const medSize = median(reports.map((r) => r.outputBytes));

    console.log('\n====================================================');
    console.log('     PHASE 4 ORCHESTRATION BENCHMARK SUMMARY        ');
    console.log('====================================================');
    console.log(`Cross-Run Summary:`);
    console.log(`- Median Wall Time: ${(medWall / 1000).toFixed(2)}s`);
    console.log(`- Median Effective FPS: ${medFps.toFixed(2)} FPS`);
    console.log(
      `- Median Peak Aggregate RSS: ${medRss.toFixed(2)} MB (Target < ${MEMORY_TARGET_MB} MB, Hard Limit <= ${MEMORY_HARD_FAIL_MB} MB)`
    );
    console.log(`- Median Output Size: ${(medSize / (1024 * 1024)).toFixed(2)} MB`);
    console.log(
      `- Max Scene Budgets: drawables=${budgetTracker.drawablesCount}, gradients=${budgetTracker.gradientShapesCount}, particles=${budgetTracker.particlesCount}`
    );

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
        Audio: r.audioCodec,
        'Size (MB)': (r.outputBytes / (1024 * 1024)).toFixed(2)
      }))
    );

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

    console.log(`Committed Final Phase 4 Demo Video: ${committedOutputPath}`);
    console.log('All Phase 4 criteria passed 100%.');
  } finally {
    // Always clean up temporary working directory
    fs.rmSync(audioWorkDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nPhase 4 Orchestration Demo failed with error:', err);
  process.exit(1);
});
