import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampDepthKey,
  computePointsDepthKey,
  shouldSplitPrimitive,
  splitLargeLine,
  splitLargePolygon,
  compareDrawables,
  sortDrawables,
  type SortablePrimitive,
  type CameraSpaceLine,
  type CameraSpacePolygon
} from '../src/engine/compositor/depth-sort.js';

test('DepthSort: clampDepthKey clamps between near and far planes', () => {
  assert.equal(clampDepthKey(-50, 1, 1000), 1);
  assert.equal(clampDepthKey(0.5, 1, 1000), 1);
  assert.equal(clampDepthKey(500, 1, 1000), 500);
  assert.equal(clampDepthKey(1500, 1, 1000), 1000);
});

test('DepthSort: computePointsDepthKey calculates mean, min, max correctly with clamping', () => {
  const points = [
    [0, 0, -10], // clamped to 1
    [10, 0, 50],
    [20, 0, 100]
  ] as const;

  const result = computePointsDepthKey(points, 1, 1000);
  assert.equal(result.zMin, 1);
  assert.equal(result.zMax, 100);
  // (1 + 50 + 100) / 3 = 50.333333333333336
  assert.ok(Math.abs(result.zMean - 50.333333) < 1e-4);
});

test('DepthSort: shouldSplitPrimitive triggers when depth ratio > 0.30 and depth < 3', () => {
  // zMin = 10, zMax = 100, zMean = 55. r = 90 / 55 = 1.636 > 0.30
  assert.equal(shouldSplitPrimitive(10, 100, 55, 1, 0), true);
  assert.equal(shouldSplitPrimitive(10, 100, 55, 1, 2), true);
  // Max recursion depth reached
  assert.equal(shouldSplitPrimitive(10, 100, 55, 1, 3), false);

  // Small ratio: zMin = 50, zMax = 55, zMean = 52.5. r = 5 / 52.5 = 0.095 < 0.30
  assert.equal(shouldSplitPrimitive(50, 55, 52.5, 1, 0), false);
});

test('DepthSort: splitLargeLine splits segment at camera-space midpoint and sets wasSplit', () => {
  const longLine: CameraSpaceLine = {
    kind: 'line',
    p0: [0, 0, 10],
    p1: [0, 0, 200],
    depthKey: 0,
    tier: 2,
    index: 0
  };

  const pieces = splitLargeLine(longLine, 1, 1000);
  assert.ok(pieces.length > 1, 'Long line must be split into pieces');
  assert.ok(pieces.every((p) => p.wasSplit === true));

  // Verify pieces are contiguous and cover original span
  assert.deepEqual(pieces[0].p0, [0, 0, 10]);
  assert.deepEqual(pieces[pieces.length - 1].p1, [0, 0, 200]);
  for (let i = 0; i < pieces.length - 1; i++) {
    assert.deepEqual(pieces[i].p1, pieces[i + 1].p0);
  }
});

test('DepthSort: splitLargePolygon splits camera-space polygon along z = zMean', () => {
  // Quad spanning from z = 20 to z = 200
  const longQuad: CameraSpacePolygon = {
    kind: 'polygon',
    vertices: [
      [-50, 0, 20],
      [50, 0, 20],
      [50, 0, 200],
      [-50, 0, 200]
    ],
    depthKey: 0,
    tier: 2,
    index: 0
  };

  const pieces = splitLargePolygon(longQuad, 1, 1000);
  assert.ok(pieces.length >= 2, 'Long polygon must be split into multiple pieces');
  assert.ok(pieces.every((p) => p.vertices.length >= 3), 'All pieces must be valid polygons');
  assert.ok(pieces.every((p) => p.wasSplit === true));
});

test('DepthSort: sortDrawables strictly orders back-to-front by depthKey DESC, tier ASC, index ASC', () => {
  const primitives: SortablePrimitive[] = [
    { kind: 'fg', depthKey: 50, tier: 4, index: 0 },
    { kind: 'bg_deep', depthKey: 500, tier: 1, index: 1 },
    { kind: 'char', depthKey: 150, tier: 3, index: 2 },
    { kind: 'tie_tier2', depthKey: 150, tier: 2, index: 3 },
    { kind: 'tie_tier2_later', depthKey: 150, tier: 2, index: 4 },
    { kind: 'overlay', depthKey: 10, tier: 5, index: 5 }
  ];

  const sorted = sortDrawables(primitives);

  // Expected order:
  // 1. depthKey 500 (bg_deep)
  // 2. depthKey 150, tier 2, index 3 (tie_tier2)
  // 3. depthKey 150, tier 2, index 4 (tie_tier2_later)
  // 4. depthKey 150, tier 3, index 2 (char)
  // 5. depthKey 50 (fg)
  // 6. depthKey 10 (overlay)
  assert.equal(sorted[0].kind, 'bg_deep');
  assert.equal(sorted[1].kind, 'tie_tier2');
  assert.equal(sorted[2].kind, 'tie_tier2_later');
  assert.equal(sorted[3].kind, 'char');
  assert.equal(sorted[4].kind, 'fg');
  assert.equal(sorted[5].kind, 'overlay');
});
