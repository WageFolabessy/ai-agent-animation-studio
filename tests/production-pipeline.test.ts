import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  runProductionPipeline,
  renderProgressBar,
  formatDuration
} from '../src/engine/director/production-pipeline.js';
import { probeVideo, assertBt709Tv } from '../src/diagnostics/ffprobe.js';

test('ProductionPipeline Suite', async (t) => {
  await t.test('renderProgressBar formats progress ratios correctly', () => {
    assert.equal(renderProgressBar(0, 10), '[>         ]');
    assert.equal(renderProgressBar(0.5, 10), '[=====>    ]');
    assert.equal(renderProgressBar(1, 10), '[==========]');
  });

  await t.test('formatDuration formats seconds into mm:ss accurately', () => {
    assert.equal(formatDuration(0), '0m 00s');
    assert.equal(formatDuration(65), '1m 05s');
    assert.equal(formatDuration(354), '5m 54s');
  });

  await t.test('runProductionPipeline renders sliced synthetic timeline cleanly with zero disk images', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-pipe-test-'));
    const testOut = path.join(tmpDir, 'test-pipeline-slice.mp4');
    const testArtifacts = path.join(tmpDir, 'test-artifacts-slice');

    try {
      // Run short 30-frame slice
      const result = await runProductionPipeline({
        outputPath: testOut,
        artifactsDir: testArtifacts,
        chunkFrames: 30,
        frameCount: 30,
        quiet: true,
        resume: false
      });

      assert.ok(fs.existsSync(result.finalOutputPath));
      assert.equal(result.finalOutputPath, testOut);
      assert.ok(result.fileSizeBytes > 1000);
      assert.equal(result.totalFrames, 30);
      assert.equal(result.fps, 30);
      assert.equal(result.resolution.width, 1920);
      assert.equal(result.resolution.height, 1080);

      const probe = probeVideo(result.finalOutputPath);
      assert.equal(probe.frameCount, 30);
      assertBt709Tv(probe.stream);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

