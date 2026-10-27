import type {
  AssetRigContract,
  NormalizedCubicBezierSegment,
  PoseInterpolationContract,
  RigPart
} from '../../schemas/rig.contract.js';
import type { ArchetypeBuildOptions } from './types.js';
import {
  generateBipedLocomotionClip,
  generateQuadrupedGallopClip
} from '../rigging/ik-leg-solver.js';
import {
  BASE_MOUTH_REST_SEGMENTS,
  CANONICAL_BIPED_MORPH_TARGETS
} from '../rigging/vocal-performance-solver.js';
import { PropFactory, CANONICAL_BIPED_SOCKETS } from './prop-factory.js';
import { shadeHexColor } from '../math/color.js';
import { applyOutlinePolicy } from './outline-policy.js';
import type { CastSpecItem } from '../../schemas/story-spec.contract.js';

const baseMouthSegments: NormalizedCubicBezierSegment[] = BASE_MOUTH_REST_SEGMENTS;

export const BipedPoseClips: Record<string, PoseInterpolationContract> = {
  walk_to: generateBipedLocomotionClip({
    loopFrames: 36,
    stanceFrames: 22,
    strideLengthUnits: 15.0,
    groundY: -46.0,
    swingLift: 5.5,
    pelvisY0: 1.8,
    pelvisBobAmp: 1.0,
    torsoDeg0: -6,
    torsoAmp: 1.0,
    headDeg0: -3,
    headAmp: 1.0,
    armUpperMid: 4,
    armUpperAmp: 24,
    armLowerMid: 34,
    armLowerAmp: 12,
    coatDeg0: -6,
    coatAmp: 2
  }),
  reach_and_grasp: {
    interpolationMode: 'linear',
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 0 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 22 },
          { jointId: 'arm_r_upper', rotationZDegrees: 15 },
          { jointId: 'arm_r_lower', rotationZDegrees: 25 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 105,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [5, -13] },
          { jointId: 'torso', rotationZDegrees: 20 },
          { jointId: 'head', rotationZDegrees: -6 },
          { jointId: 'arm_l_upper', rotationZDegrees: -14 },
          { jointId: 'arm_l_lower', rotationZDegrees: 28 },
          { jointId: 'arm_r_upper', rotationZDegrees: -29.4 },
          { jointId: 'arm_r_lower', rotationZDegrees: 68.5 },
          { jointId: 'leg_l_upper', rotationZDegrees: 28 },
          { jointId: 'leg_l_lower', rotationZDegrees: -52 },
          { jointId: 'leg_r_upper', rotationZDegrees: 22 },
          { jointId: 'leg_r_lower', rotationZDegrees: -48 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 210,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 22 },
          { jointId: 'arm_r_upper', rotationZDegrees: 32 },
          { jointId: 'arm_r_lower', rotationZDegrees: 62 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      }
    ]
  },
  stop_and_turn: {
    interpolationMode: 'linear',
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 22 },
          { jointId: 'arm_r_upper', rotationZDegrees: 32 },
          { jointId: 'arm_r_lower', rotationZDegrees: 62 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 210,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 22 },
          { jointId: 'arm_r_upper', rotationZDegrees: 32 },
          { jointId: 'arm_r_lower', rotationZDegrees: 62 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      }
    ]
  },
  carry_put_down: {
    interpolationMode: 'linear',
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -18 },
          { jointId: 'arm_l_lower', rotationZDegrees: 28 },
          { jointId: 'arm_r_upper', rotationZDegrees: 32 },
          { jointId: 'arm_r_lower', rotationZDegrees: 62 },
          { jointId: 'leg_l_upper', rotationZDegrees: 18 },
          { jointId: 'leg_l_lower', rotationZDegrees: -32 },
          { jointId: 'leg_r_upper', rotationZDegrees: -14 },
          { jointId: 'leg_r_lower', rotationZDegrees: -12 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 52,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 2] },
          { jointId: 'torso', rotationZDegrees: -4 },
          { jointId: 'head', rotationZDegrees: 2 },
          { jointId: 'arm_l_upper', rotationZDegrees: 22 },
          { jointId: 'arm_l_lower', rotationZDegrees: 38 },
          { jointId: 'arm_r_upper', rotationZDegrees: 32 },
          { jointId: 'arm_r_lower', rotationZDegrees: 62 },
          { jointId: 'leg_l_upper', rotationZDegrees: -14 },
          { jointId: 'leg_l_lower', rotationZDegrees: -12 },
          { jointId: 'leg_r_upper', rotationZDegrees: 18 },
          { jointId: 'leg_r_lower', rotationZDegrees: -32 },
          { jointId: 'coat_tail', rotationZDegrees: -8 }
        ]
      },
      {
        frame: 105,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -14 },
          { jointId: 'arm_l_lower', rotationZDegrees: 24 },
          { jointId: 'arm_r_upper', rotationZDegrees: 32 },
          { jointId: 'arm_r_lower', rotationZDegrees: 62 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 155,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [5, -13] },
          { jointId: 'torso', rotationZDegrees: 20 },
          { jointId: 'head', rotationZDegrees: -6 },
          { jointId: 'arm_l_upper', rotationZDegrees: -14 },
          { jointId: 'arm_l_lower', rotationZDegrees: 28 },
          { jointId: 'arm_r_upper', rotationZDegrees: -29.4 },
          { jointId: 'arm_r_lower', rotationZDegrees: 68.5 },
          { jointId: 'leg_l_upper', rotationZDegrees: 28 },
          { jointId: 'leg_l_lower', rotationZDegrees: -52 },
          { jointId: 'leg_r_upper', rotationZDegrees: 22 },
          { jointId: 'leg_r_lower', rotationZDegrees: -48 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 165,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [5, -13] },
          { jointId: 'torso', rotationZDegrees: 20 },
          { jointId: 'head', rotationZDegrees: -6 },
          { jointId: 'arm_l_upper', rotationZDegrees: -14 },
          { jointId: 'arm_l_lower', rotationZDegrees: 28 },
          { jointId: 'arm_r_upper', rotationZDegrees: -29.4 },
          { jointId: 'arm_r_lower', rotationZDegrees: 68.5 },
          { jointId: 'leg_l_upper', rotationZDegrees: 28 },
          { jointId: 'leg_l_lower', rotationZDegrees: -52 },
          { jointId: 'leg_r_upper', rotationZDegrees: 22 },
          { jointId: 'leg_r_lower', rotationZDegrees: -48 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 210,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 22 },
          { jointId: 'arm_r_upper', rotationZDegrees: 15 },
          { jointId: 'arm_r_lower', rotationZDegrees: 25 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      }
    ]
  },
  gesture_point: {
    interpolationMode: 'linear',
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 4 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -14 },
          { jointId: 'arm_l_lower', rotationZDegrees: 24 },
          { jointId: 'arm_r_upper', rotationZDegrees: 30 },
          { jointId: 'arm_r_lower', rotationZDegrees: 35 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 40,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 4 },
          { jointId: 'head', rotationZDegrees: 10 },
          { jointId: 'arm_l_upper', rotationZDegrees: -14 },
          { jointId: 'arm_l_lower', rotationZDegrees: 24 },
          { jointId: 'arm_r_upper', rotationZDegrees: 104 },
          { jointId: 'arm_r_lower', rotationZDegrees: 18 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 210,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 4 },
          { jointId: 'head', rotationZDegrees: 10 },
          { jointId: 'arm_l_upper', rotationZDegrees: -14 },
          { jointId: 'arm_l_lower', rotationZDegrees: 24 },
          { jointId: 'arm_r_upper', rotationZDegrees: 104 },
          { jointId: 'arm_r_lower', rotationZDegrees: 18 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      }
    ]
  },
  stalk_crouch: generateBipedLocomotionClip({
    loopFrames: 36,
    stanceFrames: 22,
    strideLengthUnits: 48.0,
    groundY: -47.0,
    swingLift: 10.0,
    pelvisY0: -10,
    pelvisBobAmp: 2.0,
    torsoDeg0: -24,
    torsoAmp: 2,
    headDeg0: 15,
    headAmp: -3,
    armUpperMid: -2.5,
    armUpperAmp: 17.5,
    armLowerMid: 37.5,
    armLowerAmp: -2.5,
    coatDeg0: -10,
    coatAmp: -2
  }),
  sprint_frenzy: generateBipedLocomotionClip({
    loopFrames: 18,
    stanceFrames: 8,
    strideLengthUnits: 23.0,
    groundY: -41.0,
    swingLift: 8.5,
    pelvisY0: 2,
    pelvisBobAmp: 2.0,
    torsoDeg0: -14,
    torsoAmp: 2.0,
    headDeg0: 6,
    headAmp: 0,
    armUpperMid: 10,
    armUpperAmp: 22,
    armLowerMid: 52,
    armLowerAmp: 14,
    coatDeg0: -8,
    coatAmp: 2
  }),
  embrace_push_away: {
    interpolationMode: 'linear',
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 0 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 22 },
          { jointId: 'arm_r_upper', rotationZDegrees: 18 },
          { jointId: 'arm_r_lower', rotationZDegrees: 28 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 90,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, -2] },
          { jointId: 'torso', rotationZDegrees: 7 },
          { jointId: 'head', rotationZDegrees: 6 },
          { jointId: 'arm_l_upper', rotationZDegrees: 68 },
          { jointId: 'arm_l_lower', rotationZDegrees: 48 },
          { jointId: 'arm_r_upper', rotationZDegrees: 72 },
          { jointId: 'arm_r_lower', rotationZDegrees: 45 },
          { jointId: 'leg_l_upper', rotationZDegrees: 8 },
          { jointId: 'leg_l_lower', rotationZDegrees: -12 },
          { jointId: 'leg_r_upper', rotationZDegrees: -6 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 105,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, -3] },
          { jointId: 'torso', rotationZDegrees: 10 },
          { jointId: 'head', rotationZDegrees: 8 },
          { jointId: 'arm_l_upper', rotationZDegrees: 82 },
          { jointId: 'arm_l_lower', rotationZDegrees: 16 },
          { jointId: 'arm_r_upper', rotationZDegrees: 86 },
          { jointId: 'arm_r_lower', rotationZDegrees: 14 },
          { jointId: 'leg_l_upper', rotationZDegrees: 12 },
          { jointId: 'leg_l_lower', rotationZDegrees: -18 },
          { jointId: 'leg_r_upper', rotationZDegrees: -8 },
          { jointId: 'leg_r_lower', rotationZDegrees: -12 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 210,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -6 },
          { jointId: 'head', rotationZDegrees: -2 },
          { jointId: 'arm_l_upper', rotationZDegrees: -18 },
          { jointId: 'arm_l_lower', rotationZDegrees: 38 },
          { jointId: 'arm_r_upper', rotationZDegrees: 24 },
          { jointId: 'arm_r_lower', rotationZDegrees: 42 },
          { jointId: 'leg_l_upper', rotationZDegrees: 6 },
          { jointId: 'leg_l_lower', rotationZDegrees: -10 },
          { jointId: 'leg_r_upper', rotationZDegrees: -6 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -8 }
        ]
      }
    ]
  },
  evade_leap: {
    interpolationMode: 'linear',
    loopFrames: 24,
    strideLengthUnits: 46.93,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -10, localOffset2D: [0, -8] },
          { jointId: 'torso', rotationZDegrees: -20 },
          { jointId: 'head', rotationZDegrees: 10 },
          { jointId: 'arm_l_upper', rotationZDegrees: -30 },
          { jointId: 'arm_l_lower', rotationZDegrees: 50 },
          { jointId: 'arm_r_upper', rotationZDegrees: 30 },
          { jointId: 'arm_r_lower', rotationZDegrees: 50 },
          { jointId: 'leg_l_upper', rotationZDegrees: 40 },
          { jointId: 'leg_l_lower', rotationZDegrees: -85 },
          { jointId: 'leg_r_upper', rotationZDegrees: -20 },
          { jointId: 'leg_r_lower', rotationZDegrees: -100 },
          { jointId: 'coat_tail', rotationZDegrees: -20 }
        ]
      },
      {
        frame: 12,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 15, localOffset2D: [0, 26] },
          { jointId: 'torso', rotationZDegrees: -10 },
          { jointId: 'head', rotationZDegrees: 8 },
          { jointId: 'arm_l_upper', rotationZDegrees: -60 },
          { jointId: 'arm_l_lower', rotationZDegrees: 30 },
          { jointId: 'arm_r_upper', rotationZDegrees: 60 },
          { jointId: 'arm_r_lower', rotationZDegrees: 45 },
          { jointId: 'leg_l_upper', rotationZDegrees: -35 },
          { jointId: 'leg_l_lower', rotationZDegrees: -15 },
          { jointId: 'leg_r_upper', rotationZDegrees: 65 },
          { jointId: 'leg_r_lower', rotationZDegrees: -125 },
          { jointId: 'coat_tail', rotationZDegrees: -65 }
        ]
      },
      {
        frame: 24,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -10, localOffset2D: [0, -8] },
          { jointId: 'torso', rotationZDegrees: -20 },
          { jointId: 'head', rotationZDegrees: 10 },
          { jointId: 'arm_l_upper', rotationZDegrees: -30 },
          { jointId: 'arm_l_lower', rotationZDegrees: 50 },
          { jointId: 'arm_r_upper', rotationZDegrees: 30 },
          { jointId: 'arm_r_lower', rotationZDegrees: 50 },
          { jointId: 'leg_l_upper', rotationZDegrees: 40 },
          { jointId: 'leg_l_lower', rotationZDegrees: -85 },
          { jointId: 'leg_r_upper', rotationZDegrees: -20 },
          { jointId: 'leg_r_lower', rotationZDegrees: -100 },
          { jointId: 'coat_tail', rotationZDegrees: -20 }
        ]
      }
    ]
  },
  defiant_scream: {
    interpolationMode: 'linear',
    loopFrames: 30,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 12 },
          { jointId: 'head', rotationZDegrees: 25 },
          { jointId: 'arm_l_upper', rotationZDegrees: 80 },
          { jointId: 'arm_l_lower', rotationZDegrees: 75 },
          { jointId: 'arm_r_upper', rotationZDegrees: 85 },
          { jointId: 'arm_r_lower', rotationZDegrees: 70 },
          { jointId: 'leg_l_upper', rotationZDegrees: -25 },
          { jointId: 'leg_l_lower', rotationZDegrees: -20 },
          { jointId: 'leg_r_upper', rotationZDegrees: 25 },
          { jointId: 'leg_r_lower', rotationZDegrees: -30 },
          { jointId: 'coat_tail', rotationZDegrees: -15 }
        ]
      },
      {
        frame: 15,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 2] },
          { jointId: 'torso', rotationZDegrees: 15 },
          { jointId: 'head', rotationZDegrees: 28 },
          { jointId: 'arm_l_upper', rotationZDegrees: 85 },
          { jointId: 'arm_l_lower', rotationZDegrees: 80 },
          { jointId: 'arm_r_upper', rotationZDegrees: 90 },
          { jointId: 'arm_r_lower', rotationZDegrees: 75 },
          { jointId: 'leg_l_upper', rotationZDegrees: -25 },
          { jointId: 'leg_l_lower', rotationZDegrees: -22 },
          { jointId: 'leg_r_upper', rotationZDegrees: 25 },
          { jointId: 'leg_r_lower', rotationZDegrees: -32 },
          { jointId: 'coat_tail', rotationZDegrees: -25 }
        ]
      },
      {
        frame: 30,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 12 },
          { jointId: 'head', rotationZDegrees: 25 },
          { jointId: 'arm_l_upper', rotationZDegrees: 80 },
          { jointId: 'arm_l_lower', rotationZDegrees: 75 },
          { jointId: 'arm_r_upper', rotationZDegrees: 85 },
          { jointId: 'arm_r_lower', rotationZDegrees: 70 },
          { jointId: 'leg_l_upper', rotationZDegrees: -25 },
          { jointId: 'leg_l_lower', rotationZDegrees: -20 },
          { jointId: 'leg_r_upper', rotationZDegrees: 25 },
          { jointId: 'leg_r_lower', rotationZDegrees: -30 },
          { jointId: 'coat_tail', rotationZDegrees: -15 }
        ]
      }
    ]
  },
  combat_clash: {
    interpolationMode: 'linear',
    loopFrames: 20,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 5, localOffset2D: [2, -6] },
          { jointId: 'torso', rotationZDegrees: -12 },
          { jointId: 'head', rotationZDegrees: 10 },
          { jointId: 'arm_l_upper', rotationZDegrees: -30 },
          { jointId: 'arm_l_lower', rotationZDegrees: 80 },
          { jointId: 'arm_r_upper', rotationZDegrees: 65 },
          { jointId: 'arm_r_lower', rotationZDegrees: 35 },
          { jointId: 'leg_l_upper', rotationZDegrees: -40 },
          { jointId: 'leg_l_lower', rotationZDegrees: -40 },
          { jointId: 'leg_r_upper', rotationZDegrees: 40 },
          { jointId: 'leg_r_lower', rotationZDegrees: -65 },
          { jointId: 'coat_tail', rotationZDegrees: -35 }
        ]
      },
      {
        frame: 10,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -5, localOffset2D: [-2, -4] },
          { jointId: 'torso', rotationZDegrees: 8 },
          { jointId: 'head', rotationZDegrees: -4 },
          { jointId: 'arm_l_upper', rotationZDegrees: 50 },
          { jointId: 'arm_l_lower', rotationZDegrees: 90 },
          { jointId: 'arm_r_upper', rotationZDegrees: -25 },
          { jointId: 'arm_r_lower', rotationZDegrees: 60 },
          { jointId: 'leg_l_upper', rotationZDegrees: 30 },
          { jointId: 'leg_l_lower', rotationZDegrees: -60 },
          { jointId: 'leg_r_upper', rotationZDegrees: -35 },
          { jointId: 'leg_r_lower', rotationZDegrees: -45 },
          { jointId: 'coat_tail', rotationZDegrees: -15 }
        ]
      },
      {
        frame: 20,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 5, localOffset2D: [2, -6] },
          { jointId: 'torso', rotationZDegrees: -12 },
          { jointId: 'head', rotationZDegrees: 10 },
          { jointId: 'arm_l_upper', rotationZDegrees: -30 },
          { jointId: 'arm_l_lower', rotationZDegrees: 80 },
          { jointId: 'arm_r_upper', rotationZDegrees: 65 },
          { jointId: 'arm_r_lower', rotationZDegrees: 35 },
          { jointId: 'leg_l_upper', rotationZDegrees: -40 },
          { jointId: 'leg_l_lower', rotationZDegrees: -40 },
          { jointId: 'leg_r_upper', rotationZDegrees: 40 },
          { jointId: 'leg_r_lower', rotationZDegrees: -65 },
          { jointId: 'coat_tail', rotationZDegrees: -35 }
        ]
      }
    ]
  },
  exhausted_walk: generateBipedLocomotionClip({
    loopFrames: 42,
    stanceFrames: 25,
    strideLengthUnits: 46.0,
    groundY: -46.0,
    swingLift: 8.0,
    pelvisY0: -4,
    pelvisBobAmp: 1.5,
    torsoDeg0: -14,
    torsoAmp: -1,
    headDeg0: -18,
    headAmp: 2,
    armUpperMid: -1,
    armUpperAmp: 11,
    armLowerMid: 12.5,
    armLowerAmp: -2.5,
    coatDeg0: -12,
    coatAmp: -2
  }),
  rain_umbrella_walk: generateBipedLocomotionClip({
    loopFrames: 36,
    stanceFrames: 22,
    strideLengthUnits: 44.0,
    groundY: -46.0,
    swingLift: 7.5,
    pelvisY0: -2,
    pelvisBobAmp: 1.2,
    torsoDeg0: -6,
    torsoAmp: 1,
    headDeg0: -8,
    headAmp: 1,
    armUpperMid: 35,
    armUpperAmp: 2,
    armLowerMid: 55,
    armLowerAmp: 1,
    coatDeg0: -14,
    coatAmp: -2
  }),
  idle: {
    interpolationMode: 'linear',
    loopFrames: 30,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 2 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 20 },
          { jointId: 'arm_r_upper', rotationZDegrees: 14 },
          { jointId: 'arm_r_lower', rotationZDegrees: 24 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 15,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 1] },
          { jointId: 'torso', rotationZDegrees: -3 },
          { jointId: 'head', rotationZDegrees: 3 },
          { jointId: 'arm_l_upper', rotationZDegrees: -11 },
          { jointId: 'arm_l_lower', rotationZDegrees: 22 },
          { jointId: 'arm_r_upper', rotationZDegrees: 15 },
          { jointId: 'arm_r_lower', rotationZDegrees: 25 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 30,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 2 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 20 },
          { jointId: 'arm_r_upper', rotationZDegrees: 14 },
          { jointId: 'arm_r_lower', rotationZDegrees: 24 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      }
    ]
  },
  pop_vocal_sway: {
    interpolationMode: 'linear',
    loopFrames: 24,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -1, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 2 },
          { jointId: 'head', rotationZDegrees: -2 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 26 },
          { jointId: 'arm_r_upper', rotationZDegrees: 8 },
          { jointId: 'arm_r_lower', rotationZDegrees: 28 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 12,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 1, localOffset2D: [0, 1] },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 2 },
          { jointId: 'arm_l_upper', rotationZDegrees: -8 },
          { jointId: 'arm_l_lower', rotationZDegrees: 32 },
          { jointId: 'arm_r_upper', rotationZDegrees: 14 },
          { jointId: 'arm_r_lower', rotationZDegrees: 34 },
          { jointId: 'leg_l_upper', rotationZDegrees: -4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: 4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -8 }
        ]
      },
      {
        frame: 24,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -1, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 2 },
          { jointId: 'head', rotationZDegrees: -2 },
          { jointId: 'arm_l_upper', rotationZDegrees: -12 },
          { jointId: 'arm_l_lower', rotationZDegrees: 26 },
          { jointId: 'arm_r_upper', rotationZDegrees: 8 },
          { jointId: 'arm_r_lower', rotationZDegrees: 28 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      }
    ]
  },
  stage_spin: {
    interpolationMode: 'linear',
    loopFrames: 24,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 6 },
          { jointId: 'head', rotationZDegrees: 0 },
          { jointId: 'arm_l_upper', rotationZDegrees: -55 },
          { jointId: 'arm_l_lower', rotationZDegrees: 35 },
          { jointId: 'arm_r_upper', rotationZDegrees: 55 },
          { jointId: 'arm_r_lower', rotationZDegrees: 35 },
          { jointId: 'leg_l_upper', rotationZDegrees: 15 },
          { jointId: 'leg_l_lower', rotationZDegrees: -25 },
          { jointId: 'leg_r_upper', rotationZDegrees: -10 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -35 }
        ]
      },
      {
        frame: 12,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 8, localOffset2D: [0, 6] },
          { jointId: 'torso', rotationZDegrees: -8 },
          { jointId: 'head', rotationZDegrees: 6 },
          { jointId: 'arm_l_upper', rotationZDegrees: -75 },
          { jointId: 'arm_l_lower', rotationZDegrees: 20 },
          { jointId: 'arm_r_upper', rotationZDegrees: 75 },
          { jointId: 'arm_r_lower', rotationZDegrees: 20 },
          { jointId: 'leg_l_upper', rotationZDegrees: -12 },
          { jointId: 'leg_l_lower', rotationZDegrees: -15 },
          { jointId: 'leg_r_upper', rotationZDegrees: 28 },
          { jointId: 'leg_r_lower', rotationZDegrees: -45 },
          { jointId: 'coat_tail', rotationZDegrees: -55 }
        ]
      },
      {
        frame: 24,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 6 },
          { jointId: 'head', rotationZDegrees: 0 },
          { jointId: 'arm_l_upper', rotationZDegrees: -55 },
          { jointId: 'arm_l_lower', rotationZDegrees: 35 },
          { jointId: 'arm_r_upper', rotationZDegrees: 55 },
          { jointId: 'arm_r_lower', rotationZDegrees: 35 },
          { jointId: 'leg_l_upper', rotationZDegrees: 15 },
          { jointId: 'leg_l_lower', rotationZDegrees: -25 },
          { jointId: 'leg_r_upper', rotationZDegrees: -10 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -35 }
        ]
      }
    ]
  },
  rhythmic_step: {
    interpolationMode: 'linear',
    loopFrames: 24,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -4 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -20 },
          { jointId: 'arm_l_lower', rotationZDegrees: 65 },
          { jointId: 'arm_r_upper', rotationZDegrees: 35 },
          { jointId: 'arm_r_lower', rotationZDegrees: 65 },
          { jointId: 'leg_l_upper', rotationZDegrees: 22 },
          { jointId: 'leg_l_lower', rotationZDegrees: -35 },
          { jointId: 'leg_r_upper', rotationZDegrees: -12 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -16 }
        ]
      },
      {
        frame: 12,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 3] },
          { jointId: 'torso', rotationZDegrees: 4 },
          { jointId: 'head', rotationZDegrees: -4 },
          { jointId: 'arm_l_upper', rotationZDegrees: 35 },
          { jointId: 'arm_l_lower', rotationZDegrees: 65 },
          { jointId: 'arm_r_upper', rotationZDegrees: -20 },
          { jointId: 'arm_r_lower', rotationZDegrees: 65 },
          { jointId: 'leg_l_upper', rotationZDegrees: -12 },
          { jointId: 'leg_l_lower', rotationZDegrees: -10 },
          { jointId: 'leg_r_upper', rotationZDegrees: 22 },
          { jointId: 'leg_r_lower', rotationZDegrees: -35 },
          { jointId: 'coat_tail', rotationZDegrees: -24 }
        ]
      },
      {
        frame: 24,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -4 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: -20 },
          { jointId: 'arm_l_lower', rotationZDegrees: 65 },
          { jointId: 'arm_r_upper', rotationZDegrees: 35 },
          { jointId: 'arm_r_lower', rotationZDegrees: 65 },
          { jointId: 'leg_l_upper', rotationZDegrees: 22 },
          { jointId: 'leg_l_lower', rotationZDegrees: -35 },
          { jointId: 'leg_r_upper', rotationZDegrees: -12 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -16 }
        ]
      }
    ]
  },
  crowd_cheer: {
    interpolationMode: 'linear',
    loopFrames: 24,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 6 },
          { jointId: 'head', rotationZDegrees: 10 },
          { jointId: 'arm_l_upper', rotationZDegrees: -78 },
          { jointId: 'arm_l_lower', rotationZDegrees: 15 },
          { jointId: 'arm_r_upper', rotationZDegrees: 78 },
          { jointId: 'arm_r_lower', rotationZDegrees: 15 },
          { jointId: 'leg_l_upper', rotationZDegrees: 6 },
          { jointId: 'leg_l_lower', rotationZDegrees: -10 },
          { jointId: 'leg_r_upper', rotationZDegrees: -6 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -15 }
        ]
      },
      {
        frame: 12,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 4] },
          { jointId: 'torso', rotationZDegrees: 10 },
          { jointId: 'head', rotationZDegrees: 14 },
          { jointId: 'arm_l_upper', rotationZDegrees: -85 },
          { jointId: 'arm_l_lower', rotationZDegrees: 5 },
          { jointId: 'arm_r_upper', rotationZDegrees: 85 },
          { jointId: 'arm_r_lower', rotationZDegrees: 5 },
          { jointId: 'leg_l_upper', rotationZDegrees: 12 },
          { jointId: 'leg_l_lower', rotationZDegrees: -18 },
          { jointId: 'leg_r_upper', rotationZDegrees: -12 },
          { jointId: 'leg_r_lower', rotationZDegrees: -18 },
          { jointId: 'coat_tail', rotationZDegrees: -25 }
        ]
      },
      {
        frame: 24,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 6 },
          { jointId: 'head', rotationZDegrees: 10 },
          { jointId: 'arm_l_upper', rotationZDegrees: -78 },
          { jointId: 'arm_l_lower', rotationZDegrees: 15 },
          { jointId: 'arm_r_upper', rotationZDegrees: 78 },
          { jointId: 'arm_r_lower', rotationZDegrees: 15 },
          { jointId: 'leg_l_upper', rotationZDegrees: 6 },
          { jointId: 'leg_l_lower', rotationZDegrees: -10 },
          { jointId: 'leg_r_upper', rotationZDegrees: -6 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -15 }
        ]
      }
    ]
  },
  acoustic_strum: {
    interpolationMode: 'linear',
    loopFrames: 24,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -6 },
          { jointId: 'head', rotationZDegrees: -8 },
          { jointId: 'arm_l_upper', rotationZDegrees: 32 },
          { jointId: 'arm_l_lower', rotationZDegrees: 68 },
          { jointId: 'arm_r_upper', rotationZDegrees: 15 },
          { jointId: 'arm_r_lower', rotationZDegrees: 52 },
          { jointId: 'leg_l_upper', rotationZDegrees: 8 },
          { jointId: 'leg_l_lower', rotationZDegrees: -10 },
          { jointId: 'leg_r_upper', rotationZDegrees: -6 },
          { jointId: 'leg_r_lower', rotationZDegrees: -8 },
          { jointId: 'coat_tail', rotationZDegrees: -8 }
        ]
      },
      {
        frame: 12,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 1] },
          { jointId: 'torso', rotationZDegrees: -4 },
          { jointId: 'head', rotationZDegrees: -4 },
          { jointId: 'arm_l_upper', rotationZDegrees: 34 },
          { jointId: 'arm_l_lower', rotationZDegrees: 72 },
          { jointId: 'arm_r_upper', rotationZDegrees: 28 },
          { jointId: 'arm_r_lower', rotationZDegrees: 32 },
          { jointId: 'leg_l_upper', rotationZDegrees: 8 },
          { jointId: 'leg_l_lower', rotationZDegrees: -10 },
          { jointId: 'leg_r_upper', rotationZDegrees: -6 },
          { jointId: 'leg_r_lower', rotationZDegrees: -8 },
          { jointId: 'coat_tail', rotationZDegrees: -12 }
        ]
      },
      {
        frame: 24,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: -6 },
          { jointId: 'head', rotationZDegrees: -8 },
          { jointId: 'arm_l_upper', rotationZDegrees: 32 },
          { jointId: 'arm_l_lower', rotationZDegrees: 68 },
          { jointId: 'arm_r_upper', rotationZDegrees: 15 },
          { jointId: 'arm_r_lower', rotationZDegrees: 52 },
          { jointId: 'leg_l_upper', rotationZDegrees: 8 },
          { jointId: 'leg_l_lower', rotationZDegrees: -10 },
          { jointId: 'leg_r_upper', rotationZDegrees: -6 },
          { jointId: 'leg_r_lower', rotationZDegrees: -8 },
          { jointId: 'coat_tail', rotationZDegrees: -8 }
        ]
      }
    ]
  },
  bench_contemplation: {
    interpolationMode: 'linear',
    loopFrames: 36,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, -14] },
          { jointId: 'torso', rotationZDegrees: -12 },
          { jointId: 'head', rotationZDegrees: -14 },
          { jointId: 'arm_l_upper', rotationZDegrees: 18 },
          { jointId: 'arm_l_lower', rotationZDegrees: 45 },
          { jointId: 'arm_r_upper', rotationZDegrees: 22 },
          { jointId: 'arm_r_lower', rotationZDegrees: 55 },
          { jointId: 'leg_l_upper', rotationZDegrees: 68 },
          { jointId: 'leg_l_lower', rotationZDegrees: -72 },
          { jointId: 'leg_r_upper', rotationZDegrees: 64 },
          { jointId: 'leg_r_lower', rotationZDegrees: -68 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 18,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, -14] },
          { jointId: 'torso', rotationZDegrees: -9 },
          { jointId: 'head', rotationZDegrees: -8 },
          { jointId: 'arm_l_upper', rotationZDegrees: 20 },
          { jointId: 'arm_l_lower', rotationZDegrees: 48 },
          { jointId: 'arm_r_upper', rotationZDegrees: 26 },
          { jointId: 'arm_r_lower', rotationZDegrees: 60 },
          { jointId: 'leg_l_upper', rotationZDegrees: 68 },
          { jointId: 'leg_l_lower', rotationZDegrees: -72 },
          { jointId: 'leg_r_upper', rotationZDegrees: 64 },
          { jointId: 'leg_r_lower', rotationZDegrees: -68 },
          { jointId: 'coat_tail', rotationZDegrees: -8 }
        ]
      },
      {
        frame: 36,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, -14] },
          { jointId: 'torso', rotationZDegrees: -12 },
          { jointId: 'head', rotationZDegrees: -14 },
          { jointId: 'arm_l_upper', rotationZDegrees: 18 },
          { jointId: 'arm_l_lower', rotationZDegrees: 45 },
          { jointId: 'arm_r_upper', rotationZDegrees: 22 },
          { jointId: 'arm_r_lower', rotationZDegrees: 55 },
          { jointId: 'leg_l_upper', rotationZDegrees: 68 },
          { jointId: 'leg_l_lower', rotationZDegrees: -72 },
          { jointId: 'leg_r_upper', rotationZDegrees: 64 },
          { jointId: 'leg_r_lower', rotationZDegrees: -68 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      }
    ]
  },
  gazing_out_window: {
    interpolationMode: 'linear',
    loopFrames: 36,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 3 },
          { jointId: 'head', rotationZDegrees: 12 },
          { jointId: 'arm_l_upper', rotationZDegrees: -8 },
          { jointId: 'arm_l_lower', rotationZDegrees: 20 },
          { jointId: 'arm_r_upper', rotationZDegrees: 28 },
          { jointId: 'arm_r_lower', rotationZDegrees: 62 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      },
      {
        frame: 18,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 1] },
          { jointId: 'torso', rotationZDegrees: 5 },
          { jointId: 'head', rotationZDegrees: 16 },
          { jointId: 'arm_l_upper', rotationZDegrees: -6 },
          { jointId: 'arm_l_lower', rotationZDegrees: 22 },
          { jointId: 'arm_r_upper', rotationZDegrees: 32 },
          { jointId: 'arm_r_lower', rotationZDegrees: 66 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -10 }
        ]
      },
      {
        frame: 36,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 3 },
          { jointId: 'head', rotationZDegrees: 12 },
          { jointId: 'arm_l_upper', rotationZDegrees: -8 },
          { jointId: 'arm_l_lower', rotationZDegrees: 20 },
          { jointId: 'arm_r_upper', rotationZDegrees: 28 },
          { jointId: 'arm_r_lower', rotationZDegrees: 62 },
          { jointId: 'leg_l_upper', rotationZDegrees: 4 },
          { jointId: 'leg_l_lower', rotationZDegrees: -6 },
          { jointId: 'leg_r_upper', rotationZDegrees: -4 },
          { jointId: 'leg_r_lower', rotationZDegrees: -6 },
          { jointId: 'coat_tail', rotationZDegrees: -6 }
        ]
      }
    ]
  },
  slow_waltz: {
    interpolationMode: 'linear',
    loopFrames: 36,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -3, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 6 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: 42 },
          { jointId: 'arm_l_lower', rotationZDegrees: 35 },
          { jointId: 'arm_r_upper', rotationZDegrees: 52 },
          { jointId: 'arm_r_lower', rotationZDegrees: 45 },
          { jointId: 'leg_l_upper', rotationZDegrees: 14 },
          { jointId: 'leg_l_lower', rotationZDegrees: -18 },
          { jointId: 'leg_r_upper', rotationZDegrees: -10 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -18 }
        ]
      },
      {
        frame: 18,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 3, localOffset2D: [0, 3] },
          { jointId: 'torso', rotationZDegrees: -6 },
          { jointId: 'head', rotationZDegrees: -4 },
          { jointId: 'arm_l_upper', rotationZDegrees: 48 },
          { jointId: 'arm_l_lower', rotationZDegrees: 40 },
          { jointId: 'arm_r_upper', rotationZDegrees: 46 },
          { jointId: 'arm_r_lower', rotationZDegrees: 38 },
          { jointId: 'leg_l_upper', rotationZDegrees: -10 },
          { jointId: 'leg_l_lower', rotationZDegrees: -10 },
          { jointId: 'leg_r_upper', rotationZDegrees: 14 },
          { jointId: 'leg_r_lower', rotationZDegrees: -18 },
          { jointId: 'coat_tail', rotationZDegrees: -26 }
        ]
      },
      {
        frame: 36,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -3, localOffset2D: [0, 0] },
          { jointId: 'torso', rotationZDegrees: 6 },
          { jointId: 'head', rotationZDegrees: 4 },
          { jointId: 'arm_l_upper', rotationZDegrees: 42 },
          { jointId: 'arm_l_lower', rotationZDegrees: 35 },
          { jointId: 'arm_r_upper', rotationZDegrees: 52 },
          { jointId: 'arm_r_lower', rotationZDegrees: 45 },
          { jointId: 'leg_l_upper', rotationZDegrees: 14 },
          { jointId: 'leg_l_lower', rotationZDegrees: -18 },
          { jointId: 'leg_r_upper', rotationZDegrees: -10 },
          { jointId: 'leg_r_lower', rotationZDegrees: -10 },
          { jointId: 'coat_tail', rotationZDegrees: -18 }
        ]
      }
    ]
  },
  headbang_riff: {
    interpolationMode: 'linear',
    loopFrames: 16,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -6, localOffset2D: [0, -4] },
          { jointId: 'torso', rotationZDegrees: -28 },
          { jointId: 'head', rotationZDegrees: -28 },
          { jointId: 'arm_l_upper', rotationZDegrees: 36 },
          { jointId: 'arm_l_lower', rotationZDegrees: 72 },
          { jointId: 'arm_r_upper', rotationZDegrees: 22 },
          { jointId: 'arm_r_lower', rotationZDegrees: 58 },
          { jointId: 'leg_l_upper', rotationZDegrees: 26 },
          { jointId: 'leg_l_lower', rotationZDegrees: -32 },
          { jointId: 'leg_r_upper', rotationZDegrees: -18 },
          { jointId: 'leg_r_lower', rotationZDegrees: -22 },
          { jointId: 'coat_tail', rotationZDegrees: -32 }
        ]
      },
      {
        frame: 8,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 2, localOffset2D: [0, 2] },
          { jointId: 'torso', rotationZDegrees: 8 },
          { jointId: 'head', rotationZDegrees: 22 },
          { jointId: 'arm_l_upper', rotationZDegrees: 38 },
          { jointId: 'arm_l_lower', rotationZDegrees: 76 },
          { jointId: 'arm_r_upper', rotationZDegrees: 38 },
          { jointId: 'arm_r_lower', rotationZDegrees: 30 },
          { jointId: 'leg_l_upper', rotationZDegrees: 22 },
          { jointId: 'leg_l_lower', rotationZDegrees: -26 },
          { jointId: 'leg_r_upper', rotationZDegrees: -14 },
          { jointId: 'leg_r_lower', rotationZDegrees: -18 },
          { jointId: 'coat_tail', rotationZDegrees: -48 }
        ]
      },
      {
        frame: 16,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -6, localOffset2D: [0, -4] },
          { jointId: 'torso', rotationZDegrees: -28 },
          { jointId: 'head', rotationZDegrees: -28 },
          { jointId: 'arm_l_upper', rotationZDegrees: 36 },
          { jointId: 'arm_l_lower', rotationZDegrees: 72 },
          { jointId: 'arm_r_upper', rotationZDegrees: 22 },
          { jointId: 'arm_r_lower', rotationZDegrees: 58 },
          { jointId: 'leg_l_upper', rotationZDegrees: 26 },
          { jointId: 'leg_l_lower', rotationZDegrees: -32 },
          { jointId: 'leg_r_upper', rotationZDegrees: -18 },
          { jointId: 'leg_r_lower', rotationZDegrees: -22 },
          { jointId: 'coat_tail', rotationZDegrees: -32 }
        ]
      }
    ]
  },
  collapse_to_knees: {
    interpolationMode: 'linear',
    loopFrames: 36,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -8, localOffset2D: [0, -22] },
          { jointId: 'torso', rotationZDegrees: 14 },
          { jointId: 'head', rotationZDegrees: 24 },
          { jointId: 'arm_l_upper', rotationZDegrees: -45 },
          { jointId: 'arm_l_lower', rotationZDegrees: 35 },
          { jointId: 'arm_r_upper', rotationZDegrees: 55 },
          { jointId: 'arm_r_lower', rotationZDegrees: 45 },
          { jointId: 'leg_l_upper', rotationZDegrees: 75 },
          { jointId: 'leg_l_lower', rotationZDegrees: -125 },
          { jointId: 'leg_r_upper', rotationZDegrees: 65 },
          { jointId: 'leg_r_lower', rotationZDegrees: -120 },
          { jointId: 'coat_tail', rotationZDegrees: -10 }
        ]
      },
      {
        frame: 18,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -10, localOffset2D: [0, -22] },
          { jointId: 'torso', rotationZDegrees: -18 },
          { jointId: 'head', rotationZDegrees: -22 },
          { jointId: 'arm_l_upper', rotationZDegrees: 25 },
          { jointId: 'arm_l_lower', rotationZDegrees: 70 },
          { jointId: 'arm_r_upper', rotationZDegrees: 30 },
          { jointId: 'arm_r_lower', rotationZDegrees: 75 },
          { jointId: 'leg_l_upper', rotationZDegrees: 75 },
          { jointId: 'leg_l_lower', rotationZDegrees: -125 },
          { jointId: 'leg_r_upper', rotationZDegrees: 65 },
          { jointId: 'leg_r_lower', rotationZDegrees: -120 },
          { jointId: 'coat_tail', rotationZDegrees: -15 }
        ]
      },
      {
        frame: 36,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: -8, localOffset2D: [0, -22] },
          { jointId: 'torso', rotationZDegrees: 14 },
          { jointId: 'head', rotationZDegrees: 24 },
          { jointId: 'arm_l_upper', rotationZDegrees: -45 },
          { jointId: 'arm_l_lower', rotationZDegrees: 35 },
          { jointId: 'arm_r_upper', rotationZDegrees: 55 },
          { jointId: 'arm_r_lower', rotationZDegrees: 45 },
          { jointId: 'leg_l_upper', rotationZDegrees: 75 },
          { jointId: 'leg_l_lower', rotationZDegrees: -125 },
          { jointId: 'leg_r_upper', rotationZDegrees: 65 },
          { jointId: 'leg_r_lower', rotationZDegrees: -120 },
          { jointId: 'coat_tail', rotationZDegrees: -10 }
        ]
      }
    ]
  }
};

