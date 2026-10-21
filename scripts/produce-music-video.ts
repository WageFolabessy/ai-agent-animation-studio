import fs from 'node:fs';
import path from 'node:path';
import { createRenderConfig } from '../src/config/render-config.js';
import { PipelineMemorySampler } from '../src/diagnostics/memory-sampler.js';
import { probeVideo, assertBt709Tv } from '../src/diagnostics/ffprobe.js';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';
import { OUTPUT_DIR } from '../src/config/paths.js';
import { DEMO_FPS } from '../src/demo/phase2-cinema/index.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import {
  loadAudioAnalysis,
  resolveCrossPlatformPath,
  runPythonAudioAnalyzer,
  analyzeWavFileToArtifacts,
  synthesizeMusicalWavBuffer,
  stitchChunksWithMasterAudio
} from '../src/engine/audio/index.js';
import {
  CheckpointManager,
  renderChunk
} from '../src/engine/director/index.js';
import {
  DeterministicMockLlmProvider,
  OpenAiCompatibleProvider,
  StudioAgentOrchestrator,
  type LlmProvider
} from '../src/agents/index.js';

interface CliOptions {
  audioPath?: string;
  lrcPath?: string;
  outFilename: string;
  chunkFrames: number;
  maxChunks?: number;
  resume: boolean;
  providerName: 'mock' | 'openai';
  usePython: boolean;
  bitrateKbps: number;
}

function parseCliArgs(argv: string[]): CliOptions {
  let audioPath: string | undefined;
  let lrcPath: string | undefined;
  let outFilename = 'trashed_and_scattered_final.mp4';
  let chunkFrames = 1500; // ~50.0 seconds per chunk @ 30fps
  let maxChunks: number | undefined;
  let resume = true;
  let providerName: 'mock' | 'openai' = 'mock';
  let usePython = true;
  let bitrateKbps = 256;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--audio' && i + 1 < argv.length) {
      audioPath = argv[++i];
    } else if (arg === '--lrc' && i + 1 < argv.length) {
      lrcPath = argv[++i];
    } else if (arg === '--out' && i + 1 < argv.length) {
      const candidate = path.basename(argv[++i]);
      if (candidate.endsWith('.mp4')) outFilename = candidate;
    } else if (arg === '--chunk-frames' && i + 1 < argv.length) {
      chunkFrames = Math.max(30, Number.parseInt(argv[++i], 10));
    } else if (arg === '--max-chunks' && i + 1 < argv.length) {
      maxChunks = Math.max(1, Number.parseInt(argv[++i], 10));
    } else if (arg === '--no-resume') {
      resume = false;
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg === '--mock') {
      providerName = 'mock';
    } else if (arg === '--provider' && i + 1 < argv.length) {
      const val = argv[++i];
      providerName = val === 'openai' ? 'openai' : 'mock';
    } else if (arg === '--no-python') {
      usePython = false;
    } else if (arg === '--bitrate' && i + 1 < argv.length) {
      bitrateKbps = Number.parseInt(argv[++i], 10) || 256;
    }
  }

  return {
    ...(audioPath ? { audioPath } : {}),
    ...(lrcPath ? { lrcPath } : {}),
    outFilename,
    chunkFrames,
    ...(maxChunks !== undefined ? { maxChunks } : {}),
    resume,
    providerName,
    usePython,
    bitrateKbps
  };
}

