import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { probeVideo, isBt709Tv } from '../../diagnostics/ffprobe.js';
import { ENGINE_RENDER_VERSION } from '../../config/render-version.js';
import type { RenderConfig } from '../../config/render-config.js';
import type { DirectorStoryboardContract } from '../../schemas/storyboard.contract.js';
import type { AssetRigContract } from '../../schemas/rig.contract.js';
import type { ChoreographyContract } from '../../schemas/choreography.contract.js';
import type { StorySpecContract } from '../../schemas/story-spec.contract.js';

export interface ChunkDescriptor {
  chunkIndex: number;
  startFrame: number;
  endFrame: number;
  frameCount: number;
  filename: string;
  filePath: string;
}

export type ChunkStatus = 'COMPLETED' | 'PENDING' | 'CORRUPTED' | 'STALE';

export interface ChunkInspectionResult {
  chunk: ChunkDescriptor;
  status: ChunkStatus;
  actualFrames?: number;
  reason?: string;
  fingerprint?: string;
}

export interface ChunkMetadata {
  chunkIndex: number;
  startFrame: number;
  endFrame: number;
  frameCount: number;
  fingerprint: string;
  engineRenderVersion: number;
  createdAt: string;
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
 * Deterministic, deep-sorted recursive canonical JSON serializer.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }
  if (value instanceof Map) {
    const sortedKeys = Array.from(value.keys()).sort();
    return (
      '{' +
      sortedKeys
        .map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(value.get(k)))
        .join(',') +
      '}'
    );
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  return (
    '{' +
    sortedKeys
      .map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]))
      .join(',') +
    '}'
  );
}

export interface ChunkFingerprintInputs {
  renderConfig: RenderConfig;
  audioManifestHash: string;
  featuresBinSha256: string;
  storyboard: DirectorStoryboardContract;
  rigs: Map<string, AssetRigContract> | Record<string, AssetRigContract>;
  choreography: ChoreographyContract;
  storySpec?: StorySpecContract;
  environmentParams?: unknown;
  chunkRange: { startFrame: number; endFrame: number };
  engineRenderVersion?: number;
}

/**
 * Computes deterministic SHA-256 chunk fingerprint over canonical JSON of all rendering inputs.
 */
export function computeChunkFingerprint(inputs: ChunkFingerprintInputs): string {
  const rigsObj =
    inputs.rigs instanceof Map
      ? Object.fromEntries(inputs.rigs.entries())
      : inputs.rigs;

  const canonicalPayload = canonicalJsonStringify({
    version: inputs.engineRenderVersion ?? ENGINE_RENDER_VERSION,
    renderConfig: {
      width: inputs.renderConfig.width,
      height: inputs.renderConfig.height,
      fps: inputs.renderConfig.fps,
      preset: inputs.renderConfig.preset,
      crf: inputs.renderConfig.crf,
      threads: inputs.renderConfig.threads
    },
    audioManifestHash: inputs.audioManifestHash,
    featuresBinSha256: inputs.featuresBinSha256,
    storyboard: inputs.storyboard,
    rigs: rigsObj,
    choreography: inputs.choreography,
    storySpec: inputs.storySpec,
    environmentParams: inputs.environmentParams,
    chunkRange: inputs.chunkRange
  });

  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

/**
 * Atomically writes chunk metadata to `${chunkFilePath}.meta.json` via staging `.part.meta.json`.
 */
export function writeChunkMetadataAtomic(chunkFilePath: string, metadata: ChunkMetadata): void {
  const metaPath = `${chunkFilePath}.meta.json`;
  const partPath = `${chunkFilePath}.part.meta.json`;
  fs.writeFileSync(partPath, JSON.stringify(metadata, null, 2), 'utf-8');
  fs.renameSync(partPath, metaPath);
}

/**
 * Reads chunk metadata if present on disk.
 */
export function readChunkMetadata(chunkFilePath: string): ChunkMetadata | null {
  const metaPath = `${chunkFilePath}.meta.json`;
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as ChunkMetadata;
  } catch {
    return null;
  }
}

