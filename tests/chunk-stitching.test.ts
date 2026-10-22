import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTestRenderConfig } from '../src/config/render-config.js';
import { ENGINE_RENDER_VERSION } from '../src/config/render-version.js';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';
import { probeVideo, assertBt709Tv, isBt709Tv } from '../src/diagnostics/ffprobe.js';
import {
  buildConcatDemuxerContent,
  stitchChunksWithMasterAudio
} from '../src/engine/audio/concat-stitcher.js';
import {
  partitionSongIntoChunks,
  CheckpointManager,
  inspectChunk,
  canonicalJsonStringify,
  computeChunkFingerprint,
  writeChunkMetadataAtomic
} from '../src/engine/director/checkpoint-manager.js';
import { renderChunk } from '../src/engine/director/chunk-renderer.js';
import {
  analyzeWavFileToArtifacts,
  synthesizeMusicalWavBuffer
} from '../src/engine/audio/wav-analyzer.js';

test('Chunking: partitionSongIntoChunks segments frame ranges contiguously without gaps or overlaps', () => {
  const chunksDir = '/tmp/fake-chunks';
  const totalFrames = 10598;
  const chunkFrames = 1500;

  const chunks = partitionSongIntoChunks(totalFrames, chunkFrames, chunksDir);
  assert.equal(chunks.length, 8); // 7 full chunks of 1500 + 1 chunk of 98 frames

  // Check first chunk
  assert.equal(chunks[0].chunkIndex, 0);
  assert.equal(chunks[0].startFrame, 0);
  assert.equal(chunks[0].endFrame, 1500);
  assert.equal(chunks[0].frameCount, 1500);
  assert.equal(chunks[0].filename, 'chunk_000.mp4');

  // Check middle chunk continuity
  for (let i = 1; i < chunks.length; i++) {
    assert.equal(chunks[i].chunkIndex, i);
    assert.equal(chunks[i].startFrame, chunks[i - 1].endFrame);
    assert.equal(chunks[i].frameCount, chunks[i].endFrame - chunks[i].startFrame);
  }

  // Check final chunk
  const last = chunks[chunks.length - 1];
  assert.equal(last.chunkIndex, 7);
  assert.equal(last.endFrame, totalFrames);
  assert.equal(last.frameCount, 98);
});

test('Chunking: partitionSongIntoChunks supports non-zero startFrame for timeline slicing', () => {
  const chunksDir = '/tmp/fake-chunks';
  const totalFrames = 300;
  const chunkFrames = 1500;
  const startFrame = 1440;

  const chunks = partitionSongIntoChunks(totalFrames, chunkFrames, chunksDir, startFrame);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunkIndex, 0);
  assert.equal(chunks[0].startFrame, 1440);
  assert.equal(chunks[0].endFrame, 1740);
  assert.equal(chunks[0].frameCount, 300);
});

