import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateParticleEmitter } from '../src/engine/effects/particle-emitter.js';
import type { ParticleEmitter } from '../src/schemas/rig.contract.js';

test('ParticleEmitter Saturation: newest audio onset burst particles are preserved under capacity exhaustion', () => {
  const maxParticles = 40;
  const fps = 30;
  const lifetimeFrames = 60; // 2.0s

  const emitter: ParticleEmitter = {
    seed: 12345,
    maxParticles,
    ratePerSecond: 30, // 30 particles/s * 2s = 60 continuous candidate particles (> 40 max)
    lifetimeFrames,
    spawn: { kind: 'point' },
    velocity: { angleDegrees: 0, spreadDegrees: 30, speedMin: 5, speedMax: 20 },
    gravity: [0, -9.8],
    radiusRange: [2, 6],
    paintRole: 'accent',
    baseOpacity: 0.9,
    audio: {
      onsetBurstCount: 15,
      rateBand: null,
      rateGain: 0
    }
  };

  const frameIndex = 100;
  // An audio onset happens exactly on frameIndex (age = 0)
  const onsetFrames = [100];

  const active = evaluateParticleEmitter(emitter, frameIndex, fps, onsetFrames);

  assert.equal(active.length, maxParticles, 'Output must be clamped to maxParticles');

  // Verify how many burst particles are retained
  // Burst particles have id >= 1_000_000
  const burstParticles = active.filter((p) => p.id >= 1_000_000);
  assert.equal(
    burstParticles.length,
    15,
    'All 15 newest audio-synced burst particles MUST be preserved under capacity saturation'
  );

  // The remaining 25 slots should be filled with the newest continuous particles
  const continuousParticles = active.filter((p) => p.id < 1_000_000);
  assert.equal(continuousParticles.length, 25);

  // Continuous particles kept must be the newest ones (closest to frameIndex)
  // At rate 30 particles/s and fps 30, particle id = spawnFrame
  // The newest continuous particle is id 100 (spawnFrame 100).
  const maxContinuousId = Math.max(...continuousParticles.map((p) => p.id));
  assert.equal(maxContinuousId, 100, 'Newest continuous particle must be kept');
});

test('ParticleEmitter Saturation: multiple overlapping bursts drop oldest burst when saturated', () => {
  const maxParticles = 20;
  const fps = 30;
  const lifetimeFrames = 60;

  const emitter: ParticleEmitter = {
    seed: 999,
    maxParticles,
    ratePerSecond: 0, // No continuous emission, only bursts
    lifetimeFrames,
    spawn: { kind: 'disc', radius: 10 },
    velocity: { angleDegrees: 90, spreadDegrees: 45, speedMin: 10, speedMax: 30 },
    gravity: [0, 0],
    radiusRange: [1, 3],
    paintRole: 'secondary',
    baseOpacity: 1.0,
    audio: {
      onsetBurstCount: 12,
      rateBand: null,
      rateGain: 0
    }
  };

  const frameIndex = 120;
  // Two onsets: one from 50 frames ago (old, near expiration), and one right now at 120 (brand new)
  // Total candidate burst particles = 12 + 12 = 24 > 20 max
  const onsetFrames = [70, 120];

  const active = evaluateParticleEmitter(emitter, frameIndex, fps, onsetFrames);

  assert.equal(active.length, maxParticles);

  // Check how many particles belong to the brand new onset (120 * 1000 = 120,000)
  const newOnsetParticles = active.filter((p) => p.id >= 1_000_000 + 120_000);
  assert.equal(newOnsetParticles.length, 12, 'All 12 brand new burst particles must be kept');

  // The older onset (70 * 1000 = 70,000) had 12 particles, but only 8 should remain
  const oldOnsetParticles = active.filter(
    (p) => p.id >= 1_000_000 + 70_000 && p.id < 1_000_000 + 120_000
  );
  assert.equal(oldOnsetParticles.length, 8, '8 oldest burst particles kept, 4 evicted');
});
