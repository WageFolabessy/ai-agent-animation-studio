import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { FfmpegStreamer } from '../src/renderer/ffmpeg-streamer.js';
import { createRenderConfig } from '../src/config/render-config.js';

class MockStdin extends EventEmitter {
  public writeResult = true;
  public writeCallbackDelay = 0;
  public simulateWriteError: Error | null = null;
  public ended = false;

  public write(chunk: Uint8Array, cb?: (err?: Error | null) => void): boolean {
    const err = this.simulateWriteError;
    if (this.writeCallbackDelay > 0) {
      setTimeout(() => {
        if (cb) cb(err);
      }, this.writeCallbackDelay);
    } else {
      if (cb) cb(err);
    }
    return this.writeResult;
  }

  public end(): this {
    this.ended = true;
    return this;
  }

  public destroyed = false;
  public destroy(): this {
    this.destroyed = true;
    return this;
  }
}

class MockChildProcess extends EventEmitter {
  public pid = 99999;
  public stdin = new MockStdin();
  public exitCode: number | null = null;
  public killed = false;

  public kill(signal?: string): boolean {
    this.killed = true;
    return true;
  }
}

function createTestStreamer(mockChild: MockChildProcess) {
  const config = createRenderConfig({
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 2
  });

  const streamer = new FfmpegStreamer({
    config,
    outputPath: 'output/test_streamer.mp4',
    childProcessForTesting: mockChild as unknown as ChildProcess
  });
  streamer.start();
  return { streamer, config };
}

test('Streamer Scenario 1: write() returns true and callback succeeds', async () => {
  const mockChild = new MockChildProcess();
  mockChild.stdin.writeResult = true;
  const { streamer, config } = createTestStreamer(mockChild);

  const fakeFrame = new Uint8Array(config.expectedFrameBytes);
  await streamer.writeFrame(fakeFrame);

  assert.equal(streamer.getFramesWritten(), 1);
});

test('Streamer Scenario 2: write() returns false then resolves on drain', async () => {
  const mockChild = new MockChildProcess();
  mockChild.stdin.writeResult = false; // Requests drain
  const { streamer, config } = createTestStreamer(mockChild);

  const fakeFrame = new Uint8Array(config.expectedFrameBytes);

  let drained = false;
  const writePromise = streamer.writeFrame(fakeFrame).then(() => {
    drained = true;
  });

  assert.equal(drained, false);

  mockChild.stdin.emit('drain');
  await writePromise;

  assert.equal(drained, true);
  assert.equal(streamer.getFramesWritten(), 1);
});

test('Streamer Scenario 3: write callback error rejects and cleans up', async () => {
  const mockChild = new MockChildProcess();
  mockChild.stdin.simulateWriteError = new Error('Disk write failure');
  const { streamer, config } = createTestStreamer(mockChild);

  const fakeFrame = new Uint8Array(config.expectedFrameBytes);

  await assert.rejects(streamer.writeFrame(fakeFrame), /Disk write failure/);
  assert.equal(streamer.getFramesWritten(), 0);
});

test('Streamer Scenario 4: EPIPE on stdin rejects frame write', async () => {
  const mockChild = new MockChildProcess();
  mockChild.stdin.writeResult = false;
  mockChild.stdin.on('error', () => {}); // Fallback handler for EventEmitter
  const { streamer, config } = createTestStreamer(mockChild);

  const fakeFrame = new Uint8Array(config.expectedFrameBytes);

  const writePromise = streamer.writeFrame(fakeFrame);
  mockChild.stdin.emit('error', new Error('EPIPE: broken pipe'));

  await assert.rejects(writePromise, /EPIPE/);
});

test('Streamer Scenario 5: child close before drain rejects frame write', async () => {
  const mockChild = new MockChildProcess();
  mockChild.stdin.writeResult = false;
  const { streamer, config } = createTestStreamer(mockChild);

  const fakeFrame = new Uint8Array(config.expectedFrameBytes);

  const writePromise = streamer.writeFrame(fakeFrame);
  mockChild.exitCode = 1;
  mockChild.emit('close', 1);

  await assert.rejects(writePromise, /FFmpeg closed with code 1/);
});

test('Streamer Scenario 6: AbortSignal rejects frame write while waiting for drain', async () => {
  const mockChild = new MockChildProcess();
  mockChild.stdin.writeResult = false;
  const { streamer, config } = createTestStreamer(mockChild);

  const fakeFrame = new Uint8Array(config.expectedFrameBytes);
  const controller = new AbortController();

  const writePromise = streamer.writeFrame(fakeFrame, controller.signal);
  controller.abort();

  await assert.rejects(writePromise, /AbortSignal triggered/);
});

test('Streamer Scenario 7: finish() frame count mismatch throws error', async () => {
  const mockChild = new MockChildProcess();
  const { streamer, config } = createTestStreamer(mockChild);

  const fakeFrame = new Uint8Array(config.expectedFrameBytes);
  await streamer.writeFrame(fakeFrame);

  await assert.rejects(async () => {
    await streamer.finish(2);
  }, /Frame count mismatch/);

  assert.equal(mockChild.killed, true);
});

test('Streamer Scenario 8: FFmpeg exit code non-zero on finish() throws error', async () => {
  const mockChild = new MockChildProcess();
  const { streamer, config } = createTestStreamer(mockChild);

  const fakeFrame = new Uint8Array(config.expectedFrameBytes);
  await streamer.writeFrame(fakeFrame);
  await streamer.writeFrame(fakeFrame);

  const finishPromise = streamer.finish(2);
  mockChild.emit('close', 137);

  await assert.rejects(finishPromise, /FFmpeg exited with non-zero code 137/);
});
