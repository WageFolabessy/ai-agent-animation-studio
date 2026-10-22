import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runProductionPipeline } from '../src/engine/director/production-pipeline.js';
import { readChunkMetadata } from '../src/engine/director/checkpoint-manager.js';
import { synthesizeMusicalWavBuffer, stitchChunksWithMasterAudio } from '../src/engine/audio/index.js';

test('Content-Addressed Resume Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-resume-test-'));
  const audioPath = path.join(tmpDir, 'test-audio.wav');
  const lrcPath = path.join(tmpDir, 'test-lyrics.lrc');
  const outPath = path.join(tmpDir, 'run.mp4');
  const chunksDir = path.join(tmpDir, 'chunks', 'run');

  // Prepare hermetic test audio (1.2s @ 120 BPM = 36 frames @ 30 fps)
  fs.writeFileSync(
    audioPath,
    synthesizeMusicalWavBuffer({ durationSeconds: 1.2, sampleRate: 44100, bpm: 120 })
  );
  fs.writeFileSync(lrcPath, '[00:00.00] Test line one\n[00:00.60] Test line two\n');

  try {
    await t.test('(a) First run renders all chunks and writes .meta.json sidecars', async () => {
      let progressCalls = 0;
      const result = await runProductionPipeline({
        outputPath: outPath,
        audioPath,
        lrcPath,
        chunkFrames: 18,
        frameCount: 36,
        quiet: true,
        resume: true,
        crf: 20,
        onProgress: () => {
          progressCalls++;
        }
      });

      assert.ok(fs.existsSync(result.finalOutputPath));
      assert.equal(result.totalFrames, 36);

      const chunk0 = path.join(chunksDir, 'chunk_000.mp4');
      const chunk1 = path.join(chunksDir, 'chunk_001.mp4');
      assert.ok(fs.existsSync(chunk0), 'chunk_000.mp4 exists');
      assert.ok(fs.existsSync(chunk1), 'chunk_001.mp4 exists');

      const meta0 = readChunkMetadata(chunk0);
      const meta1 = readChunkMetadata(chunk1);
      assert.ok(meta0 !== null, 'meta0 must be written');
      assert.ok(meta1 !== null, 'meta1 must be written');
      assert.equal(meta0.chunkIndex, 0);
      assert.equal(meta0.frameCount, 18);
      assert.ok(typeof meta0.fingerprint === 'string' && meta0.fingerprint.length === 64);
      assert.ok(typeof meta0.engineRenderVersion === 'number');
      assert.ok(progressCalls > 0, 'Progress callback should be invoked during rendering');
    });

    await t.test('(b) Second run with identical inputs skips all chunks and renders zero frames', async () => {
      let progressCallsInResume = 0;
      const result = await runProductionPipeline({
        outputPath: outPath,
        audioPath,
        lrcPath,
        chunkFrames: 18,
        frameCount: 36,
        quiet: true,
        resume: true,
        crf: 20,
        onProgress: () => {
          progressCallsInResume++;
        }
      });

      assert.ok(fs.existsSync(result.finalOutputPath));
      // In fully resumed run, renderChunk is never called for any chunk, so onProgress is never fired during render
      assert.equal(progressCallsInResume, 0, 'Resumed pipeline must render 0 frames');
    });

    await t.test('(c) Changing rendering parameters (CRF) produces new fingerprints and forces re-render', async () => {
      const chunk0 = path.join(chunksDir, 'chunk_000.mp4');
      const initialMeta = readChunkMetadata(chunk0);
      assert.ok(initialMeta !== null);

      let progressCallsInParamChange = 0;
      const result = await runProductionPipeline({
        outputPath: outPath,
        audioPath,
        lrcPath,
        chunkFrames: 18,
        frameCount: 36,
        quiet: true,
        resume: true,
        crf: 28, // Change CRF parameter
        onProgress: () => {
          progressCallsInParamChange++;
        }
      });

      assert.ok(fs.existsSync(result.finalOutputPath));
      assert.ok(progressCallsInParamChange > 0, 'Parameter change must re-render chunks');

      const updatedMeta = readChunkMetadata(chunk0);
      assert.ok(updatedMeta !== null);
      assert.notEqual(
        updatedMeta.fingerprint,
        initialMeta.fingerprint,
        'CRF change must produce different chunk fingerprint'
      );
    });

    await t.test('(d) Tampered or corrupted metadata forces chunk re-render', async () => {
      const chunk0 = path.join(chunksDir, 'chunk_000.mp4');
      const metaPath = `${chunk0}.meta.json`;
      const originalMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

      // Tamper with fingerprint in metadata file
      fs.writeFileSync(
        metaPath,
        JSON.stringify({
          ...originalMeta,
          fingerprint: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        })
      );

      let progressCallsInTampered = 0;
      const result = await runProductionPipeline({
        outputPath: outPath,
        audioPath,
        lrcPath,
        chunkFrames: 18,
        frameCount: 36,
        quiet: true,
        resume: true,
        crf: 28,
        onProgress: () => {
          progressCallsInTampered++;
        }
      });

      assert.ok(fs.existsSync(result.finalOutputPath));
      assert.ok(progressCallsInTampered > 0, 'Tampered meta must force re-render of stale chunk');

      const fixedMeta = readChunkMetadata(chunk0);
      assert.ok(fixedMeta !== null);
      assert.notEqual(
        fixedMeta.fingerprint,
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'Valid fingerprint must be restored after re-render'
      );
    });

    await t.test('(e) Concat stitcher throws immediately when presented with a stale chunk', async () => {
      const chunk0 = path.join(chunksDir, 'chunk_000.mp4');
      const chunk1 = path.join(chunksDir, 'chunk_001.mp4');
      const testStitchOut = path.join(tmpDir, 'stitch-test.mp4');

      // Provide expected fingerprints where chunk 0 has an impossible expected fingerprint
      const mismatchedFps = new Map<number, string>([
        [0, 'mismatched_expected_fp_that_does_not_match_disk_0000000000000000000000'],
        [1, readChunkMetadata(chunk1)?.fingerprint ?? '']
      ]);

      await assert.rejects(
        async () => {
          await stitchChunksWithMasterAudio({
            chunkPaths: [chunk0, chunk1],
            outputPath: testStitchOut,
            masterAudioPath: audioPath,
            audioStartSeconds: 0,
            audioBitrateKbps: 128,
            tempDir: tmpDir,
            expectedFingerprints: mismatchedFps,
            checkChunkIntegrity: true
          });
        },
        /Stitcher refused chunk "chunk_000\.mp4" with status STALE/,
        'Stitcher must reject stale chunks before starting FFmpeg concat'
      );
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
