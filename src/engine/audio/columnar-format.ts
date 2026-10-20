import type { AudioFrameFeature } from '../../schemas/audio.contract.js';

export const COLUMNAR_HEADER_MAGIC = 'AAAS';
export const COLUMN_LAYOUT_VERSION = 1 as const;
export const COLUMNAR_HEADER_BYTES = 32;
export const FLOAT32_COLUMN_COUNT = 13;
export const UINT8_COLUMN_COUNT = 1;
export const BYTES_PER_FRAME = FLOAT32_COLUMN_COUNT * 4 + UINT8_COLUMN_COUNT; // 53 bytes
export const MAX_COLUMNAR_BINARY_BYTES = 16 * 1024 * 1024; // 16 MiB security cap

export interface ColumnarAudioHeaderInput {
  readonly fps: 30 | 60;
  readonly totalFrames: number;
  readonly sampleRate: 44100 | 48000;
  readonly localWindowFrames: number;
  readonly globalRmsMax: number;
}

export interface ColumnarAudioHeader extends ColumnarAudioHeaderInput {
  readonly magic: typeof COLUMNAR_HEADER_MAGIC;
  readonly columnLayoutVersion: typeof COLUMN_LAYOUT_VERSION;
}

export interface ColumnarAudioColumns {
  readonly rms: Float32Array;
  readonly rmsRelativeGlobal: Float32Array;
  readonly rmsRelativeLocal: Float32Array;
  readonly spectralFlux: Float32Array;
  readonly onsetStrength: Float32Array;
  readonly pitchEstimatedHz: Float32Array;
  readonly subBass: Float32Array;
  readonly bass: Float32Array;
  readonly lowMid: Float32Array;
  readonly mid: Float32Array;
  readonly highMid: Float32Array;
  readonly presence: Float32Array;
  readonly brilliance: Float32Array;
  readonly isOnset: Uint8Array;
}

/**
 * Computes the exact byte length of a `.features.bin` v1 buffer for `totalFrames`.
 * Formula: 32 + 53 * totalFrames.
 */
export function computeColumnarByteLength(totalFrames: number): number {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) {
    throw new RangeError(`totalFrames must be a positive integer, got ${totalFrames}`);
  }
  return COLUMNAR_HEADER_BYTES + BYTES_PER_FRAME * totalFrames;
}

/**
 * Normalizes a Uint8Array / Node.js Buffer so its underlying ArrayBuffer byteOffset
 * is strictly a multiple of 4. Prevents RangeError when constructing Float32Array views
 * on pooled Node.js Buffer slices.
 */
export function ensureFourByteAligned(buffer: Uint8Array): Uint8Array {
  if (buffer.byteOffset % 4 !== 0) {
    return new Uint8Array(buffer);
  }
  return buffer;
}

function isColumnarAudioColumns(
  data: readonly AudioFrameFeature[] | ColumnarAudioColumns
): data is ColumnarAudioColumns {
  return !Array.isArray(data) && 'rms' in data && data.rms instanceof Float32Array;
}

/**
 * Decodes and validates the 32-byte little-endian header of a `.features.bin` v1 buffer.
 */
export function decodeColumnarAudioHeader(buffer: Uint8Array): ColumnarAudioHeader {
  if (buffer.byteLength < COLUMNAR_HEADER_BYTES) {
    throw new Error(
      `Invalid .features.bin buffer: byteLength (${buffer.byteLength}) is smaller than header (${COLUMNAR_HEADER_BYTES} bytes)`
    );
  }
  if (buffer.byteLength > MAX_COLUMNAR_BINARY_BYTES) {
    throw new Error(
      `Invalid .features.bin buffer: byteLength (${buffer.byteLength}) exceeds maximum allowed size (${MAX_COLUMNAR_BINARY_BYTES} bytes)`
    );
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, COLUMNAR_HEADER_BYTES);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== COLUMNAR_HEADER_MAGIC) {
    throw new Error(`Invalid .features.bin magic header: expected "${COLUMNAR_HEADER_MAGIC}", got "${magic}"`);
  }

  const columnLayoutVersion = view.getUint16(4, true);
  if (columnLayoutVersion !== COLUMN_LAYOUT_VERSION) {
    throw new Error(
      `Unsupported .features.bin columnLayoutVersion: expected ${COLUMN_LAYOUT_VERSION}, got ${columnLayoutVersion}`
    );
  }

  const fps = view.getUint16(6, true);
  if (fps !== 30 && fps !== 60) {
    throw new Error(`Invalid .features.bin fps: expected 30 or 60, got ${fps}`);
  }

  const totalFrames = view.getUint32(8, true);
  if (totalFrames <= 0) {
    throw new Error(`Invalid .features.bin totalFrames: expected > 0, got ${totalFrames}`);
  }

  const sampleRate = view.getUint32(12, true);
  if (sampleRate !== 44100 && sampleRate !== 48000) {
    throw new Error(`Invalid .features.bin sampleRate: expected 44100 or 48000, got ${sampleRate}`);
  }

  const localWindowFrames = view.getUint32(16, true);
  if (localWindowFrames <= 0) {
    throw new Error(
      `Invalid .features.bin localWindowFrames: expected > 0, got ${localWindowFrames}`
    );
  }

  const globalRmsMax = view.getFloat32(20, true);
  if (!Number.isFinite(globalRmsMax) || globalRmsMax <= 0) {
    throw new Error(`Invalid .features.bin globalRmsMax: expected finite > 0, got ${globalRmsMax}`);
  }

  for (let i = 24; i < 32; i++) {
    if (view.getUint8(i) !== 0) {
      throw new Error(`Invalid .features.bin header: non-zero reserved byte at offset ${i}`);
    }
  }

  const expectedBytes = computeColumnarByteLength(totalFrames);
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `Invalid .features.bin byteLength: expected ${expectedBytes} bytes for ${totalFrames} frames, got ${buffer.byteLength} bytes`
    );
  }

  return {
    magic: COLUMNAR_HEADER_MAGIC,
    columnLayoutVersion: COLUMN_LAYOUT_VERSION,
    fps,
    totalFrames,
    sampleRate,
    localWindowFrames,
    globalRmsMax
  };
}

