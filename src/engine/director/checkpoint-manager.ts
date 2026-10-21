import fs from 'node:fs';
import path from 'node:path';
import { probeVideo } from '../../diagnostics/ffprobe.js';

export interface ChunkDescriptor {
  chunkIndex: number;
  startFrame: number;
  endFrame: number;
  frameCount: number;
  filename: string;
  filePath: string;
}

export type ChunkStatus = 'COMPLETED' | 'PENDING' | 'CORRUPTED';

export interface ChunkInspectionResult {
  chunk: ChunkDescriptor;
  status: ChunkStatus;
  actualFrames?: number;
  reason?: string;
}

export interface CheckpointManifest {
  totalFrames: number;
  chunkFrames: number;
  totalChunks: number;
  completedCount: number;
  pendingCount: number;
  isComplete: boolean;
  chunks: ChunkInspectionResult[];
}

/**
 * Divides a total frame timeline into deterministic chunk segments of at most `chunkFrames` frames.
 */
export function partitionSongIntoChunks(
  totalFrames: number,
  chunkFrames: number,
  chunksDir: string
): ChunkDescriptor[] {
  if (totalFrames <= 0) {
    throw new Error(`totalFrames must be positive, got ${totalFrames}`);
  }
  if (chunkFrames <= 0) {
    throw new Error(`chunkFrames must be positive, got ${chunkFrames}`);
  }

  const resolvedDir = path.resolve(chunksDir);
  const chunks: ChunkDescriptor[] = [];
  let currentStart = 0;
  let chunkIndex = 0;

  while (currentStart < totalFrames) {
    const endFrame = Math.min(totalFrames, currentStart + chunkFrames);
    const frameCount = endFrame - currentStart;
    const filename = `chunk_${String(chunkIndex).padStart(3, '0')}.mp4`;
    chunks.push({
      chunkIndex,
      startFrame: currentStart,
      endFrame,
      frameCount,
      filename,
      filePath: path.join(resolvedDir, filename)
    });
    currentStart = endFrame;
    chunkIndex++;
  }

  return chunks;
}

/**
 * Inspects a chunk MP4 on disk using ffprobe to verify completeness and frame alignment.
 */
export function inspectChunk(chunk: ChunkDescriptor): ChunkInspectionResult {
  if (!fs.existsSync(chunk.filePath)) {
    return {
      chunk,
      status: 'PENDING',
      reason: 'File does not exist on disk'
    };
  }

  try {
    const stat = fs.statSync(chunk.filePath);
    if (stat.size === 0) {
      return {
        chunk,
        status: 'CORRUPTED',
        actualFrames: 0,
        reason: 'Zero-byte empty file'
      };
    }

    const probe = probeVideo(chunk.filePath);
    const actualFrames = probe.frameCount ?? 0;

    if (actualFrames === chunk.frameCount) {
      return {
        chunk,
        status: 'COMPLETED',
        actualFrames
      };
    }

    return {
      chunk,
      status: 'CORRUPTED',
      actualFrames,
      reason: `Frame count mismatch: expected ${chunk.frameCount}, found ${actualFrames}`
    };
  } catch (err) {
    return {
      chunk,
      status: 'CORRUPTED',
      reason: `ffprobe failed to inspect file: ${(err as Error).message}`
    };
  }
}

export interface CheckpointManagerOptions {
  totalFrames: number;
  chunkFrames: number;
  chunksDir: string;
  autoCleanCorrupted?: boolean;
}

/**
 * Manages production chunks, verifies existing outputs, and provides fault-tolerant resume capabilities.
 */
export class CheckpointManager {
  public readonly totalFrames: number;
  public readonly chunkFrames: number;
  public readonly chunksDir: string;
  private readonly autoCleanCorrupted: boolean;
  public readonly descriptors: ChunkDescriptor[];

  constructor(options: CheckpointManagerOptions) {
    this.totalFrames = options.totalFrames;
    this.chunkFrames = options.chunkFrames;
    this.chunksDir = path.resolve(options.chunksDir);
    this.autoCleanCorrupted = options.autoCleanCorrupted ?? true;
    this.descriptors = partitionSongIntoChunks(this.totalFrames, this.chunkFrames, this.chunksDir);
  }

  /**
   * Scans the chunks directory, inspects each chunk with ffprobe, optionally purges corrupted
   * partial files, and returns a comprehensive checkpoint status manifest.
   */
  public evaluateStatus(): CheckpointManifest {
    fs.mkdirSync(this.chunksDir, { recursive: true });

    const results: ChunkInspectionResult[] = [];
    let completedCount = 0;

    for (const desc of this.descriptors) {
      const inspection = inspectChunk(desc);
      if (inspection.status === 'COMPLETED') {
        completedCount++;
      } else if (inspection.status === 'CORRUPTED' && this.autoCleanCorrupted) {
        // Clean corrupted/partial chunk so it will be freshly re-rendered
        fs.rmSync(desc.filePath, { force: true });
      }
      results.push(inspection);
    }

    const pendingCount = this.descriptors.length - completedCount;

    return {
      totalFrames: this.totalFrames,
      chunkFrames: this.chunkFrames,
      totalChunks: this.descriptors.length,
      completedCount,
      pendingCount,
      isComplete: pendingCount === 0,
      chunks: results
    };
  }

  /**
   * Returns only chunks that need to be rendered (PENDING or CORRUPTED).
   */
  public getPendingChunks(): ChunkDescriptor[] {
    const manifest = this.evaluateStatus();
    return manifest.chunks
      .filter((c) => c.status !== 'COMPLETED')
      .map((c) => c.chunk);
  }

  /**
   * Returns all chunk file paths in chronological sequence for concat demuxer stitching.
   */
  public getOrderedChunkPaths(): string[] {
    return this.descriptors.map((d) => d.filePath);
  }
}
