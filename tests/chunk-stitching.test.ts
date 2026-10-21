import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTestRenderConfig } from '../src/config/render-config.js';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';
import { probeVideo, assertBt709Tv } from '../src/diagnostics/ffprobe.js';
import {
  buildConcatDemuxerContent,
  writeConcatDemuxerFile,
  stitchChunksWithMasterAudio
} from '../src/engine/audio/concat-stitcher.js';
import {
  partitionSongIntoChunks,
  CheckpointManager,
  inspectChunk
} from '../src/engine/director/checkpoint-manager.js';
import { renderChunk } from '../src/engine/director/chunk-renderer.js';
import { synthesizeMusicalWavBuffer } from '../src/engine/audio/wav-analyzer.js';

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

test('Chunking: CheckpointManager detects completed, pending, and corrupted chunks accurately', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-checkpoint-'));
  try {
    const manager = new CheckpointManager({
      totalFrames: 90,
      chunkFrames: 30,
      chunksDir: tmpDir,
      autoCleanCorrupted: true
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

    // evaluateStatus cleans corrupted file when autoCleanCorrupted is true
    status = manager.evaluateStatus();
    assert.equal(fs.existsSync(manager.descriptors[0].filePath), false);
    assert.equal(status.completedCount, 0);
    assert.equal(status.pendingCount, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Chunking: End-to-end renders 2 chunks, losslessly stitches with master audio, and validates via ffprobe', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-chunk-e2e-'));
  try {
    const chunksDir = path.join(tmpDir, 'chunks');
    fs.mkdirSync(chunksDir, { recursive: true });

    const totalFrames = 30; // 1.0 second @ 30fps
    const chunkFrames = 15; // 2 chunks of 15 frames each
    const fps = 30;
    const width = 128;
    const height = 128;

    const manager = new CheckpointManager({
      totalFrames,
      chunkFrames,
      chunksDir
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

    // Render chunk 0
    const chunk0 = manager.descriptors[0];
    const res0 = await renderChunk({
      chunk: chunk0,
      renderConfig: baseConfig,
      frameGenerator
    });
    assert.equal(res0.committed, true);
    assert.equal(fs.existsSync(chunk0.filePath), true);

    // Render chunk 1
    const chunk1 = manager.descriptors[1];
    const res1 = await renderChunk({
      chunk: chunk1,
      renderConfig: baseConfig,
      frameGenerator
    });
    assert.equal(res1.committed, true);
    assert.equal(fs.existsSync(chunk1.filePath), true);

    // Verify CheckpointManager detects both completed
    const status = manager.evaluateStatus();
    assert.equal(status.completedCount, 2);
    assert.equal(status.pendingCount, 0);
    assert.equal(status.isComplete, true);

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

    assert.ok(probe.audioStream, 'Expected stitched MP4 to have audio stream');
    assert.equal(probe.audioStream.codec_name, 'aac');

    // Verify Zero Per-Frame Disk I/O hygiene
    assert.equal(findTemporaryImageFiles().length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
