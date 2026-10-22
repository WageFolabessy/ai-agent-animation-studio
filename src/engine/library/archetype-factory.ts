import type {
  AssetRigContract,
  NormalizedCubicBezierSegment,
  PoseInterpolationContract
} from '../../schemas/rig.contract.js';
import type { ArchetypeBuildOptions } from './types.js';
import {
  generateBipedLocomotionClip,
  generateQuadrupedGallopClip
} from '../rigging/ik-leg-solver.js';

const baseMouthSegments: NormalizedCubicBezierSegment[] = [
  { p0: [-3.5, 0], p1: [-1.8, 0.45], p2: [1.8, 0.45], p3: [3.5, 0] },
  { p0: [3.5, 0], p1: [1.8, -0.45], p2: [-1.8, -0.45], p3: [-3.5, 0] }
];

const mouthOpenSegments: NormalizedCubicBezierSegment[] = [
  { p0: [-3.8, 0.2], p1: [-1.8, 1.8], p2: [1.8, 1.8], p3: [3.8, 0.2] },
  { p0: [3.8, 0.2], p1: [1.8, -2.4], p2: [-1.8, -2.4], p3: [-3.8, 0.2] }
];

const browRaiseSegments: NormalizedCubicBezierSegment[] = [
  { p0: [-3.6, 0.3], p1: [-1.8, 1.0], p2: [1.8, 1.0], p3: [3.6, 0.3] },
  { p0: [3.6, 0.3], p1: [1.8, -0.3], p2: [-1.8, -0.3], p3: [-3.6, 0.3] }
];

const blinkSegments: NormalizedCubicBezierSegment[] = [
  { p0: [-3.5, 0], p1: [-1.5, 0.15], p2: [1.5, 0.15], p3: [3.5, 0] },
  { p0: [3.5, 0], p1: [1.5, -0.15], p2: [-1.5, -0.15], p3: [-3.5, 0] }
];

export const BipedPoseClips: Record<string, PoseInterpolationContract> = {
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
    coatDeg0: -20,
    coatAmp: -2
  }),
  sprint_frenzy: generateBipedLocomotionClip({
    loopFrames: 18,
    stanceFrames: 8,
    strideLengthUnits: 68.0,
    groundY: -41.0,
    swingLift: 12.0,
    pelvisY0: 4,
    pelvisBobAmp: 4.0,
    torsoDeg0: -18,
    torsoAmp: 0,
    headDeg0: 6,
    headAmp: 0,
    armUpperMid: 2.5,
    armUpperAmp: 42.5,
    armLowerMid: 75,
    armLowerAmp: 10,
    coatDeg0: -45,
    coatAmp: 5
  }),
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
  })
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

export class ArchetypeFactory {
  public static build(options: ArchetypeBuildOptions): AssetRigContract {
    const { archetypeId } = options.spec;
    switch (archetypeId) {
      case 'biped_runner':
        return ArchetypeFactory.buildBipedRunner(options);
      case 'quadruped_beast':
        return ArchetypeFactory.buildQuadrupedBeast(options);
      case 'aerial_drone':
        return ArchetypeFactory.buildAerialDrone(options);
      default:
        return ArchetypeFactory.buildBipedRunner(options);
    }
  }

