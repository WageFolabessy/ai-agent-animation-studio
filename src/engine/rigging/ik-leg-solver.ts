import type {
  PlanarJoint,
  PoseInterpolationContract,
  PoseKeyframe,
  JointPoseTransform
} from '../../schemas/rig.contract.js';
import type { Vec2 } from '../../schemas/primitives.schema.js';
import { computeSkeletonFK, applyAffine2D } from './kinematics.js';

export interface TwoBoneIKResult {
  readonly upperAngleDeg: number;
  readonly lowerAngleDeg: number;
  readonly clampedDistance: number;
}

/**
 * Solves analytic 2-bone planar Inverse Kinematics for a 2D limb.
 *
 * Coordinate convention (matching computeSkeletonFK):
 * - Bone at local angle 0 points straight down [0, -L].
 * - Positive rotationZDegrees swings the bone forward (+X, right).
 * - Negative rotationZDegrees swings the bone backward (-X, left).
 * - bendDirection: -1 for knee/hock (backward flexion <= 0), +1 for arm/elbow (forward flexion >= 0).
 */
export function solveTwoBoneIK(
  rootPos: Vec2,
  targetPos: Vec2,
  l1: number,
  l2: number,
  parentWorldAngleDeg = 0,
  bendDirection: -1 | 1 = -1,
  constraintsUpperDeg?: readonly [number, number],
  constraintsLowerDeg?: readonly [number, number]
): TwoBoneIKResult {
  const dx = targetPos[0] - rootPos[0];
  const dy = targetPos[1] - rootPos[1];
  const rawDist = Math.hypot(dx, dy);

  const minReach = Math.abs(l1 - l2) + 1e-6;
  const maxReach = l1 + l2 - 1e-6;
  const r = Math.max(minReach, Math.min(maxReach, rawDist));

  // Law of cosines for middle joint angle
  const cosLower = Math.max(-1, Math.min(1, (r * r - l1 * l1 - l2 * l2) / (2 * l1 * l2)));
  const lowerRad = bendDirection * Math.acos(cosLower);

  // Angle of root-to-target chord measured from downward (-Y) axis toward +X
  const phi = Math.atan2(dx, -dy);
  // Interior triangle angle at the root
  const beta = Math.atan2(-l2 * Math.sin(lowerRad), l1 + l2 * Math.cos(lowerRad));

  const worldUpperDeg = ((phi + beta) * 180) / Math.PI;
  let upperAngleDeg = worldUpperDeg - parentWorldAngleDeg;
  while (upperAngleDeg > 180) upperAngleDeg -= 360;
  while (upperAngleDeg < -180) upperAngleDeg += 360;
  let lowerAngleDeg = (lowerRad * 180) / Math.PI;

  if (constraintsUpperDeg) {
    upperAngleDeg = Math.max(
      constraintsUpperDeg[0],
      Math.min(constraintsUpperDeg[1], upperAngleDeg)
    );
  }
  if (constraintsLowerDeg) {
    lowerAngleDeg = Math.max(
      constraintsLowerDeg[0],
      Math.min(constraintsLowerDeg[1], lowerAngleDeg)
    );
  }

  return {
    upperAngleDeg,
    lowerAngleDeg,
    clampedDistance: r
  };
}

/**
 * Solves analytic 2-bone planar Inverse Kinematics for a right-facing character leg
 * with backward knee/hock flexion (lowerAngleDeg <= 0).
 */
export function solveTwoBoneLegIK(
  hipPos: Vec2,
  footTarget: Vec2,
  l1: number,
  l2: number,
  parentWorldAngleDeg = 0,
  constraintsUpperDeg?: readonly [number, number],
  constraintsLowerDeg?: readonly [number, number],
  bendDirection: -1 | 1 = -1
): TwoBoneIKResult {
  return solveTwoBoneIK(
    hipPos,
    footTarget,
    l1,
    l2,
    parentWorldAngleDeg,
    bendDirection,
    constraintsUpperDeg,
    constraintsLowerDeg
  );
}

/**
 * Solves analytic 2-bone planar Inverse Kinematics for a character arm
 * with forward/upward elbow flexion (bendDirection = +1, lowerAngleDeg >= 0).
 */