test('Chunking: buildConcatDemuxerContent formats valid ffmpeg concat demuxer script', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-concat-syntax-'));
  try {
    const chunk0 = path.join(tmpDir, 'chunk_000.mp4');
    const chunk1 = path.join(tmpDir, 'chunk_001.mp4');
    fs.writeFileSync(chunk0, 'dummy-video-data');
    fs.writeFileSync(chunk1, 'dummy-video-data');

    const content = buildConcatDemuxerContent([chunk0, chunk1]);
    const lines = content.trim().split('\n');

    assert.equal(lines[0], 'ffconcat version 1.0');
    assert.ok(lines[1].startsWith("file '"));
    assert.ok(lines[1].includes('chunk_000.mp4'));
    assert.ok(lines[2].startsWith("file '"));
    assert.ok(lines[2].includes('chunk_001.mp4'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Chunking: CheckpointManager evaluateStatus is strictly side-effect free and purgeInvalid cleans corrupted files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-checkpoint-'));
  try {
    const manager = new CheckpointManager({
      totalFrames: 90,
      chunkFrames: 30,
      chunksDir: tmpDir
    });

    assert.equal(manager.descriptors.length, 3);

    // Initial state: all pending
    let status = manager.evaluateStatus();
    assert.equal(status.totalChunks, 3);
    assert.equal(status.completedCount, 0);
    assert.equal(status.pendingCount, 3);
    assert.equal(status.isComplete, false);

    // Create a corrupted empty file for chunk 0
    fs.writeFileSync(manager.descriptors[0].filePath, Buffer.alloc(0));
    const inspectionCorrupted = inspectChunk(manager.descriptors[0]);
    assert.equal(inspectionCorrupted.status, 'CORRUPTED');

    // evaluateStatus MUST NOT delete the file (strictly side-effect free)
    status = manager.evaluateStatus();
    assert.equal(fs.existsSync(manager.descriptors[0].filePath), true);
    assert.equal(status.completedCount, 0);
    assert.equal(status.pendingCount, 3);

    // Explicit purgeInvalid deletes corrupted files and staging files
    const purged = manager.purgeInvalid();
    assert.ok(purged.includes(manager.descriptors[0].filePath));
    assert.equal(fs.existsSync(manager.descriptors[0].filePath), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Chunking: Canonical JSON serialization is deep-sorted and deterministic across property order and Maps', () => {
  const objA = { z: 1, a: { b: 2, a: 1 }, list: [3, 2, 1] };
  const objB = { a: { a: 1, b: 2 }, z: 1, list: [3, 2, 1] };
  assert.equal(canonicalJsonStringify(objA), canonicalJsonStringify(objB));

  const mapA = new Map([
    ['beta', 2],
    ['alpha', 1]
  ]);
  const mapB = new Map([
    ['alpha', 1],
    ['beta', 2]
  ]);
  assert.equal(canonicalJsonStringify(mapA), canonicalJsonStringify(mapB));
});

test('Chunking: Fingerprint invalidation on storyboard, LRC, FPS, CRF, or engine version changes', () => {
  const dummyStoryboard: any = { id: 'sb_1', shots: [], totalFrames: 30 };
  const dummyChoreo: any = { entityTracks: [] };
  const dummyRigs = new Map();

  const baseConfig = createTestRenderConfig({
    width: 64,
    height: 64,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 30,
    crf: 18,
    preset: 'veryfast',
    threads: 1
  });

  const baseInputs = {
    renderConfig: baseConfig,
    audioManifestHash: 'manifest_sha256_001',
    featuresBinSha256: 'bin_sha256_001',
    storyboard: dummyStoryboard,
    rigs: dummyRigs,
    choreography: dummyChoreo,
    chunkRange: { startFrame: 0, endFrame: 30 }
  };

  const baseFp = computeChunkFingerprint(baseInputs);
  assert.ok(baseFp.length === 64, 'Fingerprint must be a 64-char hex SHA-256');

  // 1. Identical inputs produce identical fingerprint
  assert.equal(computeChunkFingerprint(baseInputs), baseFp);

  // 2. Modifying CRF changes fingerprint
  const crfInputs = {
    ...baseInputs,
    renderConfig: { ...baseConfig, crf: 23 }
  };
  assert.notEqual(computeChunkFingerprint(crfInputs), baseFp);

  // 3. Modifying FPS changes fingerprint
  const fpsInputs = {
    ...baseInputs,
    renderConfig: { ...baseConfig, fps: 60 }
  };
  assert.notEqual(computeChunkFingerprint(fpsInputs), baseFp);

  // 4. Modifying audio manifest hash (e.g. lyrics edited) changes fingerprint
  const audioInputs = {
    ...baseInputs,
    audioManifestHash: 'manifest_sha256_edited_lyrics'
  };
  assert.notEqual(computeChunkFingerprint(audioInputs), baseFp);

  // 5. Modifying storyboard changes fingerprint
  const sbInputs = {
    ...baseInputs,
    storyboard: { ...dummyStoryboard, id: 'sb_modified' }
  };
  assert.notEqual(computeChunkFingerprint(sbInputs), baseFp);

  // 6. Bumping ENGINE_RENDER_VERSION changes fingerprint
  const bumpedInputs = {
    ...baseInputs,
    engineRenderVersion: ENGINE_RENDER_VERSION + 1
  };
  assert.notEqual(computeChunkFingerprint(bumpedInputs), baseFp);
});

test('Chunking: InspectChunk returns STALE on missing metadata, version mismatch, or fingerprint mismatch', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-inspect-stale-'));
  try {
    const dummyChunk = {
      chunkIndex: 0,
      startFrame: 0,
      endFrame: 15,
      frameCount: 15,
      filename: 'chunk_000.mp4',
      filePath: path.join(tmpDir, 'chunk_000.mp4')
    };

    // Fake MP4 with non-zero bytes
    fs.writeFileSync(dummyChunk.filePath, 'dummy-mp4-data-for-meta-check');

    // Case 1: Missing metadata file
    const resNoMeta = inspectChunk(dummyChunk, 'expected_fp_123');
    assert.equal(resNoMeta.status, 'STALE');
    assert.ok(resNoMeta.reason?.includes('missing'));

    // Case 2: Metadata file has old engine version
    writeChunkMetadataAtomic(dummyChunk.filePath, {
      chunkIndex: 0,
      startFrame: 0,
      endFrame: 15,
      frameCount: 15,
      fingerprint: 'expected_fp_123',
      engineRenderVersion: ENGINE_RENDER_VERSION - 1,
      createdAt: new Date().toISOString()
    });
    const resOldVersion = inspectChunk(dummyChunk, 'expected_fp_123');
    assert.equal(resOldVersion.status, 'STALE');
    assert.ok(resOldVersion.reason?.includes('version mismatch'));

    // Case 3: Metadata file has mismatched fingerprint
    writeChunkMetadataAtomic(dummyChunk.filePath, {
      chunkIndex: 0,
      startFrame: 0,
      endFrame: 15,
      frameCount: 15,
      fingerprint: 'stale_fingerprint_abc',
      engineRenderVersion: ENGINE_RENDER_VERSION,
      createdAt: new Date().toISOString()
    });
    const resMismatchedFp = inspectChunk(dummyChunk, 'expected_fp_123');
    assert.equal(resMismatchedFp.status, 'STALE');
    assert.ok(resMismatchedFp.reason?.includes('fingerprint mismatch'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Chunking: Audio analysis sidecar .cache.json hits on identical inputs and invalidates on changes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-audiocache-'));
  try {
    const wavBuffer = synthesizeMusicalWavBuffer({
      durationSeconds: 1.0,
      sampleRate: 44100,
      bpm: 120
    });
    const wavPath = path.join(tmpDir, 'test.wav');
    fs.writeFileSync(wavPath, wavBuffer);

    const manifestPath = path.join(tmpDir, 'test.manifest.json');
    const binPath = path.join(tmpDir, 'test.features.bin');
    const cachePath = `${manifestPath}.cache.json`;

    // 1. Initial run: cache miss, produces artifacts + .cache.json
    const res1 = analyzeWavFileToArtifacts({
      wavFilePath: wavPath,
      outManifestPath: manifestPath,
      outBinaryPath: binPath,
      fps: 30
    });
    assert.equal(fs.existsSync(manifestPath), true);
    assert.equal(fs.existsSync(binPath), true);
    assert.equal(fs.existsSync(cachePath), true);

    const initialCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    assert.ok(initialCache.cacheKey);

    // 2. Second run: cache hit (returns validated manifest and reader in O(1))
    const res2 = analyzeWavFileToArtifacts({
      wavFilePath: wavPath,
      outManifestPath: manifestPath,
      outBinaryPath: binPath,
      fps: 30
    });
    assert.equal(res2.manifest.metadata.totalFrames, res1.manifest.metadata.totalFrames);

    // 3. Changing audio content invalidates cache key
    const modifiedWav = synthesizeMusicalWavBuffer({
      durationSeconds: 2.0,
      sampleRate: 44100,
      bpm: 140
    });
    fs.writeFileSync(wavPath, modifiedWav);

    const res3 = analyzeWavFileToArtifacts({
      wavFilePath: wavPath,
      outManifestPath: manifestPath,
      outBinaryPath: binPath,
      fps: 30
    });
    assert.equal(res3.manifest.metadata.totalFrames, 60);

    const updatedCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    assert.notEqual(updatedCache.cacheKey, initialCache.cacheKey);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Chunking: End-to-end renders 2 chunks with metadata, losslessly stitches with master audio, and validates via ffprobe', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-chunk-e2e-'));
  try {
    const chunksDir = path.join(tmpDir, 'chunks');
    fs.mkdirSync(chunksDir, { recursive: true });

    const totalFrames = 30; // 1.0 second @ 30fps
    const chunkFrames = 15; // 2 chunks of 15 frames each
    const fps = 30;
    const width = 128;
    const height = 128;

    const fp0 = 'fingerprint_chunk_0_sha256';
    const fp1 = 'fingerprint_chunk_1_sha256';
    const expectedFps = new Map([
      [0, fp0],
      [1, fp1]
    ]);

    const manager = new CheckpointManager({
      totalFrames,
      chunkFrames,
      chunksDir,
      expectedFingerprints: expectedFps
    });

    assert.equal(manager.descriptors.length, 2);

    const baseConfig = createTestRenderConfig({
      width,
      height,
      fps,
      pixelFormat: 'rgba',
      totalFrames: chunkFrames
    });

    // Simple deterministic frame generator: rotating colored rectangle
    const frameGenerator = (globalIndex: number): string => {
      const red = Math.floor((globalIndex / totalFrames) * 255);
      const blue = 255 - red;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#0a0a14"/>
  <rect x="20" y="20" width="88" height="88" fill="rgb(${red}, 100, ${blue})"/>
  <circle cx="64" cy="64" r="${10 + (globalIndex % 15)}" fill="#00f0ff"/>
</svg>`;
    };

    // Render chunk 0 with fingerprint
    const chunk0 = manager.descriptors[0];
    const res0 = await renderChunk({
      chunk: chunk0,
      renderConfig: baseConfig,
      frameGenerator,
      fingerprint: fp0
    });
    assert.equal(res0.committed, true);
    assert.equal(fs.existsSync(chunk0.filePath), true);
    assert.equal(fs.existsSync(`${chunk0.filePath}.meta.json`), true);

    // Render chunk 1 with fingerprint
    const chunk1 = manager.descriptors[1];
    const res1 = await renderChunk({
      chunk: chunk1,
      renderConfig: baseConfig,
      frameGenerator,
      fingerprint: fp1
    });
    assert.equal(res1.committed, true);
    assert.equal(fs.existsSync(chunk1.filePath), true);
    assert.equal(fs.existsSync(`${chunk1.filePath}.meta.json`), true);

    // Verify CheckpointManager detects both completed
    const status = manager.evaluateStatus();
    assert.equal(status.completedCount, 2);
    assert.equal(status.pendingCount, 0);
    assert.equal(status.isComplete, true);

    // If an expected fingerprint changes, that chunk is evaluated as STALE
    const staleFps = new Map([
      [0, fp0],
      [1, 'modified_fingerprint_for_chunk_1']
    ]);
    const staleStatus = manager.evaluateStatus(staleFps);
    assert.equal(staleStatus.completedCount, 1);
    assert.equal(staleStatus.pendingCount, 1);
    assert.equal(staleStatus.chunks[1].status, 'STALE');

    // Synthesize a 1.0s master WAV audio track
    const wavBuffer = synthesizeMusicalWavBuffer({
      durationSeconds: 1.0,
      sampleRate: 44100,
      bpm: 140
    });
    const masterAudioPath = path.join(tmpDir, 'master.wav');
    fs.writeFileSync(masterAudioPath, wavBuffer);

    // Losslessly stitch the chunks together with the master audio
    const finalMp4Path = path.join(tmpDir, 'final_stitched.mp4');
    const stitchResult = await stitchChunksWithMasterAudio({
      chunkPaths: manager.getOrderedChunkPaths(),
      outputPath: finalMp4Path,
      masterAudioPath,
      audioBitrateKbps: 192,
      totalExpectedFrames: totalFrames,
      tempDir: tmpDir
    });

    assert.equal(fs.existsSync(finalMp4Path), true);
    assert.equal(stitchResult.hasAudio, true);
    assert.equal(stitchResult.totalFrames, totalFrames);

    // Probe the final video
    const probe = probeVideo(finalMp4Path);
    assert.equal(probe.frameCount, totalFrames);
    assert.equal(probe.stream.codec_name, 'h264');
    assert.equal(probe.stream.width, width);
    assert.equal(probe.stream.height, height);
    assertBt709Tv(probe.stream);
    assert.equal(isBt709Tv(finalMp4Path), true);

    assert.ok(probe.audioStream, 'Expected stitched MP4 to have audio stream');
    assert.equal(probe.audioStream.codec_name, 'aac');

    // Verify Zero Per-Frame Disk I/O hygiene
    assert.equal(findTemporaryImageFiles().length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
