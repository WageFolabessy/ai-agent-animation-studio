import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRenderConfig } from '../src/config/render-config.js';
import { PipelineMemorySampler } from '../src/diagnostics/memory-sampler.js';
import { probeVideo, assertBt709Tv } from '../src/diagnostics/ffprobe.js';
import { OUTPUT_DIR } from '../src/config/paths.js';
import { DEMO_FPS } from '../src/demo/phase2-cinema/index.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import {
  loadAudioAnalysis,
  resolveCrossPlatformPath,
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
  type LlmProvider,
  type OrchestrationResult
} from '../src/agents/index.js';
import { DirectorStoryboardContractSchema } from '../src/schemas/storyboard.contract.js';
import { AssetRigContractSchema } from '../src/schemas/rig.contract.js';
import { ChoreographyContractSchema } from '../src/schemas/choreography.contract.js';
import { StorySpecContractSchema } from '../src/schemas/story-spec.contract.js';
import { EnvironmentKit } from '../src/engine/library/environment-kit.js';
import { getOrchestratedEnvironment } from '../src/agents/director-agent.js';
import { z } from 'zod';

interface StudioCliOptions {
  audioPath?: string;
  lrcPath?: string;
  outputPath: string;
  artifactsDir?: string;
  fromArtifactsDir?: string;
  providerName: 'mock' | 'openai';
  useSpec: boolean;
  chunkFrames: number;
  maxChunks?: number;
  resume: boolean;
  bitrateKbps: number;
  startFrame?: number;
  frameCount?: number;
}