export function solveTwoBoneArmIK(
  shoulderPos: Vec2,
  handTarget: Vec2,
  l1: number,
  l2: number,
  parentWorldAngleDeg = 0,
  bendDirection: -1 | 1 = 1,
  constraintsUpperDeg?: readonly [number, number],
  constraintsLowerDeg?: readonly [number, number]
): TwoBoneIKResult {
  return solveTwoBoneIK(
    shoulderPos,
    handTarget,
    l1,
    l2,
    parentWorldAngleDeg,
    bendDirection,
    constraintsUpperDeg ?? [-140, 140],
    constraintsLowerDeg ?? (bendDirection === 1 ? [0, 140] : [-140, 0])
  );
}

/**
 * Converts world-space 2D coordinates to local coordinates of a character rig.
 */
export function worldToRigLocal(
  worldPos: readonly [number, number],
  rigPos: readonly [number, number, number] | readonly [number, number],
  rigScale: readonly [number, number]
): Vec2 {
  const sx = rigScale[0] !== 0 ? rigScale[0] : 1;
  const sy = rigScale[1] !== 0 ? rigScale[1] : 1;
  return [
    (worldPos[0] - rigPos[0]) / sx,
    (worldPos[1] - rigPos[1]) / sy
  ];
}

export interface BipedLocomotionClipConfig {
  readonly loopFrames: number;
  readonly stanceFrames: number;
  readonly strideLengthUnits: number;
  readonly groundY: number;
  readonly swingLift: number;
  readonly stanceCenterOffsetX?: number;
  readonly pelvisY0: number;
  readonly pelvisBobAmp: number;
  readonly torsoDeg0: number;
  readonly torsoAmp: number;
  readonly headDeg0: number;
  readonly headAmp: number;
  readonly armUpperMid: number;
  readonly armUpperAmp: number;
  readonly armLowerMid: number;
  readonly armLowerAmp: number;
  readonly coatDeg0: number;
  readonly coatAmp: number;
}

export const BIPED_SKELETON_JOINTS: readonly PlanarJoint[] = [
  { id: 'pelvis', parentId: null, localOffset2D: [0, 0], rotationZDegrees: 0, length: 12, constraintsDeg: [-30, 30] },
  { id: 'torso', parentId: 'pelvis', localOffset2D: [0, 18], rotationZDegrees: -9, length: 28, constraintsDeg: [-45, 45] },
  { id: 'head', parentId: 'torso', localOffset2D: [3, 20], rotationZDegrees: 5, length: 16, constraintsDeg: [-40, 40] },
  { id: 'arm_l_upper', parentId: 'torso', localOffset2D: [-6, 15], rotationZDegrees: -25, length: 18, constraintsDeg: [-150, 150] },
  { id: 'arm_l_lower', parentId: 'arm_l_upper', localOffset2D: [0, -18], rotationZDegrees: 35, length: 16, constraintsDeg: [0, 135] },
  { id: 'arm_r_upper', parentId: 'torso', localOffset2D: [6, 15], rotationZDegrees: 25, length: 18, constraintsDeg: [-150, 150] },
  { id: 'arm_r_lower', parentId: 'arm_r_upper', localOffset2D: [0, -18], rotationZDegrees: 40, length: 16, constraintsDeg: [0, 135] },
  { id: 'leg_l_upper', parentId: 'pelvis', localOffset2D: [-4, -4], rotationZDegrees: 32, length: 22, constraintsDeg: [-90, 90] },
  { id: 'leg_l_lower', parentId: 'leg_l_upper', localOffset2D: [0, -22], rotationZDegrees: -22, length: 22, constraintsDeg: [-140, 0] },
  { id: 'leg_r_upper', parentId: 'pelvis', localOffset2D: [4, -4], rotationZDegrees: -32, length: 22, constraintsDeg: [-90, 90] },
  { id: 'leg_r_lower', parentId: 'leg_r_upper', localOffset2D: [0, -22], rotationZDegrees: -58, length: 22, constraintsDeg: [-140, 0] },
  { id: 'coat_tail', parentId: 'torso', localOffset2D: [-10, 10], rotationZDegrees: -28, length: 26, constraintsDeg: [-85, 20] },
  { id: 'hair_tie', parentId: 'head', localOffset2D: [-10, 8], rotationZDegrees: -22, length: 18, constraintsDeg: [-75, 25] }
];

