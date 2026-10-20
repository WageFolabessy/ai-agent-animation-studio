import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  mapFfmpegThreads,
  X264_MEMORY_PARAMS,
  type RenderConfig
} from '../config/render-config.js';
import { resolveCrossPlatformPath } from '../engine/audio/lrc-parser.js';

export interface FfmpegStreamerOptions {
  config: RenderConfig;
  /** Final `.mp4` path. It is resolved to an absolute path when the streamer is created. */
  outputPath: string;
  /** Replaces the spawned FFmpeg process. Intended for unit tests only. */
  childProcessForTesting?: ChildProcess;
}

const MAX_STDERR_LINES = 100;
const STDERR_SUMMARY_LINES = 10;

/**
 * Builds the FFmpeg argument vector for raw RGBA frames on stdin to H.264/MP4 (BT.709, limited range).
 * The arguments are passed to `spawn` as an array, so no shell is involved.
 */
export function buildFfmpegArgs(config: RenderConfig, stagingPath: string): string[] {
  if (!config.audio) {
    return [
      '-y',
      // Input options (before -i).
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${config.width}x${config.height}`,
      '-framerate', config.fps.toString(),
      '-probesize', '32',
      '-analyzeduration', '0',
      '-i', 'pipe:0',
      // Explicit RGB -> BT.709 limited-range YUV conversion.
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      // Output options (after -i).
      '-c:v', 'libx264',
      '-preset', config.preset,
      '-crf', config.crf.toString(),
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-color_range', 'tv',
      ...mapFfmpegThreads(config.threads),
      '-x264-params', X264_MEMORY_PARAMS,
      '-movflags', '+faststart',
      '-f', 'mp4',
      stagingPath
    ];
  }

  const resolvedAudioPath = resolveCrossPlatformPath(config.audio.filePath);
  const audioInputArgs: string[] = [];
  if (config.audio.startSeconds !== undefined) {
    audioInputArgs.push('-ss', config.audio.startSeconds.toString());
  }
  if (config.audio.durationSeconds !== undefined) {
    audioInputArgs.push('-t', config.audio.durationSeconds.toString());
  }
  audioInputArgs.push('-i', resolvedAudioPath);

  const bitrateKbps = config.audio.bitrateKbps ?? 192;

  return [
    '-y',
    // Input 0: Raw RGBA video frames on stdin
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${config.width}x${config.height}`,
    '-framerate', config.fps.toString(),
    '-probesize', '32',
    '-analyzeduration', '0',
    '-i', 'pipe:0',
    // Input 1: External audio file
    ...audioInputArgs,
    // Map video from Input 0 and primary audio from Input 1 (ignores embedded cover art in FLAC/MP3)
    '-map', '0:v:0',
    '-map', '1:a:0',
    // Explicit RGB -> BT.709 limited-range YUV conversion.
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    // Video encoding options
    '-c:v', 'libx264',
    '-preset', config.preset,
    '-crf', config.crf.toString(),
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-color_range', 'tv',
    ...mapFfmpegThreads(config.threads),
    '-x264-params', X264_MEMORY_PARAMS,
    // Audio encoding options
    '-c:a', 'aac',
    '-b:a', `${bitrateKbps}k`,
    '-shortest',
    '-movflags', '+faststart',
    '-f', 'mp4',
    stagingPath
  ];
}

/** Derives the `.part.mp4` staging path that FFmpeg writes to before the atomic commit. */
function deriveStagingPath(finalOutputPath: string): string {
  return finalOutputPath.replace(/\.mp4$/, '.part.mp4');
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Streams raw RGBA frames to an FFmpeg child process over stdin.
 *
 * Lifecycle guarantees:
 * - Every `writeFrame()` waits for both the write callback and, when `write()` returned
 *   `false`, the `drain` event, so memory use stays bounded (backpressure).
 * - FFmpeg writes only to a `.part.mp4` staging file. The caller commits it atomically.
 * - `abort()` is idempotent, kills the child, and removes the staging file.
 * - Close/error/abort events and the `AbortSignal` all settle a pending write.
 */
export class FfmpegStreamer {
  private child: ChildProcess | null = null;
  private readonly childProcessForTesting?: ChildProcess;
  private readonly config: RenderConfig;
  private readonly finalOutputPath: string;
  private readonly stagingOutputPath: string;
  private framesWritten = 0;
  private readonly stderrTail: string[] = [];
  private stagingCleaned = false;
  private isAborted = false;
  private abortReason: Error | null = null;
  private childExitCode: number | null = null;
  private childFailure: Error | null = null;
  private childClosePromise: Promise<number | null> | null = null;

  constructor(options: FfmpegStreamerOptions) {
    if (!options.outputPath.endsWith('.mp4')) {
      throw new Error(`FFmpeg output path must end with ".mp4": "${options.outputPath}"`);
    }
    this.config = options.config;
    this.finalOutputPath = path.resolve(options.outputPath);
    this.stagingOutputPath = deriveStagingPath(this.finalOutputPath);
    this.childProcessForTesting = options.childProcessForTesting;
  }

  public getChildPid(): number | undefined {
    return this.child?.pid;
  }

  public getFramesWritten(): number {
    return this.framesWritten;
  }

  public getPartOutputPath(): string {
    return this.stagingOutputPath;
  }

  public getFinalOutputPath(): string {
    return this.finalOutputPath;
  }

  public isAlive(): boolean {
    if (!this.child) return false;
    return this.child.exitCode === null && !this.child.killed && !this.isAborted;
  }

  /**
   * Spawns FFmpeg and attaches all lifecycle listeners immediately, so a child that fails
   * or exits early can never produce an unhandled `error`/`EPIPE` or an unsettled promise.
   */
  public start(): void {
    if (this.child) {
      throw new Error('FFmpeg process has already been started');
    }

    if (this.childProcessForTesting) {
      this.child = this.childProcessForTesting;
      this.childClosePromise = this.createClosePromise(this.child);
      return;
    }

    fs.mkdirSync(path.dirname(this.stagingOutputPath), { recursive: true });
    // Remove a stale staging file from a previous crashed run; a missing file is fine.
    fs.rmSync(this.stagingOutputPath, { force: true });

    const child = spawn('ffmpeg', buildFfmpegArgs(this.config, this.stagingOutputPath), {
      stdio: ['pipe', 'ignore', 'pipe']
    });
    this.child = child;

    // Record stdin/spawn failures instead of letting them crash the process; they are
    // surfaced as errors by the next writeFrame() or finish() call.
    child.stdin?.on('error', (err: Error) => {
      this.childFailure ??= err;
    });
    child.on('error', (err: Error) => {
      this.childFailure ??= err;
      this.cleanupPartFile();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) {
          this.stderrTail.push(line);
          if (this.stderrTail.length > MAX_STDERR_LINES) {
            this.stderrTail.shift();
          }
        }
      }
    });

    // Created at start() so finish() cannot miss a `close` that happens earlier.
    this.childClosePromise = this.createClosePromise(child);
  }

  private createClosePromise(child: ChildProcess): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
      child.once('close', (code) => {
        this.childExitCode = code;
        resolve(code);
      });
      // A spawn failure (e.g. FFmpeg not installed) emits `error` and may never emit `close`.
      child.once('error', () => resolve(null));
    });
  }

  /**
   * Idempotent cancellation: destroys stdin, kills FFmpeg with SIGKILL, and removes the staging
   * file. Safe to call at any time, including before `start()` and more than once.
   */
  public abort(reason?: Error): void {
    if (this.isAborted) return;
    this.isAborted = true;
    this.abortReason = reason ?? null;

    if (this.child) {
      if (this.child.stdin && !this.child.stdin.destroyed && typeof this.child.stdin.destroy === 'function') {
        try {
          this.child.stdin.destroy();
        } catch {}
      }
      if (this.child.exitCode === null && !this.child.killed && typeof this.child.kill === 'function') {
        try {
          this.child.kill('SIGKILL');
        } catch {}
      }
    }

    this.cleanupPartFile();
  }

  /**
   * Writes one raw frame to FFmpeg stdin and resolves only after the chunk was flushed and,
   * if the stream signalled backpressure, after `drain`.
   *
   * All listeners are attached synchronously before the write so no event can be missed.
   */
  public async writeFrame(chunk: Uint8Array, signal?: AbortSignal): Promise<void> {
    const child = this.child;
    if (!child || !child.stdin) {
      throw new Error('FFmpeg process has not been started');
    }
    if (this.isAborted || signal?.aborted) {
      const reason = this.abortReason?.message ?? 'AbortSignal';
      this.abort();
      throw new Error(`Frame write aborted by ${reason}`);
    }
    if (this.childFailure) {
      this.abort();
      throw new Error(`FFmpeg stream failed before frame write: ${this.childFailure.message}`);
    }
    if (child.exitCode !== null || this.childExitCode !== null) {
      this.abort();
      throw new Error(
        `FFmpeg has already terminated with code ${this.childExitCode ?? child.exitCode}: ${this.getStderrSummary()}`
      );
    }
    if (chunk.byteLength !== this.config.expectedFrameBytes) {
      throw new Error(
        `Invalid frame byteLength: expected ${this.config.expectedFrameBytes}, received ${chunk.byteLength}`
      );
    }

    const stdin = child.stdin;
    let writeCallbackDone = false;
    let writeCallbackError: Error | null = null;
    let drainNeeded = false;
    let drainDone = false;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        stdin.removeListener('drain', onDrain);
        child.removeListener('close', onClose);
        child.removeListener('error', onFailure);
        stdin.removeListener('error', onFailure);
        signal?.removeEventListener('abort', onAbort);
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.abort(err);
        reject(err);
      };

      const checkComplete = () => {
        if (settled) return;
        if (writeCallbackError) {
          fail(writeCallbackError);
          return;
        }
        if (writeCallbackDone && (!drainNeeded || drainDone)) {
          settled = true;
          cleanup();
          this.framesWritten++;
          resolve();
        }
      };

      const onDrain = () => {
        drainDone = true;
        checkComplete();
      };
      const onClose = (code: number | null) => {
        fail(new Error(`FFmpeg closed with code ${code} during frame write: ${this.getStderrSummary()}`));
      };
      const onFailure = (err: Error) => fail(err);
      const onAbort = () => fail(new Error('AbortSignal triggered during frame write'));

      stdin.on('error', onFailure);
      child.on('error', onFailure);
      child.once('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });

      // The write callback may fire synchronously; `writeCalled` defers completion
      // until `drainNeeded` is known.
      let writeCalled = false;
      const ok = stdin.write(chunk, (err) => {
        writeCallbackDone = true;
        if (err) writeCallbackError = err;
        if (writeCalled) checkComplete();
      });

      if (!ok) {
        drainNeeded = true;
        stdin.once('drain', onDrain);
      }

      writeCalled = true;
      checkComplete();
    });
  }

  /**
   * Closes stdin and waits for FFmpeg to exit cleanly (exit code 0).
   * Aborts and throws if the frame count differs from `expectedTotalFrames` or FFmpeg fails.
   */
  public async finish(expectedTotalFrames: number): Promise<void> {
    const child = this.child;
    if (!child || !child.stdin) {
      throw new Error('FFmpeg process has not been started');
    }

    if (this.framesWritten !== expectedTotalFrames) {
      this.abort();
      throw new Error(
        `Frame count mismatch: expected ${expectedTotalFrames} frames, but ${this.framesWritten} were written`
      );
    }

    child.stdin.end();

    const exitCode = await (this.childClosePromise ?? Promise.resolve(child.exitCode));
    if (exitCode === 0 && !this.childFailure) {
      return;
    }

    const failure = this.childFailure ? ` (${this.childFailure.message})` : '';
    this.abort();
    throw new Error(`FFmpeg exited with non-zero code ${exitCode}${failure}: ${this.getStderrSummary()}`);
  }

  public getStderrSummary(): string {
    return this.stderrTail.slice(-STDERR_SUMMARY_LINES).join('\n');
  }

  /** Removes the staging file once. A missing file is ignored; other failures are reported. */
  public cleanupPartFile(): void {
    if (this.stagingCleaned) return;
    this.stagingCleaned = true;
    try {
      fs.rmSync(this.stagingOutputPath, { force: true });
    } catch (err) {
      const code = isErrnoException(err) ? err.code : 'UNKNOWN';
      console.warn(`[FfmpegStreamer] Failed to remove staging file "${this.stagingOutputPath}" (${code}).`);
    }
  }
}
