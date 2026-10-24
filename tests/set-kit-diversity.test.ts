import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StageEnvironmentGenerator } from '../src/engine/library/stage-environment-generator.js';
import { THEME_PALETTES } from '../src/engine/library/environment-kit.js';
import type { TheatricalSetId } from '../src/schemas/stage.contract.js';

const WIDTH = 64;
const HEIGHT = 36;
const FOV_DEG = 50;

const SCALE = 4;
const HI_WIDTH = WIDTH * SCALE; // 256
const HI_HEIGHT = HEIGHT * SCALE; // 144

/**
 * Projects a 3D world coordinate to 2D pixel coordinates on high-res buffer.
 */
function projectToHiResScreen(
  x: number,
  y: number,
  z: number
): [number, number] | null {
  const camX = 0;
  const camY = 105;
  const camZ = 260;

  const xc = x - camX;
  const yc = y - camY;
  const zc = camZ - z;

  if (zc <= 5.0) return null;

  const halfH = zc * Math.tan(((FOV_DEG * Math.PI) / 180) / 2);
  const halfW = halfH * (WIDTH / HEIGHT);

  const u = (xc / halfW) * 0.5 + 0.5;
  const v = 0.5 - (yc / halfH) * 0.5;

  const px = Math.round(u * (HI_WIDTH - 1));
  const py = Math.round(v * (HI_HEIGHT - 1));

  return [px, py];
}

/**
 * Fills a 2D convex polygon into the high-res buffer.
 */
function fillHiPolygon(buffer: Float32Array, points: Array<[number, number]>): void {
  if (points.length < 3) return;

  let minY = HI_HEIGHT;
  let maxY = -1;
  for (const [_, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  minY = Math.max(0, minY);
  maxY = Math.min(HI_HEIGHT - 1, maxY);

  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % n];

      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        const t = (y - y0) / (y1 - y0);
        const x = x0 + t * (x1 - x0);
        intersections.push(x);
      }
    }

    intersections.sort((a, b) => a - b);

    for (let i = 0; i < intersections.length - 1; i += 2) {
      const startX = Math.max(0, Math.round(intersections[i]));
      const endX = Math.min(HI_WIDTH - 1, Math.round(intersections[i + 1]));
      for (let x = startX; x <= endX; x++) {
        buffer[y * HI_WIDTH + x] = 1.0;
      }
    }
  }
}

/**
 * Draws a line into the high-res buffer using Bresenham's algorithm.
 */
function drawHiLine(
  buffer: Float32Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number = 2
): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;

  while (true) {
    for (let ty = -thickness; ty <= thickness; ty++) {
      for (let tx = -thickness; tx <= thickness; tx++) {
        const px = cx + tx;
        const py = cy + ty;
        if (px >= 0 && px < HI_WIDTH && py >= 0 && py < HI_HEIGHT) {
          buffer[py * HI_WIDTH + px] = 1.0;
        }
      }
    }
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
}

/**
 * Renders a 64x36 anti-aliased monochrome buffer for a theatrical set kit.
 */
function renderMonochromeSetBuffer(setId: TheatricalSetId): Float32Array {
  const hiBuffer = new Float32Array(HI_WIDTH * HI_HEIGHT);
  const palette = THEME_PALETTES.CYBERPUNK_CYAN;

  const { polygons = [], lines = [] } = StageEnvironmentGenerator.buildSet({
    setId,
    centerX: 0,
    palette,
    isCloseUp: false
  });

  // Render polygons
  for (const poly of polygons) {
    const projected: Array<[number, number]> = [];
    for (const v of poly.vertices) {
      const pt = projectToHiResScreen(v[0], v[1], v[2]);
      if (pt) projected.push(pt);
    }
    if (projected.length >= 3) {
      fillHiPolygon(hiBuffer, projected);
    }
  }

  // Render lines with thickness
  for (const line of lines) {
    const ptA = projectToHiResScreen(line.p0[0], line.p0[1], line.p0[2]);
    const ptB = projectToHiResScreen(line.p1[0], line.p1[1], line.p1[2]);
    if (ptA && ptB) {
      drawHiLine(hiBuffer, ptA[0], ptA[1], ptB[0], ptB[1], 2);
    }
  }

  // Downsample 4x4 box average to 64x36
  const buffer = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let sum = 0;
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          sum += hiBuffer[(y * SCALE + sy) * HI_WIDTH + (x * SCALE + sx)];
        }
      }
      buffer[y * WIDTH + x] = sum / (SCALE * SCALE);
    }
  }

  return buffer;
}

/**
 * Computes 8x4 spatial grid occupancy histogram (32 bins).
 */