/**
 * Extracts zero-copy (or 4-byte alignment-normalized) TypedArray column views from a `.features.bin` buffer.
 */
export function extractColumnarAudioViews(buffer: Uint8Array): {
  header: ColumnarAudioHeader;
  columns: ColumnarAudioColumns;
  alignedBuffer: Uint8Array;
} {
  const alignedBuffer = ensureFourByteAligned(buffer);
  const header = decodeColumnarAudioHeader(alignedBuffer);
  const n = header.totalFrames;
  const baseOffset = alignedBuffer.byteOffset + COLUMNAR_HEADER_BYTES;
  const colBytes = n * 4;

  const col = (index: number): Float32Array =>
    new Float32Array(alignedBuffer.buffer, baseOffset + index * colBytes, n);

  const columns: ColumnarAudioColumns = {
    rms: col(0),
    rmsRelativeGlobal: col(1),
    rmsRelativeLocal: col(2),
    spectralFlux: col(3),
    onsetStrength: col(4),
    pitchEstimatedHz: col(5),
    subBass: col(6),
    bass: col(7),
    lowMid: col(8),
    mid: col(9),
    highMid: col(10),
    presence: col(11),
    brilliance: col(12),
    isOnset: new Uint8Array(alignedBuffer.buffer, baseOffset + FLOAT32_COLUMN_COUNT * colBytes, n)
  };

  return { header, columns, alignedBuffer };
}

/**
 * Encodes audio features (from either an array of AudioFrameFeature objects or pre-computed
 * typed-array columns) into the compact `.features.bin` (`columnLayoutVersion: 1`) binary buffer.
 */
export function encodeColumnarAudioFeatures(
  header: ColumnarAudioHeaderInput,
  data: readonly AudioFrameFeature[] | ColumnarAudioColumns
): Uint8Array {
  const n = header.totalFrames;
  const totalBytes = computeColumnarByteLength(n);
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer, out.byteOffset, COLUMNAR_HEADER_BYTES);

  // Magic "AAAS"
  view.setUint8(0, 0x41);
  view.setUint8(1, 0x41);
  view.setUint8(2, 0x41);
  view.setUint8(3, 0x53);
  view.setUint16(4, COLUMN_LAYOUT_VERSION, true);
  view.setUint16(6, header.fps, true);
  view.setUint32(8, n, true);
  view.setUint32(12, header.sampleRate, true);
  view.setUint32(16, header.localWindowFrames, true);
  view.setFloat32(20, header.globalRmsMax, true);
  // Bytes 24..31 are already zero-initialized by Uint8Array

  const { columns } = extractColumnarAudioViews(out);

  if (isColumnarAudioColumns(data)) {
    if (data.rms.length !== n || data.isOnset.length !== n) {
      throw new Error(`Column length mismatch: expected ${n} frames, got ${data.rms.length}`);
    }
    columns.rms.set(data.rms);
    columns.rmsRelativeGlobal.set(data.rmsRelativeGlobal);
    columns.rmsRelativeLocal.set(data.rmsRelativeLocal);
    columns.spectralFlux.set(data.spectralFlux);
    columns.onsetStrength.set(data.onsetStrength);
    columns.pitchEstimatedHz.set(data.pitchEstimatedHz);
    columns.subBass.set(data.subBass);
    columns.bass.set(data.bass);
    columns.lowMid.set(data.lowMid);
    columns.mid.set(data.mid);
    columns.highMid.set(data.highMid);
    columns.presence.set(data.presence);
    columns.brilliance.set(data.brilliance);
    columns.isOnset.set(data.isOnset);
  } else {
    if (data.length !== n) {
      throw new Error(`Frame array length mismatch: expected ${n} frames, got ${data.length}`);
    }
    for (let f = 0; f < n; f++) {
      const feat = data[f];
      columns.rms[f] = feat.rms;
      columns.rmsRelativeGlobal[f] = feat.rmsRelativeGlobal;
      columns.rmsRelativeLocal[f] = feat.rmsRelativeLocal;
      columns.spectralFlux[f] = feat.spectralFlux;
      columns.onsetStrength[f] = feat.onsetStrength;
      columns.pitchEstimatedHz[f] = feat.pitchEstimatedHz !== undefined && feat.pitchEstimatedHz > 0
        ? feat.pitchEstimatedHz
        : 0;
      columns.subBass[f] = feat.bands.subBass;
      columns.bass[f] = feat.bands.bass;
      columns.lowMid[f] = feat.bands.lowMid;
      columns.mid[f] = feat.bands.mid;
      columns.highMid[f] = feat.bands.highMid;
      columns.presence[f] = feat.bands.presence;
      columns.brilliance[f] = feat.bands.brilliance;
      columns.isOnset[f] = feat.isOnset ? 1 : 0;
    }
  }

  return out;
}
