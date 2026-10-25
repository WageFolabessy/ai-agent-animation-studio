import fs from 'node:fs';
import { SvgRasterizer } from './rasterizer.js';
import { FfmpegStreamer } from './ffmpeg-streamer.js';
import type { RenderConfig } from '../config/render-config.js';

/** Frames between explicit GC calls. Only active when Node runs with `--expose-gc`. */
const GC_INTERVAL_FRAMES = 25;

export interface FrameTimings {
  genMs: number;
  rasterMs: number;
  writeMs: number;
}

export interface RenderPipelineOptions {
  config: RenderConfig;
  /** Final `.mp4` path. The video is only visible there after a successful atomic commit. */
  outputPath: string;
  /** Produces the SVG markup for one frame. It must be deterministic for a given index. */
  frameGenerator: (frameIndex: number) => string;
  onFrameRendered?: (frameIndex: number, timings: FrameTimings) => void;
  abortSignal?: AbortSignal;
}

export interface RenderPipelineResult {
  /** Absolute path of the final video, committed atomically. */
  finalOutputPath: string;
  /**
   * Absolute path of the `.part.mp4` staging file FFmpeg wrote to.
   * It no longer exists after the atomic commit.
   */
  stagingPartPath: string;
  /** Always `true`: the pipeline throws instead of returning an uncommitted result. */
  committed: true;
  totalFrames: number;
  totalWallMs: number;
  avgGenMs: number;
  avgRasterMs: number;
  avgWriteMs: number;
  effectiveFps: number;
}

/**
 * Renders frames as in-memory SVG, rasterizes them to raw RGBA, and streams them to FFmpeg.
 *
 * Guarantees: no frame image is written to disk, memory is bounded by stdin backpressure,
 * the output is published by an atomic rename only after FFmpeg exited successfully, and
 * on any failure FFmpeg is killed and the staging file is removed.
 */
export class RenderPipeline {
  private readonly config: RenderConfig;
  private readonly outputPath: string;
  private readonly frameGenerator: (frameIndex: number) => string;
  private readonly onFrameRendered?: (frameIndex: number, timings: FrameTimings) => void;
  private readonly abortSignal?: AbortSignal;

  constructor(options: RenderPipelineOptions) {
    this.config = options.config;
    this.outputPath = options.outputPath;
    this.frameGenerator = options.frameGenerator;
    this.onFrameRendered = options.onFrameRendered;
    this.abortSignal = options.abortSignal;
  }

  /**
   * Runs the pipeline to completion.
   *
   * @param streamerRefCallback Receives the started streamer, e.g. for lifecycle diagnostics.
   */
  public async run(streamerRefCallback?: (streamer: FfmpegStreamer) => void): Promise<RenderPipelineResult> {
    const { totalFrames } = this.config;
    const rasterizer = new SvgRasterizer({
      width: this.config.width,
      height: this.config.height,
      loadSystemFonts: false
    });
    const streamer = new FfmpegStreamer({ config: this.config, outputPath: this.outputPath });

    const startWall = performance.now();
    let sumGenMs = 0;
    let sumRasterMs = 0;
    let sumWriteMs = 0;

    try {
      streamer.start();
      streamerRefCallback?.(streamer);

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (this.abortSignal?.aborted) {
          throw new Error('Pipeline rendering aborted by signal');
        }

        // 1. Generate the SVG string in memory.
        const t0 = performance.now();
        const svg = this.frameGenerator(frameIndex);
        const t1 = performance.now();

        // 2. Rasterize the SVG to a raw RGBA buffer.
        const rawBuffer = rasterizer.rasterize(svg);
        const t2 = performance.now();

        // 3. Write the frame to FFmpeg stdin, honoring backpressure.
        await streamer.writeFrame(rawBuffer, this.abortSignal);
        const t3 = performance.now();

        const timings: FrameTimings = { genMs: t1 - t0, rasterMs: t2 - t1, writeMs: t3 - t2 };
        sumGenMs += timings.genMs;
        sumRasterMs += timings.rasterMs;
        sumWriteMs += timings.writeMs;
        this.onFrameRendered?.(frameIndex, timings);

        // With --expose-gc, periodically release native buffers that V8 does not account for.
        if (frameIndex % GC_INTERVAL_FRAMES === 0) {
          globalThis.gc?.();
        }
      }

      await streamer.finish(totalFrames);

      const stagingPath = streamer.getPartOutputPath();
      const finalPath = streamer.getFinalOutputPath();
      if (!fs.existsSync(stagingPath)) {
        throw new Error(`Staging output file not found after FFmpeg finished: ${stagingPath}`);
      }

      // Atomic commit: the final path never contains a partially written video.
      fs.renameSync(stagingPath, finalPath);

      const totalWallMs = performance.now() - startWall;

      return {
        finalOutputPath: finalPath,
        stagingPartPath: stagingPath,
        committed: true,
        totalFrames,
        totalWallMs,
        avgGenMs: sumGenMs / totalFrames,
        avgRasterMs: sumRasterMs / totalFrames,
        avgWriteMs: sumWriteMs / totalFrames,
        effectiveFps: totalFrames / (totalWallMs / 1000)
      };
    } catch (err) {
      streamer.abort(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
}
