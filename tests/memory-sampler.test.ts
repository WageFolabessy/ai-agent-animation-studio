import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PipelineMemorySampler } from '../src/diagnostics/memory-sampler.js';
import {
  evaluateProductionMemoryGate,
  runProductionPipeline
} from '../src/engine/director/production-pipeline.js';
import { readChunkMetadata } from '../src/engine/director/checkpoint-manager.js';
import { synthesizeMusicalWavBuffer } from '../src/engine/audio/index.js';

function spawnDummyChild(allocMb = 16): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const script = `
      const buf = Buffer.alloc(${allocMb} * 1024 * 1024, 0xaa);
      process.stdout.write('READY\\n');
      setInterval(() => { buf[0] ^= 1; }, 200);
    `;
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    child.once('error', reject);
    child.stdout?.once('data', () => resolve(child));
  });
}

function killAndWait(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    child.once('close', () => resolve());
    child.kill('SIGKILL');
  });
}

test('PipelineMemorySampler & Real Aggregate Memory Gate Suite (D1)', async (t) => {
  await t.test(
    '(1) Detects spawned child RSS, enforces per-tick aggregate >= each component, and supports PID re-pointing',
    async () => {
      const childA = await spawnDummyChild(16);
      const childB = await spawnDummyChild(20);

      try {
        assert.ok(typeof childA.pid === 'number', 'childA must have a valid PID');
        assert.ok(typeof childB.pid === 'number', 'childB must have a valid PID');

        const sampler = new PipelineMemorySampler(25);
        sampler.start();

        // Initially no child PID attached -> childRssMb === 0
        sampler.sample();
        const initialSnap = sampler.getLastTickSnapshot();
        assert.equal(initialSnap.childRssMb, 0, 'Without childPid, childRssMb must be 0');
        assert.equal(
          initialSnap.aggregateRssMb,
          initialSnap.nodeRssMb,
          'Without childPid, aggregate must equal node RSS'
        );

        // Attach childA -> immediate synchronous sample taken
        sampler.setChildPid(childA.pid!);
        const snapA = sampler.getLastTickSnapshot();
        assert.ok(snapA.childRssMb > 8, `Expected childA RSS > 8 MB, got ${snapA.childRssMb} MB`);
        assert.ok(
          snapA.aggregateRssMb >= snapA.nodeRssMb + snapA.childRssMb - 0.05,
          `Aggregate (${snapA.aggregateRssMb}) must equal node (${snapA.nodeRssMb}) + child (${snapA.childRssMb})`
        );
        assert.ok(snapA.aggregateRssMb > snapA.nodeRssMb, 'Aggregate RSS must strictly exceed Node RSS');

        // Re-point to null (gap between chunks) -> childRssMb drops to 0 on next sample
        sampler.setChildPid(null);
        sampler.sample();
        const gapSnap = sampler.getLastTickSnapshot();
        assert.equal(gapSnap.childRssMb, 0, 'During inter-chunk gap (PID null), childRssMb must be 0');

        // Re-point to childB
        sampler.setChildPid(childB.pid!);
        const snapB = sampler.getLastTickSnapshot();
        assert.ok(snapB.childRssMb > 10, `Expected childB RSS > 10 MB, got ${snapB.childRssMb} MB`);

        const finalStats = sampler.stop();
        assert.ok(finalStats.peakChildRssMb >= snapB.childRssMb);
        assert.ok(finalStats.peakAggregateRssMb > finalStats.peakNodeRssMb);
        assert.ok(finalStats.sampleCount >= 4);
      } finally {
        await killAndWait(childA);
        await killAndWait(childB);
      }
    }
  );

  await t.test('(2) Gracefully handles dead child process with 0 RSS and zero exceptions', async () => {
    const child = await spawnDummyChild(8);
    const deadPid = child.pid!;
    await killAndWait(child);

    const sampler = new PipelineMemorySampler(25);
    sampler.start(deadPid);
    sampler.sample();
    const snap = sampler.getLastTickSnapshot();
    const stats = sampler.stop();

    assert.equal(snap.childRssMb, 0, 'Exited child process must report 0 MB RSS');
    assert.equal(stats.peakChildRssMb, 0, 'Exited child process peak must be 0 MB');
    assert.ok(stats.peakNodeRssMb > 0, 'Node RSS must still be measured');
  });

  await t.test(
    '(3) In-flight hard fail triggers callback on the first tick exceeding hardFailThresholdMb',
    async () => {
      const child = await spawnDummyChild(16);
      try {
        let triggeredCount = 0;
        let capturedAggregate = 0;

        // Set threshold to 10 MB so the very first tick with Node + Child triggers in-flight abort
        const sampler = new PipelineMemorySampler({
          intervalMs: 25,
          hardFailThresholdMb: 10,
          onHardFailExceeded: (snapshot) => {
            triggeredCount++;
            capturedAggregate = snapshot.aggregateRssMb;
          }
        });

        sampler.start();
        sampler.setChildPid(child.pid!);
        sampler.sample();
        sampler.sample();
        sampler.stop();

        assert.equal(triggeredCount, 1, 'onHardFailExceeded must fire exactly once on the first exceeding tick');
        assert.ok(capturedAggregate > 10, 'Captured snapshot must exceed the threshold');
      } finally {
        await killAndWait(child);
      }
    }
  );

  await t.test(
    '(4) Production summary gate derives from true aggregate RSS (pass < 400 MB, warn >= 400 MB, fail > 600 MB)',
    () => {
      // Pass case (< 400 MB)
      const passEval = evaluateProductionMemoryGate({
        peakAggregateRssMb: 365.4,
        peakNodeRssMb: 235.2,
        peakChildRssMb: 130.2
      });
      assert.equal(passEval.status, 'pass');
      assert.equal(passEval.warningMessage, undefined);
      assert.match(passEval.summaryLabel, /PASS/);

      // Warning case (>= 400 MB, <= 600 MB) where Node alone is < 400 MB but Node + FFmpeg >= 400 MB
      const warnEval = evaluateProductionMemoryGate({
        peakAggregateRssMb: 425.0,
        peakNodeRssMb: 295.0,
        peakChildRssMb: 130.0
      });
      assert.equal(warnEval.status, 'warning');
      assert.ok(warnEval.warningMessage?.includes('425.00 MB'));
      assert.ok(warnEval.warningMessage?.includes('Peak FFmpeg: 130.00 MB'));
      assert.match(warnEval.summaryLabel, /WARNING/);

      // Hard fail case (> 600 MB)
      assert.throws(
        () =>
          evaluateProductionMemoryGate({
            peakAggregateRssMb: 605.0,
            peakNodeRssMb: 390.0,
            peakChildRssMb: 215.0
          }),
        /MEMORY GATE FAILED: Peak aggregate RSS 605\.00 MB/
      );
    }
  );

  await t.test(
    '(5) End-to-end production pipeline attributes FFmpeg child RSS and aborts in-flight while keeping completed chunks resumable',
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-memgate-test-'));
      const audioPath = path.join(tmpDir, 'test.wav');
      const lrcPath = path.join(tmpDir, 'test.lrc');
      const outPath = path.join(tmpDir, 'memrun.mp4');
      const chunksDir = path.join(tmpDir, 'chunks', 'memrun');

      fs.writeFileSync(
        audioPath,
        synthesizeMusicalWavBuffer({ durationSeconds: 1.0, sampleRate: 44100, bpm: 120 })
      );
      fs.writeFileSync(lrcPath, '[00:00.00] Memory gate test\n');

      try {
        // Step A: Render chunk 0 only (maxChunks: 1 of 2) with normal memory limit
        const firstSlice = await runProductionPipeline({
          outputPath: outPath,
          audioPath,
          lrcPath,
          chunkFrames: 12,
          frameCount: 24,
          maxChunks: 1,
          quiet: true,
          resume: true,
          crf: 24
        });

        assert.ok(firstSlice.peakChildRssMb > 0, 'Production pipeline must measure positive FFmpeg child RSS');
        assert.ok(
          firstSlice.peakAggregateRssMb > firstSlice.peakNodeRssMb,
          `Peak Aggregate RSS (${firstSlice.peakAggregateRssMb} MB) must exceed Peak Node RSS (${firstSlice.peakNodeRssMb} MB)`
        );

        const chunk0Path = path.join(chunksDir, 'chunk_000.mp4');
        const chunk1Path = path.join(chunksDir, 'chunk_001.mp4');
        assert.ok(fs.existsSync(chunk0Path), 'chunk_000.mp4 must exist after first slice');
        assert.ok(readChunkMetadata(chunk0Path) !== null, 'chunk_000.mp4.meta.json must exist');

        // Step B: Run full 2-chunk pipeline with an artificially low hardFailMemoryMb (10 MB)
        // Chunk 0 is already COMPLETED and skipped; Chunk 1 aborts in-flight via AbortSignal!
        await assert.rejects(
          async () => {
            await runProductionPipeline({
              outputPath: outPath,
              audioPath,
              lrcPath,
              chunkFrames: 12,
              frameCount: 24,
              quiet: true,
              resume: true,
              crf: 24,
              hardFailMemoryMb: 10
            });
          },
          /MEMORY GATE FAILED \(IN-FLIGHT\)/,
          'Must abort in-flight when aggregate RSS exceeds hardFailMemoryMb'
        );

        // Verify completed chunk_000.mp4 is still intact and resumable, and uncommitted chunk_001.part.mp4 is cleaned
        assert.ok(fs.existsSync(chunk0Path), 'Completed chunk_000.mp4 must remain intact after in-flight abort');
        assert.ok(
          readChunkMetadata(chunk0Path) !== null,
          'Completed chunk_000.mp4.meta.json must remain valid for resume'
        );
        assert.ok(
          !fs.existsSync(chunk1Path.replace(/\.mp4$/, '.part.mp4')),
          'Aborted chunk staging .part.mp4 must be cleaned up'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
});