export const QUADRUPED_SKELETON_JOINTS: readonly PlanarJoint[] = [
  { id: 'pelvis', parentId: null, localOffset2D: [0, 0], length: 14, rotationZDegrees: 0, constraintsDeg: [-25, 25] },
  { id: 'spine', parentId: 'pelvis', localOffset2D: [18, 4], length: 22, rotationZDegrees: 0, constraintsDeg: [-30, 30] },
  { id: 'chest', parentId: 'spine', localOffset2D: [20, 2], length: 18, rotationZDegrees: -5, constraintsDeg: [-30, 30] },
  { id: 'neck', parentId: 'chest', localOffset2D: [12, 10], length: 14, rotationZDegrees: 15, constraintsDeg: [-35, 35] },
  { id: 'head', parentId: 'neck', localOffset2D: [10, 6], length: 14, rotationZDegrees: -8, constraintsDeg: [-35, 35] },
  { id: 'tail_root', parentId: 'pelvis', localOffset2D: [-14, 2], length: 16, rotationZDegrees: -25, constraintsDeg: [-60, 40] },
  { id: 'tail_tip', parentId: 'tail_root', localOffset2D: [-14, -6], length: 16, rotationZDegrees: -15, constraintsDeg: [-45, 45] },
  { id: 'ear_l', parentId: 'head', localOffset2D: [-6, 8], length: 12, rotationZDegrees: -20, constraintsDeg: [-30, 30] },
  { id: 'leg_fl_upper', parentId: 'chest', localOffset2D: [8, -6], length: 18, rotationZDegrees: 20, constraintsDeg: [-60, 60] },
  { id: 'leg_fl_lower', parentId: 'leg_fl_upper', localOffset2D: [0, -18], length: 18, rotationZDegrees: -20, constraintsDeg: [-120, 0] },
  { id: 'leg_fr_upper', parentId: 'chest', localOffset2D: [14, -6], length: 18, rotationZDegrees: -20, constraintsDeg: [-60, 60] },
  { id: 'leg_fr_lower', parentId: 'leg_fr_upper', localOffset2D: [0, -18], length: 18, rotationZDegrees: -25, constraintsDeg: [-120, 0] },
  { id: 'leg_bl_upper', parentId: 'pelvis', localOffset2D: [-10, -6], length: 20, rotationZDegrees: 30, constraintsDeg: [-60, 60] },
  { id: 'leg_bl_lower', parentId: 'leg_bl_upper', localOffset2D: [0, -20], length: 20, rotationZDegrees: -35, constraintsDeg: [-140, 0] },
  { id: 'leg_br_upper', parentId: 'pelvis', localOffset2D: [-4, -6], length: 20, rotationZDegrees: -25, constraintsDeg: [-60, 60] },
  { id: 'leg_br_lower', parentId: 'leg_br_upper', localOffset2D: [0, -20], length: 20, rotationZDegrees: -45, constraintsDeg: [-140, 0] }
];

/**
 * Evaluates a single limb's target foot tip position (Fx, Fy) at integer frame f in [0..loopFrames].
 * - Stance interval u in [0..stanceFrames]: flat ground y = groundY, constant backward velocity -S/N.
 * - Swing interval u in (stanceFrames..loopFrames): smooth sinusoidal lift arc, monotonic forward velocity.
 */
export function evaluateLimbFootTrajectory(
  frame: number,
  frameOffset: number,
  loopFrames: number,
  stanceFrames: number,
  strideLengthUnits: number,
  hipX: number,
  groundY: number,
  swingLift: number,
  stanceCenterOffsetX = 0
): Vec2 {
  const N = loopFrames;
  const Tstance = stanceFrames;
  const Tswing = N - Tstance;
  const u = (((frame - frameOffset) % N) + N) % N;

  const stanceSpan = (Tstance / N) * strideLengthUnits;
  const xFront = stanceCenterOffsetX + stanceSpan / 2;
  const xBack = stanceCenterOffsetX - stanceSpan / 2;
  const stepPerFrame = strideLengthUnits / N;

  if (u <= Tstance) {
    return [hipX + xFront - stepPerFrame * u, groundY];
  }

  const tau = (u - Tstance) / Tswing;
  const fx = hipX + xBack + stanceSpan * tau;
  const fy = groundY + swingLift * Math.sin(Math.PI * tau);
  return [fx, fy];
}

/**
 * Generates a complete, dense per-frame PoseInterpolationContract for a biped locomotion clip.
 * - Reads exact per-frame hip position from `pelvis` (including vertical bobbing) via `computeSkeletonFK`.
 * - Preserves contralateral arm/leg counter-swing (right arm swings forward with left leg, left arm with right leg).
 * - Guarantees keyframe[0] === keyframe[loopFrames] for seamless periodic looping.
 */
