import type { CameraEasing } from '../../schemas/storyboard.contract.js';
import type { Vec2, Vec3 } from '../../schemas/primitives.schema.js';

export function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function linear(t: number): number {
  return t;
}

export function easeInQuad(t: number): number {
  return t * t;
}

export function easeOutQuad(t: number): number {
  return t * (2 - t);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

const SPRING_ZETA = 0.6;
const SPRING_OMEGA = 12;
const SPRING_OMEGA_D = SPRING_OMEGA * Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA); // 9.6
const SPRING_SCALE = (SPRING_ZETA * SPRING_OMEGA) / SPRING_OMEGA_D; // 0.75

function stepResponse(time: number): number {
  return (
    1 -
    Math.exp(-SPRING_ZETA * SPRING_OMEGA * time) *
      (Math.cos(SPRING_OMEGA_D * time) + SPRING_SCALE * Math.sin(SPRING_OMEGA_D * time))
  );
}

const S_AT_1 = stepResponse(1);

/**
 * Normalized step response of a damped spring oscillator (zeta = 0.6, omega = 12).
 * Has ~9.5% overshoot peaking at t ~= 0.327, and satisfies ease(0) = 0 and ease(1) = 1.
 */
export function springImpulse(t: number): number {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return stepResponse(t) / S_AT_1;
}

export function interpolateEasing(easing: CameraEasing, t: number): number {
  switch (easing) {
    case 'linear':
      return linear(t);
    case 'easeInQuad':
      return easeInQuad(t);
    case 'easeOutQuad':
      return easeOutQuad(t);
    case 'easeInOutCubic':
      return easeInOutCubic(t);
    case 'easeInOutSine':
      return easeInOutSine(t);
    case 'springImpulse':
      return springImpulse(t);
  }
}

export type PoseKeyEasing = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';

export function interpolatePoseEasing(easing: PoseKeyEasing | undefined, t: number): number {
  switch (easing) {
    case 'ease_in':
      return easeInQuad(t);
    case 'ease_out':
      return easeOutQuad(t);
    case 'ease_in_out':
      return easeInOutCubic(t);
    case 'linear':
    default:
      return linear(t);
  }
}
