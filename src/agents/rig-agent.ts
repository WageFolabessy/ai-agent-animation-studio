import { z } from 'zod';
import {
  AssetRigContractSchema,
  type AssetRigContract,
  type NormalizedCubicBezierSegment
} from '../schemas/rig.contract.js';
import type { LlmProvider, RigAgentInput } from './types.js';
import { CANONICAL_RIG_IDS, formatRepairFeedbackPrompt } from './director-agent.js';

export const RigCatalogContractSchema = z
  .object({
    rigs: z.array(AssetRigContractSchema).min(1)
  })
  .strict();
export type RigCatalogContract = z.infer<typeof RigCatalogContractSchema>;

const baseMouthSegments: NormalizedCubicBezierSegment[] = [
  { p0: [-6, 0], p1: [-3, 1.5], p2: [3, 1.5], p3: [6, 0] },
  { p0: [6, 0], p1: [3, -1.5], p2: [-3, -1.5], p3: [-6, 0] }
];

const mouthOpenSegments: NormalizedCubicBezierSegment[] = [
  { p0: [-6, 1], p1: [-3, 5.5], p2: [3, 5.5], p3: [6, 1] },
  { p0: [6, 1], p1: [3, -6.5], p2: [-3, -6.5], p3: [-6, 1] }
];

const browRaiseSegments: NormalizedCubicBezierSegment[] = [
  { p0: [-7, 2], p1: [-3, 4], p2: [3, 4], p3: [7, 2] },
  { p0: [7, 2], p1: [3, 0], p2: [-3, 0], p3: [-7, 2] }
];

const blinkSegments: NormalizedCubicBezierSegment[] = [
  { p0: [-6, 0], p1: [-2, 0.2], p2: [2, 0.2], p3: [6, 0] },
  { p0: [6, 0], p1: [2, -0.2], p2: [-2, -0.2], p3: [-6, 0] }
];

/**
 * Builds the deterministic, schema-valid catalog of AssetRigContracts:
 * - Separates stationary factory chimney smoke ("rig-smoke-chimney") from the
 *   runner's kinetic trail ("rig-runner-aura").
 * - Configures "rig-runner" with explicit `facingDirection: "right"`, forward-leaning
 *   sprint posture, right-offset visor/optics, and anatomical backward knee flexion
 *   (`constraintsDeg: [-140, 0]`) to eliminate the moonwalk illusion.
 */
