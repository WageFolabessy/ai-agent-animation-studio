import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AudioFrameFeatureSchema,
  type AudioAnalysisManifest,
  type AudioFrameFeature
} from '../src/schemas/audio.contract.js';
import {
  computeColumnarByteLength,
  decodeColumnarAudioHeader,
  encodeColumnarAudioFeatures
} from '../src/engine/audio/columnar-format.js';
import {
  ColumnarAudioFeatureReader,
  loadAudioAnalysis
} from '../src/engine/audio/feature-reader.js';

function createSampleFrames(totalFrames: number, fps: 30 | 60): AudioFrameFeature[] {
  const frames: AudioFrameFeature[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const isVoiced = f % 2 === 0;
    const isOnset = f % 15 === 0;
    frames.push({
      frameIndex: f,
      timestamp: f / fps,
      rms: 0.4,
      rmsRelativeGlobal: 0.5,
      rmsRelativeLocal: 0.6,
      localWindowFrames: 90,
      spectralFlux: isOnset ? 0.9 : 0.1,
      onsetStrength: isOnset ? 0.85 : 0.05,
      isOnset,
      ...(isVoiced ? { pitchEstimatedHz: 220 + (f % 12) * 10 } : {}),
      bands: {
        subBass: 0.15,
        bass: 0.25,
        lowMid: 0.35,
        mid: 0.45,
        highMid: 0.55,
        presence: 0.65,
        brilliance: 0.75
      }
    });
  }
  return frames;
}

test('AudioColumnar: Encodes and decodes .features.bin v1 with voiced and unvoiced pitch schema validation', () => {
  const totalFrames = 60;
  const fps = 30;
  const frames = createSampleFrames(totalFrames, fps);

  const bin = encodeColumnarAudioFeatures(
    {
      fps,
      totalFrames,
      sampleRate: 44100,
      localWindowFrames: 90,
      globalRmsMax: 0.8
    },
    frames
  );

  assert.equal(bin.byteLength, 32 + 53 * totalFrames);

  const header = decodeColumnarAudioHeader(bin);
  assert.equal(header.magic, 'AAAS');
  assert.equal(header.columnLayoutVersion, 1);
  assert.equal(header.fps, 30);
  assert.equal(header.totalFrames, totalFrames);
  assert.equal(header.sampleRate, 44100);
  assert.equal(header.localWindowFrames, 90);
  assert.ok(Math.abs(header.globalRmsMax - 0.8) < 1e-6);

  const reader = new ColumnarAudioFeatureReader(bin);
  assert.equal(reader.totalFrames, totalFrames);

  for (let f = 0; f < totalFrames; f++) {
    const feat = reader.getFrameFeature(f);
    // Safeguard 1: Must pass AudioFrameFeatureSchema.parse() for both voiced and unvoiced frames
    const parsed = AudioFrameFeatureSchema.parse(feat);
    assert.equal(parsed.frameIndex, f);
    assert.equal(parsed.isOnset, f % 15 === 0);

    if (f % 2 === 0) {
      assert.equal(parsed.pitchEstimatedHz, 220 + (f % 12) * 10);
    } else {
      assert.equal(parsed.pitchEstimatedHz, undefined);
      assert.equal('pitchEstimatedHz' in feat, false);
    }
    assert.ok(Math.abs(parsed.bands.subBass - 0.15) < 1e-6);
    assert.ok(Math.abs(parsed.bands.brilliance - 0.75) < 1e-6);
  }

  // Out-of-bounds frame indices throw RangeError
  assert.throws(() => reader.getFrameFeature(-1), RangeError);
  assert.throws(() => reader.getFrameFeature(totalFrames), RangeError);
});

test('AudioColumnar: Safeguard 2 - Handles misaligned Node.js Buffer subarray (byteOffset % 4 !== 0) without RangeError', () => {
  const totalFrames = 20;
  const frames = createSampleFrames(totalFrames, 30);
  const encoded = encodeColumnarAudioFeatures(
    {
      fps: 30,
      totalFrames,
      sampleRate: 44100,
      localWindowFrames: 90,
      globalRmsMax: 0.75
    },
    frames
  );

  // Allocate a larger buffer and copy `encoded` starting at byte offset 1 (unaligned!)
  const unalignedSlab = Buffer.alloc(encoded.byteLength + 7);
  Buffer.from(encoded).copy(unalignedSlab, 1);
  const misalignedSlice = unalignedSlab.subarray(1, 1 + encoded.byteLength);

  assert.notEqual(
    misalignedSlice.byteOffset % 4,
    0,
    'Slice must be deliberately misaligned to test alignment guard'
  );

  const reader = new ColumnarAudioFeatureReader(misalignedSlice);
  assert.equal(reader.totalFrames, totalFrames);
  const f0 = AudioFrameFeatureSchema.parse(reader.getFrameFeature(0));
  const f1 = AudioFrameFeatureSchema.parse(reader.getFrameFeature(1));
  assert.equal(f0.pitchEstimatedHz, 220);
  assert.equal(f1.pitchEstimatedHz, undefined);
});