function parseCliArgs(argv: string[]): StudioCliOptions {
  let audioPath: string | undefined;
  let lrcPath: string | undefined;
  let outputPath = path.join(OUTPUT_DIR, 'studio-render.mp4');
  let artifactsDir: string | undefined;
  let fromArtifactsDir: string | undefined;
  let providerName: 'mock' | 'openai' = 'mock';
  let useSpec = true;
  let chunkFrames = 1500; // ~50s @ 30fps
  let maxChunks: number | undefined;
  let resume = true;
  let bitrateKbps = 256;
  let startFrame: number | undefined;
  let frameCount: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--audio' && i + 1 < argv.length) {
      audioPath = argv[++i];
    } else if (arg === '--lrc' && i + 1 < argv.length) {
      lrcPath = argv[++i];
    } else if (arg === '--out' && i + 1 < argv.length) {
      outputPath = path.resolve(argv[++i]);
    } else if (arg === '--artifacts' && i + 1 < argv.length) {
      artifactsDir = path.resolve(argv[++i]);
    } else if (arg === '--from-artifacts' && i + 1 < argv.length) {
      fromArtifactsDir = path.resolve(argv[++i]);
    } else if (arg === '--provider' && i + 1 < argv.length) {
      const p = argv[++i];
      providerName = p === 'openai' ? 'openai' : 'mock';
    } else if (arg === '--mock') {
      providerName = 'mock';
    } else if (arg === '--spec') {
      useSpec = true;
    } else if (arg === '--no-spec') {
      useSpec = false;
    } else if (arg === '--chunk-frames' && i + 1 < argv.length) {
      chunkFrames = Math.max(30, Number.parseInt(argv[++i], 10));
    } else if (arg === '--max-chunks' && i + 1 < argv.length) {
      maxChunks = Math.max(1, Number.parseInt(argv[++i], 10));
    } else if (arg === '--start-frame' && i + 1 < argv.length) {
      startFrame = Math.max(0, Number.parseInt(argv[++i], 10));
    } else if (arg === '--frame-count' && i + 1 < argv.length) {
      frameCount = Math.max(1, Number.parseInt(argv[++i], 10));
    } else if (arg === '--no-resume') {
      resume = false;
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg === '--bitrate' && i + 1 < argv.length) {
      bitrateKbps = Number.parseInt(argv[++i], 10) || 256;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: npm run studio -- [options]

Options:
  --audio <file>           Path to master song file (.wav, .flac, .mp3)
  --lrc <file>             Path to synchronized lyrics file (.lrc)
  --out <file>             Target path for stitched MP4 output (default: output/studio-render.mp4)
  --artifacts <dir>        Directory to store intermediate artifacts (audio manifest, storyboard, rigs, choreo)
  --from-artifacts <dir>   Render directly from previously synthesized artifacts (skips LLM generation)
  --provider <name>        LLM backend provider: 'mock' or 'openai' (default: 'mock')
  --spec / --no-spec       Use 'Spec-Then-Compile' architecture (default: enabled)
  --chunk-frames <num>     Number of frames per rendered chunk (default: 1500)
  --max-chunks <num>       Maximum number of chunks to render (useful for quick previews)
  --start-frame <num>      Initial timeline frame index to start rendering from (default: 0)
  --frame-count <num>      Total number of frames to render from start-frame
  --resume / --no-resume   Resume rendering using valid existing chunk files (default: enabled)
  --bitrate <kbps>         Master continuous audio AAC bitrate in kbps (default: 256)
  --help, -h               Show this help message and exit
`);
      process.exit(0);
    }
  }

  return {
    ...(audioPath ? { audioPath } : {}),
    ...(lrcPath ? { lrcPath } : {}),
    outputPath,
    ...(artifactsDir ? { artifactsDir } : {}),
    ...(fromArtifactsDir ? { fromArtifactsDir } : {}),
    providerName,
    useSpec,
    chunkFrames,
    ...(maxChunks !== undefined ? { maxChunks } : {}),
    ...(startFrame !== undefined ? { startFrame } : {}),
    ...(frameCount !== undefined ? { frameCount } : {}),
    resume,
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
  console.log('       AUTONOMOUS AI AGENT ANIMATION STUDIO PRODUCTION CLI       ');
  console.log('================================================================');

  const cli = parseCliArgs(process.argv.slice(2));
  const width: 1920 = 1920;
  const height: 1080 = 1080;
  const fps: 30 | 60 = DEMO_FPS as 30;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const chunksDir = path.join(OUTPUT_DIR, 'chunks', path.basename(cli.outputPath, '.mp4'));
  fs.mkdirSync(chunksDir, { recursive: true });

  // 1. Resolve Audio Master & LRC
  const defaultFlac = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.flac');
  const defaultLrc = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.lrc');

  let activeAudioPath: string;
  let activeLrcPath: string | undefined;

  if (cli.audioPath) {
    activeAudioPath = resolveCrossPlatformPath(cli.audioPath);
    activeLrcPath = cli.lrcPath ? resolveCrossPlatformPath(cli.lrcPath) : undefined;
  } else if (fs.existsSync(defaultFlac)) {
    activeAudioPath = defaultFlac;
    activeLrcPath = fs.existsSync(defaultLrc) ? defaultLrc : undefined;
  } else {
    // Synthetic fallback
    const fallbackDir = path.join(OUTPUT_DIR, 'synthetic-fallback');
    fs.mkdirSync(fallbackDir, { recursive: true });
    activeAudioPath = path.join(fallbackDir, 'synth_song.wav');
    activeLrcPath = path.join(fallbackDir, 'synth_song.lrc');
    if (!fs.existsSync(activeAudioPath)) {
      console.log('Generating synthetic WAV soundtrack fallback (30.0s @ 140 BPM)...');
      fs.writeFileSync(
        activeAudioPath,
        synthesizeMusicalWavBuffer({ durationSeconds: 30.0, sampleRate: 44100, bpm: 140 })
      );
      fs.writeFileSync(
        activeLrcPath,
        '[00:00.00] Synthetic Studio Production\n[00:08.00] Cybernetic Horizon\n[00:18.00] Kinetic Convergence\n'
      );
    }
  }

  // Determine Artifacts Directory
  let artifactsDir: string;
  if (cli.fromArtifactsDir) {
    artifactsDir = cli.fromArtifactsDir;
  } else if (cli.artifactsDir) {
    artifactsDir = cli.artifactsDir;
  } else {
    const audioStat = fs.statSync(activeAudioPath);
    const audioKey = `${path.basename(activeAudioPath)}_${audioStat.size}_${audioStat.mtimeMs}`;
    const hash = crypto.createHash('sha256').update(audioKey).digest('hex').slice(0, 12);
    artifactsDir = path.join(OUTPUT_DIR, 'artifacts', hash);
  }
  fs.mkdirSync(artifactsDir, { recursive: true });

  console.log(`\n[Stage 1/5] Ingesting Audio Master: "${path.basename(activeAudioPath)}"`);
  const manifestPath = path.join(artifactsDir, 'audio-manifest.json');
  const binaryPath = path.join(artifactsDir, 'features.bin');

  const needsAnalysis =
    !cli.fromArtifactsDir &&
    (!fs.existsSync(manifestPath) ||
      !fs.existsSync(binaryPath) ||
      fs.statSync(binaryPath).size === 0);

  if (needsAnalysis) {
    console.log('Executing in-memory audio analysis (zero per-frame disk I/O)...');
    await analyzeWavFileToArtifacts({
      wavFilePath: activeAudioPath,
      lrcFilePath: activeLrcPath,
      outManifestPath: manifestPath,
      outBinaryPath: binaryPath,
      fps
    });
  }

  const { manifest: audioManifest, reader: audioReader } = loadAudioAnalysis(manifestPath);
  const totalFrames = audioManifest.metadata.totalFrames;
  const durationSec = audioManifest.metadata.durationSeconds;
  const onsetFrames = audioManifest.beatEvents.map((b) => b.frameIndex);

  console.log(
    `✓ Audio ready: ${formatDuration(durationSec)} | ${totalFrames} frames @ ${fps}fps | ${audioManifest.lyrics.length} lyrics`
  );

  // 2. Narrative Orchestration / Artifact Ingestion
  let orchestration: OrchestrationResult;

  if (cli.fromArtifactsDir) {
    console.log(`\n[Stage 2/5] Loading Pre-Synthesized Narrative from Artifacts: "${cli.fromArtifactsDir}"`);
    const storyboardFile = path.join(artifactsDir, 'storyboard.json');
    const rigsFile = path.join(artifactsDir, 'rigs.json');
    const choreoFile = path.join(artifactsDir, 'choreography.json');
    const specFile = path.join(artifactsDir, 'story-spec.json');

    const storyboard = DirectorStoryboardContractSchema.parse(
      JSON.parse(fs.readFileSync(storyboardFile, 'utf8'))
    );
    const rawRigs = JSON.parse(fs.readFileSync(rigsFile, 'utf8'));
    const rigsList = z.array(AssetRigContractSchema).parse(rawRigs.rigs ?? rawRigs);
    const rigsMap = new Map(rigsList.map((r) => [r.id, r]));
    const choreography = ChoreographyContractSchema.parse(
      JSON.parse(fs.readFileSync(choreoFile, 'utf8'))
    );

    let storySpec: any;
    if (fs.existsSync(specFile)) {
      storySpec = StorySpecContractSchema.parse(JSON.parse(fs.readFileSync(specFile, 'utf8')));
    }

    const shotMap = new Map(storyboard.shots.map((s) => [s.id, s]));
    const getEnvironmentForShot = (shotId: string) => {
      const shot = shotMap.get(shotId);
      const centerX = shot
        ? (shot.cameraStart.position[0] + shot.cameraEnd.position[0]) / 2
        : 0;
      if (storySpec) {
        const secDuration = totalFrames / storySpec.sections.length;
        const startFrame = shot?.frameRange.startFrameInclusive ?? 0;
        const secIdx = Math.min(
          storySpec.sections.length - 1,
          Math.floor(startFrame / secDuration)
        );
        const sec = storySpec.sections[secIdx];
        const xMin = shot ? Math.min(shot.cameraStart.position[0], shot.cameraEnd.position[0]) - 600 : centerX - 600;
        const xMax = shot ? Math.max(shot.cameraStart.position[0], shot.cameraEnd.position[0]) + 900 : centerX + 900;
        return EnvironmentKit.build({ section: sec, shotId, centerX, framing: shot?.framing, xMin, xMax });
      }
      const zone = shot?.environmentZone ?? 'ROOFTOP';
      const palette = shot?.palette;
      return getOrchestratedEnvironment(shotId, centerX, zone, palette);
    };

    orchestration = {
      storyboard,
      rigs: rigsMap,
      choreography,
      getEnvironmentForShot,
      projectValidation: { isValid: true, errors: [] },
      choreographyValidation: { isValid: true, errors: [] },
      attempts: []
    };
    console.log(`✓ Loaded from artifacts: ${storyboard.shots.length} Shots | ${rigsMap.size} Rigs`);
  } else {
    console.log(
      `\n[Stage 2/5] Synthesizing Narrative (Pipeline: ${cli.useSpec ? 'Spec-Then-Compile' : 'Classic Multi-Agent'}, Provider: ${cli.providerName})...`
    );
    const provider: LlmProvider =
      cli.providerName === 'openai'
        ? new OpenAiCompatibleProvider()
        : new DeterministicMockLlmProvider();

    const orchestrator = new StudioAgentOrchestrator(provider);
    orchestration = await orchestrator.orchestrate({
      projectId: path.basename(cli.outputPath, '.mp4'),
      audioManifest,
      getAudioFeatureAtFrame: (f) => audioReader.getFrameFeature(f),
      width,
      height,
      maxRetries: 3,
      useSpecPipeline: cli.useSpec
    });

    // Persist all artifacts
    console.log(`Persisting pipeline artifacts to: "${artifactsDir}"...`);
    fs.writeFileSync(
      path.join(artifactsDir, 'storyboard.json'),
      JSON.stringify(orchestration.storyboard, null, 2)
    );
    fs.writeFileSync(
      path.join(artifactsDir, 'rigs.json'),
      JSON.stringify({ rigs: Array.from(orchestration.rigs.values()) }, null, 2)
    );
    fs.writeFileSync(
      path.join(artifactsDir, 'choreography.json'),
      JSON.stringify(orchestration.choreography, null, 2)
    );
    fs.writeFileSync(
      path.join(artifactsDir, 'agent-log.json'),
      JSON.stringify(orchestration.attempts, null, 2)
    );
    if (orchestration.storySpec) {
      fs.writeFileSync(
        path.join(artifactsDir, 'story-spec.json'),
        JSON.stringify(orchestration.storySpec, null, 2)
      );
    }
    console.log(
      `✓ Storyboard synthesized: ${orchestration.storyboard.acts.length} Acts | ${orchestration.storyboard.shots.length} Shots | ${orchestration.rigs.size} Rigs`
    );
  }

  // 3. Partitioning & Checkpoints
  console.log(`\n[Stage 3/5] Evaluating Checkpoints & Chunks...`);
  const startFrame = cli.startFrame ?? 0;
  const availableFrames = Math.max(0, totalFrames - startFrame);
  const requestedFrames =
    cli.frameCount !== undefined
      ? Math.min(availableFrames, cli.frameCount)
      : availableFrames;

  const effectiveTotalFrames =
    cli.maxChunks !== undefined
      ? Math.min(requestedFrames, cli.maxChunks * cli.chunkFrames)
      : requestedFrames;

  const checkpointManager = new CheckpointManager({
    totalFrames: effectiveTotalFrames,
    chunkFrames: cli.chunkFrames,
    chunksDir,
    startFrame,
    autoCleanCorrupted: true
  });

  const checkpointStatus = checkpointManager.evaluateStatus();
  console.log(
    `Total Chunks: ${checkpointStatus.totalChunks} (Chunk size: ${cli.chunkFrames}f / ~${(cli.chunkFrames / fps).toFixed(1)}s)`
  );
  console.log(
    `Completed: ${checkpointStatus.completedCount} | Pending: ${checkpointStatus.pendingCount}`
  );

  // 4. Renderer Setup
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

  // 5. Chunk Rendering Loop
  console.log(`\n[Stage 4/5] Executing Streaming Renderer (Strictly Zero Disk I/O)...`);
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
        `✓ Chunk ${c + 1}/${checkpointStatus.totalChunks} [${chunk.startFrame}..${chunk.endFrame}) already valid. Skipped.`
      );
      continue;
    }

    console.log(
      `\nRendering Chunk ${c + 1}/${checkpointStatus.totalChunks}: [frames ${chunk.startFrame}..${chunk.endFrame}) -> "${chunk.filename}"`
    );

    await renderChunk({
      chunk,
      renderConfig,
      frameGenerator: globalFrameGenerator,
      onChunkFrameRendered: (localIndex, globalIndex) => {
        renderedFramesInSession++;
        const now = performance.now();
        if (now - lastProgressUpdate > 250 || localIndex === chunk.frameCount - 1) {
          lastProgressUpdate = now;
          const chunkProgress = (localIndex + 1) / chunk.frameCount;
          const overallProgress = (globalIndex - startFrame + 1) / effectiveTotalFrames;
          const elapsedSec = (now - productionStartWall) / 1000;
          const currentFps =
            renderedFramesInSession > 0 && elapsedSec > 0
              ? (renderedFramesInSession / elapsedSec).toFixed(1)
              : '0.0';
          const remainingFrames = effectiveTotalFrames - (globalIndex - startFrame + 1);
          const etaSec = Number(currentFps) > 0 ? remainingFrames / Number(currentFps) : 0;
          const rssMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);

          const progressBar = renderProgressBar(overallProgress, 20);
          const pct = (overallProgress * 100).toFixed(1);

          process.stdout.write(
            `\r[${c + 1}/${checkpointStatus.totalChunks}] ${progressBar} ${globalIndex - startFrame + 1}/${effectiveTotalFrames}f (${pct}%) | ${currentFps} FPS | RSS: ${rssMb}MB | ETA: ${formatDuration(etaSec)} `
          );
        }
      }
    });

    if (global.gc) {
      global.gc();
    }
  }

  const memoryStats = sampler.stop();
  const totalElapsedSec = (performance.now() - productionStartWall) / 1000;
  const effectiveFps = effectiveTotalFrames / totalElapsedSec;

  console.log('\n\n✓ All production chunks successfully rendered.');
  console.log(`  Total time: ${formatDuration(totalElapsedSec)} | Effective FPS: ${effectiveFps.toFixed(2)}`);
  console.log(`  Aggregate Node RSS: Peak ${memoryStats.peakNodeRssMb.toFixed(1)}MB (Peak Aggregate: ${memoryStats.peakAggregateRssMb.toFixed(1)}MB)`);

  // 6. Concat Stitcher & Master Audio Muxing
  console.log(`\n[Stage 5/5] Stitching Chunks & Multiplexing Master Audio into Final Output...`);
  const finalChunkPaths = checkpointManager.getOrderedChunkPaths();

  const stitchResult = await stitchChunksWithMasterAudio({
    chunkPaths: finalChunkPaths,
    outputPath: cli.outputPath,
    masterAudioPath: activeAudioPath,
    audioStartSeconds: startFrame / fps,
    audioBitrateKbps: cli.bitrateKbps,
    totalExpectedFrames: effectiveTotalFrames,
    tempDir: OUTPUT_DIR
  });

  console.log(`✓ Master Final Render: "${path.basename(stitchResult.finalOutputPath)}" (${(stitchResult.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)`);

  const probe = probeVideo(stitchResult.finalOutputPath);
  assertBt709Tv(probe.stream);
  console.log(`✓ Colorimetry Verified: BT.709 TV Broadcast Conformance (YUV420P, bt709/bt709/bt709)`);

  console.log('\n================================================================');
  console.log('                 PRODUCTION COMPLETED CLEANLY                   ');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\nProduction Pipeline Error:', err);
  process.exit(1);
});
