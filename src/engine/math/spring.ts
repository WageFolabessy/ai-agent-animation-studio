/**
 * Continuous analytical damped oscillator and impulse decay solvers.
 * Provides frame-independent, deterministic evaluation of audio-reactive lighting pulses,
 * secondary bone springs, and camera trauma shake.
 */

/**
 * Closed-form unit-impulse response h(tau) of a 2nd-order damped linear oscillator:
 * x'' + 2*zeta*omega*x' + omega^2*x = delta(t)
 */
export function springImpulseResponse(tau: number, zeta: number, omega: number): number {
  if (tau < 0) return 0;
  if (zeta < 1) {
    // Underdamped
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    return (Math.exp(-zeta * omega * tau) * Math.sin(omegaD * tau)) / omegaD;
  } else if (zeta === 1) {
    // Critically damped
    return tau * Math.exp(-omega * tau);
  } else {
    // Overdamped
    const q = Math.sqrt(zeta * zeta - 1);
    return (
      (Math.exp(-(zeta - q) * omega * tau) - Math.exp(-(zeta + q) * omega * tau)) /
      (2 * omega * q)
    );
  }
}

/**
 * Continuous analytical exponential decay: I(dt) = peak * exp(-lambda * dt)
 */
export function exponentialDecay(dtSeconds: number, lambda: number, peak = 1): number {
  if (dtSeconds < 0) return 0;
  return peak * Math.exp(-lambda * dtSeconds);
}

/**
 * Computes the response at a given frame f using discrete convolution with the closed-form
 * impulse response h(tau). Evaluates over a bounded window K = ceil(ln(1/eps) / (zeta*omega) * fps).
 * Guaranteed O(1) in total animation length and strictly frame-independent.
 */
export function evaluateSpringResponse(
  frame: number,
  fps: number,
  zeta: number,
  omega: number,
  getDriveAtFrame: (f: number) => number,
  epsilon = 1e-3
): number {
  const kWindow = Math.ceil((Math.log(1 / epsilon) / (zeta * omega)) * fps);
  let sum = 0;
  for (let k = 0; k <= kWindow; k++) {
    const driveFrame = frame - k;
    if (driveFrame < 0) break;
    const u = getDriveAtFrame(driveFrame);
    if (u === 0) continue;
    const tau = k / fps;
    const h = springImpulseResponse(tau, zeta, omega);
    sum += (u * h) / fps;
  }
  return sum;
}

/**
 * Computes the accumulated exponential decay response (e.g. camera trauma accumulation):
 * T(f) = sum_{k=0..K} kick_{f-k} * exp(-k / (fps * tauDecay))
 */
export function evaluateExponentialDecayResponse(
  frame: number,
  fps: number,
  tauDecaySeconds: number,
  getDriveAtFrame: (f: number) => number,
  cutoffMultiplier = 6.2
): number {
  const kWindow = Math.ceil(cutoffMultiplier * tauDecaySeconds * fps);
  let sum = 0;
  for (let k = 0; k <= kWindow; k++) {
    const driveFrame = frame - k;
    if (driveFrame < 0) break;
    const kick = getDriveAtFrame(driveFrame);
    if (kick === 0) continue;
    sum += kick * Math.exp(-k / (fps * tauDecaySeconds));
  }
  return sum;
}
