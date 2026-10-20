import { z } from 'zod';

/**
 * x264 parameters chosen to keep encoder memory low (see README "Memory and performance gates"):
 * - `sliced-threads=1`: slice-based threading avoids per-thread frame buffers of frame-threading.
 * - `rc-lookahead=0`: removes the lookahead frame pool.
 * - `ref=1` / `bframes=0`: minimizes the reference and reorder buffers.
 */
export const X264_MEMORY_PARAMS = 'sliced-threads=1:rc-lookahead=0:ref=1:bframes=0';

/**
 * Thread count used when `threads` is `'auto'`. `-threads 0` lets libx264 pick one
 * worker per logical CPU, which measured ~680 MB of FFmpeg RSS on an 18-thread host
 * and breaks the 400 MB aggregate memory limit.
 */
export const AUTO_FFMPEG_THREADS = 2;

export const AudioMuxConfigSchema = z.object({
  filePath: z.string().min(1),
  startSeconds: z.number().finite().min(0).optional(),
  durationSeconds: z.number().finite().positive().optional(),
  bitrateKbps: z.union([z.literal(192), z.literal(256), z.literal(320)]).optional()
}).strict();

export type AudioMuxConfig = z.infer<typeof AudioMuxConfigSchema>;

export const BaseRenderConfigSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  pixelFormat: z.literal('rgba'),
  totalFrames: z.number().int().positive(),
  crf: z.number().int().min(0).max(51).default(18),
  preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow']).default('fast'),
  threads: z.union([z.literal('auto'), z.number().int().min(1).max(32)]).default(AUTO_FFMPEG_THREADS),
  audio: AudioMuxConfigSchema.optional()
}).strict();

export type BaseRenderConfigInput = z.input<typeof BaseRenderConfigSchema>;
export type BaseRenderConfigOutput = z.output<typeof BaseRenderConfigSchema>;

/** Production output is restricted to 1920x1080 at 30 or 60 fps. */
export const ProductionRenderConfigSchema = BaseRenderConfigSchema.extend({
  width: z.literal(1920),
  height: z.literal(1080),
  fps: z.union([z.literal(30), z.literal(60)])
}).strict();

export type RenderConfigInput = z.input<typeof ProductionRenderConfigSchema>;
export type RenderConfigOutput = z.output<typeof ProductionRenderConfigSchema>;

export interface RenderConfig extends BaseRenderConfigOutput {
  /** Exact byte length of one raw RGBA frame (`width * height * 4`). */
  readonly expectedFrameBytes: number;
}

function withFrameBytes(parsed: BaseRenderConfigOutput): RenderConfig {
  return { ...parsed, expectedFrameBytes: parsed.width * parsed.height * 4 };
}

/** Creates a validated production configuration (1920x1080, 30/60 fps). */
export function createRenderConfig(input: RenderConfigInput): RenderConfig {
  return withFrameBytes(ProductionRenderConfigSchema.parse(input));
}

/**
 * Creates a validated configuration for tests and conformance runs that need small
 * resolutions. It must not be used for production renders.
 */
export function createTestRenderConfig(input: BaseRenderConfigInput): RenderConfig {
  return withFrameBytes(BaseRenderConfigSchema.parse(input));
}

/**
 * Maps the `threads` setting to FFmpeg CLI arguments. `'auto'` resolves to
 * {@link AUTO_FFMPEG_THREADS} instead of `-threads 0` to protect the memory limit.
 */
export function mapFfmpegThreads(threads: 'auto' | number): string[] {
  const count = threads === 'auto' ? AUTO_FFMPEG_THREADS : threads;
  return ['-threads', count.toString()];
}
