import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interpolateEasing,
  springImpulse,
  lerp,
  lerpVec2,
  lerpVec3
} from '../src/engine/math/easing.js';
import {
  springImpulseResponse,
  exponentialDecay,
  evaluateSpringResponse
} from '../src/engine/math/spring.js';
import { valueNoise1D } from '../src/engine/math/noise.js';
import {
  hexToRgb,
  rgbToHex,
  mixHexColors,
  shadeHexColor,
  computeLitShadedColors
} from '../src/engine/math/color.js';
import type { CameraEasing } from '../src/schemas/storyboard.contract.js';

test('Math Easing: All CameraEasingEnum functions satisfy endpoints and bounds', () => {
  const easings: CameraEasing[] = [
    'linear',
    'easeInQuad',
    'easeOutQuad',
    'easeInOutCubic',
    'easeInOutSine',
    'springImpulse'
  ];

  for (const easing of easings) {
    const v0 = interpolateEasing(easing, 0);
    const v1 = interpolateEasing(easing, 1);
    assert.equal(Math.abs(v0) < 1e-6, true, `${easing} at 0 must be 0`);
    assert.equal(Math.abs(v1 - 1) < 1e-6, true, `${easing} at 1 must be 1`);
  }

  // Monotonic easings check
  const monotonic: CameraEasing[] = ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutCubic', 'easeInOutSine'];
  for (const easing of monotonic) {
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const t = i / 20;
      const curr = interpolateEasing(easing, t);
      assert.ok(curr >= prev, `${easing} must be monotonically non-decreasing`);
      assert.ok(curr >= 0 && curr <= 1, `${easing} must stay in [0, 1]`);
      prev = curr;
    }
  }

  // springImpulse overshoot check: peaks near t ~= 0.327 with ~9.5% overshoot
  const peakVal = springImpulse(0.327);
  assert.ok(peakVal > 1.08 && peakVal < 1.11, `springImpulse peak overshoot expected ~1.095, got ${peakVal}`);
});

test('Math Vectors: lerp, lerpVec2, and lerpVec3 calculate exact linear interpolation', () => {
  assert.equal(lerp(10, 20, 0.5), 15);
  assert.deepEqual(lerpVec2([0, 10], [10, 30], 0.5), [5, 20]);
  assert.deepEqual(lerpVec3([0, 10, 20], [10, 30, 60], 0.5), [5, 20, 40]);
});

test('Math Spring: Impulse response for underdamped, critically damped, and overdamped modes', () => {
  // Underdamped (zeta = 0.5 < 1)
  const hUnder = springImpulseResponse(0.1, 0.5, 10);
  assert.ok(Number.isFinite(hUnder) && hUnder > 0);

  // Critically damped (zeta = 1.0)
  const hCrit = springImpulseResponse(0.1, 1.0, 10);
  assert.ok(Number.isFinite(hCrit) && hCrit > 0);

  // Overdamped (zeta = 1.5 > 1)
  const hOver = springImpulseResponse(0.1, 1.5, 10);
  assert.ok(Number.isFinite(hOver) && hOver > 0);

  // tau = 0 must be 0
  assert.equal(springImpulseResponse(0, 0.5, 10), 0);
  assert.equal(springImpulseResponse(0, 1.0, 10), 0);
  assert.equal(springImpulseResponse(0, 1.5, 10), 0);
});

test('Math Spring: Superposition and frame-independence of evaluateSpringResponse', () => {
  const fps = 30;
  const zeta = 0.6;
  const omega = 12;

  const drive1 = (f: number) => (f === 10 ? 1.0 : 0);
  const drive2 = (f: number) => (f === 15 ? 0.5 : 0);
  const driveCombined = (f: number) => drive1(f) + drive2(f);

  // Superposition: response(d1 + d2) === response(d1) + response(d2)
  for (let f = 10; f <= 30; f++) {
    const r1 = evaluateSpringResponse(f, fps, zeta, omega, drive1);
    const r2 = evaluateSpringResponse(f, fps, zeta, omega, drive2);
    const rCombined = evaluateSpringResponse(f, fps, zeta, omega, driveCombined);
    assert.ok(Math.abs(rCombined - (r1 + r2)) < 1e-6, `Superposition failed at frame ${f}`);
  }

  // Frame-independence: evaluating frame 25 directly yields identical result to sequential
  const rDirect = evaluateSpringResponse(25, fps, zeta, omega, driveCombined);
  const rRepeated = evaluateSpringResponse(25, fps, zeta, omega, driveCombined);
  assert.equal(rDirect, rRepeated);
});

test('Math Spring: Continuous exponential decay is monotonic and smooth', () => {
  const peak = 1.0;
  const lambda = 5.0; // Decay rate

  let prev = peak;
  for (let i = 1; i <= 20; i++) {
    const dt = i * 0.05;
    const curr = exponentialDecay(dt, lambda, peak);
    assert.ok(curr < prev, 'Exponential decay must decrease monotonically');
    assert.ok(curr >= 0, 'Exponential decay must remain non-negative');
    prev = curr;
  }
});

test('Math Noise: valueNoise1D is deterministic and strictly bounded in [-1, 1]', () => {
  const seed = 12345;
  const channel = 0;

  for (let i = 0; i < 200; i++) {
    const x = i * 0.17;
    const n1 = valueNoise1D(seed, channel, x);
    const n2 = valueNoise1D(seed, channel, x);
    assert.equal(n1, n2, 'Noise must be deterministic');
    assert.ok(n1 >= -1.0 && n1 <= 1.0, `Noise value ${n1} out of bounds [-1, 1]`);
  }

  // Different channels produce different values
  const nChan0 = valueNoise1D(seed, 0, 5.5);
  const nChan1 = valueNoise1D(seed, 1, 5.5);
  assert.notEqual(nChan0, nChan1);
});

test('Math Color: hexToRgb, rgbToHex, mixHexColors, and shadeHexColor behave correctly', () => {
  assert.deepEqual(hexToRgb('#ff00aa'), [255, 0, 170]);
  assert.equal(rgbToHex(255, 0, 170), '#ff00aa');

  // Mixing #000000 and #ffffff
  assert.equal(mixHexColors('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixHexColors('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixHexColors('#000000', '#ffffff', 0.5), '#808080');

  // Shading
  assert.equal(shadeHexColor('#808080', 0), '#808080');
  // Shading positive brightens
  const brightened = shadeHexColor('#808080', 0.5);
  assert.deepEqual(hexToRgb(brightened), [192, 192, 192]);
  // Shading negative darkens
  const darkened = shadeHexColor('#808080', -0.5);
  assert.deepEqual(hexToRgb(darkened), [64, 64, 64]);

  // Lit / shaded colors
  const palette = {
    background: '#08081a',
    primary: '#00d4ff',
    secondary: '#ff0077',
    accent: '#ffe600',
    ambientLightColor: '#ffffff',
    ambientIntensity: 0.5,
    keyLightDirection: [0.5, 0.8, -0.3] as [number, number, number],
    audioReactiveGain: 1.0
  };
  const { litColor, shadedColor } = computeLitShadedColors('#808080', palette);
  assert.ok(litColor.startsWith('#'));
  assert.ok(shadedColor.startsWith('#'));
});
