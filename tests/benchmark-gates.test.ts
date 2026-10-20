import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';
import {
  evaluateSmokeBenchmarkGates,
  type GateIterationReport,
  MEMORY_HARD_FAIL_MB,
  MEMORY_TARGET_MB
} from '../src/diagnostics/benchmark-gates.js';
import { X264_MEMORY_PARAMS } from '../src/config/render-config.js';

test('Benchmark Gates: Rejects benchmark when any iteration exceeds hard fail limit of 600 MB', () => {
  const reports: GateIterationReport[] = [
    { iterNumber: 1, effectiveFps: 45, peakAggregateRssMb: 600.05, peakNodeRssMb: 450.0, peakChildRssMb: 150.05, preset: 'veryfast', threads: 2 },
    { iterNumber: 2, effectiveFps: 48, peakAggregateRssMb: 382.0, peakNodeRssMb: 240.0, peakChildRssMb: 142.0, preset: 'veryfast', threads: 2 },
    { iterNumber: 3, effectiveFps: 47, peakAggregateRssMb: 385.0, peakNodeRssMb: 243.0, peakChildRssMb: 142.0, preset: 'veryfast', threads: 2 }
  ];

  assert.throws(
    () => evaluateSmokeBenchmarkGates({ reports }),
    (err: Error) => {
      return (
        err.message.includes('MEMORY GATE FAILED') &&
        err.message.includes('Iteration: 1') &&
        err.message.includes('Node RSS: 450.00 MB') &&
        err.message.includes('Child (FFmpeg) RSS: 150.05 MB') &&
        err.message.includes(`Aggregate RSS: 600.05 MB (Hard limit: <= ${MEMORY_HARD_FAIL_MB} MB)`) &&
        err.message.includes('Preset: veryfast') &&
        err.message.includes('Thread Count: 2') &&
        err.message.includes(`x264 Params: ${X264_MEMORY_PARAMS}`)
      );
    }
  );
});

test('Benchmark Gates: Emits warning but passes when an iteration reaches target of 400 MB but stays <= 600 MB', () => {
  const reports: GateIterationReport[] = [
    { iterNumber: 1, effectiveFps: 45, peakAggregateRssMb: 401.5, peakNodeRssMb: 260.0, peakChildRssMb: 141.5, preset: 'veryfast', threads: 2 },
    { iterNumber: 2, effectiveFps: 48, peakAggregateRssMb: 382.0, peakNodeRssMb: 240.0, peakChildRssMb: 142.0, preset: 'veryfast', threads: 2 },
    { iterNumber: 3, effectiveFps: 47, peakAggregateRssMb: 385.0, peakNodeRssMb: 243.0, peakChildRssMb: 142.0, preset: 'veryfast', threads: 2 }
  ];

  const result = evaluateSmokeBenchmarkGates({ reports });
  assert.equal(result.success, true);
  assert.equal(result.status, 'pass_with_warnings');
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes('MEMORY TARGET WARNING'));
  assert.ok(result.warnings[0].includes('401.50 MB'));
  assert.equal(result.medianRss, 385.0);
  assert.equal(result.maxRss, 401.5);
});

test('Benchmark Gates: Emits warning when median aggregate RSS reaches target of 400 MB', () => {
  const reports: GateIterationReport[] = [
    { iterNumber: 1, effectiveFps: 35, peakAggregateRssMb: 450.5 },
    { iterNumber: 2, effectiveFps: 40, peakAggregateRssMb: 480.2 },
    { iterNumber: 3, effectiveFps: 38, peakAggregateRssMb: 420.0 }
  ];

  const result = evaluateSmokeBenchmarkGates({ reports });
  assert.equal(result.success, true);
  assert.equal(result.status, 'pass_with_warnings');
  assert.ok(result.warnings.some((w) => w.includes('Median peak aggregate RSS 450.50 MB')));
});

