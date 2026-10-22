import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRenderConfig } from '../../config/render-config.js';
import { OUTPUT_DIR } from '../../config/paths.js';
import { ENGINE_RENDER_VERSION } from '../../config/render-version.js';
import { PipelineMemorySampler } from '../../diagnostics/memory-sampler.js';
import { probeVideo, assertBt709Tv } from '../../diagnostics/ffprobe.js';
import { findTemporaryImageFiles } from '../../diagnostics/artifact-hygiene.js';
import { FrameStateBuilder } from './frame-state-builder.js';
import { SceneCompositor } from '../compositor/scene-compositor.js';
import {
  loadAudioAnalysis,
  resolveCrossPlatformPath,
  analyzeWavFileToArtifacts,
  runPythonAudioAnalyzer,
  synthesizeMusicalWavBuffer,
  stitchChunksWithMasterAudio,
  AUDIO_ANALYZER_VERSION
} from '../audio/index.js';
import {
  CheckpointManager,
  computeChunkFingerprint,
  canonicalJsonStringify,
  partitionSongIntoChunks
} from './checkpoint-manager.js';
import { renderChunk } from './chunk-renderer.js';
import {
  DeterministicMockLlmProvider,
  OpenAiCompatibleProvider,
  StudioAgentOrchestrator,
  type LlmProvider,
  type OrchestrationResult
} from '../../agents/index.js';
import { DirectorStoryboardContractSchema } from '../../schemas/storyboard.contract.js';
import { AssetRigContractSchema } from '../../schemas/rig.contract.js';
import { ChoreographyContractSchema } from '../../schemas/choreography.contract.js';
import { StorySpecContractSchema, type SectionStagingSpec, type StorySpecContract } from '../../schemas/story-spec.contract.js';
import { EnvironmentKit } from '../library/environment-kit.js';
import { getOrchestratedEnvironment } from './environment-generator.js';
import { z } from 'zod';

export interface ProductionProgress {
  readonly chunkIndex: number;
  readonly totalChunks: number;
  readonly currentFrame: number;
  readonly totalFrames: number;
  readonly overallProgress: number;
  readonly currentFps: number;
  readonly rssMb: number;
  readonly etaSeconds: number;
}

export interface ProductionPipelineOptions {
  readonly audioPath?: string;
  readonly lrcPath?: string;
  readonly outputPath?: string;
  readonly outFilename?: string;
  readonly artifactsDir?: string;
  readonly fromArtifactsDir?: string;
  readonly provider?: LlmProvider;
  readonly providerName?: 'mock' | 'openai';
  readonly usePythonAudio?: boolean;
  readonly useSpecPipeline?: boolean;
  readonly storySpec?: StorySpecContract;
  readonly noLyricsInPrompt?: boolean;
  readonly chunkFrames?: number;
  readonly maxChunks?: number;
  readonly startFrame?: number;
  readonly frameCount?: number;
  readonly resume?: boolean;
  readonly bitrateKbps?: number;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: 30 | 60;
  readonly preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';
  readonly crf?: number;
  readonly threads?: number;
  readonly quiet?: boolean;
  readonly onProgress?: (progress: ProductionProgress) => void;
}

export interface ProductionPipelineResult {
  readonly finalOutputPath: string;
  readonly fileSizeBytes: number;
  readonly totalFrames: number;
  readonly durationSeconds: number;
  readonly resolution: { width: number; height: number };
  readonly fps: number;
  readonly peakAggregateRssMb: number;
  readonly peakNodeRssMb: number;
  readonly wallTimeSeconds: number;
  readonly effectiveFps: number;
  readonly artifactsDir: string;
}

export function renderProgressBar(ratio: number, width = 24): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.min(width, Math.round(clamped * width));
  const bar =
    '='.repeat(filled) + (filled < width ? '>' : '') + ' '.repeat(Math.max(0, width - filled - 1));
  return `[${bar}]`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

/**
 * Executes the complete autonomous music video production pipeline:
 * Audio Ingestion -> Story Spec & Storyboard -> Checkpointed Chunk Streaming -> Audio Stitching & Colorimetry.
 */