export function generateBipedLocomotionClip(
  config: BipedLocomotionClipConfig
): PoseInterpolationContract {
  const {
    loopFrames: N,
    stanceFrames,
    strideLengthUnits,
    groundY,
    swingLift,
    stanceCenterOffsetX = 0,
    pelvisY0,
    pelvisBobAmp,
    torsoDeg0,
    torsoAmp,
    headDeg0,
    headAmp,
    armUpperMid,
    armUpperAmp,
    armLowerMid,
    armLowerAmp,
    coatDeg0,
    coatAmp
  } = config;

  const skeleton = { rootJointId: 'pelvis', joints: BIPED_SKELETON_JOINTS };
  const legLUpper = BIPED_SKELETON_JOINTS.find((j) => j.id === 'leg_l_upper')!;
  const legLLower = BIPED_SKELETON_JOINTS.find((j) => j.id === 'leg_l_lower')!;
  const legRUpper = BIPED_SKELETON_JOINTS.find((j) => j.id === 'leg_r_upper')!;
  const legRLower = BIPED_SKELETON_JOINTS.find((j) => j.id === 'leg_r_lower')!;

  const keyframes: PoseKeyframe[] = [];

  for (let f = 0; f <= N; f++) {
    // Wrap f === N to 0 so closure keyframe is bit-for-bit identical to keyframe[0]
    const fWrapped = f === N ? 0 : f;
    const theta = (2 * Math.PI * fWrapped) / N;

    // 2-step vertical bobbing per gait loop (peaks at f = 0 and f = N/2)
    const pelvisY = pelvisY0 + pelvisBobAmp * 0.5 * (Math.cos(2 * theta) - 1);
    const torsoDeg = torsoDeg0 + torsoAmp * 0.5 * (1 - Math.cos(theta));
    const headDeg = headDeg0 + headAmp * 0.5 * (1 - Math.cos(theta));
    const coatDeg = coatDeg0 + coatAmp * 0.5 * (1 - Math.cos(2 * theta));

    // Contralateral arm/leg counter-swing:
    // At f = 0, left leg is at front strike (+X) -> right arm is forward (+), left arm is back (-)
    const armLUpperDeg = armUpperMid - armUpperAmp * Math.cos(theta);
    const armRUpperDeg = armUpperMid + armUpperAmp * Math.cos(theta);
    const armLLowerDeg = armLowerMid - armLowerAmp * Math.cos(theta);
    const armRLowerDeg = armLowerMid + armLowerAmp * Math.cos(theta);

    // Evaluate parent FK at frame f to read exact hip positions H_L(f), H_R(f) and pelvis angle
    const upperAngles: Record<string, number> = {
      pelvis: 0,
      torso: torsoDeg,
      head: headDeg,
      arm_l_upper: armLUpperDeg,
      arm_l_lower: armLLowerDeg,
      arm_r_upper: armRUpperDeg,
      arm_r_lower: armRLowerDeg,
      coat_tail: coatDeg
    };
    const upperOffsets: Record<string, Vec2> = {
      pelvis: [0, pelvisY]
    };

    const fkMap = computeSkeletonFK(skeleton, upperAngles, upperOffsets);
    const pelvisAff = fkMap.get('pelvis')!;
    const pelvisWorldAngleDeg = (Math.atan2(pelvisAff.b, pelvisAff.a) * 180) / Math.PI;

    const hipL = applyAffine2D(pelvisAff, legLUpper.localOffset2D);
    const hipR = applyAffine2D(pelvisAff, legRUpper.localOffset2D);

    const targetFootL = evaluateLimbFootTrajectory(
      fWrapped,
      0,
      N,
      stanceFrames,
      strideLengthUnits,
      hipL[0],
      groundY,
      swingLift,
      stanceCenterOffsetX
    );
    const targetFootR = evaluateLimbFootTrajectory(
      fWrapped,
      Math.floor(N / 2),
      N,
      stanceFrames,
      strideLengthUnits,
      hipR[0],
      groundY,
      swingLift,
      stanceCenterOffsetX
    );

    const ikL = solveTwoBoneLegIK(
      hipL,
      targetFootL,
      legLUpper.length,
      legLLower.length,
      pelvisWorldAngleDeg,
      legLUpper.constraintsDeg,
      legLLower.constraintsDeg
    );
    const ikR = solveTwoBoneLegIK(
      hipR,
      targetFootR,
      legRUpper.length,
      legRLower.length,
      pelvisWorldAngleDeg,
      legRUpper.constraintsDeg,
      legRLower.constraintsDeg
    );

    const jointTransforms: JointPoseTransform[] = [
      { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, pelvisY] },
      { jointId: 'torso', rotationZDegrees: torsoDeg },
      { jointId: 'head', rotationZDegrees: headDeg },
      { jointId: 'arm_l_upper', rotationZDegrees: armLUpperDeg },
      { jointId: 'arm_l_lower', rotationZDegrees: armLLowerDeg },
      { jointId: 'arm_r_upper', rotationZDegrees: armRUpperDeg },
      { jointId: 'arm_r_lower', rotationZDegrees: armRLowerDeg },
      { jointId: 'leg_l_upper', rotationZDegrees: ikL.upperAngleDeg },
      { jointId: 'leg_l_lower', rotationZDegrees: ikL.lowerAngleDeg },
      { jointId: 'leg_r_upper', rotationZDegrees: ikR.upperAngleDeg },
      { jointId: 'leg_r_lower', rotationZDegrees: ikR.lowerAngleDeg },
      { jointId: 'coat_tail', rotationZDegrees: coatDeg }
    ];

    keyframes.push({
      frame: f,
      jointTransforms
    });
  }

  return {
    interpolationMode: 'linear',
    loopFrames: N,
    strideLengthUnits,
    contactFrames: stanceFrames,
    keyframes
  };
}