test('Benchmark Gates: Evaluates memory plateau and rejects suspected memory leaks', () => {
  const reports: GateIterationReport[] = [
    { iterNumber: 1, effectiveFps: 30, peakAggregateRssMb: 280 }
  ];

  // Short run: 150 frames, peak 280 MB. Allowed growth: max(32, 0.1 * 280 = 28) = 32 MB.
  // Long run: 450 frames, peak 330 MB -> growth 50 MB > 32 MB. Must reject!
  assert.throws(
    () =>
      evaluateSmokeBenchmarkGates({
        reports,
        plateau: {
          short: { frames: 150, peakAggregateRssMb: 280 },
          long: { frames: 450, peakAggregateRssMb: 330 }
        }
      }),
    (err: Error) => {
      return (
        err.message.includes('MEMORY PLATEAU FAILED') &&
        err.message.includes('growth 50.00 MB exceeds allowed 32.00 MB')
      );
    }
  );

  // Growth within limit (e.g. 15 MB <= 32 MB) passes
  const valid = evaluateSmokeBenchmarkGates({
    reports,
    plateau: {
      short: { frames: 150, peakAggregateRssMb: 280 },
      long: { frames: 450, peakAggregateRssMb: 295 }
    }
  });
  assert.equal(valid.success, true);
  assert.equal(valid.plateau?.growthMb, 15);
  assert.equal(valid.plateau?.allowedMb, 32);
});

test('Benchmark Gates: Rejects benchmark when effective FPS is below 15', () => {
  const reports: GateIterationReport[] = [
    { effectiveFps: 12.0, peakAggregateRssMb: 350.0 },
    { effectiveFps: 14.5, peakAggregateRssMb: 360.0 },
    { effectiveFps: 10.0, peakAggregateRssMb: 340.0 }
  ];

  assert.throws(
    () => evaluateSmokeBenchmarkGates({ reports }),
    (err: Error) => {
      return err.message.includes('PERFORMANCE GATE FAILED') && err.message.includes('12.00');
    }
  );
});

test('Benchmark Gates: Rejects benchmark when temporary image files exist on disk', () => {
  const reports: GateIterationReport[] = [
    { effectiveFps: 30.0, peakAggregateRssMb: 380.0 },
    { effectiveFps: 32.0, peakAggregateRssMb: 385.0 },
    { effectiveFps: 31.0, peakAggregateRssMb: 375.0 }
  ];

  assert.throws(
    () => evaluateSmokeBenchmarkGates({ reports, existingImageFiles: ['frame_001.png', 'temp.svg'] }),
    (err: Error) => {
      return err.message.includes('ARTIFACT HYGIENE FAILED') && err.message.includes('frame_001.png');
    }
  );
});

test('Benchmark Gates: Passes cleanly with zero warnings when all criteria satisfied below target', () => {
  const reports: GateIterationReport[] = [
    { iterNumber: 1, effectiveFps: 35.0, peakAggregateRssMb: 320.0 },
    { iterNumber: 2, effectiveFps: 42.0, peakAggregateRssMb: 315.0 },
    { iterNumber: 3, effectiveFps: 39.0, peakAggregateRssMb: 318.0 }
  ];

  const result = evaluateSmokeBenchmarkGates({ reports });
  assert.equal(result.success, true);
  assert.equal(result.status, 'pass');
  assert.equal(result.warnings.length, 0);
  assert.equal(result.medianRss, 318.0);
  assert.equal(result.medianFps, 39.0);
});

test('Hygiene: Zero temporary svg or png files across entire workspace disk', () => {
  const junk = findTemporaryImageFiles('.');
  assert.equal(junk.length, 0, `No .png or .svg files allowed in workspace: ${junk.join(', ')}`);
});

test('Hygiene: Detects and rejects temporary image files located in subdirectories of output', () => {
  const subDir = 'output/test_sub_hygiene';
  const dummyFile = path.join(subDir, 'orphan_frame.png');

  if (!fs.existsSync(subDir)) {
    fs.mkdirSync(subDir, { recursive: true });
  }
  fs.writeFileSync(dummyFile, 'dummy png content');

  try {
    const junk = findTemporaryImageFiles('output');
    assert.ok(
      junk.some((f) => f.includes('orphan_frame.png')),
      'Must detect temporary image file in output subdirectory'
    );

    assert.throws(
      () =>
        evaluateSmokeBenchmarkGates({
          reports: [{ effectiveFps: 30, peakAggregateRssMb: 350 }],
          existingImageFiles: junk
        }),
      (err: Error) => {
        return (
          err.message.includes('ARTIFACT HYGIENE FAILED') &&
          err.message.includes('orphan_frame.png')
        );
      }
    );
  } finally {
    if (fs.existsSync(dummyFile)) fs.unlinkSync(dummyFile);
    if (fs.existsSync(subDir)) fs.rmdirSync(subDir);
  }
});