export async function runProductionPipeline(
  options: ProductionPipelineOptions = {}
): Promise<ProductionPipelineResult> {
  const width: 1920 = 1920;
  const height: 1080 = 1080;
  const fps: 30 | 60 = options.fps === 60 ? 60 : 30;
  const chunkFrames = options.chunkFrames ?? 1500;
  const resume = options.resume !== false;
  const bitrateKbps = options.bitrateKbps ?? 256;
  const quiet = options.quiet === true;
  const usePythonAudio = options.usePythonAudio === true;

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Determine final output path
  let finalOutputPath: string;
  if (options.outputPath) {
    finalOutputPath = path.resolve(options.outputPath);
  } else if (options.outFilename) {
    finalOutputPath = path.join(OUTPUT_DIR, options.outFilename);
  } else {
    finalOutputPath = path.join(OUTPUT_DIR, 'production-output.mp4');
  }

  const outputDir = path.dirname(finalOutputPath);
  const chunksDir = path.join(outputDir, 'chunks', path.basename(finalOutputPath, '.mp4'));
  fs.mkdirSync(chunksDir, { recursive: true });

  // 1. Resolve Audio Master & Optional LRC
  let activeAudioPath: string;
  let activeLrcPath: string | undefined;

  if (options.audioPath) {
    activeAudioPath = resolveCrossPlatformPath(options.audioPath);
    activeLrcPath = options.lrcPath ? resolveCrossPlatformPath(options.lrcPath) : undefined;
  } else {
    // Synthetic fallback when no audio source is supplied
    const fallbackDir = path.join(outputDir, 'synthetic-fallback');
    fs.mkdirSync(fallbackDir, { recursive: true });
    activeAudioPath = path.join(fallbackDir, 'synth_song.wav');
    activeLrcPath = path.join(fallbackDir, 'synth_song.lrc');
    if (!fs.existsSync(activeAudioPath)) {
      if (!quiet) {
        console.log('Generating synthetic WAV soundtrack fallback (30.0s @ 140 BPM)...');
      }
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

  // 2. Resolve Artifacts Directory
  let artifactsDir: string;
  const audioContent = fs.readFileSync(activeAudioPath);
  const audioContentHash = crypto.createHash('sha256').update(audioContent).digest('hex');
  const lrcContentHash = activeLrcPath && fs.existsSync(activeLrcPath)
    ? crypto.createHash('sha256').update(fs.readFileSync(activeLrcPath)).digest('hex')
    : '';
  const audioKey = crypto
    .createHash('sha256')
    .update(
      canonicalJsonStringify({
        audioContentHash,
        lrcContentHash,
        fps,
        start: options.startFrame ?? 0,
        duration: options.frameCount ?? 0,
        analyzerVersion: AUDIO_ANALYZER_VERSION
      })
    )
    .digest('hex');

  if (options.fromArtifactsDir) {
    artifactsDir = path.resolve(options.fromArtifactsDir);
  } else if (options.artifactsDir) {
    artifactsDir = path.resolve(options.artifactsDir);
  } else {
    artifactsDir = path.join(outputDir, 'artifacts', audioKey.slice(0, 16));
  }
  fs.mkdirSync(artifactsDir, { recursive: true });

  if (!quiet) {
    console.log(`\n[Stage 1/5] Ingesting Audio Master: "${path.basename(activeAudioPath)}"`);
  }

  const manifestPath = path.join(artifactsDir, 'audio-manifest.json');
  const binaryPath = path.join(artifactsDir, 'features.bin');

  const needsAnalysis =
    !options.fromArtifactsDir &&
    (!fs.existsSync(manifestPath) ||
      !fs.existsSync(binaryPath) ||
      fs.statSync(binaryPath).size === 0);

  if (needsAnalysis) {
    if (!quiet) {
      console.log(`Executing audio feature analysis (usePython: ${usePythonAudio})...`);
    }
    if (usePythonAudio) {
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

  if (!quiet) {
    console.log(
      `✓ Audio ready: ${formatDuration(durationSec)} | ${totalFrames} frames @ ${fps}fps | ${audioManifest.lyrics.length} lyrics`
    );
  }

  // 3. Narrative Orchestration
  let orchestration: OrchestrationResult;

  const agentMetaPath = path.join(artifactsDir, 'agent-meta.json');
  const storyboardFile = path.join(artifactsDir, 'storyboard.json');
  const rigsFile = path.join(artifactsDir, 'rigs.json');
  const choreoFile = path.join(artifactsDir, 'choreography.json');
  const specFile = path.join(artifactsDir, 'story-spec.json');

  const providerName =
    options.providerName ??
    (options.provider ? (options.provider as { name?: string }).name ?? 'custom' : 'mock');
  const modelId =
    (options.provider as { model?: string })?.model ??
    (providerName === 'openai' ? 'gpt-4o-mini' : 'deterministic-mock-v1');
  const lyricsInPromptFlag =
    (options as { noLyricsInPrompt?: boolean }).noLyricsInPrompt === true ? false : true;

  const expectedAgentKey = {
    audioKey,
    promptVersion: 1,
    provider: providerName,
    modelId,
    storySpecContractVersion: 1,
    lyricsInPromptFlag
  };

  let canReuseAgentArtifacts = false;
  if (
    !options.fromArtifactsDir &&
    fs.existsSync(agentMetaPath) &&
    fs.existsSync(storyboardFile) &&
    fs.existsSync(rigsFile) &&
    fs.existsSync(choreoFile)
  ) {
    try {
      const existingMeta = JSON.parse(fs.readFileSync(agentMetaPath, 'utf8'));
      if (canonicalJsonStringify(existingMeta) === canonicalJsonStringify(expectedAgentKey)) {
        canReuseAgentArtifacts = true;
      }
    } catch {
      canReuseAgentArtifacts = false;
    }
  }

  if (options.fromArtifactsDir || canReuseAgentArtifacts) {
    if (!quiet) {
      const reason = options.fromArtifactsDir ? 'explicit fromArtifactsDir' : 'matching agent-meta';
      console.log(`\n[Stage 2/5] Ingesting Pre-Synthesized Narrative from: "${artifactsDir}" (${reason})`);
    }
    const storyboard = DirectorStoryboardContractSchema.parse(
      JSON.parse(fs.readFileSync(storyboardFile, 'utf8'))
    );
    const rawRigs = JSON.parse(fs.readFileSync(rigsFile, 'utf8'));
    const rigsList = z.array(AssetRigContractSchema).parse(rawRigs.rigs ?? rawRigs);
    const rigsMap = new Map(rigsList.map((r) => [r.id, r]));
    const choreography = ChoreographyContractSchema.parse(
      JSON.parse(fs.readFileSync(choreoFile, 'utf8'))
    );

    let storySpec: StorySpecContract | undefined;
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
        const startFrame = shot?.frameRange.startFrameInclusive ?? 0;
        const sec = storySpec.sections.find(
          (s: SectionStagingSpec) => startFrame >= s.startFrame && startFrame < s.endFrame
        ) ?? storySpec.sections[storySpec.sections.length - 1];
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
      ...(storySpec ? { storySpec } : {}),
      getEnvironmentForShot,
      projectValidation: { isValid: true, errors: [] },
      choreographyValidation: { isValid: true, errors: [] },
      attempts: []
    };
  } else {
    if (!quiet) {
      console.log(`\n[Stage 2/5] Synthesizing Narrative with Spec-Then-Compile Architecture...`);
    }

    const provider: LlmProvider =
      options.provider ??
      (options.providerName === 'openai'
        ? new OpenAiCompatibleProvider()
        : new DeterministicMockLlmProvider());

    const orchestrator = new StudioAgentOrchestrator(provider);
    orchestration = await orchestrator.orchestrate({
      projectId: path.basename(finalOutputPath, '.mp4'),
      audioManifest,
      getAudioFeatureAtFrame: (f) => audioReader.getFrameFeature(f),
      width,
      height,
      maxRetries: 3,
      useSpecPipeline: true,
      noLyricsInPrompt: options.noLyricsInPrompt,
      ...(options.storySpec ? { storySpec: options.storySpec } : {})
    });

    // Persist artifacts
    fs.writeFileSync(
      storyboardFile,
      JSON.stringify(orchestration.storyboard, null, 2)
    );
    fs.writeFileSync(
      rigsFile,
      JSON.stringify({ rigs: Array.from(orchestration.rigs.values()) }, null, 2)
    );
    fs.writeFileSync(
      choreoFile,
      JSON.stringify(orchestration.choreography, null, 2)
    );
    fs.writeFileSync(
      path.join(artifactsDir, 'agent-log.json'),
      JSON.stringify(orchestration.attempts, null, 2)
    );
    if (orchestration.storySpec) {
      fs.writeFileSync(
        specFile,
        JSON.stringify(orchestration.storySpec, null, 2)
      );
    }
    fs.writeFileSync(
      agentMetaPath,
      JSON.stringify(expectedAgentKey, null, 2)
    );

    if (!quiet) {
      console.log(
        `✓ Storyboard synthesized: ${orchestration.storyboard.acts.length} Acts | ${orchestration.storyboard.shots.length} Shots | ${orchestration.rigs.size} Rigs`
      );
    }
  }

  // 4. Partitioning & Checkpoints
  const startFrame = options.startFrame ?? 0;
  const availableFrames = Math.max(0, totalFrames - startFrame);
  const requestedFrames =
    options.frameCount !== undefined
      ? Math.min(availableFrames, options.frameCount)
      : availableFrames;

  const effectiveTotalFrames =
    options.maxChunks !== undefined
      ? Math.min(requestedFrames, options.maxChunks * chunkFrames)
      : requestedFrames;

  const renderConfig = createRenderConfig({
    width,
    height,
    fps,
    pixelFormat: 'rgba',
    preset: options.preset ?? 'veryfast',
    crf: options.crf ?? 18,
    threads: options.threads ?? 2,
    totalFrames: chunkFrames
  });

  const initialDescriptors = partitionSongIntoChunks(
    effectiveTotalFrames,
    chunkFrames,
    chunksDir,
    startFrame
  );

  const audioManifestContent = fs.readFileSync(manifestPath, 'utf8');
  const audioManifestHash = crypto.createHash('sha256').update(audioManifestContent).digest('hex');
  const featuresBinBuffer = fs.readFileSync(binaryPath);
  const featuresBinSha256 = crypto.createHash('sha256').update(featuresBinBuffer).digest('hex');

  const expectedFingerprintsMap = new Map<number, string>();
  for (const chunk of initialDescriptors) {
    const overlappingShots = orchestration.storyboard.shots.filter(
      (s) =>
        s.frameRange.startFrameInclusive < chunk.endFrame &&
        s.frameRange.endFrameExclusive > chunk.startFrame
    );
    const environmentParams = overlappingShots.map((s) => ({
      shotId: s.id,
      framing: s.framing,
      cameraStart: s.cameraStart,
      cameraEnd: s.cameraEnd,
      environmentZone: s.environmentZone,
      palette: s.palette,
      env: orchestration.getEnvironmentForShot(s.id)
    }));

    const fp = computeChunkFingerprint({
      renderConfig,
      audioManifestHash,
      featuresBinSha256,
      storyboard: orchestration.storyboard,
      rigs: orchestration.rigs,
      choreography: orchestration.choreography,
      storySpec: orchestration.storySpec,
      environmentParams,
      chunkRange: { startFrame: chunk.startFrame, endFrame: chunk.endFrame },
      engineRenderVersion: ENGINE_RENDER_VERSION
    });
    expectedFingerprintsMap.set(chunk.chunkIndex, fp);
  }

  const checkpointManager = new CheckpointManager({
    totalFrames: effectiveTotalFrames,
    chunkFrames,
    chunksDir,
    startFrame,
    autoCleanCorrupted: true,
    expectedFingerprints: expectedFingerprintsMap
  });

  const checkpointStatus = checkpointManager.evaluateStatus(expectedFingerprintsMap);

  if (!quiet) {
    console.log(`\n[Stage 3/5] Evaluating Production Checkpoints & Chunks...`);
    console.log(
      `Total Chunks: ${checkpointStatus.totalChunks} (Chunk size: ${chunkFrames}f / ~${(chunkFrames / fps).toFixed(1)}s)`
    );
    console.log(
      `Completed: ${checkpointStatus.completedCount} | Pending: ${checkpointStatus.pendingCount}`
    );
  }

  // 5. Setup Rendering State Builder & Compositor
  const stateBuilder = new FrameStateBuilder({
    storyboard: orchestration.storyboard,
    audioManifest,
    rigs: orchestration.rigs,
    choreography: orchestration.choreography,
    getAudioFeatureAtFrame: (f) => audioReader.getFrameFeature(f)
  });
  const compositor = new SceneCompositor({ width, height, fps });

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

  // 6. Chunk Streaming Loop
  if (!quiet) {
    console.log(`\n[Stage 4/5] Executing Chunked Streaming Renderer (Strictly Zero Disk I/O)...`);
  }

  const sampler = new PipelineMemorySampler(100);
  sampler.start();

  const productionStartWall = performance.now();
  let renderedFramesInSession = 0;
  let lastProgressUpdate = 0;

  for (let c = 0; c < checkpointStatus.totalChunks; c++) {
    const chunk = checkpointManager.descriptors[c];
    const inspection = checkpointStatus.chunks[c];
    const fingerprint = expectedFingerprintsMap.get(chunk.chunkIndex);

    if (resume && inspection.status === 'COMPLETED') {
      if (!quiet) {
        console.log(
          `✓ Chunk ${c + 1}/${checkpointStatus.totalChunks} [${chunk.startFrame}..${chunk.endFrame}) already valid. Skipped.`
        );
      }
      continue;
    }

    if (!quiet) {
      console.log(
        `\nRendering Chunk ${c + 1}/${checkpointStatus.totalChunks}: [frames ${chunk.startFrame}..${chunk.endFrame}) -> "${chunk.filename}"`
      );
    }

    await renderChunk({
      chunk,
      renderConfig,
      frameGenerator: globalFrameGenerator,
      fingerprint,
      onChunkFrameRendered: (localIndex, globalIndex) => {
        renderedFramesInSession++;
        const now = performance.now();
        if (now - lastProgressUpdate > 200 || localIndex === chunk.frameCount - 1) {
          lastProgressUpdate = now;
          const currentProgressFrames = globalIndex - startFrame + 1;
          const overallProgress = currentProgressFrames / effectiveTotalFrames;
          const elapsedSec = (now - productionStartWall) / 1000;
          const currentFpsNum =
            renderedFramesInSession > 0 && elapsedSec > 0
              ? renderedFramesInSession / elapsedSec
              : 0;
          const remainingFrames = effectiveTotalFrames - currentProgressFrames;
          const etaSec = currentFpsNum > 0 ? remainingFrames / currentFpsNum : 0;
          const rssMb = process.memoryUsage().rss / 1024 / 1024;

          options.onProgress?.({
            chunkIndex: c,
            totalChunks: checkpointStatus.totalChunks,
            currentFrame: currentProgressFrames,
            totalFrames: effectiveTotalFrames,
            overallProgress,
            currentFps: Number(currentFpsNum.toFixed(1)),
            rssMb: Number(rssMb.toFixed(0)),
            etaSeconds: Math.round(etaSec)
          });

          if (!quiet) {
            const progressBar = renderProgressBar(overallProgress, 20);
            const pct = (overallProgress * 100).toFixed(1);
            process.stdout.write(
              `\r[${c + 1}/${checkpointStatus.totalChunks}] ${progressBar} ${currentProgressFrames}/${effectiveTotalFrames}f (${pct}%) | ${currentFpsNum.toFixed(1)} FPS | RSS: ${rssMb.toFixed(0)}MB | ETA: ${formatDuration(etaSec)} `
            );
          }
        }
      }
    });

    if (global.gc) {
      global.gc();
    }
  }

  const memoryStats = sampler.stop();
  const totalElapsedSec = (performance.now() - productionStartWall) / 1000;
  const effectiveFps = effectiveTotalFrames / Math.max(0.001, totalElapsedSec);

  // 7. Concat Stitcher & Master Audio Multiplexing
  if (!quiet) {
    console.log(`\n\n[Stage 5/5] Losslessly Stitching Chunks with Master Audio...`);
  }

  const finalStatus = checkpointManager.evaluateStatus(expectedFingerprintsMap);
  const incompleteChunks = finalStatus.chunks.filter((ch) => ch.status !== 'COMPLETED');
  if (incompleteChunks.length > 0) {
    const reasons = incompleteChunks
      .map((c) => `chunk ${c.chunk.chunkIndex}: ${c.status} (${c.reason ?? 'not completed'})`)
      .join(', ');
    throw new Error(`Cannot stitch chunks: Not all chunks are COMPLETED. ${reasons}`);
  }

  const finalChunkPaths = checkpointManager.getOrderedChunkPaths();

  const stitchResult = await stitchChunksWithMasterAudio({
    chunkPaths: finalChunkPaths,
    outputPath: finalOutputPath,
    masterAudioPath: activeAudioPath,
    audioStartSeconds: startFrame / fps,
    audioBitrateKbps: bitrateKbps,
    totalExpectedFrames: effectiveTotalFrames,
    tempDir: outputDir,
    expectedFingerprints: expectedFingerprintsMap,
    descriptors: checkpointManager.descriptors,
    checkChunkIntegrity: true
  });

  const probe = probeVideo(stitchResult.finalOutputPath);
  assertBt709Tv(probe.stream);

  // Check Artifact Hygiene
  const residualImages = findTemporaryImageFiles();
  if (residualImages.length > 0) {
    throw new Error(`Hygiene Violation: Found ${residualImages.length} intermediate disk images!`);
  }

  if (!quiet) {
    console.log('\n================================================================');
    console.log('             PRODUCTION VIDEO GENERATED SUCCESSFULLY!           ');
    console.log('================================================================');
    console.log(` Output Video:        ${stitchResult.finalOutputPath}`);
    console.log(` File Size:           ${(stitchResult.fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(` Total Frames:        ${probe.frameCount} frames`);
    console.log(` Duration:            ${formatDuration(stitchResult.durationSeconds ?? durationSec)}`);
    console.log(` Resolution:          ${probe.stream.width}x${probe.stream.height} @ ${fps}fps`);
    console.log(` Color Metadata:      BT.709 tv limited-range (Verified)`);
    console.log(` Audio Stream:        AAC ${bitrateKbps}kbps stereo (Continuous Master)`);
    console.log(` Peak Aggregate RSS:  ${memoryStats.peakAggregateRssMb.toFixed(2)} MB (< 400 MB target)`);
    console.log(` Peak Node RSS:       ${memoryStats.peakNodeRssMb.toFixed(2)} MB`);
    console.log(` Effective FPS:       ${effectiveFps.toFixed(2)}`);
    console.log(` Wall Time:           ${formatDuration(totalElapsedSec)}`);
    console.log(` Intermediate Images: 0 bytes (Strictly Zero Per-Frame Disk I/O)`);
    console.log('================================================================\n');
  }

  return {
    finalOutputPath: stitchResult.finalOutputPath,
    fileSizeBytes: stitchResult.fileSizeBytes,
    totalFrames: probe.frameCount ?? effectiveTotalFrames,
    durationSeconds: stitchResult.durationSeconds ?? durationSec,
    resolution: { width: probe.stream.width ?? width, height: probe.stream.height ?? height },
    fps,
    peakAggregateRssMb: memoryStats.peakAggregateRssMb,
    peakNodeRssMb: memoryStats.peakNodeRssMb,
    wallTimeSeconds: totalElapsedSec,
    effectiveFps,
    artifactsDir
  };
}
