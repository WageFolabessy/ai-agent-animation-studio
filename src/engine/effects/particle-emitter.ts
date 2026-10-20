import type { ParticleEmitter } from '../../schemas/rig.contract.js';
import type { Vec2 } from '../../schemas/primitives.schema.js';
import { lowbias32 } from '../math/noise.js';
import { lerp } from '../math/easing.js';

export interface ActiveParticle {
  id: number;
  position: Vec2;
  radius: number;
  opacity: number;
  ageFraction: number;
}

function hashFloat(seed: number, id: number, stream: number): number {
  const h1 = lowbias32((seed ^ Math.imul(id, 0x9e3779b9)) >>> 0);
  const h2 = lowbias32((h1 ^ Math.imul(stream, 0x85ebca6b)) >>> 0);
  return h2 / 0xffffffff;
}

/**
 * Simulates a deterministic closed-form particle system for a given frame.
 * Does not retain frame-to-frame state; particle positions and lifetimes are
 * evaluated analytically as a function of (frame, emitter, onsetFrames).
 */
export function evaluateParticleEmitter(
  emitter: ParticleEmitter,
  frameIndex: number,
  fps: number,
  onsetFrames: readonly number[] = []
): ActiveParticle[] {
  const particles: ActiveParticle[] = [];
  const lifetime = emitter.lifetimeFrames;
  const rate = emitter.ratePerSecond;

  // 1. Continuous steady-state emission
  if (rate > 0) {
    const minIndex = Math.max(0, Math.floor(((frameIndex - lifetime + 1) * rate) / fps));
    const maxIndex = Math.floor((frameIndex * rate) / fps);

    for (let i = minIndex; i <= maxIndex; i++) {
      if (particles.length >= emitter.maxParticles) break;

      const spawnFrame = Math.floor((i * fps) / rate);
      const ageFrames = frameIndex - spawnFrame;
      if (ageFrames < 0 || ageFrames >= lifetime) continue;

      const tAge = ageFrames / fps;
      const ageFrac = ageFrames / lifetime;

      // Spawn position
      let p0x = 0;
      let p0y = 0;
      if (emitter.spawn.kind === 'rect') {
        const [w, h] = emitter.spawn.size;
        p0x = (hashFloat(emitter.seed, i, 0) - 0.5) * w;
        p0y = (hashFloat(emitter.seed, i, 1) - 0.5) * h;
      } else if (emitter.spawn.kind === 'disc') {
        const angle = hashFloat(emitter.seed, i, 0) * Math.PI * 2;
        const rad = Math.sqrt(hashFloat(emitter.seed, i, 1)) * emitter.spawn.radius;
        p0x = rad * Math.cos(angle);
        p0y = rad * Math.sin(angle);
      }

      // Initial velocity
      const spread = (hashFloat(emitter.seed, i, 2) - 0.5) * emitter.velocity.spreadDegrees;
      const velAngleRad = ((emitter.velocity.angleDegrees + spread) * Math.PI) / 180;
      const speed = lerp(
        emitter.velocity.speedMin,
        emitter.velocity.speedMax,
        hashFloat(emitter.seed, i, 3)
      );
      const vx = speed * Math.cos(velAngleRad);
      const vy = speed * Math.sin(velAngleRad);

      // Physics integration: p(t) = p0 + v0*t + 0.5*g*t^2
      const px = p0x + vx * tAge + 0.5 * emitter.gravity[0] * tAge * tAge;
      const py = p0y + vy * tAge + 0.5 * emitter.gravity[1] * tAge * tAge;

      // Radius and opacity
      const radius = lerp(
        emitter.radiusRange[0],
        emitter.radiusRange[1],
        hashFloat(emitter.seed, i, 4)
      );
      // Smooth bell fade-in and fade-out
      const opacity = emitter.baseOpacity * Math.sin(Math.PI * ageFrac);

      particles.push({
        id: i,
        position: [px, py],
        radius,
        opacity,
        ageFraction: ageFrac
      });
    }
  }

  // 2. Audio onset burst emission
  const burstCount = emitter.audio?.onsetBurstCount ?? 0;
  if (burstCount > 0 && onsetFrames.length > 0) {
    for (const onsetFrame of onsetFrames) {
      if (particles.length >= emitter.maxParticles) break;
      const ageFrames = frameIndex - onsetFrame;
      if (ageFrames < 0 || ageFrames >= lifetime) continue;

      const tAge = ageFrames / fps;
      const ageFrac = ageFrames / lifetime;

      for (let j = 0; j < burstCount; j++) {
        if (particles.length >= emitter.maxParticles) break;

        const burstKey = onsetFrame * 1000 + j;

        let p0x = 0;
        let p0y = 0;
        if (emitter.spawn.kind === 'rect') {
          const [w, h] = emitter.spawn.size;
          p0x = (hashFloat(emitter.seed, burstKey, 0) - 0.5) * w;
          p0y = (hashFloat(emitter.seed, burstKey, 1) - 0.5) * h;
        } else if (emitter.spawn.kind === 'disc') {
          const angle = hashFloat(emitter.seed, burstKey, 0) * Math.PI * 2;
          const rad = Math.sqrt(hashFloat(emitter.seed, burstKey, 1)) * emitter.spawn.radius;
          p0x = rad * Math.cos(angle);
          p0y = rad * Math.sin(angle);
        }

        const spread = (hashFloat(emitter.seed, burstKey, 2) - 0.5) * emitter.velocity.spreadDegrees;
        const velAngleRad = ((emitter.velocity.angleDegrees + spread) * Math.PI) / 180;
        const speed = lerp(
          emitter.velocity.speedMin,
          emitter.velocity.speedMax,
          hashFloat(emitter.seed, burstKey, 3)
        );
        const vx = speed * Math.cos(velAngleRad);
        const vy = speed * Math.sin(velAngleRad);

        const px = p0x + vx * tAge + 0.5 * emitter.gravity[0] * tAge * tAge;
        const py = p0y + vy * tAge + 0.5 * emitter.gravity[1] * tAge * tAge;

        const radius = lerp(
          emitter.radiusRange[0],
          emitter.radiusRange[1],
          hashFloat(emitter.seed, burstKey, 4)
        );
        const opacity = emitter.baseOpacity * Math.sin(Math.PI * ageFrac);

        particles.push({
          id: 1_000_000 + burstKey,
          position: [px, py],
          radius,
          opacity,
          ageFraction: ageFrac
        });
      }
    }
  }

  return particles;
}