export interface QuadrupedGallopClipConfig {
  readonly loopFrames: number;
  readonly stanceFrames: number;
  readonly strideLengthUnits: number;
  readonly groundY: number;
  readonly swingLift: number;
  readonly pelvisBobAmp: number;
  readonly stanceCenterOffsetFrontX?: number;
  readonly stanceCenterOffsetBackX?: number;
  readonly limbOffsets: {
    readonly bl: number;
    readonly br: number;
    readonly fl: number;
    readonly fr: number;
  };
}

/**
 * Generates a complete, dense per-frame PoseInterpolationContract for quadruped gallop (`beast_gallop`).
 * - Reads exact per-frame hip/shoulder positions from `pelvis` and `chest` via `computeSkeletonFK`.
 * - Places all 4 paws on a shared ground plane `groundY` during their stance intervals.
 */
export function generateQuadrupedGallopClip(
  config: QuadrupedGallopClipConfig
): PoseInterpolationContract {
  const {
    loopFrames: N,
    stanceFrames,
    strideLengthUnits,
    groundY,
    swingLift,
    pelvisBobAmp,
    stanceCenterOffsetFrontX = -2.0,
    stanceCenterOffsetBackX = -6.0,
    limbOffsets
  } = config;

  const skeleton = { rootJointId: 'pelvis', joints: QUADRUPED_SKELETON_JOINTS };
  const flUpper = QUADRUPED_SKELETON_JOINTS.find((j) => j.id === 'leg_fl_upper')!;
  const flLower = QUADRUPED_SKELETON_JOINTS.find((j) => j.id === 'leg_fl_lower')!;
  const frUpper = QUADRUPED_SKELETON_JOINTS.find((j) => j.id === 'leg_fr_upper')!;
  const frLower = QUADRUPED_SKELETON_JOINTS.find((j) => j.id === 'leg_fr_lower')!;
  const blUpper = QUADRUPED_SKELETON_JOINTS.find((j) => j.id === 'leg_bl_upper')!;
  const blLower = QUADRUPED_SKELETON_JOINTS.find((j) => j.id === 'leg_bl_lower')!;
  const brUpper = QUADRUPED_SKELETON_JOINTS.find((j) => j.id === 'leg_br_upper')!;
  const brLower = QUADRUPED_SKELETON_JOINTS.find((j) => j.id === 'leg_br_lower')!;

  const keyframes: PoseKeyframe[] = [];

  for (let f = 0; f <= N; f++) {
    const fWrapped = f === N ? 0 : f;
    const theta = (2 * Math.PI * fWrapped) / N;
    const pelvisY = pelvisBobAmp * 0.5 * (Math.cos(theta) - 1);

    const upperAngles: Record<string, number> = {
      pelvis: 0,
      spine: 0,
      chest: 0,
      head: 0,
      tail_root: -10 + 5 * Math.sin(theta)
    };
    const upperOffsets: Record<string, Vec2> = {
      pelvis: [0, pelvisY]
    };

    const fkMap = computeSkeletonFK(skeleton, upperAngles, upperOffsets);
    const pelvisAff = fkMap.get('pelvis')!;
    const chestAff = fkMap.get('chest')!;
    const pelvisAngleDeg = (Math.atan2(pelvisAff.b, pelvisAff.a) * 180) / Math.PI;
    const chestAngleDeg = (Math.atan2(chestAff.b, chestAff.a) * 180) / Math.PI;

    const hipFL = applyAffine2D(chestAff, flUpper.localOffset2D);
    const hipFR = applyAffine2D(chestAff, frUpper.localOffset2D);
    const hipBL = applyAffine2D(pelvisAff, blUpper.localOffset2D);
    const hipBR = applyAffine2D(pelvisAff, brUpper.localOffset2D);

    const targetFL = evaluateLimbFootTrajectory(
      fWrapped,
      limbOffsets.fl,
      N,
      stanceFrames,
      strideLengthUnits,
      hipFL[0],
      groundY,
      swingLift,
      stanceCenterOffsetFrontX
    );
    const targetFR = evaluateLimbFootTrajectory(
      fWrapped,
      limbOffsets.fr,
      N,
      stanceFrames,
      strideLengthUnits,
      hipFR[0],
      groundY,
      swingLift,
      stanceCenterOffsetFrontX
    );
    const targetBL = evaluateLimbFootTrajectory(
      fWrapped,
      limbOffsets.bl,
      N,
      stanceFrames,
      strideLengthUnits,
      hipBL[0],
      groundY,
      swingLift,
      stanceCenterOffsetBackX
    );
    const targetBR = evaluateLimbFootTrajectory(
      fWrapped,
      limbOffsets.br,
      N,
      stanceFrames,
      strideLengthUnits,
      hipBR[0],
      groundY,
      swingLift,
      stanceCenterOffsetBackX
    );

    const ikFL = solveTwoBoneLegIK(
      hipFL,
      targetFL,
      flUpper.length,
      flLower.length,
      chestAngleDeg,
      flUpper.constraintsDeg,
      flLower.constraintsDeg
    );
    const ikFR = solveTwoBoneLegIK(
      hipFR,
      targetFR,
      frUpper.length,
      frLower.length,
      chestAngleDeg,
      frUpper.constraintsDeg,
      frLower.constraintsDeg
    );
    const ikBL = solveTwoBoneLegIK(
      hipBL,
      targetBL,
      blUpper.length,
      blLower.length,
      pelvisAngleDeg,
      blUpper.constraintsDeg,
      blLower.constraintsDeg
    );
    const ikBR = solveTwoBoneLegIK(
      hipBR,
      targetBR,
      brUpper.length,
      brLower.length,
      pelvisAngleDeg,
      brUpper.constraintsDeg,
      brLower.constraintsDeg
    );

    const jointTransforms: JointPoseTransform[] = [
      { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, pelvisY] },
      { jointId: 'spine', rotationZDegrees: 0 },
      { jointId: 'chest', rotationZDegrees: 0 },
      { jointId: 'head', rotationZDegrees: 0 },
      { jointId: 'tail_root', rotationZDegrees: upperAngles.tail_root },
      { jointId: 'leg_fl_upper', rotationZDegrees: ikFL.upperAngleDeg },
      { jointId: 'leg_fl_lower', rotationZDegrees: ikFL.lowerAngleDeg },
      { jointId: 'leg_fr_upper', rotationZDegrees: ikFR.upperAngleDeg },
      { jointId: 'leg_fr_lower', rotationZDegrees: ikFR.lowerAngleDeg },
      { jointId: 'leg_br_upper', rotationZDegrees: ikBR.upperAngleDeg },
      { jointId: 'leg_br_lower', rotationZDegrees: ikBR.lowerAngleDeg },
      { jointId: 'leg_bl_upper', rotationZDegrees: ikBL.upperAngleDeg },
      { jointId: 'leg_bl_lower', rotationZDegrees: ikBL.lowerAngleDeg }
    ];

    keyframes.push({
      frame: f,
      jointTransforms
    });
  }

  return {
    interpolationMode: 'linear',
    loopFrames: N,
    strideLengthUnits,
    contactFrames: stanceFrames,
    keyframes
  };
}