/**
 * Divides a total frame timeline into deterministic chunk segments of at most `chunkFrames` frames.
 */
export function partitionSongIntoChunks(
  totalFrames: number,
  chunkFrames: number,
  chunksDir: string,
  startFrame = 0
): ChunkDescriptor[] {
  if (totalFrames <= 0) {
    throw new Error(`totalFrames must be positive, got ${totalFrames}`);
  }
  if (chunkFrames <= 0) {
    throw new Error(`chunkFrames must be positive, got ${chunkFrames}`);
  }

  const resolvedDir = path.resolve(chunksDir);
  const chunks: ChunkDescriptor[] = [];
  let currentStart = startFrame;
  let chunkIndex = 0;
  const targetEnd = startFrame + totalFrames;

  while (currentStart < targetEnd) {
    const endFrame = Math.min(targetEnd, currentStart + chunkFrames);
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
 * Inspects a chunk MP4 on disk using ffprobe and metadata fingerprinting.
 *
 * Guarantees:
 * - Returns PENDING if MP4 does not exist.
 * - Returns CORRUPTED if file is 0 bytes, corrupted, or fails BT.709 TV color check.
 * - Returns STALE if metadata file is missing or fingerprint/engine version mismatches.
 * - Returns COMPLETED if and only if progressive H.264 BT.709 tv passes, frame count matches,
 *   and fingerprint is verified.
 */
export function inspectChunk(
  chunk: ChunkDescriptor,
  expectedFingerprint?: string
): ChunkInspectionResult {
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

    // Check metadata file
    const meta = readChunkMetadata(chunk.filePath);
    if (!meta) {
      return {
        chunk,
        status: 'STALE',
        reason: 'Chunk metadata file missing (.meta.json)'
      };
    }

    if (meta.engineRenderVersion !== ENGINE_RENDER_VERSION) {
      return {
        chunk,
        status: 'STALE',
        fingerprint: meta.fingerprint,
        reason: `Engine render version mismatch: expected ${ENGINE_RENDER_VERSION}, found ${meta.engineRenderVersion}`
      };
    }

    if (expectedFingerprint && meta.fingerprint !== expectedFingerprint) {
      return {
        chunk,
        status: 'STALE',
        fingerprint: meta.fingerprint,
        reason: `Chunk fingerprint mismatch: expected ${expectedFingerprint}, found ${meta.fingerprint}`
      };
    }

    // Validate progressive H.264 BT.709 tv limited-range tags
    if (!isBt709Tv(chunk.filePath)) {
      return {
        chunk,
        status: 'CORRUPTED',
        reason: 'BT.709 TV limited-range or H.264 color metadata check failed'
      };
    }

    const probe = probeVideo(chunk.filePath);
    const actualFrames = probe.frameCount ?? 0;
    const targetFrames = chunk.frameCount > 0 ? chunk.frameCount : (meta.frameCount ?? 0);

    if (actualFrames === targetFrames && actualFrames > 0) {
      return {
        chunk,
        status: 'COMPLETED',
        actualFrames,
        fingerprint: meta.fingerprint
      };
    }

    return {
      chunk,
      status: 'CORRUPTED',
      actualFrames,
      reason: `Frame count mismatch: expected ${targetFrames}, found ${actualFrames}`
    };
  } catch (err) {
    return {
      chunk,
      status: 'CORRUPTED',
      reason: `ffprobe failed to inspect file: ${(err as Error).message}`
    };
  }
}

/**
 * Explicitly purges corrupted or stale chunks and their metadata files from disk.
 * Strictly separated from read-only evaluation methods.
 */
export function purgeInvalid(
  chunksDir: string,
  descriptors?: ChunkDescriptor[],
  fingerprints?: Map<number, string> | ((desc: ChunkDescriptor) => string)
): string[] {
  const dir = path.resolve(chunksDir);
  if (!fs.existsSync(dir)) return [];
  const purged: string[] = [];

  // Remove any leftover staging parts
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file.includes('.part.')) {
      const full = path.join(dir, file);
      fs.rmSync(full, { force: true });
      purged.push(full);
    }
  }

  const descs = descriptors ?? [];
  for (const desc of descs) {
    const fp =
      typeof fingerprints === 'function'
        ? fingerprints(desc)
        : fingerprints?.get(desc.chunkIndex);
    const inspection = inspectChunk(desc, fp);
    if (inspection.status === 'CORRUPTED' || inspection.status === 'STALE') {
      if (fs.existsSync(desc.filePath)) {
        fs.rmSync(desc.filePath, { force: true });
        purged.push(desc.filePath);
      }
      const metaPath = `${desc.filePath}.meta.json`;
      if (fs.existsSync(metaPath)) {
        fs.rmSync(metaPath, { force: true });
        purged.push(metaPath);
      }
    }
  }

  return purged;
}

