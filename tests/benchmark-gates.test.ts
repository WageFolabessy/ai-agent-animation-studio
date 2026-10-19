import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';
import {
  evaluateSmokeBenchmarkGates,
  type GateIterationReport
} from '../src/diagnostics/benchmark-gates.js';
import { X264_MEMORY_PARAMS } from '../src/config/render-config.js';

test('Benchmark Gates: Rejects benchmark when median is under 400 MB but one iteration reaches 400 MB', () => {
  const reports: GateIterationReport[] = [
    { iterNumber: 1, effectiveFps: 45, peakAggregateRssMb: 401.5, peakNodeRssMb: 260.0, peakChildRssMb: 141.5, preset: 'veryfast', threads: 2 },
    { iterNumber: 2, effectiveFps: 48, peakAggregateRssMb: 382.0, peakNodeRssMb: 240.0, peakChildRssMb: 142.0, preset: 'veryfast', threads: 2 },
    { iterNumber: 3, effectiveFps: 47, peakAggregateRssMb: 385.0, peakNodeRssMb: 243.0, peakChildRssMb: 142.0, preset: 'veryfast', threads: 2 }
  ];

  // Median is 385.0 MB (below 400 MB), but iteration 1 is 401.5 MB (>= 400 MB)
  assert.throws(
    () => evaluateSmokeBenchmarkGates({ reports }),
    (err: Error) => {
      return (
        err.message.includes('MEMORY GATE FAILED') &&
        err.message.includes('Iteration: 1') &&
        err.message.includes('Node RSS: 260.00 MB') &&
        err.message.includes('Child (FFmpeg) RSS: 141.50 MB') &&
        err.message.includes('Aggregate RSS: 401.50 MB') &&
        err.message.includes('Preset: veryfast') &&
        err.message.includes('Thread Count: 2') &&
        err.message.includes(`x264 Params: ${X264_MEMORY_PARAMS}`)
      );
    }
  );
});

test('Benchmark Gates: Rejects benchmark when median aggregate RSS exceeds 400 MB', () => {
  const reports: GateIterationReport[] = [
    { effectiveFps: 35, peakAggregateRssMb: 450.5 },
    { effectiveFps: 40, peakAggregateRssMb: 480.2 },
    { effectiveFps: 38, peakAggregateRssMb: 420.0 }
  ];

  assert.throws(
    () => evaluateSmokeBenchmarkGates({ reports }),
    (err: Error) => {
      return err.message.includes('MEMORY GATE FAILED');
    }
  );
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

test('Benchmark Gates: Passes when all criteria are satisfied', () => {
  const reports: GateIterationReport[] = [
    { iterNumber: 1, effectiveFps: 35.0, peakAggregateRssMb: 382.0 },
    { iterNumber: 2, effectiveFps: 42.0, peakAggregateRssMb: 386.0 },
    { iterNumber: 3, effectiveFps: 39.0, peakAggregateRssMb: 385.0 }
  ];

  const result = evaluateSmokeBenchmarkGates({ reports });
  assert.equal(result.success, true);
  assert.equal(result.medianRss, 385.0);
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