export const QuadrupedPoseClips: Record<string, PoseInterpolationContract> = {
  beast_gallop: generateQuadrupedGallopClip({
    loopFrames: 24,
    stanceFrames: 10,
    strideLengthUnits: 54.0,
    groundY: -32.5,
    swingLift: 4.5,
    pelvisBobAmp: 0.5,
    stanceCenterOffsetFrontX: -1.0,
    stanceCenterOffsetBackX: -6.5,
    limbOffsets: { bl: 0, br: 4, fl: 12, fr: 16 }
  }),
  beast_idle: {
    interpolationMode: 'linear',
    loopFrames: 24,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'spine', rotationZDegrees: 0 },
          { jointId: 'chest', rotationZDegrees: 0 },
          { jointId: 'head', rotationZDegrees: 0 },
          { jointId: 'tail_root', rotationZDegrees: -15 },
          { jointId: 'leg_fl_upper', rotationZDegrees: 0 },
          { jointId: 'leg_fl_lower', rotationZDegrees: -30 },
          { jointId: 'leg_fr_upper', rotationZDegrees: 0 },
          { jointId: 'leg_fr_lower', rotationZDegrees: -30 },
          { jointId: 'leg_bl_upper', rotationZDegrees: 0 },
          { jointId: 'leg_bl_lower', rotationZDegrees: -35 },
          { jointId: 'leg_br_upper', rotationZDegrees: 0 },
          { jointId: 'leg_br_lower', rotationZDegrees: -35 }
        ]
      },
      {
        frame: 12,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 1] },
          { jointId: 'spine', rotationZDegrees: 2 },
          { jointId: 'chest', rotationZDegrees: 2 },
          { jointId: 'head', rotationZDegrees: 3 },
          { jointId: 'tail_root', rotationZDegrees: -10 },
          { jointId: 'leg_fl_upper', rotationZDegrees: 0 },
          { jointId: 'leg_fl_lower', rotationZDegrees: -30 },
          { jointId: 'leg_fr_upper', rotationZDegrees: 0 },
          { jointId: 'leg_fr_lower', rotationZDegrees: -30 },
          { jointId: 'leg_bl_upper', rotationZDegrees: 0 },
          { jointId: 'leg_bl_lower', rotationZDegrees: -35 },
          { jointId: 'leg_br_upper', rotationZDegrees: 0 },
          { jointId: 'leg_br_lower', rotationZDegrees: -35 }
        ]
      },
      {
        frame: 24,
        jointTransforms: [
          { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, 0] },
          { jointId: 'spine', rotationZDegrees: 0 },
          { jointId: 'chest', rotationZDegrees: 0 },
          { jointId: 'head', rotationZDegrees: 0 },
          { jointId: 'tail_root', rotationZDegrees: -15 },
          { jointId: 'leg_fl_upper', rotationZDegrees: 0 },
          { jointId: 'leg_fl_lower', rotationZDegrees: -30 },
          { jointId: 'leg_fr_upper', rotationZDegrees: 0 },
          { jointId: 'leg_fr_lower', rotationZDegrees: -30 },
          { jointId: 'leg_bl_upper', rotationZDegrees: 0 },
          { jointId: 'leg_bl_lower', rotationZDegrees: -35 },
          { jointId: 'leg_br_upper', rotationZDegrees: 0 },
          { jointId: 'leg_br_lower', rotationZDegrees: -35 }
        ]
      }
    ]
  }
};