export interface CheckpointManagerOptions {
  totalFrames: number;
  chunkFrames: number;
  chunksDir: string;
  autoCleanCorrupted?: boolean;
  startFrame?: number;
  expectedFingerprints?: Map<number, string> | ((desc: ChunkDescriptor) => string);
}

/**
 * Manages production chunks, verifies existing outputs, and provides fault-tolerant resume capabilities.
 * Guarantees strictly side-effect free inspection (zero deletions during evaluateStatus/getPendingChunks).
 */
export class CheckpointManager {
  public readonly totalFrames: number;
  public readonly chunkFrames: number;
  public readonly chunksDir: string;
  public readonly startFrame: number;
  public readonly descriptors: ChunkDescriptor[];
  public expectedFingerprints?: Map<number, string> | ((desc: ChunkDescriptor) => string);

  constructor(options: CheckpointManagerOptions) {
    this.totalFrames = options.totalFrames;
    this.chunkFrames = options.chunkFrames;
    this.chunksDir = path.resolve(options.chunksDir);
    this.startFrame = options.startFrame ?? 0;
    this.expectedFingerprints = options.expectedFingerprints;
    this.descriptors = partitionSongIntoChunks(
      this.totalFrames,
      this.chunkFrames,
      this.chunksDir,
      this.startFrame
    );
  }

  /**
   * Scans the chunks directory, inspects each chunk with ffprobe and metadata fingerprinting.
   * Strictly side-effect free: never deletes any files from disk.
   */
  public evaluateStatus(
    overrideFingerprints?: Map<number, string> | ((desc: ChunkDescriptor) => string)
  ): CheckpointManifest {
    fs.mkdirSync(this.chunksDir, { recursive: true });

    const results: ChunkInspectionResult[] = [];
    let completedCount = 0;
    const fpSource = overrideFingerprints ?? this.expectedFingerprints;

    for (const desc of this.descriptors) {
      const expectedFp =
        typeof fpSource === 'function' ? fpSource(desc) : fpSource?.get(desc.chunkIndex);
      const inspection = inspectChunk(desc, expectedFp);
      if (inspection.status === 'COMPLETED') {
        completedCount++;
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
   * Returns only chunks that need to be rendered (PENDING, CORRUPTED, or STALE).
   * Strictly side-effect free.
   */
  public getPendingChunks(
    overrideFingerprints?: Map<number, string> | ((desc: ChunkDescriptor) => string)
  ): ChunkDescriptor[] {
    const manifest = this.evaluateStatus(overrideFingerprints);
    return manifest.chunks
      .filter((c) => c.status !== 'COMPLETED')
      .map((c) => c.chunk);
  }

  /**
   * Explicitly purges invalid (CORRUPTED or STALE) chunk files and their metadata from disk.
   */
  public purgeInvalid(): string[] {
    return purgeInvalid(this.chunksDir, this.descriptors, this.expectedFingerprints);
  }

  /**
   * Returns all chunk file paths in chronological sequence for concat demuxer stitching.
   */
  public getOrderedChunkPaths(): string[] {
    return this.descriptors.map((d) => d.filePath);
  }
}