function computeSpatialOccupancy(buffer: Float32Array): number[] {
  const gridCols = 8;
  const gridRows = 4;
  const cellW = WIDTH / gridCols; // 8 px
  const cellH = HEIGHT / gridRows; // 9 px
  const occupancy: number[] = new Array(gridCols * gridRows).fill(0);

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      let activeCount = 0;
      const startX = Math.floor(gx * cellW);
      const endX = Math.floor((gx + 1) * cellW);
      const startY = Math.floor(gy * cellH);
      const endY = Math.floor((gy + 1) * cellH);
      const totalPixels = (endX - startX) * (endY - startY);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          if (buffer[y * WIDTH + x] > 0.0) {
            activeCount++;
          }
        }
      }

      const binIndex = gy * gridCols + gx;
      occupancy[binIndex] = totalPixels > 0 ? activeCount / totalPixels : 0;
    }
  }

  return occupancy;
}

/**
 * Computes 8-bin Sobel edge gradient orientation histogram.
 */
function computeSobelGradientHistogram(buffer: Float32Array): number[] {
  const hist = new Array(8).fill(0);
  let totalWeight = 0;

  for (let y = 1; y < HEIGHT - 1; y++) {
    for (let x = 1; x < WIDTH - 1; x++) {
      // 3x3 Sobel kernels
      const p00 = buffer[(y - 1) * WIDTH + (x - 1)];
      const p01 = buffer[(y - 1) * WIDTH + x];
      const p02 = buffer[(y - 1) * WIDTH + (x + 1)];
      const p10 = buffer[y * WIDTH + (x - 1)];
      const p12 = buffer[y * WIDTH + (x + 1)];
      const p20 = buffer[(y + 1) * WIDTH + (x - 1)];
      const p21 = buffer[(y + 1) * WIDTH + x];
      const p22 = buffer[(y + 1) * WIDTH + (x + 1)];

      const gx = -p00 + p02 - 2 * p10 + 2 * p12 - p20 + p22;
      const gy = -p00 - 2 * p01 - p02 + p20 + 2 * p21 + p22;
      const mag = Math.hypot(gx, gy);

      if (mag > 0.05) {
        let angle = Math.atan2(gy, gx); // [-PI, PI]
        if (angle < 0) angle += 2 * Math.PI; // [0, 2*PI)
        const bin = Math.min(7, Math.floor((angle / (2 * Math.PI)) * 8));
        hist[bin] += mag;
        totalWeight += mag;
      }
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < 8; i++) {
      hist[i] /= totalWeight;
    }
  } else {
    for (let i = 0; i < 8; i++) {
      hist[i] = 1 / 8;
    }
  }

  return hist;
}

/**
 * Computes the color-blind monochrome spatial and Sobel edge diversity metric:
 *   Delta_set = 0.6 * (1/32) * sum(|O1(b) - O2(b)|) + 0.4 * (1/2) * sum(|G1(k) - G2(k)|)
 */
export function computeSetSilhouetteDiversity(
  setA: TheatricalSetId,
  setB: TheatricalSetId
): { deltaSet: number; spatialDelta: number; gradientDelta: number } {
  const bufA = renderMonochromeSetBuffer(setA);
  const bufB = renderMonochromeSetBuffer(setB);

  const occA = computeSpatialOccupancy(bufA);
  const occB = computeSpatialOccupancy(bufB);

  const gradA = computeSobelGradientHistogram(bufA);
  const gradB = computeSobelGradientHistogram(bufB);

  let spatialDiffSum = 0;
  for (let b = 0; b < 32; b++) {
    spatialDiffSum += Math.abs(occA[b] - occB[b]);
  }
  const spatialDelta = spatialDiffSum / 32;

  let gradDiffSum = 0;
  for (let k = 0; k < 8; k++) {
    gradDiffSum += Math.abs(gradA[k] - gradB[k]);
  }
  const gradientDelta = gradDiffSum / 2;

  const deltaSet = 0.6 * spatialDelta + 0.4 * gradientDelta;
  return { deltaSet, spatialDelta, gradientDelta };
}

describe('SetKit: Structural Silhouette Diversity (Monochrome Spatial & Sobel Edge Metric)', () => {
  it('computes Delta_set >= 0.25 between ARCHITECTURAL_INTERIOR and EXTERIOR_URBAN_VISTA', () => {
    const { deltaSet, spatialDelta, gradientDelta } = computeSetSilhouetteDiversity(
      'ARCHITECTURAL_INTERIOR',
      'EXTERIOR_URBAN_VISTA'
    );

    console.log(
      `Set Diversity [ARCHITECTURAL_INTERIOR vs EXTERIOR_URBAN_VISTA]: Delta_set = ${deltaSet.toFixed(4)} ` +
        `(Spatial: ${spatialDelta.toFixed(4)}, Sobel Gradient: ${gradientDelta.toFixed(4)})`
    );

    assert.ok(
      deltaSet >= 0.25,
      `Expected Delta_set >= 0.25, got ${deltaSet.toFixed(4)}`
    );
  });

  it('identical set kits have Delta_set = 0.000', () => {
    const { deltaSet } = computeSetSilhouetteDiversity(
      'ARCHITECTURAL_INTERIOR',
      'ARCHITECTURAL_INTERIOR'
    );

    assert.equal(deltaSet, 0);
  });
});