/** Drawable budget for a biped rig including attached prop parts. */
export const MAX_BIPED_PARTS = 28;

type RigPaintValue = NonNullable<RigPart['style']['fill']>;

function resolveOverridePaint(
  paint: RigPaintValue,
  overrides: NonNullable<CastSpecItem['paletteOverrides']>
): RigPaintValue {
  if (paint.kind !== 'palette') return paint;
  const hex =
    paint.role === 'primary' ? overrides.primary : paint.role === 'accent' ? overrides.accent : undefined;
  if (!hex) return paint;
  return { kind: 'solid', color: shadeHexColor(hex, paint.shade) };
}

/**
 * Applies a cast member's palette overrides to the primary and accent roles of every
 * part of the rig (body parts, accessories and attached props). Overridden paints become
 * solid colors that keep their shade offset; parts stay lit so shot lighting still modulates them.
 */
export function applyPaletteOverrides(
  rig: AssetRigContract,
  overrides: CastSpecItem['paletteOverrides']
): AssetRigContract {
  if (!overrides || (!overrides.primary && !overrides.accent)) return rig;
  return {
    ...rig,
    parts: rig.parts.map((part) => ({
      ...part,
      style: {
        ...part.style,
        ...(part.style.fill ? { fill: resolveOverridePaint(part.style.fill, overrides) } : {}),
        ...(part.style.stroke
          ? {
              stroke: {
                ...part.style.stroke,
                paint: resolveOverridePaint(part.style.stroke.paint, overrides)
              }
            }
          : {})
      }
    }))
  };
}

