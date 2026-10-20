import type { SceneEnvironment, EnvironmentPolygon, EnvironmentLine } from '../../engine/compositor/scene-compositor.js';

export function getDemoEnvironment(shotId: string): SceneEnvironment {
  if (shotId === 'shot-3') {
    // Close-up shot: local ground plane and subtle framing grid lines
    return {
      polygons: [
        {
          vertices: [
            [-100, 0, 300],
            [500, 0, 300],
            [500, 0, -300],
            [-100, 0, -300]
          ],
          fill: '#0c101d',
          opacity: 0.95,
          tier: 0
        }
      ],
      lines: [
        { p0: [-100, 0, 0], p1: [500, 0, 0], stroke: '#1b2438', strokeWidth: 1.5, opacity: 0.8, tier: 2 },
        { p0: [300, 0, -300], p1: [300, 0, 300], stroke: '#1b2438', strokeWidth: 1.5, opacity: 0.8, tier: 2 }
      ]
    };
  }

  // Wide, Tracking, and Orbit shots: broad industrial ground plane and perspective grid lines
  const groundPolygon: EnvironmentPolygon = {
    vertices: [
      [-1200, 0, 1200],
      [1200, 0, 1200],
      [1200, 0, -1200],
      [-1200, 0, -1200]
    ],
    fill: '#0c101d',
    opacity: 0.95,
    tier: 0
  };

  const gridLines: EnvironmentLine[] = [];
  const steps = [-800, -400, 0, 400, 800];

  for (const z of steps) {
    gridLines.push({
      p0: [-1200, 0, z],
      p1: [1200, 0, z],
      stroke: '#1b2438',
      strokeWidth: 1.5,
      opacity: 0.8,
      tier: 2
    });
  }

  for (const x of steps) {
    gridLines.push({
      p0: [x, 0, -1200],
      p1: [x, 0, 1200],
      stroke: '#1b2438',
      strokeWidth: 1.5,
      opacity: 0.8,
      tier: 2
    });
  }

  return {
    polygons: [groundPolygon],
    lines: gridLines
  };
}