export function buildDeterministicRigCatalog(): RigCatalogContract {
  const skylineRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.SKYLINE,
    name: 'Cybernetic Megacity Distant Skyline',
    type: 'parallax_background',
    renderMode: 'planar',
    baseTransform: {
      position: [0, 200, -900],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    parts: [
      {
        id: 'sky_tower_far_left',
        jointId: null,
        localOffset2D: [-400, 0],
        shape: { kind: 'rect', size: [160, 320] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.2 },
          opacity: 0.85,
          lit: false
        }
      },
      {
        id: 'sky_tower_left',
        jointId: null,
        localOffset2D: [-200, 0],
        shape: { kind: 'rect', size: [140, 420] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.1 },
          opacity: 0.85,
          lit: false
        }
      },
      {
        id: 'sky_spire_center',
        jointId: null,
        localOffset2D: [50, 0],
        shape: { kind: 'rect', size: [180, 480] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.3 },
          opacity: 0.85,
          lit: false
        }
      },
      {
        id: 'sky_tower_right',
        jointId: null,
        localOffset2D: [300, 0],
        shape: { kind: 'rect', size: [150, 360] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.15 },
          opacity: 0.85,
          lit: false
        }
      },
      {
        id: 'sky_neon_beacon_strip',
        jointId: null,
        localOffset2D: [50, 260],
        shape: {
          kind: 'polygon',
          points: [
            [-8, 0],
            [0, 80],
            [8, 0]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0.1 },
          opacity: 0.9,
          lit: false
        }
      }
    ],
    secondaryMotion: [],
    svgAsset: { idNamespace: 'skyline' }
  };

  const factoryRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.FACTORIES,
    name: 'Industrial Refinery & Smokestacks Midground',
    type: 'parallax_midground',
    renderMode: 'planar',
    baseTransform: {
      position: [0, 150, -400],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    parts: [
      {
        id: 'factory_left_hull',
        jointId: null,
        localOffset2D: [-250, -40],
        shape: { kind: 'rect', size: [220, 160] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0.1 },
          opacity: 0.95,
          lit: true
        }
      },
      {
        id: 'factory_chimney_stack_1',
        jointId: null,
        localOffset2D: [-150, 80],
        shape: { kind: 'rect', size: [32, 140] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0.2 },
          opacity: 0.95,
          lit: true
        }
      },
      {
        id: 'factory_chimney_rim',
        jointId: null,
        localOffset2D: [-150, 150],
        shape: { kind: 'rect', size: [42, 14] },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0 },
          opacity: 1.0,
          lit: false
        }
      },
      {
        id: 'factory_right_reactor',
        jointId: null,
        localOffset2D: [200, -20],
        shape: { kind: 'rect', size: [280, 200] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0.05 },
          opacity: 0.95,
          lit: true
        }
      }
    ],
    secondaryMotion: [],
    svgAsset: { idNamespace: 'factory' }
  };

  const foregroundPipesRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.FG_PIPES,
    name: 'Foreground Industrial Gantry & Conduits',
    type: 'parallax_foreground',
    renderMode: 'planar',
    baseTransform: {
      position: [0, 0, 320],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    parts: [
      {
        id: 'fg_top_beam',
        jointId: null,
        localOffset2D: [0, 185],
        shape: { kind: 'rect', size: [960, 20] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0.15 },
          opacity: 0.92,
          lit: true
        }
      },
      {
        id: 'fg_vertical_pilar_left',
        jointId: null,
        localOffset2D: [-210, 92],
        shape: { kind: 'rect', size: [24, 185] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0.05 },
          opacity: 0.92,
          lit: true
        }
      }
    ],
    secondaryMotion: [],
    svgAsset: { idNamespace: 'fgpipes' }
  };

  const chimneySmokeRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.SMOKE_CHIMNEY,
    name: 'Stationary Factory Smokestack Plume Emitter',
    type: 'particle_emitter',
    renderMode: 'planar',
    baseTransform: {
      position: [-150, 220, -380],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    parts: [],
    emitter: {
      seed: 421337,
      maxParticles: 60,
      ratePerSecond: 9,
      lifetimeFrames: 36,
      spawn: { kind: 'disc', radius: 10 },
      velocity: {
        angleDegrees: 82,
        spreadDegrees: 30,
        speedMin: 18,
        speedMax: 36
      },
      gravity: [4, -4],
      radiusRange: [4, 14],
      paintRole: 'accent',
      baseOpacity: 0.55,
      audio: {
        onsetBurstCount: 3,
        rateBand: 'bass',
        rateGain: 1.2
      }
    },
    secondaryMotion: [],
    svgAsset: { idNamespace: 'smoke_chimney' }
  };

  const runnerAuraRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.RUNNER_AURA,
    name: 'Runner Kinetic Cybernetic Trail Emitter',
    type: 'particle_emitter',
    renderMode: 'planar',
    baseTransform: {
      position: [-50, 95, -10],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    parts: [],
    emitter: {
      seed: 900210,
      maxParticles: 50,
      ratePerSecond: 8,
      lifetimeFrames: 20,
      spawn: { kind: 'disc', radius: 5 },
      velocity: {
        angleDegrees: 170,
        spreadDegrees: 35,
        speedMin: 20,
        speedMax: 42
      },
      gravity: [-36, 4],
      radiusRange: [2.5, 7],
      paintRole: 'primary',
      baseOpacity: 0.55,
      audio: {
        onsetBurstCount: 3,
        rateBand: 'presence',
        rateGain: 1.2
      }
    },
    secondaryMotion: [],
    svgAsset: { idNamespace: 'runner_aura' }
  };

  const runnerRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.RUNNER,
    name: 'Cybernetic Sprint Runner (Right-Facing +X)',
    type: 'character',
    facingDirection: 'right',
    renderMode: 'billboard',
    baseTransform: {
      position: [0, 75, -60],
      rotationZDegrees: 0,
      scale: [1.35, 1.35]
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
          constraintsDeg: [-140, 0]
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
          constraintsDeg: [-140, 0]
        },
        {
          id: 'coat_tail',
          parentId: 'torso',
          localOffset2D: [-12, 2],
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
      {
        id: 'coat_wing',
        jointId: 'coat_tail',
        localOffset2D: [-14, -10],
        shape: {
          kind: 'polygon',
          points: [
            [4, 8],
            [-32, -8],
            [-26, -24],
            [6, -4]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: -0.2 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0.1 }, width: 1.5 },
          opacity: 0.94,
          lit: true
        }
      },
      {
        id: 'leg_l_thigh',
        jointId: 'leg_l_upper',
        localOffset2D: [0, -11],
        shape: { kind: 'rect', size: [9, 22] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.2 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'leg_l_shin',
        jointId: 'leg_l_lower',
        localOffset2D: [0, -11],
        shape: { kind: 'rect', size: [7, 22] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: -0.25 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'arm_l_bicep',
        jointId: 'arm_l_upper',
        localOffset2D: [0, -9],
        shape: { kind: 'rect', size: [7, 18] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.15 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'arm_l_forearm',
        jointId: 'arm_l_lower',
        localOffset2D: [0, -8],
        shape: { kind: 'rect', size: [6, 16] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: -0.1 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'pelvis_core',
        jointId: 'pelvis',
        localOffset2D: [0, 0],
        shape: { kind: 'rect', size: [18, 12] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'chest_armor',
        jointId: 'torso',
        localOffset2D: [1, 8],
        shape: {
          kind: 'polygon',
          points: [
            [-11, -12],
            [13, -12],
            [17, 14],
            [-13, 14]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0.1 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0.2 }, width: 1.8 },
          opacity: 1,
          lit: true
        }
      },
      {
        id: 'hair_ribbon',
        jointId: 'hair_tie',
        localOffset2D: [-10, -2],
        shape: {
          kind: 'polygon',
          points: [
            [2, 3],
            [-22, 6],
            [-18, -5],
            [2, -2]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0.2 },
          opacity: 0.95,
          lit: false
        }
      },
      {
        id: 'cranium',
        jointId: 'head',
        localOffset2D: [1, 8],
        shape: {
          kind: 'polygon',
          points: [
            [-11, -10],
            [13, -10],
            [16, 4],
            [10, 14],
            [-12, 13]
          ]
        },
        style: {
          fill: { kind: 'solid', color: '#1b2234' },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0.1 }, width: 1.5 },
          opacity: 1,
          lit: true
        }
      },
      {
        id: 'visor_glow',
        jointId: 'head',
        localOffset2D: [5, 9],
        shape: { kind: 'rect', size: [16, 6] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: 0.35 },
          opacity: 0.95,
          lit: false
        }
      },
      {
        id: 'eye_l',
        jointId: 'head',
        localOffset2D: [1, 9],
        shape: { kind: 'ellipse', radius: [2.2, 2.2] },
        style: {
          fill: { kind: 'solid', color: '#ffffff' },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'eye_r',
        jointId: 'head',
        localOffset2D: [8, 9],
        shape: { kind: 'ellipse', radius: [2.2, 2.2] },
        style: {
          fill: { kind: 'solid', color: '#ffffff' },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'mouth_expressive',
        jointId: 'head',
        localOffset2D: [4, 2],
        shape: { kind: 'morph' },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0.25 },
          stroke: { paint: { kind: 'solid', color: '#ffffff' }, width: 1 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'leg_r_thigh',
        jointId: 'leg_r_upper',
        localOffset2D: [0, -11],
        shape: { kind: 'rect', size: [9, 22] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0.05 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'leg_r_shin',
        jointId: 'leg_r_lower',
        localOffset2D: [0, -11],
        shape: { kind: 'rect', size: [7, 22] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: 0.05 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'arm_r_bicep',
        jointId: 'arm_r_upper',
        localOffset2D: [0, -9],
        shape: { kind: 'rect', size: [7, 18] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0.15 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'arm_r_forearm',
        jointId: 'arm_r_lower',
        localOffset2D: [0, -8],
        shape: { kind: 'rect', size: [6, 16] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: 0.2 },
          opacity: 1,
          lit: false
        }
      }
    ],
    secondaryMotion: [
      {
        jointId: 'coat_tail',
        spring: { zeta: 0.42, omega: 16 },
        drive: 'audio.bands.bass',
        gainDegrees: 22
      },
      {
        jointId: 'hair_tie',
        spring: { zeta: 0.35, omega: 20 },
        drive: 'audio.onsetStrength',
        gainDegrees: 26
      }
    ],
    poseInterpolation: {
      interpolationMode: 'cubic_spline',
      loopFrames: 24,
      keyframes: [
        {
          frame: 0,
          jointTransforms: [
            { jointId: 'pelvis', rotationZDegrees: 3, localOffset2D: [0, 2] },
            { jointId: 'torso', rotationZDegrees: -10 },
            { jointId: 'head', rotationZDegrees: 6 },
            { jointId: 'leg_l_upper', rotationZDegrees: 38 },
            { jointId: 'leg_l_lower', rotationZDegrees: -18 },
            { jointId: 'leg_r_upper', rotationZDegrees: -34 },
            { jointId: 'leg_r_lower', rotationZDegrees: -62 },
            { jointId: 'arm_l_upper', rotationZDegrees: -36 },
            { jointId: 'arm_l_lower', rotationZDegrees: 30 },
            { jointId: 'arm_r_upper', rotationZDegrees: 36 },
            { jointId: 'arm_r_lower', rotationZDegrees: 52 }
          ]
        },
        {
          frame: 6,
          jointTransforms: [
            { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, -3] },
            { jointId: 'torso', rotationZDegrees: -12 },
            { jointId: 'head', rotationZDegrees: 7 },
            { jointId: 'leg_l_upper', rotationZDegrees: 2 },
            { jointId: 'leg_l_lower', rotationZDegrees: -14 },
            { jointId: 'leg_r_upper', rotationZDegrees: 12 },
            { jointId: 'leg_r_lower', rotationZDegrees: -78 },
            { jointId: 'arm_l_upper', rotationZDegrees: 0 },
            { jointId: 'arm_l_lower', rotationZDegrees: 42 },
            { jointId: 'arm_r_upper', rotationZDegrees: 0 },
            { jointId: 'arm_r_lower', rotationZDegrees: 42 }
          ]
        },
        {
          frame: 12,
          jointTransforms: [
            { jointId: 'pelvis', rotationZDegrees: -3, localOffset2D: [0, 2] },
            { jointId: 'torso', rotationZDegrees: -10 },
            { jointId: 'head', rotationZDegrees: 6 },
            { jointId: 'leg_l_upper', rotationZDegrees: -34 },
            { jointId: 'leg_l_lower', rotationZDegrees: -62 },
            { jointId: 'leg_r_upper', rotationZDegrees: 38 },
            { jointId: 'leg_r_lower', rotationZDegrees: -18 },
            { jointId: 'arm_l_upper', rotationZDegrees: 36 },
            { jointId: 'arm_l_lower', rotationZDegrees: 52 },
            { jointId: 'arm_r_upper', rotationZDegrees: -36 },
            { jointId: 'arm_r_lower', rotationZDegrees: 30 }
          ]
        },
        {
          frame: 18,
          jointTransforms: [
            { jointId: 'pelvis', rotationZDegrees: 0, localOffset2D: [0, -3] },
            { jointId: 'torso', rotationZDegrees: -12 },
            { jointId: 'head', rotationZDegrees: 7 },
            { jointId: 'leg_l_upper', rotationZDegrees: 12 },
            { jointId: 'leg_l_lower', rotationZDegrees: -78 },
            { jointId: 'leg_r_upper', rotationZDegrees: 2 },
            { jointId: 'leg_r_lower', rotationZDegrees: -14 },
            { jointId: 'arm_l_upper', rotationZDegrees: 0 },
            { jointId: 'arm_l_lower', rotationZDegrees: 42 },
            { jointId: 'arm_r_upper', rotationZDegrees: 0 },
            { jointId: 'arm_r_lower', rotationZDegrees: 42 }
          ]
        },
        {
          frame: 24,
          jointTransforms: [
            { jointId: 'pelvis', rotationZDegrees: 3, localOffset2D: [0, 2] },
            { jointId: 'torso', rotationZDegrees: -10 },
            { jointId: 'head', rotationZDegrees: 6 },
            { jointId: 'leg_l_upper', rotationZDegrees: 38 },
            { jointId: 'leg_l_lower', rotationZDegrees: -18 },
            { jointId: 'leg_r_upper', rotationZDegrees: -34 },
            { jointId: 'leg_r_lower', rotationZDegrees: -62 },
            { jointId: 'arm_l_upper', rotationZDegrees: -36 },
            { jointId: 'arm_l_lower', rotationZDegrees: 30 },
            { jointId: 'arm_r_upper', rotationZDegrees: 36 },
            { jointId: 'arm_r_lower', rotationZDegrees: 52 }
          ]
        }
      ]
    },
    morphTopology: {
      baseSegments: baseMouthSegments,
      targets: [
        { name: 'mouthOpen', segments: mouthOpenSegments },
        { name: 'browRaise', segments: browRaiseSegments },
        { name: 'blink', segments: blinkSegments }
      ]
    },
    svgAsset: { idNamespace: 'runner' }
  };

  return {
    rigs: [
      skylineRig,
      factoryRig,
      foregroundPipesRig,
      chimneySmokeRig,
      runnerAuraRig,
      runnerRig
    ]
  };
}

/**
 * Character & Asset Rig Agent: Generates the Map<string, AssetRigContract> catalog
 * required by all shots in the DirectorStoryboardContract.
 */
export class RigAgent {
  private readonly provider: LlmProvider;

  constructor(provider: LlmProvider) {
    this.provider = provider;
  }

  public buildSystemPrompt(): string {
    return [
      'You are the Principal Character & Asset Rig Agent for an AI 2.5D Animation Studio.',
      'Your task is to generate a JSON object { "rigs": AssetRigContract[] } conforming to RigCatalogContractSchema.',
      'Invariants to enforce:',
      '1. Every activeRigId referenced in any storyboard shot must be present in the returned rigs array.',
      '2. Character skeletons must have a single rootJointId (parentId === null) and zero hierarchy cycles.',
      '3. For right-facing (+X) characters (facingDirection: "right"), lower-leg knee joints ("leg_l_lower", "leg_r_lower") MUST bend backward toward -X using non-positive constraintsDeg (e.g. [-140, 0]) and negative rotationZDegrees to prevent the moonwalk illusion.',
      '4. Separate stationary environmental particle emitters ("rig-smoke-chimney" fixed at the factory chimney top [-150, 220, -380]) from character-attached particle emitters ("rig-runner-aura").',
      '5. Particle emitters must satisfy ceil(ratePerSecond * (lifetimeFrames / fps)) + onsetBurstCount <= maxParticles.',
      '6. Morph topologies must maintain equal segment counts and strict C0 endpoint continuity.',
      'Return ONLY valid JSON.'
    ].join('\n');
  }

  public buildUserPrompt(input: RigAgentInput): string {
    const requiredRigIds = Array.from(
      new Set(input.storyboard.shots.flatMap((s) => s.activeRigIds))
    );

    const basePrompt = [
      `Generate all AssetRigContracts required for storyboard "${input.storyboard.projectId}" (fps: ${input.storyboard.fps}).`,
      `Required activeRigIds across shots: ${JSON.stringify(requiredRigIds)}`,
      'Ensure "rig-runner" sets facingDirection: "right" with anatomical backward knee flexion [-140, 0].'
    ].join('\n');

    const repairSection = formatRepairFeedbackPrompt(input.repairErrors ?? []);
    return `${basePrompt}${repairSection}`;
  }

  public async generateRigs(input: RigAgentInput): Promise<Map<string, AssetRigContract>> {
    const prompt = this.buildUserPrompt(input);
    const catalog = await this.provider.generateStructuredJson(prompt, RigCatalogContractSchema, {
      systemPrompt: this.buildSystemPrompt(),
      temperature: 0.1,
      agentRole: 'rig',
      attempt: input.attempt ?? 1,
      repairErrors: input.repairErrors ?? [],
      context: {
        rigInput: input
      }
    });

    const rigMap = new Map<string, AssetRigContract>();
    for (const rig of catalog.rigs) {
      rigMap.set(rig.id, rig);
    }
    return rigMap;
  }
}
