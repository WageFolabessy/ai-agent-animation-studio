import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RenderPipeline } from '../src/renderer/pipeline.js';
import { FfmpegStreamer } from '../src/renderer/ffmpeg-streamer.js';
import { createTestRenderConfig } from '../src/config/render-config.js';
import { SvgBuilder } from '../src/engine/compositor/svg-builder.js';

test('Pipeline Lifecycle: Aborts FFmpeg process and cleans up .part.mp4 when frameGenerator throws', async () => {
  const outputPath = path.join(os.tmpdir(), 'test_abort_pipeline.mp4');
  const resolvedOutputPath = path.resolve(outputPath);
  const resolvedPartPath = resolvedOutputPath.replace(/\.mp4$/, '.part.mp4');

  const config = createTestRenderConfig({
    width: 64,
    height: 64,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 25,
    crf: 18,
    preset: 'veryfast',
    threads: 1
  });

  let childPid: number | undefined;
  let streamerRef: FfmpegStreamer | null = null;

  const pipeline = new RenderPipeline({
    config,
    outputPath,
    frameGenerator: (f) => {
      if (f === 5) {
        throw new Error('Simulated generator failure at middle frame 5');
      }
      return new SvgBuilder({ width: 64, height: 64, backgroundColor: '#000000' })
        .addRect(0, 0, 64, 64, '#ff0000', 1)
        .build();
    }
  });

  let threw = false;
  try {
    await pipeline.run((streamer) => {
      streamerRef = streamer;
      childPid = streamer.getChildPid();
    });
  } catch (err: unknown) {
    threw = true;
    assert.ok(err instanceof Error);
    assert.ok(err.message.includes('Simulated generator failure at middle frame 5'));
  }

  assert.equal(threw, true, 'pipeline.run() must throw when generator fails');
  assert.ok(childPid, 'FFmpeg child PID must be defined');

  // Small delay to allow OS process termination
  await new Promise((r) => setTimeout(r, 100));

  // Verify child process is dead
  if (streamerRef) {
    assert.equal((streamerRef as FfmpegStreamer).isAlive(), false, 'Streamer must report child process as dead');
  }

  try {
    process.kill(childPid!, 0);
    assert.fail(`Child PID ${childPid} should have terminated, but still responded to signal 0`);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    assert.equal(error.code, 'ESRCH', 'Child process must no longer exist in OS (ESRCH)');
  }

  // Verify no temporary .part.mp4 or final output files remain
  assert.equal(fs.existsSync(resolvedPartPath), false, '.part.mp4 file must be removed after abort');
  assert.equal(fs.existsSync(resolvedOutputPath), false, 'Final output must not be published on failure');
});

test('Pipeline Lifecycle: Atomically commits .part.mp4 to final output on success', async () => {
  const outputPath = path.join(os.tmpdir(), 'test_commit_success.mp4');
  const resolvedOutputPath = path.resolve(outputPath);
  const resolvedPartPath = resolvedOutputPath.replace(/\.mp4$/, '.part.mp4');

  // Clean up any stale artifacts
  if (fs.existsSync(resolvedOutputPath)) fs.unlinkSync(resolvedOutputPath);
  if (fs.existsSync(resolvedPartPath)) fs.unlinkSync(resolvedPartPath);

  const config = createTestRenderConfig({
    width: 64,
    height: 64,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 4,
    crf: 18,
    preset: 'veryfast',
    threads: 1
  });

  const pipeline = new RenderPipeline({
    config,
    outputPath,
    frameGenerator: (f) => {
      return new SvgBuilder({ width: 64, height: 64, backgroundColor: '#112233' })
        .addCircle(32, 32, 10 + f * 2, '#00ffff', 1)
        .build();
    }
  });

  const res = await pipeline.run();

  assert.equal(res.finalOutputPath, resolvedOutputPath);
  assert.equal(res.committed, true);
  assert.equal(res.stagingPartPath, resolvedPartPath);
  assert.equal(fs.existsSync(resolvedOutputPath), true, 'Final output file must exist');
  assert.equal(fs.existsSync(resolvedPartPath), false, '.part.mp4 must be atomically renamed and no longer exist');
  assert.equal(fs.existsSync(res.stagingPartPath), false, 'Staging path must no longer exist on disk');

  const stat = fs.statSync(resolvedOutputPath);
  assert.ok(stat.size > 1000, 'MP4 file size must be non-trivial');

  // Clean up test file
  fs.unlinkSync(resolvedOutputPath);
});

test('Pipeline Lifecycle: FfmpegStreamer abort is idempotent and safe to call multiple times', () => {
  const config = createTestRenderConfig({
    width: 64,
    height: 64,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 4,
    threads: 1
  });

  const streamer = new FfmpegStreamer({
    config,
    outputPath: path.join(os.tmpdir(), 'test_idempotent.mp4')
  });

  // Call abort before start
  assert.doesNotThrow(() => streamer.abort());
  assert.doesNotThrow(() => streamer.abort());
  assert.doesNotThrow(() => streamer.abort(new Error('Extra abort call')));
});