test('AudioColumnar: 6-minute song memory footprint is strictly < 2 MB at both 30fps and 60fps', () => {
  const frames30Fps = 10_800; // 6 minutes @ 30fps
  const frames60Fps = 21_600; // 6 minutes @ 60fps

  const bytes30 = computeColumnarByteLength(frames30Fps);
  const bytes60 = computeColumnarByteLength(frames60Fps);

  assert.equal(bytes30, 572_432);
  assert.equal(bytes60, 1_144_832);
  assert.ok(bytes60 < 2 * 1024 * 1024, `60fps 6-min buffer (${bytes60}) must be < 2 MiB`);

  const emptyCols = {
    rms: new Float32Array(frames30Fps).fill(0.25),
    rmsRelativeGlobal: new Float32Array(frames30Fps).fill(0.5),
    rmsRelativeLocal: new Float32Array(frames30Fps).fill(0.5),
    spectralFlux: new Float32Array(frames30Fps).fill(0.1),
    onsetStrength: new Float32Array(frames30Fps).fill(0.1),
    pitchEstimatedHz: new Float32Array(frames30Fps).fill(0),
    subBass: new Float32Array(frames30Fps).fill(0.2),
    bass: new Float32Array(frames30Fps).fill(0.3),
    lowMid: new Float32Array(frames30Fps).fill(0.4),
    mid: new Float32Array(frames30Fps).fill(0.5),
    highMid: new Float32Array(frames30Fps).fill(0.4),
    presence: new Float32Array(frames30Fps).fill(0.3),
    brilliance: new Float32Array(frames30Fps).fill(0.2),
    isOnset: new Uint8Array(frames30Fps)
  };

  const bin30 = encodeColumnarAudioFeatures(
    {
      fps: 30,
      totalFrames: frames30Fps,
      sampleRate: 44100,
      localWindowFrames: 90,
      globalRmsMax: 0.5
    },
    emptyCols
  );

  const reader = new ColumnarAudioFeatureReader(bin30);
  assert.equal(reader.byteLength, 572_432);
  assert.ok(reader.byteLength < 2 * 1024 * 1024);

  // Random O(1) lookup at start, middle, and end
  assert.equal(reader.getFrameFeature(0).frameIndex, 0);
  assert.equal(reader.getFrameFeature(5400).frameIndex, 5400);
  assert.equal(reader.getFrameFeature(10799).frameIndex, 10799);
});

test('AudioColumnar: loadAudioAnalysis verifies SHA-256, byteLength, and path boundaries', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-col-test-'));
  try {
    const totalFrames = 30;
    const frames = createSampleFrames(totalFrames, 30);
    const bin = encodeColumnarAudioFeatures(
      {
        fps: 30,
        totalFrames,
        sampleRate: 44100,
        localWindowFrames: 90,
        globalRmsMax: 0.9
      },
      frames
    );

    const sha256 = crypto.createHash('sha256').update(bin).digest('hex');
    const binPath = path.join(tmpDir, 'track.features.bin');
    const manifestPath = path.join(tmpDir, 'track.manifest.json');

    fs.writeFileSync(binPath, bin);

    const manifest: AudioAnalysisManifest = {
      metadata: {
        audioFilePath: 'track.wav',
        sampleRate: 44100,
        durationSeconds: 1.0,
        fps: 30,
        totalFrames
      },
      normalization: {
        globalRmsMax: 0.9,
        localWindowFrames: 90
      },
      lyrics: [],
      beatEvents: [],
      storageReference: {
        type: 'external_binary',
        columnLayoutVersion: 1,
        binaryFilePath: 'track.features.bin',
        byteLength: bin.byteLength,
        sha256
      }
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const loaded = loadAudioAnalysis(manifestPath);
    assert.equal(loaded.reader.totalFrames, totalFrames);
    assert.equal(loaded.reader.getFrameFeature(15).isOnset, true);

    // Tamper with 1 byte in binary file -> SHA-256 verification must reject
    const tampered = new Uint8Array(bin);
    tampered[32] = 0;
    tampered[33] = 0;
    tampered[34] = 0;
    tampered[35] = 0;
    fs.writeFileSync(binPath, tampered);

    assert.throws(() => loadAudioAnalysis(manifestPath), /SHA-256 mismatch/);

    // Path traversal outside manifestDir & workspace -> security boundary must reject
    const traversalManifest: AudioAnalysisManifest = {
      ...manifest,
      storageReference: {
        type: 'external_binary',
        columnLayoutVersion: 1,
        binaryFilePath: '../../../etc/passwd',
        byteLength: bin.byteLength,
        sha256
      }
    };
    fs.writeFileSync(manifestPath, JSON.stringify(traversalManifest, null, 2));
    assert.throws(() => loadAudioAnalysis(manifestPath), /Security violation/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
