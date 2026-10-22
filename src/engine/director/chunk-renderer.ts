import type { RenderConfig } from '../../config/render-config.js';
import {
  RenderPipeline,
  type FrameTimings,
  type RenderPipelineResult
} from '../../renderer/pipeline.js';
import type { FrameStateBuilder } from './frame-state-builder.js';
import type {
  SceneCompositor,
  SceneEnvironment,
  SceneBudgetStats
} from '../compositor/scene-compositor.js';
import type { AssetRigContract } from '../../schemas/rig.contract.js';
import type { AudioFrameFeature } from '../../schemas/audio.contract.js';
import {
  type ChunkDescriptor,
  writeChunkMetadataAtomic
} from './checkpoint-manager.js';
import { ENGINE_RENDER_VERSION } from '../../config/render-version.js';

export interface GlobalFrameGeneratorOptions {
  frameStateBuilder: FrameStateBuilder;
  compositor: SceneCompositor;
  rigs: Map<string, AssetRigContract>;
  getEnvironmentForShot?: (shotId: string) => SceneEnvironment;
  onsetFrames?: readonly number[];
  getAudioFeatureAtFrame?: (frameIndex: number) => AudioFrameFeature;
  onBudgetStats?: (stats: SceneBudgetStats, globalFrameIndex: number) => void;
}

/**
 * Creates a reusable frame generator callback that maps any global frame index to an SVG string.
 */
export function createGlobalFrameGenerator(
  options: GlobalFrameGeneratorOptions
): (globalFrameIndex: number) => string {
  const {
    frameStateBuilder,
    compositor,
    rigs,
    getEnvironmentForShot,
    onsetFrames = [],
    getAudioFeatureAtFrame,
    onBudgetStats
  } = options;

  return (globalFrameIndex: number): string => {
    const frameState = frameStateBuilder.buildFrameState(globalFrameIndex);
    const env = getEnvironmentForShot ? getEnvironmentForShot(frameState.shotId) : {};
    const result = compositor.renderFrame(
      frameState,
      rigs,
      env,
      onsetFrames,
      getAudioFeatureAtFrame
    );

    if (onBudgetStats) {
      onBudgetStats(result.stats, globalFrameIndex);
    }

    return result.svg;
  };
}

export interface ChunkRenderOptions {
  /** Target chunk segment metadata defining [startFrame, endFrame). */
  chunk: ChunkDescriptor;
  /** Base render configuration (width, height, fps, preset, crf, threads). */
  renderConfig: RenderConfig;
  /** Function generating the SVG markup for a given global frame index. */
  frameGenerator: (globalFrameIndex: number) => string;
  /** Optional callback fired after each frame in this chunk is rendered. */
  onChunkFrameRendered?: (
    localFrameIndex: number,
    globalFrameIndex: number,
    timings: FrameTimings
  ) => void;
  /** Optional abort signal to cancel rendering cleanly. */
  abortSignal?: AbortSignal;
  /** Optional SHA-256 fingerprint for content-addressed caching (.meta.json). */
  fingerprint?: string;
  /** Optional callback notified with the active FFmpeg child PID when started and `null` when finished. */
  onChildPidChange?: (pid: number | null) => void;
}

/**
 * Renders a single chunk segment to disk atomically via RenderPipeline.
 *
 * Guarantees:
 * - Translates local chunk frame indices [0, frameCount) to global song frame indices [startFrame, endFrame).
 * - Encodes pure progressive H.264 video with BT.709 tv limited-range parameters.
 * - Writes to .part.mp4 staging before atomic commit to chunk.filePath.
 * - Strictly zero per-frame disk I/O (in-memory SVG -> Resvg -> FFmpeg stdin pipe).
 */
export async function renderChunk(options: ChunkRenderOptions): Promise<RenderPipelineResult> {
  const { chunk, renderConfig, frameGenerator, onChunkFrameRendered, abortSignal, onChildPidChange } = options;

  // Chunk video is encoded video-only with identical GOP/CRF/BT.709 parameters.
  // Master audio is mapped continuously in the concat-stitch step to prevent seam pops.
  const chunkConfig: RenderConfig = {
    ...renderConfig,
    totalFrames: chunk.frameCount,
    audio: undefined
  };

  const localFrameGenerator = (localFrameIndex: number): string => {
    const globalFrameIndex = chunk.startFrame + localFrameIndex;
    return frameGenerator(globalFrameIndex);
  };

  const onFrameRendered = onChunkFrameRendered
    ? (localFrameIndex: number, timings: FrameTimings) => {
        const globalFrameIndex = chunk.startFrame + localFrameIndex;
        onChunkFrameRendered(localFrameIndex, globalFrameIndex, timings);
      }
    : undefined;

  const pipeline = new RenderPipeline({
    config: chunkConfig,
    outputPath: chunk.filePath,
    frameGenerator: localFrameGenerator,
    onFrameRendered,
    abortSignal
  });

  try {
    const res = await pipeline.run((streamer) => {
      onChildPidChange?.(streamer.getChildPid() ?? null);
    });

    if (res.committed && options.fingerprint) {
      writeChunkMetadataAtomic(chunk.filePath, {
        chunkIndex: chunk.chunkIndex,
        startFrame: chunk.startFrame,
        endFrame: chunk.endFrame,
        frameCount: chunk.frameCount,
        fingerprint: options.fingerprint,
        engineRenderVersion: ENGINE_RENDER_VERSION,
        createdAt: new Date().toISOString()
      });
    }

    return res;
  } finally {
    onChildPidChange?.(null);
  }
}
