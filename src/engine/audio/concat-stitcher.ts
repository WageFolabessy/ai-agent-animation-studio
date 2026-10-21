import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveCrossPlatformPath } from './lrc-parser.js';
import { probeVideo, type VideoProbeResult } from '../../diagnostics/ffprobe.js';

export interface ConcatStitcherOptions {
  /** Ordered list of chunk MP4 file paths to concatenate. */
  chunkPaths: string[];
  /** Destination path for the final concatenated MP4. */
  outputPath: string;
  /** Optional master audio file (FLAC, WAV, MP3) to mux as a continuous soundtrack. */
  masterAudioPath?: string;
  /** Optional audio start offset in seconds for slicing (default: 0). */
  audioStartSeconds?: number;
  /** Audio bitrate in kbps when encoding master audio to AAC (default: 256). */
  audioBitrateKbps?: number;
  /** Expected total frame count across all chunks for post-stitch verification. */
  totalExpectedFrames?: number;
  /** Directory for temporary list files (defaults to destination folder). */
  tempDir?: string;
  /** Optional abort signal to cancel FFmpeg execution. */
  abortSignal?: AbortSignal;
}

export interface ConcatStitcherResult {
  finalOutputPath: string;
  probe: VideoProbeResult;
  totalFrames?: number;
  durationSeconds?: number;
  hasAudio: boolean;
  fileSizeBytes: number;
}

/**
 * Generates the FFmpeg concat demuxer script content for a sequence of chunk files.
 */
export function buildConcatDemuxerContent(chunkPaths: string[]): string {
  if (chunkPaths.length === 0) {
    throw new Error('Cannot build concat demuxer content from an empty chunk list');
  }

  const lines: string[] = ['ffconcat version 1.0'];
  for (const chunkPath of chunkPaths) {
    const resolved = path.resolve(chunkPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Chunk file does not exist for concat demuxer: ${resolved}`);
    }
    // Escape single quotes according to FFmpeg concat file specification: ' -> '\''
    const escaped = resolved.replace(/'/g, "'\\''");
    lines.push(`file '${escaped}'`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Writes the FFmpeg concat demuxer script to disk.
 */
export function writeConcatDemuxerFile(chunkPaths: string[], listFilePath: string): void {
  const content = buildConcatDemuxerContent(chunkPaths);
  fs.mkdirSync(path.dirname(listFilePath), { recursive: true });
  fs.writeFileSync(listFilePath, content, 'utf8');
}

/**
 * Stitches multiple video-only or muxed MP4 chunks losslessly via FFmpeg's concat demuxer
 * and optionally muxes an uncompressed continuous master audio track (FLAC/WAV -> AAC).
 *
 * Guarantees:
 * - Lossless video concatenation (-c:v copy, zero transcoding degradation).
 * - Atomic commit to outputPath using .part.mp4 staging.
 * - Single continuous master audio track with zero phase jumps or seam pops.
 * - Post-stitch verification via ffprobe.
 */
export async function stitchChunksWithMasterAudio(
  options: ConcatStitcherOptions
): Promise<ConcatStitcherResult> {
  const { chunkPaths, outputPath, masterAudioPath, audioBitrateKbps = 256 } = options;

  if (chunkPaths.length === 0) {
    throw new Error('stitchChunksWithMasterAudio requires at least one chunk path');
  }

  const resolvedOutput = path.resolve(outputPath);
  const outDir = path.dirname(resolvedOutput);
  fs.mkdirSync(outDir, { recursive: true });

  const stagingDir = options.tempDir ? path.resolve(options.tempDir) : outDir;
  fs.mkdirSync(stagingDir, { recursive: true });

  const listFilePath = path.join(
    stagingDir,
    `concat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`
  );
  writeConcatDemuxerFile(chunkPaths, listFilePath);

  const stagingOutputPath = resolvedOutput.endsWith('.mp4')
    ? `${resolvedOutput.slice(0, -4)}.part.mp4`
    : `${resolvedOutput}.part.mp4`;

  // Clean any stale staging file
  if (fs.existsSync(stagingOutputPath)) {
    fs.rmSync(stagingOutputPath, { force: true });
  }

  const ffmpegArgs: string[] = ['-y', '-f', 'concat', '-safe', '0', '-i', listFilePath];

  if (masterAudioPath) {
    const resolvedAudio = resolveCrossPlatformPath(masterAudioPath);
    if (!fs.existsSync(resolvedAudio)) {
      throw new Error(`Master audio file not found: ${resolvedAudio}`);
    }
    if (options.audioStartSeconds && options.audioStartSeconds > 0) {
      ffmpegArgs.push('-ss', options.audioStartSeconds.toFixed(3));
    }
    ffmpegArgs.push(
      '-i',
      resolvedAudio,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      `${audioBitrateKbps}k`,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-shortest'
    );
  } else {
    ffmpegArgs.push('-c:v', 'copy');
  }

  ffmpegArgs.push('-movflags', '+faststart', '-f', 'mp4', stagingOutputPath);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderrOutput = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrOutput += chunk.toString('utf8');
      });

      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          child.kill('SIGTERM');
          reject(new Error('Stitch operation aborted by signal'));
        });
      }

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn FFmpeg for concat: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const tailStderr = stderrOutput.split('\n').slice(-10).join('\n');
          reject(
            new Error(`FFmpeg concat demuxer exited with code ${code}. Stderr tail:\n${tailStderr}`)
          );
        }
      });
    });

    if (!fs.existsSync(stagingOutputPath)) {
      throw new Error(`Staging output file was not created: ${stagingOutputPath}`);
    }

    // Atomic commit
    fs.renameSync(stagingOutputPath, resolvedOutput);

    // Verify output with ffprobe
    const probe = probeVideo(resolvedOutput);

    if (options.totalExpectedFrames !== undefined && probe.frameCount !== undefined) {
      if (probe.frameCount !== options.totalExpectedFrames) {
        throw new Error(
          `Stitched video frame count mismatch: expected ${options.totalExpectedFrames}, got ${probe.frameCount}`
        );
      }
    }

    if (masterAudioPath && !probe.audioStream) {
      throw new Error('Expected stitched video to contain an AAC audio stream, but none was found');
    }

    const stat = fs.statSync(resolvedOutput);

    return {
      finalOutputPath: resolvedOutput,
      probe,
      totalFrames: probe.frameCount,
      durationSeconds: probe.format?.duration ? Number.parseFloat(probe.format.duration) : undefined,
      hasAudio: Boolean(probe.audioStream),
      fileSizeBytes: stat.size
    };
  } finally {
    // Clean up temporary concat list file
    if (fs.existsSync(listFilePath)) {
      fs.rmSync(listFilePath, { force: true });
    }
    // Clean up staging file if an error occurred before atomic rename
    if (fs.existsSync(stagingOutputPath)) {
      fs.rmSync(stagingOutputPath, { force: true });
    }
  }
}