  /**
   * Archetype 1: Biped Humanoid Runner
   * Enforces:
   * - Backward knee flexion constraints [-140, 0].
   * - localOffset2D: [0, 0] on secondary motion parts (coat_wing, hair_ribbon).
   * - Cohesive close-up silhouette: neck_collar and abdomen_connector.
   * - Total parts <= 28.
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
            constraintsDeg: [-120, 120]
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
            constraintsDeg: [-120, 120]
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
            rotationZDegrees: -28,
            length: 26,
            constraintsDeg: [-85, 20]
          },
          {
            id: 'hair_tie',
            parentId: 'head',
            localOffset2D: [-10, 8],
            rotationZDegrees: -22,
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
              [-32, -8],
              [-28, -26],
              [-12, -18],
              [0, -4]
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
              [-18, -12],
              [-34, -20],
              [-24, -30],
              [-8, -16],
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
              [-24, -6],
              [-20, -16],
              [-6, -10],
              [0, -2]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: 0.1 },
            opacity: 0.9,
            lit: false
          }
        },
        // 4. Cohesive Close-Up Silhouette: Abdomen Connector (pelvis-torso bridge)
        {
          id: 'abdomen_connector',
          jointId: 'torso',
          localOffset2D: [0, -6],
          shape: { kind: 'rect', size: [14, 16], rx: 4, ry: 4 },
          style: {
            fill: { kind: 'palette', role: 'secondary', shade: -0.4 },
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
        // 15. Left Arm Forearm
        {
          id: 'arm_l_forearm',
          jointId: 'arm_l_lower',
          localOffset2D: [0, -8],
          shape: { kind: 'rect', size: [5, 16], rx: 2.5, ry: 2.5 },
          style: { fill: { kind: 'palette', role: 'primary', shade: -0.2 }, opacity: 1, lit: true }
        },
        // 16. Left Forearm Gauntlet
        {
          id: 'arm_l_gauntlet',
          jointId: 'arm_l_lower',
          localOffset2D: [1, -8],
          shape: {
            kind: 'polygon',
            points: [
              [-2, 6],
              [4, 4],
              [3, -6],
              [-3, -6]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: 0.2 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.1 }, width: 1.0 },
            opacity: 0.95,
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
        // 21. Right Arm Forearm
        {
          id: 'arm_r_forearm',
          jointId: 'arm_r_lower',
          localOffset2D: [0, -8],
          shape: { kind: 'rect', size: [5, 16], rx: 2.5, ry: 2.5 },
          style: { fill: { kind: 'palette', role: 'primary', shade: -0.2 }, opacity: 1, lit: true }
        },
        // 22. Right Forearm Gauntlet
        {
          id: 'arm_r_gauntlet',
          jointId: 'arm_r_lower',
          localOffset2D: [1, -8],
          shape: {
            kind: 'polygon',
            points: [
              [-2, 6],
              [4, 4],
              [3, -6],
              [-3, -6]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: 0.2 },
            stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.1 }, width: 1.0 },
            opacity: 0.95,
            lit: true
          }
        }
      ],
      morphTopology: {
        baseSegments: baseMouthSegments,
        targets: [
          { name: 'mouthOpen', segments: mouthOpenSegments },
          { name: 'browRaise', segments: browRaiseSegments },
          { name: 'blink', segments: blinkSegments }
        ]
      },
      secondaryMotion: [],
      poseInterpolation: BipedPoseClips.sprint_frenzy,
      poseClips: BipedPoseClips,
      svgAsset: { idNamespace: instanceId }
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
        }
      ],
      poseInterpolation: QuadrupedPoseClips.beast_gallop,
      poseClips: {
        beast_gallop: QuadrupedPoseClips.beast_gallop,
        beast_idle: QuadrupedPoseClips.beast_idle
      },
      secondaryMotion: [],
      svgAsset: { idNamespace: instanceId }
    };
  }

  /**
   * Archetype 3: Aerial Pursuit Drone
   * Enforces:
   * - 5 joints (chassis_core, thrusters, turret, antenna).
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
          { id: 'scanner_turret', parentId: 'chassis_core', localOffset2D: [0, -14], length: 10, rotationZDegrees: 0, constraintsDeg: [-60, 60] }
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
          id: 'drone_searchlight',
          jointId: 'scanner_turret',
          localOffset2D: [0, -10],
          shape: { kind: 'ellipse', radius: [6, 6] },
          style: { fill: { kind: 'palette', role: 'accent', shade: 0.4 }, opacity: 0.9, lit: true }
        }
      ],
      secondaryMotion: [],
      svgAsset: { idNamespace: instanceId }
    };
  }
}