const BIPED_BOOT_SHAPE = {
  kind: 'polygon' as const,
  points: [
    [-3.5, 0],
    [9, 0],
    [9, 2.5],
    [5, 4.5],
    [3.5, 7],
    [-3.5, 7]
  ] as Array<[number, number]>
};

const QUADRUPED_PAW_SHAPE = {
  kind: 'polygon' as const,
  points: [
    [-3, 0],
    [5, 0],
    [5, 2.5],
    [3, 4.5],
    [-2, 4.5],
    [-3, 2.5]
  ] as Array<[number, number]>
};

export class ArchetypeFactory {
  private static attachNarrativeProps(
    rig: AssetRigContract,
    accessories: readonly string[] = []
  ): AssetRigContract {
    const propParts: RigPart[] = [];
    for (const acc of accessories) {
      if (PropFactory.isNarrativePropId(acc)) {
        const candidateParts = PropFactory.buildAttachedPropParts(acc);
        for (const p of candidateParts) {
          if (rig.parts.length + propParts.length < MAX_BIPED_PARTS) {
            propParts.push(p);
          }
        }
      }
    }

    return {
      ...rig,
      sockets: [...CANONICAL_BIPED_SOCKETS],
      parts: propParts.length > 0 ? [...rig.parts, ...propParts] : rig.parts
    };
  }