function renderProgressBar(ratio: number, width = 24): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.min(width, Math.round(clamped * width));
  const bar =
    '='.repeat(filled) + (filled < width ? '>' : '') + ' '.repeat(Math.max(0, width - filled - 1));
  return `[${bar}]`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('   PHASE 5 FULL-LENGTH MUSIC VIDEO PRODUCTION & CINEMA ENGINE   ');
  console.log('================================================================');

  const cli = parseCliArgs(process.argv.slice(2));
  const width = 1920;
  const height = 1080;
  const fps = DEMO_FPS; // 30 FPS

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const chunksDir = path.join(OUTPUT_DIR, 'chunks');
  fs.mkdirSync(chunksDir, { recursive: true });

  const audioWorkDir = path.join(OUTPUT_DIR, 'production-audio-cache');
  fs.mkdirSync(audioWorkDir, { recursive: true });

  // 1. Resolve master audio and LRC lyrics
  const defaultFlac = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.flac');
  const defaultLrc = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.lrc');

  let activeAudioPath: string;
  let activeLrcPath: string | undefined;

  if (cli.audioPath) {
    activeAudioPath = resolveCrossPlatformPath(cli.audioPath);
    activeLrcPath = cli.lrcPath ? resolveCrossPlatformPath(cli.lrcPath) : undefined;
  } else if (fs.existsSync(defaultFlac) && fs.existsSync(defaultLrc)) {
    activeAudioPath = defaultFlac;
    activeLrcPath = defaultLrc;
  } else {
    // Synthetic fallback for environments where full FLAC is missing
    activeAudioPath = path.join(audioWorkDir, 'synth_song.wav');
    activeLrcPath = path.join(audioWorkDir, 'synth_song.lrc');
    if (!fs.existsSync(activeAudioPath)) {
      console.log('Generating synthetic WAV soundtrack fallback (30.0s @ 140 BPM)...');
      fs.writeFileSync(
        activeAudioPath,
        synthesizeMusicalWavBuffer({ durationSeconds: 30.0, sampleRate: 44100, bpm: 140 })
      );
      fs.writeFileSync(
        activeLrcPath,
        '[00:00.00] Synthetic Studio Production\n[00:05.00] Cybernetic Horizon\n[00:15.00] Speed Convergence\n'
      );
    }
  }

  console.log(`\n[Stage 1/5] Ingesting Audio Master: "${path.basename(activeAudioPath)}"`);
  const manifestPath = path.join(audioWorkDir, 'production.manifest.json');
  const binaryPath = path.join(audioWorkDir, 'production.features.bin');

  const needsAudioAnalysis =
    !fs.existsSync(manifestPath) ||
    !fs.existsSync(binaryPath) ||
    fs.statSync(binaryPath).size === 0;

  if (needsAudioAnalysis) {
    console.log(`Executing offline STFT 7-band analysis (usePython: ${cli.usePython})...`);
    if (cli.usePython) {
      runPythonAudioAnalyzer({
        audioFilePath: activeAudioPath,
        lrcFilePath: activeLrcPath,
        outManifestPath: manifestPath,
        outBinaryPath: binaryPath,
        fps
      });
    } else {
      await analyzeWavFileToArtifacts({
        wavFilePath: activeAudioPath,
        lrcFilePath: activeLrcPath,
        outManifestPath: manifestPath,
        outBinaryPath: binaryPath,
        fps
      });
    }
  }

  const { manifest: audioManifest, reader: audioReader } = loadAudioAnalysis(manifestPath);
  const totalFrames = audioManifest.metadata.totalFrames;
  const durationSec = audioManifest.metadata.durationSeconds;
  const onsetFrames = audioManifest.beatEvents.map((b) => b.frameIndex);

  console.log(
    `✓ Audio ready: ${formatDuration(durationSec)} | ${totalFrames} frames @ ${fps}fps | ${audioManifest.lyrics.length} lyrics | Buffer: ${(audioReader.byteLength / 1024).toFixed(1)} KB`
  );

  // 2. Multi-Agent Narrative Orchestration
  console.log(`\n[Stage 2/5] Synthesizing Full-Song Narrative (Provider: ${cli.providerName})...`);
  const provider: LlmProvider =
    cli.providerName === 'openai'
      ? new OpenAiCompatibleProvider()
      : new DeterministicMockLlmProvider();

  const orchestrator = new StudioAgentOrchestrator(provider);
  const orchestration = await orchestrator.orchestrate({
    projectId: 'trashed-and-scattered-production',
    audioManifest,
    getAudioFeatureAtFrame: (f) => audioReader.getFrameFeature(f),
    width,
    height,
    maxRetries: 3
  });

  console.log(
    `✓ Storyboard synthesized: ${orchestration.storyboard.acts.length} Acts | ${orchestration.storyboard.shots.length} Shots | ${orchestration.rigs.size} Rigs`
  );

  // 3. Checkpoint Planning & Partitioning
  console.log(`\n[Stage 3/5] Evaluating Production Checkpoints & Chunks...`);
  const effectiveTotalFrames =
    cli.maxChunks !== undefined
      ? Math.min(totalFrames, cli.maxChunks * cli.chunkFrames)
      : totalFrames;

  const checkpointManager = new CheckpointManager({
    totalFrames: effectiveTotalFrames,
    chunkFrames: cli.chunkFrames,
    chunksDir,
    autoCleanCorrupted: true
  });

  const checkpointStatus = checkpointManager.evaluateStatus();
  console.log(
    `Total Chunks: ${checkpointStatus.totalChunks} (Chunk size: ${cli.chunkFrames}f / ~${(cli.chunkFrames / fps).toFixed(1)}s)`
  );
  console.log(
    `Completed: ${checkpointStatus.completedCount} | Pending: ${checkpointStatus.pendingCount}`
  );

  // 4. Render Engine Setup
  const stateBuilder = new FrameStateBuilder({
    storyboard: orchestration.storyboard,
    audioManifest,
    rigs: orchestration.rigs,
    choreography: orchestration.choreography,
    getAudioFeatureAtFrame: (f) => audioReader.getFrameFeature(f)
  });
  const compositor = new SceneCompositor({ width, height, fps });

  const renderConfig = createRenderConfig({
    width,
    height,
    fps,
    pixelFormat: 'rgba',
    preset: 'veryfast',
    crf: 18,
    threads: 2,
    totalFrames: cli.chunkFrames
  });

  const globalFrameGenerator = (globalIndex: number): string => {
    const clampedIndex = Math.max(0, Math.min(totalFrames - 1, globalIndex));
    const frameState = stateBuilder.buildFrameState(clampedIndex);
    const env = orchestration.getEnvironmentForShot(frameState.shotId);
    const result = compositor.renderFrame(
      frameState,
      orchestration.rigs,
      env,
      onsetFrames,
      (f) => audioReader.getFrameFeature(Math.max(0, Math.min(totalFrames - 1, f)))
    );
    return result.svg;
  };

  // 5. Chunk Rendering Execution Loop
  console.log(`\n[Stage 4/5] Executing Chunked Streaming Renderer (Strictly Zero Disk I/O)...`);
  const sampler = new PipelineMemorySampler(100);
  sampler.start();

  const productionStartWall = performance.now();
  let renderedFramesInSession = 0;
  let lastProgressUpdate = 0;

  for (let c = 0; c < checkpointStatus.totalChunks; c++) {
    const chunk = checkpointManager.descriptors[c];
    const inspection = checkpointStatus.chunks[c];

    if (cli.resume && inspection.status === 'COMPLETED') {
      console.log(
        `✓ Chunk ${c + 1}/${checkpointStatus.totalChunks} [${chunk.startFrame}..${chunk.endFrame}) already valid (${chunk.frameCount} frames). Skipped.`
      );
      continue;
    }

    console.log(
      `\nRendering Chunk ${c + 1}/${checkpointStatus.totalChunks}: [frames ${chunk.startFrame}..${chunk.endFrame}) -> "${chunk.filename}"`
    );

    const chunkStartWall = performance.now();

    await renderChunk({
      chunk,
      renderConfig,
      frameGenerator: globalFrameGenerator,
      onChunkFrameRendered: (localIndex, globalIndex) => {
        renderedFramesInSession++;
        const now = performance.now();
        if (now - lastProgressUpdate > 150 || localIndex === chunk.frameCount - 1) {
          lastProgressUpdate = now;
          const overallProgress = (globalIndex + 1) / effectiveTotalFrames;
          const elapsedSec = (now - productionStartWall) / 1000;
          const currentFps =
            renderedFramesInSession > 0 && elapsedSec > 0
              ? (renderedFramesInSession / elapsedSec).toFixed(1)
              : '0.0';
          const remainingFrames = effectiveTotalFrames - (globalIndex + 1);
          const etaSec = Number(currentFps) > 0 ? remainingFrames / Number(currentFps) : 0;
          const rssMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);

          const progressBar = renderProgressBar(overallProgress, 20);
          const pct = (overallProgress * 100).toFixed(1);

          process.stdout.write(
            `\r[${c + 1}/${checkpointStatus.totalChunks}] ${progressBar} ${globalIndex + 1}/${effectiveTotalFrames}f (${pct}%) | ${currentFps} FPS | RSS: ${rssMb}MB | ETA: ${formatDuration(etaSec)} `
          );
        }
      }
    });

    const chunkElapsedSec = (performance.now() - chunkStartWall) / 1000;
    const chunkFps = (chunk.frameCount / Math.max(0.001, chunkElapsedSec)).toFixed(1);
    console.log(
      `\n✓ Chunk ${c + 1} committed cleanly in ${chunkElapsedSec.toFixed(1)}s (${chunkFps} FPS).`
    );
  }

  const memoryStats = sampler.stop();

  // 6. Lossless Concat Demuxer & Master Audio Muxing
  console.log(`\n[Stage 5/5] Losslessly Stitching Chunks with Master Continuous Audio...`);
  const finalOutputPath = path.join(OUTPUT_DIR, cli.outFilename);
  const orderedChunkPaths = checkpointManager.getOrderedChunkPaths();

  const stitchResult = await stitchChunksWithMasterAudio({
    chunkPaths: orderedChunkPaths,
    outputPath: finalOutputPath,
    masterAudioPath: activeAudioPath,
    audioBitrateKbps: cli.bitrateKbps,
    totalExpectedFrames: effectiveTotalFrames,
    tempDir: OUTPUT_DIR
  });

  const totalWallMs = performance.now() - productionStartWall;
  const probe = probeVideo(finalOutputPath);
  assertBt709Tv(probe.stream);

  // Check Artifact Hygiene
  const residualImages = findTemporaryImageFiles();
  if (residualImages.length > 0) {
    throw new Error(`Hygiene Violation: Found ${residualImages.length} intermediate disk images!`);
  }

  console.log('\n================================================================');
  console.log('             PRODUCTION VIDEO GENERATED SUCCESSFULLY!           ');
  console.log('================================================================');
  console.log(` Output Video:        ${finalOutputPath}`);
  console.log(` File Size:           ${(stitchResult.fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(` Total Frames:        ${probe.frameCount} frames`);
  console.log(` Duration:            ${formatDuration(stitchResult.durationSeconds ?? durationSec)}`);
  console.log(` Resolution:          ${probe.stream.width}x${probe.stream.height} @ ${fps}fps`);
  console.log(` Color Metadata:      BT.709 tv limited-range (Verified)`);
  console.log(` Audio Stream:        AAC ${cli.bitrateKbps}kbps stereo (Continuous Master)`);
  console.log(` Peak Aggregate RSS:  ${memoryStats.peakAggregateRssMb.toFixed(2)} MB (< 400 MB target)`);
  console.log(` Peak Node RSS:       ${memoryStats.peakNodeRssMb.toFixed(2)} MB`);
  console.log(` Wall Time:           ${formatDuration(totalWallMs / 1000)}`);
  console.log(` Intermediate Images: 0 bytes (Strictly Zero Per-Frame Disk I/O)`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\n[FATAL ERROR during production video generation]:', err);
  process.exit(1);
});
