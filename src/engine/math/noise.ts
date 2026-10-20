/**
 * Fully deterministic 1D value noise with quintic smoothing and lowbias32 integer hashing.
 * Guaranteed to return values strictly within [-1, 1] without random state or drift.
 */

export function lowbias32(x: number): number {
  let h = x >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

export function hashCoord(seed: number, channel: number, coord: number): number {
  const h1 = lowbias32((seed ^ 0x9e3779b9) >>> 0);
  const h2 = lowbias32((h1 ^ Math.imul(channel, 0x85ebca6b)) >>> 0);
  const h3 = lowbias32((h2 ^ Math.imul(coord, 0xc2b2ae35)) >>> 0);
  // Map unsigned 32-bit integer [0, 0xFFFFFFFF] to [-1.0, 1.0]
  return (h3 / 0xffffffff) * 2 - 1;
}

/** Perlin quintic polynomial: 6t^5 - 15t^4 + 10t^3 */
export function quinticSmooth(t: number): number {
  const ct = Math.max(0, Math.min(1, t));
  return ct * ct * ct * (ct * (ct * 6 - 15) + 10);
}

/**
 * 1D value noise sampled at coordinate x.
 *
 * @param seed - User or project seed
 * @param channel - Distinct channel integer (e.g. 0 for X, 1 for Y, 2 for Roll)
 * @param x - Continuous coordinate
 * @returns Smooth noise value strictly in [-1.0, 1.0]
 */
export function valueNoise1D(seed: number, channel: number, x: number): number {
  const i0 = Math.floor(x);
  const i1 = i0 + 1;
  const t = x - i0;

  const v0 = hashCoord(seed, channel, i0);
  const v1 = hashCoord(seed, channel, i1);

  const u = quinticSmooth(t);
  const val = v0 + u * (v1 - v0);
  return Math.max(-1.0, Math.min(1.0, val));
}