  public static build(options: ArchetypeBuildOptions): AssetRigContract {
    return applyPaletteOverrides(
      applyOutlinePolicy(ArchetypeFactory.buildBase(options)),
      options.spec.paletteOverrides
    );
  }

  private static buildBase(options: ArchetypeBuildOptions): AssetRigContract {
    const { archetypeId, viewAngle, accessories } = options.spec;
    if (archetypeId === 'biped_frontal' || (archetypeId === 'biped_runner' && viewAngle === 'front')) {
      return ArchetypeFactory.attachNarrativeProps(
        ArchetypeFactory.buildBipedFrontal(options),
        accessories
      );
    }
    if (
      archetypeId === 'biped_three_quarters' ||
      (archetypeId === 'biped_runner' && viewAngle === 'three_quarter')
    ) {
      return ArchetypeFactory.attachNarrativeProps(
        ArchetypeFactory.buildBipedThreeQuarters(options),
        accessories
      );
    }
    switch (archetypeId) {
      case 'hero_silhouette':
        return ArchetypeFactory.attachNarrativeProps(
          ArchetypeFactory.buildHeroSilhouette(options),
          accessories
        );
      case 'companion_silhouette':
        return ArchetypeFactory.attachNarrativeProps(
          ArchetypeFactory.buildCompanionSilhouette(options),
          accessories
        );
      case 'biped_runner':
        return ArchetypeFactory.attachNarrativeProps(
          ArchetypeFactory.buildBipedRunner(options),
          accessories
        );
      case 'quadruped_beast':
        return ArchetypeFactory.buildQuadrupedBeast(options);
      case 'aerial_drone':
        return ArchetypeFactory.buildAerialDrone(options);
      default:
        return ArchetypeFactory.attachNarrativeProps(
          ArchetypeFactory.buildBipedRunner(options),
          accessories
        );
    }
  }

