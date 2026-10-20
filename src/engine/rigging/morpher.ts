import type {
  NormalizedCubicBezierSegment,
  NormalizedMorphTarget
} from '../../schemas/rig.contract.js';
import type { Vec2 } from '../../schemas/primitives.schema.js';
import type { PathCommand } from '../compositor/svg-builder.js';

export interface BlendedMorphResult {
  segments: NormalizedCubicBezierSegment[];
  commands: PathCommand[];
}

/**
 * Linearly blends base Bezier segments with morph targets using additive shape keys:
 * P_{s,i}(w) = B_{s,i} + sum_k w_k * (T_{k,s,i} - B_{s,i})
 */
export function blendMorphTargets(
  baseSegments: readonly NormalizedCubicBezierSegment[],
  targets: readonly NormalizedMorphTarget[],
  weights: Record<string, number>,
  closed = true
): BlendedMorphResult {
  const targetMap = new Map(targets.map((t) => [t.name, t]));
  const activeWeights: Array<{ target: NormalizedMorphTarget; weight: number }> = [];

  for (const [targetName, weight] of Object.entries(weights)) {
    if (weight > 0 && targetMap.has(targetName)) {
      activeWeights.push({
        target: targetMap.get(targetName)!,
        weight: Math.max(0, Math.min(1, weight))
      });
    }
  }

  const blendedSegments: NormalizedCubicBezierSegment[] = baseSegments.map((base, sIdx) => {
    let p0x = base.p0[0];
    let p0y = base.p0[1];
    let p1x = base.p1[0];
    let p1y = base.p1[1];
    let p2x = base.p2[0];
    let p2y = base.p2[1];
    let p3x = base.p3[0];
    let p3y = base.p3[1];

    for (const { target, weight } of activeWeights) {
      const tSeg = target.segments[sIdx];
      if (!tSeg) continue;
      p0x += weight * (tSeg.p0[0] - base.p0[0]);
      p0y += weight * (tSeg.p0[1] - base.p0[1]);
      p1x += weight * (tSeg.p1[0] - base.p1[0]);
      p1y += weight * (tSeg.p1[1] - base.p1[1]);
      p2x += weight * (tSeg.p2[0] - base.p2[0]);
      p2y += weight * (tSeg.p2[1] - base.p2[1]);
      p3x += weight * (tSeg.p3[0] - base.p3[0]);
      p3y += weight * (tSeg.p3[1] - base.p3[1]);
    }

    return {
      p0: [p0x, p0y],
      p1: [p1x, p1y],
      p2: [p2x, p2y],
      p3: [p3x, p3y]
    };
  });

  const commands: PathCommand[] = [];
  if (blendedSegments.length > 0) {
    commands.push({
      cmd: 'M',
      x: blendedSegments[0].p0[0],
      y: blendedSegments[0].p0[1]
    });

    for (const seg of blendedSegments) {
      commands.push({
        cmd: 'C',
        x1: seg.p1[0],
        y1: seg.p1[1],
        x2: seg.p2[0],
        y2: seg.p2[1],
        x: seg.p3[0],
        y: seg.p3[1]
      });
    }

    if (closed) {
      commands.push({ cmd: 'Z' });
    }
  }

  return {
    segments: blendedSegments,
    commands
  };
}

/**
 * Samples a cubic Bezier curve at parameter t in [0, 1].
 */
export function evaluateCubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const oneMinusT = 1 - t;
  const a = oneMinusT * oneMinusT * oneMinusT;
  const b = 3 * oneMinusT * oneMinusT * t;
  const c = 3 * oneMinusT * t * t;
  const d = t * t * t;

  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]
  ];
}

/**
 * Flattens a cubic Bezier segment into a discrete polygonal polyline.
 * @param samples - Number of sub-segments (>= 1).
 */
export function flattenCubicBezier(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  samples = 4
): Vec2[] {
  const count = Math.max(1, Math.round(samples));
  const points: Vec2[] = [p0];

  for (let i = 1; i <= count; i++) {
    const t = i / count;
    points.push(evaluateCubicBezier(p0, p1, p2, p3, t));
  }

  return points;
}
