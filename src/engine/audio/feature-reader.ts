import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AudioAnalysisManifestSchema,
  type AudioAnalysisManifest,
  type AudioFeatureReader,
  type AudioFrameFeature
} from '../../schemas/audio.contract.js';
import {
  extractColumnarAudioViews,
  MAX_COLUMNAR_BINARY_BYTES,
  type ColumnarAudioColumns,
  type ColumnarAudioHeader
} from './columnar-format.js';

export interface ColumnarReaderVerificationOptions {
  readonly expectedTotalFrames?: number;
  readonly expectedFps?: 30 | 60;
  readonly expectedSampleRate?: 44100 | 48000;
  readonly expectedByteLength?: number;
  readonly expectedSha256?: string;
}

const MAX_MANIFEST_JSON_BYTES = 4 * 1024 * 1024; // 4 MiB limit

function assertNormalizedColumn(name: string, col: Float32Array): void {
  const eps = 1e-5;
  for (let i = 0; i < col.length; i++) {
    const v = col[i];
    if (!Number.isFinite(v) || v < -eps || v > 1 + eps) {
      throw new Error(`Invalid value in column "${name}" at frame ${i}: expected [0, 1], got ${v}`);
    }
  }
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

/**
 * O(1) columnar audio feature reader backed by flat TypedArray views over `.features.bin`.
 * Avoids materializing an array of nested AudioFrameFeature objects on the V8 heap.
 */
export class ColumnarAudioFeatureReader implements AudioFeatureReader {
  public readonly totalFrames: number;
  public readonly header: ColumnarAudioHeader;
  private readonly columns: ColumnarAudioColumns;
  private readonly alignedBuffer: Uint8Array;

  constructor(buffer: Uint8Array, verification?: ColumnarReaderVerificationOptions) {
    if (verification?.expectedByteLength !== undefined && buffer.byteLength !== verification.expectedByteLength) {
      throw new Error(
        `Binary byteLength mismatch: manifest expected ${verification.expectedByteLength} bytes, got ${buffer.byteLength} bytes`
      );
    }

    if (verification?.expectedSha256 !== undefined) {
      const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      if (actualSha256 !== verification.expectedSha256.toLowerCase()) {
        throw new Error(
          `Binary SHA-256 mismatch: expected ${verification.expectedSha256}, got ${actualSha256}`
        );
      }
    }

    const { header, columns, alignedBuffer } = extractColumnarAudioViews(buffer);
    this.header = header;
    this.columns = columns;
    this.alignedBuffer = alignedBuffer;
    this.totalFrames = header.totalFrames;

    if (verification?.expectedTotalFrames !== undefined && header.totalFrames !== verification.expectedTotalFrames) {
      throw new Error(
        `Header totalFrames (${header.totalFrames}) does not match manifest totalFrames (${verification.expectedTotalFrames})`
      );
    }
    if (verification?.expectedFps !== undefined && header.fps !== verification.expectedFps) {
      throw new Error(
        `Header fps (${header.fps}) does not match manifest fps (${verification.expectedFps})`
      );
    }
    if (verification?.expectedSampleRate !== undefined && header.sampleRate !== verification.expectedSampleRate) {
      throw new Error(
        `Header sampleRate (${header.sampleRate}) does not match manifest sampleRate (${verification.expectedSampleRate})`
      );
    }

    // Validate column values once at initialization
    assertNormalizedColumn('rms', columns.rms);
    assertNormalizedColumn('rmsRelativeGlobal', columns.rmsRelativeGlobal);
    assertNormalizedColumn('rmsRelativeLocal', columns.rmsRelativeLocal);
    assertNormalizedColumn('spectralFlux', columns.spectralFlux);
    assertNormalizedColumn('onsetStrength', columns.onsetStrength);
    assertNormalizedColumn('subBass', columns.subBass);
    assertNormalizedColumn('bass', columns.bass);
    assertNormalizedColumn('lowMid', columns.lowMid);
    assertNormalizedColumn('mid', columns.mid);
    assertNormalizedColumn('highMid', columns.highMid);
    assertNormalizedColumn('presence', columns.presence);
    assertNormalizedColumn('brilliance', columns.brilliance);

    for (let i = 0; i < this.totalFrames; i++) {
      const pitch = columns.pitchEstimatedHz[i];
      if (!Number.isFinite(pitch) || pitch < 0) {
        throw new Error(`Invalid pitchEstimatedHz at frame ${i}: ${pitch}`);
      }
      const onset = columns.isOnset[i];
      if (onset !== 0 && onset !== 1) {
        throw new Error(`Invalid isOnset byte at frame ${i}: expected 0 or 1, got ${onset}`);
      }
    }
  }

  /** Underlying binary footprint in bytes. */
  public get byteLength(): number {
    return this.alignedBuffer.byteLength;
  }

  /**
   * Reconstructs the AudioFrameFeature for `frameIndex` in O(1) time from typed array views.
   * Maps unvoiced pitch (`<= 0`) to `undefined` so the returned object strictly conforms
   * to `AudioFrameFeatureSchema`.
   */
  public getFrameFeature(frameIndex: number): AudioFrameFeature {
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= this.totalFrames) {
      throw new RangeError(
        `Frame index ${frameIndex} is out of bounds [0, ${this.totalFrames})`
      );
    }

    const c = this.columns;
    const rawPitch = c.pitchEstimatedHz[frameIndex];

    const feature: AudioFrameFeature = {
      frameIndex,
      timestamp: frameIndex / this.header.fps,
      rms: clamp01(c.rms[frameIndex]),
      rmsRelativeGlobal: clamp01(c.rmsRelativeGlobal[frameIndex]),
      rmsRelativeLocal: clamp01(c.rmsRelativeLocal[frameIndex]),
      localWindowFrames: this.header.localWindowFrames,
      spectralFlux: clamp01(c.spectralFlux[frameIndex]),
      onsetStrength: clamp01(c.onsetStrength[frameIndex]),
      isOnset: c.isOnset[frameIndex] === 1,
      ...(rawPitch > 0 ? { pitchEstimatedHz: rawPitch } : {}),
      bands: {
        subBass: clamp01(c.subBass[frameIndex]),
        bass: clamp01(c.bass[frameIndex]),
        lowMid: clamp01(c.lowMid[frameIndex]),
        mid: clamp01(c.mid[frameIndex]),
        highMid: clamp01(c.highMid[frameIndex]),
        presence: clamp01(c.presence[frameIndex]),
        brilliance: clamp01(c.brilliance[frameIndex])
      }
    };

    return feature;
  }
}