  /**
   * Archetype 1: Biped Humanoid Runner
   * Enforces:
   * - Backward knee flexion constraints [-140, 0].
   * - localOffset2D: [0, 0] on secondary motion parts (coat_wing, hair_ribbon).
   * - Cohesive close-up silhouette: neck_collar and abdomen_connector.
   * - Total parts <= MAX_BIPED_PARTS (includes one boot per leg bound to the lower-leg joint).
   */
  public static buildBipedRunner(options: ArchetypeBuildOptions): AssetRigContract {
    const { instanceId, spec } = options;
    const s = spec.scale ?? 1.0;

    return {
      id: instanceId,
      name: `Biped Runner (${instanceId})`,
      type: 'character',
      facingDirection: 'right',
      renderMode: 'billboard',
      baseTransform: {
        position: [0, 75, 0],
        rotationZDegrees: 0,
        scale: [1.35 * s, 1.35 * s]
      },
      skeleton: {
        rootJointId: 'pelvis',
        joints: [
          {
            id: 'pelvis',
            parentId: null,
            localOffset2D: [0, 0],
            rotationZDegrees: 0,
            length: 12,
            constraintsDeg: [-30, 30]
          },
          {
            id: 'torso',
            parentId: 'pelvis',
            localOffset2D: [0, 18],
            rotationZDegrees: -9,
            length: 28,
            constraintsDeg: [-45, 45]
          },
          {
            id: 'head',
            parentId: 'torso',
            localOffset2D: [3, 20],
            rotationZDegrees: 5,
            length: 16,
            constraintsDeg: [-40, 40]
          },
          {
            id: 'arm_l_upper',
            parentId: 'torso',
            localOffset2D: [-6, 15],
            rotationZDegrees: -25,
            length: 18,
            constraintsDeg: [-150, 150]
          },
          {
            id: 'arm_l_lower',
            parentId: 'arm_l_upper',
            localOffset2D: [0, -18],
            rotationZDegrees: 35,
            length: 16,
            constraintsDeg: [0, 135]
          },
          {
            id: 'arm_r_upper',
            parentId: 'torso',
            localOffset2D: [6, 15],
            rotationZDegrees: 25,
            length: 18,
            constraintsDeg: [-150, 150]
          },
          {
            id: 'arm_r_lower',
            parentId: 'arm_r_upper',
            localOffset2D: [0, -18],
            rotationZDegrees: 40,
            length: 16,
            constraintsDeg: [0, 135]
          },
          {
            id: 'leg_l_upper',
            parentId: 'pelvis',
            localOffset2D: [-4, -4],
            rotationZDegrees: 32,
            length: 22,
            constraintsDeg: [-90, 90]
          },
          {
            id: 'leg_l_lower',
            parentId: 'leg_l_upper',
            localOffset2D: [0, -22],
            rotationZDegrees: -22,
            length: 22,
            constraintsDeg: [-140, 0] // Anatomical backward knee flexion
          },
          {
            id: 'leg_r_upper',
            parentId: 'pelvis',
            localOffset2D: [4, -4],
            rotationZDegrees: -32,
            length: 22,
            constraintsDeg: [-90, 90]
          },
          {
            id: 'leg_r_lower',
            parentId: 'leg_r_upper',
            localOffset2D: [0, -22],
            rotationZDegrees: -58,
            length: 22,
            constraintsDeg: [-140, 0] // Anatomical backward knee flexion
          },
          {
            id: 'coat_tail',
            parentId: 'torso',
            localOffset2D: [-10, 10],
            rotationZDegrees: -6,
            length: 26,
            constraintsDeg: [-85, 20]
          },
          {
            id: 'hair_tie',
            parentId: 'head',
            localOffset2D: [-10, 8],
            rotationZDegrees: -6,
            length: 18,
            constraintsDeg: [-75, 25]
          }
        ]
      },
      parts: [
        // 1. Secondary Motion: Coat Wing (Strict localOffset2D: [0, 0] safeguard)
        {
          id: 'coat_wing',
          jointId: 'coat_tail',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [-10, -14],
              [-14, -34],
              [-5, -32],
              [2, -10]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: -0.2 },
            stroke: { paint: { kind: 'palette', role: 'primary', shade: 0.1 }, width: 1.5 },
            opacity: 0.94,
            lit: true
          }
        },
        // 2. Secondary Motion: Coat Tatter (Cyber-Gothic 3-point tattered trench coat tail)
        {
          id: 'coat_tatter',
          jointId: 'coat_tail',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [-8, -16],
              [-12, -38],
              [-3, -35],
              [2, -12],
              [0, -6]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: -0.3 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: -0.1 }, width: 1.0 },
            opacity: 0.88,
            lit: true
          }
        },
        // 3. Secondary Motion: Hair Ribbon (Strict localOffset2D: [0, 0] safeguard)
        {
          id: 'hair_ribbon',
          jointId: 'hair_tie',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [-8, -10],
              [-11, -22],
              [-4, -20],
              [0, -5]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: 0.1 },
            opacity: 0.9,
            lit: false
          }
        },
        // 4. Cohesive Close-Up Silhouette: Abdomen Connector (closes pelvis-to-thigh gap by overlapping down to Y = -10)
        {
          id: 'abdomen_connector',
          jointId: 'pelvis',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [-10, 10],
              [10, 10],
              [8, -10],
              [-8, -10]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'secondary', shade: -0.35 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.1 }, width: 1.0 },
            opacity: 1,
            lit: true
          }
        },
        // 5. Cohesive Close-Up Silhouette: Neck Collar (torso-head bridge)
        {
          id: 'neck_collar',
          jointId: 'head',
          localOffset2D: [0, -8],
          shape: { kind: 'rect', size: [10, 12], rx: 3, ry: 3 },
          style: {
            fill: { kind: 'palette', role: 'secondary', shade: -0.3 },
            opacity: 1,
            lit: true
          }
        },
        // 6. Torso / Chassis
        {
          id: 'torso_body',
          jointId: 'torso',
          localOffset2D: [0, 8],
          shape: {
            kind: 'polygon',
            points: [
              [-10, -6],
              [10, -6],
              [12, 14],
              [-12, 14]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: -0.1 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.2 }, width: 1.2 },
            opacity: 1,
            lit: true
          }
        },
        // 7. Angular Shoulder Pauldron Left
        {
          id: 'pauldron_l',
          jointId: 'torso',
          localOffset2D: [-9, 17],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [-8, 4],
              [-6, -8],
              [2, -6]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: 0.2 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.3 }, width: 1.5 },
            opacity: 1,
            lit: true
          }
        },
        // 8. Angular Shoulder Pauldron Right
        {
          id: 'pauldron_r',
          jointId: 'torso',
          localOffset2D: [9, 17],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [8, 4],
              [6, -8],
              [-2, -6]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: 0.2 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.3 }, width: 1.5 },
            opacity: 1,
            lit: true
          }
        },
        // 9. Head / Cranium
        {
          id: 'head_cranium',
          jointId: 'head',
          localOffset2D: [2, 6],
          shape: {
            kind: 'polygon',
            points: [
              [-8, -6],
              [10, -6],
              [12, 6],
              [4, 12],
              [-8, 10]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'secondary', shade: 0.1 },
            opacity: 1,
            lit: true
          }
        },
        // 10. Visor / Optics (Sharp visor slit optics with ambient illumination glow)
        {
          id: 'head_visor',
          jointId: 'head',
          localOffset2D: [6, 6],
          shape: {
            kind: 'polygon',
            points: [
              [-4, -2],
              [8, -2],
              [10, 3],
              [-2, 3]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: 0.3 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.5 }, width: 1.5 },
            opacity: 0.98,
            lit: true
          }
        },
        // 10b. Eye Optic Core (Blinks via SceneCompositor ellipse ry scaling when id includes 'eye')
        {
          id: 'eye_optic_core',
          jointId: 'head',
          localOffset2D: [8.5, 6.5],
          shape: { kind: 'ellipse', radius: [3.5, 1.8] },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: 0.45 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.6 }, width: 1.0 },
            opacity: 0.98,
            lit: false
          }
        },
        // 10c. Facial Expression Morph (Driven by rig.morphTopology: mouthOpen, browRaise, blink)
        {
          id: 'facial_expression_morph',
          jointId: 'head',
          localOffset2D: [7.5, 2.2],
          shape: { kind: 'morph' },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: 0.4 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.7 }, width: 1.4 },
            opacity: 0.98,
            lit: false
          }
        },
        // 11. Left Thigh
        {
          id: 'leg_l_thigh',
          jointId: 'leg_l_upper',
          localOffset2D: [0, -11],
          shape: {
            kind: 'polygon',
            points: [
              [-4, 11],
              [4, 11],
              [3, -11],
              [-3, -11]
            ]
          },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.2 }, opacity: 1, lit: true }
        },
        // 12. Left Shin
        {
          id: 'leg_l_shin',
          jointId: 'leg_l_lower',
          localOffset2D: [0, -11],
          shape: { kind: 'rect', size: [6, 22], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0 }, opacity: 1, lit: true }
        },
        // Boot: sole sits exactly at the lower-leg joint tip (ankle) used by the contact analysis.
        {
          id: 'leg_l_foot',
          jointId: 'leg_l_lower',
          localOffset2D: [0, -22],
          shape: BIPED_BOOT_SHAPE,
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.35 }, opacity: 1, lit: true }
        },
        // 13. Left Knee Greave
        {
          id: 'leg_l_greave',
          jointId: 'leg_l_lower',
          localOffset2D: [2, -6],
          shape: {
            kind: 'polygon',
            points: [
              [0, 6],
              [4, 0],
              [0, -8],
              [-3, -2]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: 0.1 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.2 }, width: 1.0 },
            opacity: 0.95,
            lit: true
          }
        },
        // 14. Left Arm Bicep
        {
          id: 'arm_l_bicep',
          jointId: 'arm_l_upper',
          localOffset2D: [0, -9],
          shape: { kind: 'rect', size: [6, 18], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.1 }, opacity: 1, lit: true }
        },
        // 15. Left Arm Forearm (Tapered from elbow to wrist)
        {
          id: 'arm_l_forearm',
          jointId: 'arm_l_lower',
          localOffset2D: [0, -8],
          shape: {
            kind: 'polygon',
            points: [
              [-2.8, 8],
              [2.8, 8],
              [2.0, -8],
              [-2.0, -8]
            ]
          },
          style: { fill: { kind: 'palette', role: 'primary', shade: -0.2 }, opacity: 1, lit: true }
        },
        // 16. Left Hand Morph (open_rest, grasp_fist, point)
        {
          id: 'arm_l_hand_morph',
          jointId: 'arm_l_lower',
          localOffset2D: [0, -16],
          shape: { kind: 'morph' },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: 0.2 },
            stroke: { paint: { kind: 'palette', role: 'primary', shade: -0.2 }, width: 1.0 },
            opacity: 1,
            lit: true
          }
        },
        // 17. Right Thigh
        {
          id: 'leg_r_thigh',
          jointId: 'leg_r_upper',
          localOffset2D: [0, -11],
          shape: {
            kind: 'polygon',
            points: [
              [-4, 11],
              [4, 11],
              [3, -11],
              [-3, -11]
            ]
          },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.2 }, opacity: 1, lit: true }
        },
        // 18. Right Shin
        {
          id: 'leg_r_shin',
          jointId: 'leg_r_lower',
          localOffset2D: [0, -11],
          shape: { kind: 'rect', size: [6, 22], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0 }, opacity: 1, lit: true }
        },
        // Boot: sole sits exactly at the lower-leg joint tip (ankle) used by the contact analysis.
        {
          id: 'leg_r_foot',
          jointId: 'leg_r_lower',
          localOffset2D: [0, -22],
          shape: BIPED_BOOT_SHAPE,
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.35 }, opacity: 1, lit: true }
        },
        // 19. Right Knee Greave
        {
          id: 'leg_r_greave',
          jointId: 'leg_r_lower',
          localOffset2D: [2, -6],
          shape: {
            kind: 'polygon',
            points: [
              [0, 6],
              [4, 0],
              [0, -8],
              [-3, -2]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: 0.1 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.2 }, width: 1.0 },
            opacity: 0.95,
            lit: true
          }
        },
        // 20. Right Arm Bicep
        {
          id: 'arm_r_bicep',
          jointId: 'arm_r_upper',
          localOffset2D: [0, -9],
          shape: { kind: 'rect', size: [6, 18], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.1 }, opacity: 1, lit: true }
        },
        // 21. Right Arm Forearm (Tapered from elbow to wrist)
        {
          id: 'arm_r_forearm',
          jointId: 'arm_r_lower',
          localOffset2D: [0, -8],
          shape: {
            kind: 'polygon',
            points: [
              [-2.8, 8],
              [2.8, 8],
              [2.0, -8],
              [-2.0, -8]
            ]
          },
          style: { fill: { kind: 'palette', role: 'primary', shade: -0.2 }, opacity: 1, lit: true }
        },
        // 22. Right Hand Morph (open_rest, grasp_fist, point)
        {
          id: 'arm_r_hand_morph',
          jointId: 'arm_r_lower',
          localOffset2D: [0, -16],
          shape: { kind: 'morph' },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: 0.2 },
            stroke: { paint: { kind: 'palette', role: 'primary', shade: -0.2 }, width: 1.0 },
            opacity: 1,
            lit: true
          }
        }
      ],
      morphTopology: {
        baseSegments: baseMouthSegments,
        targets: CANONICAL_BIPED_MORPH_TARGETS
      },
      secondaryMotion: [
        {
          jointId: 'coat_tail',
          spring: { zeta: 0.35, omega: 17.59 },
          drive: 'audio.onsetStrength',
          gainDegrees: 10,
          maxDeflectionDeg: 14
        },
        {
          jointId: 'hair_tie',
          spring: { zeta: 0.3, omega: 21.99 },
          drive: 'audio.bands.bass',
          gainDegrees: 10,
          maxDeflectionDeg: 14
        }
      ],
      poseInterpolation: BipedPoseClips.sprint_frenzy,
      poseClips: BipedPoseClips,
      svgAsset: { idNamespace: instanceId }
    };
  }

  /**
   * Archetype 1B: Biped Frontal (0 deg direct-to-camera vocalist/monologue rig)
   * Features symmetrical torso/shoulders, dual blinking eyes (eye_l_optic_core, eye_r_optic_core),
   * and centered cranial facial_expression_morph for phoneme lip-sync.
   */
  public static buildBipedFrontal(options: ArchetypeBuildOptions): AssetRigContract {
    const base = ArchetypeFactory.buildBipedRunner(options);
    const frontalParts: RigPart[] = base.parts
      .filter(
        (p) =>
          p.id !== 'eye_optic_core' &&
          p.id !== 'facial_expression_morph' &&
          p.id !== 'coat_tatter'
      )
      .map((p) => {
        if (p.id === 'head_cranium') {
          return {
            ...p,
            localOffset2D: [0, 6],
            shape: {
              kind: 'polygon' as const,
              points: [
                [-9, -6],
                [9, -6],
                [10, 6],
                [5, 12],
                [-5, 12],
                [-10, 6]
              ]
            }
          };
        }
        if (p.id === 'head_visor') {
          return {
            ...p,
            localOffset2D: [0, 6.5],
            shape: {
              kind: 'polygon' as const,
              points: [
                [-8, -2],
                [8, -2],
                [9, 3],
                [-9, 3]
              ]
            }
          };
        }
        return p;
      });

    frontalParts.push(
      {
        id: 'eye_l_optic_core',
        jointId: 'head',
        localOffset2D: [-3.5, 6.5],
        shape: { kind: 'ellipse', radius: [2.2, 1.6] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: 0.45 },
          stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.6 }, width: 0.9 },
          opacity: 0.98,
          lit: false
        }
      },
      {
        id: 'eye_r_optic_core',
        jointId: 'head',
        localOffset2D: [3.5, 6.5],
        shape: { kind: 'ellipse', radius: [2.2, 1.6] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: 0.45 },
          stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.6 }, width: 0.9 },
          opacity: 0.98,
          lit: false
        }
      },
      {
        id: 'facial_expression_morph',
        jointId: 'head',
        localOffset2D: [0, 2.0],
        shape: { kind: 'morph' },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0.25 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0.35 }, width: 1.2 },
          opacity: 0.95,
          lit: false
        }
      }
    );

    return {
      ...base,
      name: `Biped Frontal (${options.instanceId})`,
      viewAngle: 'front',
      facingDirection: 'front',
      sockets: [...CANONICAL_BIPED_SOCKETS],
      parts: frontalParts,
      poseInterpolation: BipedPoseClips.pop_vocal_sway
    };
  }

  /**
   * Archetype 1C: Biped Three-Quarters (45 deg cinematic conversational/performance rig)
   * Balances depth foreshortening with clear dual-eye and mouth articulation.
   */
  public static buildBipedThreeQuarters(options: ArchetypeBuildOptions): AssetRigContract {
    const base = ArchetypeFactory.buildBipedRunner(options);
    const threeQuarterParts: RigPart[] = base.parts
      .filter(
        (p) =>
          p.id !== 'eye_optic_core' &&
          p.id !== 'facial_expression_morph' &&
          p.id !== 'coat_tatter'
      )
      .map((p) => {
        if (p.id === 'head_visor') {
          return {
            ...p,
            localOffset2D: [3.5, 6.5],
            shape: {
              kind: 'polygon' as const,
              points: [
                [-6, -2],
                [8, -2],
                [9, 3],
                [-5, 3]
              ]
            }
          };
        }
        return p;
      });

    threeQuarterParts.push(
      {
        id: 'eye_l_optic_core',
        jointId: 'head',
        localOffset2D: [1.2, 6.5],
        shape: { kind: 'ellipse', radius: [2.0, 1.6] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: 0.45 },
          stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.6 }, width: 0.9 },
          opacity: 0.98,
          lit: false
        }
      },
      {
        id: 'eye_r_optic_core',
        jointId: 'head',
        localOffset2D: [6.8, 6.5],
        shape: { kind: 'ellipse', radius: [1.7, 1.5] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: 0.45 },
          stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.6 }, width: 0.9 },
          opacity: 0.98,
          lit: false
        }
      },
      {
        id: 'facial_expression_morph',
        jointId: 'head',
        localOffset2D: [4.2, 2.1],
        shape: { kind: 'morph' },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0.25 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0.35 }, width: 1.2 },
          opacity: 0.95,
          lit: false
        }
      }
    );

    return {
      ...base,
      name: `Biped Three-Quarters (${options.instanceId})`,
      viewAngle: 'three_quarter',
      facingDirection: 'right',
      sockets: [...CANONICAL_BIPED_SOCKETS],
      parts: threeQuarterParts,
      poseInterpolation: BipedPoseClips.acoustic_strum
    };
  }

  /**
   * Archetype: Hero Silhouette (Lead Protagonist)
   * Enforces:
   * - 7.5 heads tall, slender, angular proportions.
   * - Split-tail coat, high-collared angular boots, forward-swept hair fringe.
   * - Sockets: CANONICAL_BIPED_SOCKETS.
   * - Total parts <= 24 drawables.
   */
  public static buildHeroSilhouette(options: ArchetypeBuildOptions): AssetRigContract {
    const base = ArchetypeFactory.buildBipedRunner(options);
    const s = options.spec.scale ?? 1.0;

    return {
      ...base,
      name: `Hero Silhouette (${options.instanceId})`,
      baseTransform: {
        position: [0, 75, 0],
        rotationZDegrees: 0,
        scale: [1.35 * s, 1.45 * s]
      },
      sockets: [...CANONICAL_BIPED_SOCKETS],
      morphTopology: {
        baseSegments: baseMouthSegments,
        targets: [
          ...CANONICAL_BIPED_MORPH_TARGETS,
          { name: 'grasp_fist', segments: baseMouthSegments },
          { name: 'point', segments: baseMouthSegments },
          { name: 'open_rest', segments: baseMouthSegments }
        ]
      },
      poseInterpolation: BipedPoseClips.acoustic_strum
    };
  }

  /**
   * Archetype: Companion Silhouette (Partner / Antagonist)
   * Enforces:
   * - 5.5 heads tall, broad, grounded proportions.
   * - Heavy mantle / shawl, chunky gauntlets, block boots with treaded base plate.
   * - Sockets: CANONICAL_BIPED_SOCKETS.
   * - Total parts <= 26 drawables.
   */
  public static buildCompanionSilhouette(options: ArchetypeBuildOptions): AssetRigContract {
    const base = ArchetypeFactory.buildBipedRunner(options);
    const s = options.spec.scale ?? 1.0;

    const companionParts: RigPart[] = base.parts
      .filter((p) => p.id !== 'eye_optic_core' && p.id !== 'facial_expression_morph')
      .map((p) => {
      // 1. Heavy draped cloak replacing coat_wing
      if (p.id === 'coat_wing') {
        return {
          ...p,
          id: 'heavy_cloak_drape',
          shape: {
            kind: 'polygon' as const,
            points: [
              [0, 0],
              [-11, -14],
              [-15, -36],
              [-4, -38],
              [4, -14]
            ]
          },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: -0.3 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: -0.2 }, width: 1.5 },
            opacity: 0.96,
            lit: true
          }
        };
      }
      // 2. Heavy mantle shawl replacing coat_tatter
      if (p.id === 'coat_tatter') {
        return {
          ...p,
          id: 'mantle_shawl',
          jointId: 'torso',
          localOffset2D: [0, 10],
          shape: {
            kind: 'polygon' as const,
            points: [
              [-16, -10],
              [16, -10],
              [18, 12],
              [-18, 12]
            ]
          },
          style: {
            fill: { kind: 'palette' as const, role: 'secondary' as const, shade: -0.1 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: 0.2 }, width: 1.4 },
            opacity: 0.98,
            lit: true
          }
        };
      }
      // 3. Folded cowl hood drape replacing hair_ribbon
      if (p.id === 'hair_ribbon') {
        return {
          ...p,
          id: 'cowl_hood_drape',
          jointId: 'head',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon' as const,
            points: [
              [0, 0],
              [-7, -8],
              [-9, -20],
              [-2, -18]
            ]
          },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: -0.2 },
            opacity: 0.95,
            lit: true
          }
        };
      }
      // 4. Textured hood / headwrap replacing head_cranium
      if (p.id === 'head_cranium') {
        return {
          ...p,
          id: 'hood_headwrap',
          shape: {
            kind: 'polygon' as const,
            points: [
              [-10, -6],
              [12, -6],
              [14, 8],
              [6, 14],
              [-10, 12]
            ]
          },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: -0.15 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: 0.1 }, width: 1.2 },
            opacity: 1,
            lit: true
          }
        };
      }
      // 5. Furrowed hood shadow replacing head_visor
      if (p.id === 'head_visor') {
        return {
          ...p,
          id: 'furrowed_hood_shadow',
          shape: {
            kind: 'polygon' as const,
            points: [
              [-6, -1],
              [8, -1],
              [10, 4],
              [-4, 4]
            ]
          },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: -0.5 },
            opacity: 0.85,
            lit: false
          }
        };
      }
      // 6. Broader rounded shoulders replacing pauldrons
      if (p.id === 'pauldron_l') {
        return {
          ...p,
          id: 'companion_pauldron_l',
          localOffset2D: [-12, 16],
          shape: { kind: 'ellipse' as const, radius: [10, 8] },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: 0.1 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: 0.2 }, width: 1.5 },
            opacity: 1,
            lit: true
          }
        };
      }
      if (p.id === 'pauldron_r') {
        return {
          ...p,
          id: 'companion_pauldron_r',
          localOffset2D: [12, 16],
          shape: { kind: 'ellipse' as const, radius: [10, 8] },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: 0.1 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: 0.2 }, width: 1.5 },
            opacity: 1,
            lit: true
          }
        };
      }
      // 7. Articulated gauntlet forearms and heavy clamps
      if (p.id === 'arm_l_forearm') {
        return {
          ...p,
          id: 'arm_l_gauntlet_forearm',
          shape: {
            kind: 'polygon' as const,
            points: [
              [-3.6, 8],
              [3.6, 8],
              [3.2, -8],
              [-3.2, -8]
            ]
          },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: -0.3 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: 0.2 }, width: 1.2 },
            opacity: 1,
            lit: true
          }
        };
      }
      if (p.id === 'arm_r_forearm') {
        return {
          ...p,
          id: 'arm_r_gauntlet_forearm',
          shape: {
            kind: 'polygon' as const,
            points: [
              [-3.6, 8],
              [3.6, 8],
              [3.2, -8],
              [-3.2, -8]
            ]
          },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: -0.3 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: 0.2 }, width: 1.2 },
            opacity: 1,
            lit: true
          }
        };
      }
      if (p.id === 'arm_l_hand_morph' || p.id === 'hand_l_grip') {
        return {
          ...p,
          id: 'hand_l_gauntlet_clamp',
          shape: { kind: 'morph' as const },
          style: {
            fill: { kind: 'palette' as const, role: 'secondary' as const, shade: -0.2 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: 0.3 }, width: 1.4 },
            opacity: 1,
            lit: true
          }
        };
      }
      if (p.id === 'arm_r_hand_morph' || p.id === 'hand_r_grip') {
        return {
          ...p,
          id: 'hand_r_gauntlet_clamp',
          shape: { kind: 'morph' as const },
          style: {
            fill: { kind: 'palette' as const, role: 'secondary' as const, shade: -0.2 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: 0.3 }, width: 1.4 },
            opacity: 1,
            lit: true
          }
        };
      }
      // 8. Heavy block boots with treaded base plate replacing leg feet
      if (p.id === 'leg_l_foot' || p.id === 'boot_l') {
        return {
          ...p,
          id: 'boot_tread_l',
          localOffset2D: [0, -22],
          shape: { kind: 'rect' as const, size: [18, 7], rx: 2, ry: 1 },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: -0.4 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: -0.2 }, width: 1.2 },
            opacity: 1,
            lit: true
          }
        };
      }
      if (p.id === 'leg_r_foot' || p.id === 'boot_r') {
        return {
          ...p,
          id: 'boot_tread_r',
          localOffset2D: [0, -22],
          shape: { kind: 'rect' as const, size: [18, 7], rx: 2, ry: 1 },
          style: {
            fill: { kind: 'palette' as const, role: 'primary' as const, shade: -0.4 },
            stroke: { paint: { kind: 'palette' as const, role: 'accent' as const, shade: -0.2 }, width: 1.2 },
            opacity: 1,
            lit: true
          }
        };
      }
      return p;
    });

    companionParts.push({
      id: 'companion_iris_optic',
      jointId: 'head',
      localOffset2D: [7.0, 5.5],
      shape: { kind: 'ellipse' as const, radius: [2.2, 2.2] },
      style: {
        fill: { kind: 'palette' as const, role: 'accent' as const, shade: 0.6 },
        opacity: 1.0,
        lit: false
      }
    });

    return {
      ...base,
      name: `Companion Silhouette (${options.instanceId})`,
      baseTransform: {
        position: [0, 65, 0],
        rotationZDegrees: 0,
        scale: [1.60 * s, 1.15 * s]
      },
      sockets: [...CANONICAL_BIPED_SOCKETS],
      parts: companionParts,
      morphTopology: {
        baseSegments: baseMouthSegments,
        targets: [
          ...CANONICAL_BIPED_MORPH_TARGETS,
          { name: 'grasp_fist', segments: baseMouthSegments },
          { name: 'point', segments: baseMouthSegments },
          { name: 'open_rest', segments: baseMouthSegments }
        ]
      },
      poseInterpolation: BipedPoseClips.pop_vocal_sway
    };
  }

  /**
   * Archetype 2: Quadruped Cyber Hound
   * Enforces:
   * - 14 joints.
   * - localOffset2D: [0, 0] on tail and ears.
   * - Backward knee flexion on rear legs [-140, 0].
   * - Total parts <= 32.
   */
  public static buildQuadrupedBeast(options: ArchetypeBuildOptions): AssetRigContract {
    const { instanceId, spec } = options;
    const s = spec.scale ?? 1.0;

    return {
      id: instanceId,
      name: `Quadruped Beast (${instanceId})`,
      type: 'character',
      facingDirection: 'right',
      renderMode: 'billboard',
      baseTransform: {
        position: [0, 50, 0],
        rotationZDegrees: 0,
        scale: [1.2 * s, 1.2 * s]
      },
      skeleton: {
        rootJointId: 'pelvis',
        joints: [
          { id: 'pelvis', parentId: null, localOffset2D: [0, 0], length: 14, rotationZDegrees: 0, constraintsDeg: [-25, 25] },
          { id: 'spine', parentId: 'pelvis', localOffset2D: [18, 4], length: 22, rotationZDegrees: 0, constraintsDeg: [-30, 30] },
          { id: 'chest', parentId: 'spine', localOffset2D: [20, 2], length: 18, rotationZDegrees: -5, constraintsDeg: [-30, 30] },
          { id: 'neck', parentId: 'chest', localOffset2D: [12, 10], length: 14, rotationZDegrees: 15, constraintsDeg: [-35, 35] },
          { id: 'head', parentId: 'neck', localOffset2D: [10, 6], length: 14, rotationZDegrees: -8, constraintsDeg: [-35, 35] },
          { id: 'tail_root', parentId: 'pelvis', localOffset2D: [-14, 2], length: 16, rotationZDegrees: -25, constraintsDeg: [-60, 40] },
          { id: 'tail_tip', parentId: 'tail_root', localOffset2D: [-14, -6], length: 16, rotationZDegrees: -15, constraintsDeg: [-45, 45] },
          { id: 'ear_l', parentId: 'head', localOffset2D: [-6, 8], length: 12, rotationZDegrees: -20, constraintsDeg: [-30, 30] },
          // Front Legs
          { id: 'leg_fl_upper', parentId: 'chest', localOffset2D: [8, -6], length: 18, rotationZDegrees: 20, constraintsDeg: [-60, 60] },
          { id: 'leg_fl_lower', parentId: 'leg_fl_upper', localOffset2D: [0, -18], length: 18, rotationZDegrees: -20, constraintsDeg: [-120, 0] },
          { id: 'leg_fr_upper', parentId: 'chest', localOffset2D: [14, -6], length: 18, rotationZDegrees: -20, constraintsDeg: [-60, 60] },
          { id: 'leg_fr_lower', parentId: 'leg_fr_upper', localOffset2D: [0, -18], length: 18, rotationZDegrees: -25, constraintsDeg: [-120, 0] },
          // Back Legs
          { id: 'leg_bl_upper', parentId: 'pelvis', localOffset2D: [-10, -6], length: 20, rotationZDegrees: 30, constraintsDeg: [-60, 60] },
          { id: 'leg_bl_lower', parentId: 'leg_bl_upper', localOffset2D: [0, -20], length: 20, rotationZDegrees: -35, constraintsDeg: [-140, 0] },
          { id: 'leg_br_upper', parentId: 'pelvis', localOffset2D: [-4, -6], length: 20, rotationZDegrees: -25, constraintsDeg: [-60, 60] },
          { id: 'leg_br_lower', parentId: 'leg_br_upper', localOffset2D: [0, -20], length: 20, rotationZDegrees: -45, constraintsDeg: [-140, 0] }
        ]
      },
      parts: [
        // 1. Chassis Body Plate
        {
          id: 'beast_chassis',
          jointId: 'spine',
          localOffset2D: [0, 0],
          shape: { kind: 'rect', size: [42, 22], rx: 8, ry: 8 },
          style: { fill: { kind: 'palette', role: 'primary', shade: -0.2 }, opacity: 1, lit: true }
        },
        // 2. Head / Muzzle
        {
          id: 'beast_head',
          jointId: 'head',
          localOffset2D: [4, 0],
          shape: {
            kind: 'polygon',
            points: [
              [-8, -6],
              [14, -4],
              [18, 4],
              [4, 10],
              [-8, 6]
            ]
          },
          style: { fill: { kind: 'palette', role: 'primary', shade: 0 }, opacity: 1, lit: true }
        },
        // 3. Optics Visor
        {
          id: 'beast_visor',
          jointId: 'head',
          localOffset2D: [6, 2],
          shape: { kind: 'rect', size: [10, 4], rx: 2, ry: 2 },
          style: { fill: { kind: 'palette', role: 'accent', shade: 0.1 }, opacity: 0.95, lit: true }
        },
        // 4. Ear (localOffset2D: [0, 0] safeguard)
        {
          id: 'beast_ear',
          jointId: 'ear_l',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [-10, 14],
              [-2, 6]
            ]
          },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0.1 }, opacity: 0.9, lit: true }
        },
        // 5. Tail (localOffset2D: [0, 0] safeguard)
        {
          id: 'beast_tail',
          jointId: 'tail_root',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [-20, -4],
              [-16, -10],
              [0, -4]
            ]
          },
          style: { fill: { kind: 'palette', role: 'accent', shade: -0.2 }, opacity: 0.9, lit: true }
        },
        // 6-9. Front Legs
        {
          id: 'beast_fl_thigh',
          jointId: 'leg_fl_upper',
          localOffset2D: [0, -9],
          shape: { kind: 'rect', size: [7, 20], rx: 3.5, ry: 3.5 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.1 }, opacity: 1, lit: true }
        },
        {
          id: 'beast_fl_shin',
          jointId: 'leg_fl_lower',
          localOffset2D: [0, -9],
          shape: { kind: 'rect', size: [5, 18], rx: 2.5, ry: 2.5 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0.1 }, opacity: 1, lit: true }
        },
        // Cybernetic paw: sole sits at the lower-leg joint tip
        {
          id: 'beast_fl_paw',
          jointId: 'leg_fl_lower',
          localOffset2D: [0, -18],
          shape: QUADRUPED_PAW_SHAPE,
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.3 }, opacity: 1, lit: true }
        },
        {
          id: 'beast_fr_thigh',
          jointId: 'leg_fr_upper',
          localOffset2D: [0, -9],
          shape: { kind: 'rect', size: [7, 20], rx: 3.5, ry: 3.5 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.1 }, opacity: 1, lit: true }
        },
        {
          id: 'beast_fr_shin',
          jointId: 'leg_fr_lower',
          localOffset2D: [0, -9],
          shape: { kind: 'rect', size: [5, 18], rx: 2.5, ry: 2.5 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0.1 }, opacity: 1, lit: true }
        },
        // Cybernetic paw: sole sits at the lower-leg joint tip
        {
          id: 'beast_fr_paw',
          jointId: 'leg_fr_lower',
          localOffset2D: [0, -18],
          shape: QUADRUPED_PAW_SHAPE,
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.3 }, opacity: 1, lit: true }
        },
        // 10-13. Back Legs
        {
          id: 'beast_bl_thigh',
          jointId: 'leg_bl_upper',
          localOffset2D: [0, -10],
          shape: { kind: 'rect', size: [8, 22], rx: 4, ry: 4 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.2 }, opacity: 1, lit: true }
        },
        {
          id: 'beast_bl_shin',
          jointId: 'leg_bl_lower',
          localOffset2D: [0, -10],
          shape: { kind: 'rect', size: [6, 20], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0 }, opacity: 1, lit: true }
        },
        // Cybernetic paw: sole sits at the lower-leg joint tip
        {
          id: 'beast_bl_paw',
          jointId: 'leg_bl_lower',
          localOffset2D: [0, -20],
          shape: QUADRUPED_PAW_SHAPE,
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.3 }, opacity: 1, lit: true }
        },
        {
          id: 'beast_br_thigh',
          jointId: 'leg_br_upper',
          localOffset2D: [0, -10],
          shape: { kind: 'rect', size: [8, 22], rx: 4, ry: 4 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.2 }, opacity: 1, lit: true }
        },
        {
          id: 'beast_br_shin',
          jointId: 'leg_br_lower',
          localOffset2D: [0, -10],
          shape: { kind: 'rect', size: [6, 20], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0 }, opacity: 1, lit: true }
        },
        // Cybernetic paw: sole sits at the lower-leg joint tip
        {
          id: 'beast_br_paw',
          jointId: 'leg_br_lower',
          localOffset2D: [0, -20],
          shape: QUADRUPED_PAW_SHAPE,
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.3 }, opacity: 1, lit: true }
        }
      ],
      poseInterpolation: QuadrupedPoseClips.beast_gallop,
      poseClips: {
        beast_gallop: QuadrupedPoseClips.beast_gallop,
        beast_idle: QuadrupedPoseClips.beast_idle
      },
      secondaryMotion: [
        {
          jointId: 'tail_root',
          spring: { zeta: 0.32, omega: 15.71 },
          drive: 'audio.onsetStrength',
          gainDegrees: 24,
          maxDeflectionDeg: 30
        },
        {
          jointId: 'ear_l',
          spring: { zeta: 0.4, omega: 23.88 },
          drive: 'audio.bands.bass',
          gainDegrees: 16,
          maxDeflectionDeg: 20
        }
      ],
      svgAsset: { idNamespace: instanceId }
    };
  }

  /**
   * Archetype 3: Aerial Pursuit Drone
   * Enforces:
   * - 6 joints (chassis_core, thrusters, turret, stabilizer wings).
   * - Total parts <= 16.
   */
  public static buildAerialDrone(options: ArchetypeBuildOptions): AssetRigContract {
    const { instanceId, spec } = options;
    const s = spec.scale ?? 1.0;

    return {
      id: instanceId,
      name: `Aerial Drone (${instanceId})`,
      type: 'character',
      facingDirection: 'right',
      renderMode: 'billboard',
      baseTransform: {
        position: [-100, 180, -40],
        rotationZDegrees: 0,
        scale: [1.1 * s, 1.1 * s]
      },
      skeleton: {
        rootJointId: 'chassis_core',
        joints: [
          { id: 'chassis_core', parentId: null, localOffset2D: [0, 0], length: 12, rotationZDegrees: 0, constraintsDeg: [-45, 45] },
          { id: 'left_thruster', parentId: 'chassis_core', localOffset2D: [-28, 6], length: 14, rotationZDegrees: 12, constraintsDeg: [-45, 60] },
          { id: 'right_thruster', parentId: 'chassis_core', localOffset2D: [28, 6], length: 14, rotationZDegrees: -12, constraintsDeg: [-60, 45] },
          { id: 'scanner_turret', parentId: 'chassis_core', localOffset2D: [0, -14], length: 10, rotationZDegrees: 0, constraintsDeg: [-60, 60] },
          { id: 'wing_l', parentId: 'chassis_core', localOffset2D: [-24, 4], length: 16, rotationZDegrees: 8, constraintsDeg: [-35, 35] },
          { id: 'wing_r', parentId: 'chassis_core', localOffset2D: [24, 4], length: 16, rotationZDegrees: -8, constraintsDeg: [-35, 35] }
        ]
      },
      parts: [
        {
          id: 'drone_hull',
          jointId: 'chassis_core',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [-24, -8],
              [24, -8],
              [32, 4],
              [16, 16],
              [-16, 16],
              [-32, 4]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: -0.2 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0 }, width: 2 },
            opacity: 1,
            lit: true
          }
        },
        {
          id: 'drone_visor',
          jointId: 'chassis_core',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [-14, -4],
              [14, -4],
              [18, 2],
              [-18, 2]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: 0.2 },
            opacity: 0.95,
            lit: true
          }
        },
        {
          id: 'drone_thruster_l',
          jointId: 'left_thruster',
          localOffset2D: [0, -6],
          shape: { kind: 'rect', size: [8, 16], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.3 }, opacity: 1, lit: true }
        },
        {
          id: 'drone_thruster_r',
          jointId: 'right_thruster',
          localOffset2D: [0, -6],
          shape: { kind: 'rect', size: [8, 16], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.3 }, opacity: 1, lit: true }
        },
        {
          id: 'drone_wing_l',
          jointId: 'wing_l',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [-18, 6],
              [-14, -4],
              [0, -2]
            ]
          },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0.15 }, opacity: 0.92, lit: true }
        },
        {
          id: 'drone_wing_r',
          jointId: 'wing_r',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [18, 6],
              [14, -4],
              [0, -2]
            ]
          },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0.15 }, opacity: 0.92, lit: true }
        },
        {
          id: 'drone_searchlight',
          jointId: 'scanner_turret',
          localOffset2D: [0, -10],
          shape: { kind: 'ellipse', radius: [6, 6] },
          style: { fill: { kind: 'palette', role: 'accent', shade: 0.4 }, opacity: 0.9, lit: true }
        }
      ],
      secondaryMotion: [
        {
          jointId: 'wing_l',
          spring: { zeta: 0.38, omega: 20.11 },
          drive: 'audio.bands.bass',
          gainDegrees: 15,
          maxDeflectionDeg: 18
        },
        {
          jointId: 'wing_r',
          spring: { zeta: 0.38, omega: 20.11 },
          drive: 'audio.bands.bass',
          gainDegrees: -15,
          maxDeflectionDeg: 18
        }
      ],
      svgAsset: { idNamespace: instanceId }
    };
  }
}