/**
 * Loads and validates an `<name>.manifest.json` file alongside its external `.features.bin`
 * columnar binary file, enforcing path boundary and SHA-256 integrity checks.
 *
 * // TODO(security): If exposed to untrusted web uploads in a future service layer,
 * // enforce per-tenant isolated storage directories and virus scanning before reading.
 */
export function loadAudioAnalysis(manifestPath: string): {
  manifest: AudioAnalysisManifest;
  reader: ColumnarAudioFeatureReader;
} {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifestStat = fs.statSync(resolvedManifestPath);
  if (!manifestStat.isFile()) {
    throw new Error(`Audio manifest path is not a regular file: "${resolvedManifestPath}"`);
  }
  if (manifestStat.size > MAX_MANIFEST_JSON_BYTES) {
    throw new Error(`Audio manifest file exceeds size limit (${manifestStat.size} bytes)`);
  }

  const rawManifest = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf8')) as unknown;
  const manifest = AudioAnalysisManifestSchema.parse(rawManifest);

  if (manifest.storageReference.type !== 'external_binary') {
    throw new Error(
      `loadAudioAnalysis requires storageReference.type === "external_binary", got "${manifest.storageReference.type}"`
    );
  }

  const manifestDir = path.dirname(resolvedManifestPath);
  const workspaceRoot = path.resolve(process.cwd());
  const rawBinaryPath = manifest.storageReference.binaryFilePath;
  const resolvedBinaryPath = path.isAbsolute(rawBinaryPath)
    ? path.resolve(rawBinaryPath)
    : path.resolve(manifestDir, rawBinaryPath);

  const inManifestDir =
    resolvedBinaryPath === manifestDir ||
    resolvedBinaryPath.startsWith(manifestDir + path.sep);
  const inWorkspace =
    resolvedBinaryPath === workspaceRoot ||
    resolvedBinaryPath.startsWith(workspaceRoot + path.sep);

  if (!inManifestDir && !inWorkspace) {
    throw new Error(
      `Security violation: binaryFilePath "${rawBinaryPath}" resolves outside allowed directory boundary`
    );
  }

  const binStat = fs.statSync(resolvedBinaryPath);
  if (!binStat.isFile()) {
    throw new Error(`Audio binary path is not a regular file: "${resolvedBinaryPath}"`);
  }
  if (binStat.size > MAX_COLUMNAR_BINARY_BYTES) {
    throw new Error(`Audio binary file exceeds maximum allowed size (${binStat.size} bytes)`);
  }

  const binBuffer = fs.readFileSync(resolvedBinaryPath);
  const reader = new ColumnarAudioFeatureReader(binBuffer, {
    expectedTotalFrames: manifest.metadata.totalFrames,
    expectedFps: manifest.metadata.fps,
    expectedSampleRate: manifest.metadata.sampleRate,
    expectedByteLength: manifest.storageReference.byteLength,
    expectedSha256: manifest.storageReference.sha256
  });

  return { manifest, reader };
}
