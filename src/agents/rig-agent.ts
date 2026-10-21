import { z } from 'zod';
import {
  AssetRigContractSchema,
  type AssetRigContract,
  type NormalizedCubicBezierSegment
} from '../schemas/rig.contract.js';
import type { LlmProvider, RigAgentInput } from './types.js';
import {
  CANONICAL_RIG_IDS,
  formatContractJsonSchema,
  formatRepairFeedbackPrompt
} from './director-agent.js';

export const RigCatalogContractSchema = z
  .object({
    rigs: z.array(AssetRigContractSchema).min(1)
  })
  .strict();
export type RigCatalogContract = z.infer<typeof RigCatalogContractSchema>;

export const RIG_CATALOG_JSON_SCHEMA = formatContractJsonSchema(RigCatalogContractSchema);

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
      position: [0, 0, 140],
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
      maxParticles: 60,
      ratePerSecond: 28,
      lifetimeFrames: 16,
      spawn: { kind: 'disc', radius: 6 },
      velocity: {
        angleDegrees: 170,
        spreadDegrees: 35,
        speedMin: 22,
        speedMax: 46
      },
      gravity: [-36, 4],
      radiusRange: [3, 10],
      paintRole: 'accent',
      baseOpacity: 0.85,
      audio: {
        onsetBurstCount: 4,
        rateBand: 'presence',
        rateGain: 1.4
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
      {
        id: 'coat_wing',
        jointId: 'coat_tail',
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [2, 6],
            [-28, -6],
            [-24, -22],
            [2, -4]
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
        shape: { kind: 'rect', size: [9, 26], rx: 4.5, ry: 4.5 },
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
        shape: { kind: 'rect', size: [7, 25], rx: 3.5, ry: 3.5 },
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
        shape: { kind: 'rect', size: [7, 22], rx: 3.5, ry: 3.5 },
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
        shape: { kind: 'rect', size: [6, 19], rx: 3.0, ry: 3.0 },
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
        shape: { kind: 'rect', size: [18, 12], rx: 4.0, ry: 4.0 },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: 0 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'abdomen_core',
        jointId: 'torso',
        localOffset2D: [0, -6],
        shape: { kind: 'rect', size: [14, 16], rx: 4.0, ry: 4.0 },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.1 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'neck_collar',
        jointId: 'torso',
        localOffset2D: [2, 20],
        shape: { kind: 'rect', size: [10, 10], rx: 3.0, ry: 3.0 },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.15 },
          opacity: 1,
          lit: false
        }
      },
      {
        id: 'chest_armor',
        jointId: 'torso',
        localOffset2D: [1, 7],
        shape: {
          kind: 'polygon',
          points: [
            [-10, -11],
            [12, -11],
            [16, 4],
            [13, 15],
            [-12, 15]
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
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [2, 3],
            [-22, 5],
            [-18, -5],
            [2, -3]
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
        localOffset2D: [1, 7],
        shape: {
          kind: 'polygon',
          points: [
            [-11, -9],
            [12, -9],
            [15, 3],
            [11, 14],
            [-10, 14],
            [-13, 2]
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
        shape: { kind: 'rect', size: [16, 6], rx: 2.5, ry: 2.5 },
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
        localOffset2D: [5.5, 2],
        shape: { kind: 'morph' },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0.25 },
          stroke: { paint: { kind: 'solid', color: '#ffffff' }, width: 0.9 },
          opacity: 0.95,
          lit: false
        }
      },
      {
        id: 'leg_r_thigh',
        jointId: 'leg_r_upper',
        localOffset2D: [0, -11],
        shape: { kind: 'rect', size: [9, 26], rx: 4.5, ry: 4.5 },
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
        shape: { kind: 'rect', size: [7, 25], rx: 3.5, ry: 3.5 },
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
        shape: { kind: 'rect', size: [7, 22], rx: 3.5, ry: 3.5 },
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
        shape: { kind: 'rect', size: [6, 19], rx: 3.0, ry: 3.0 },
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

  const pursuitDroneRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.PURSUIT_DRONE,
    name: 'Cybernetic Pursuit Enforcer Drone',
    type: 'character',
    renderMode: 'billboard',
    baseTransform: {
      position: [-100, 180, 20],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    skeleton: {
      rootJointId: 'chassis_core',
      joints: [
        {
          id: 'chassis_core',
          parentId: null,
          localOffset2D: [0, 0],
          length: 12,
          rotationZDegrees: 0,
          constraintsDeg: [-45, 45]
        },
        {
          id: 'left_thruster',
          parentId: 'chassis_core',
          localOffset2D: [-28, 6],
          length: 14,
          rotationZDegrees: 12,
          constraintsDeg: [-45, 60]
        },
        {
          id: 'right_thruster',
          parentId: 'chassis_core',
          localOffset2D: [28, 6],
          length: 14,
          rotationZDegrees: -12,
          constraintsDeg: [-60, 45]
        },
        {
          id: 'scanner_turret',
          parentId: 'chassis_core',
          localOffset2D: [0, -14],
          length: 10,
          rotationZDegrees: 0,
          constraintsDeg: [-60, 60]
        }
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
            [10, 8],
            [-10, 8]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0.2 },
          stroke: { paint: { kind: 'solid', color: '#ffffff' }, width: 1.5 },
          opacity: 0.95,
          lit: false
        }
      },
      {
        id: 'thruster_nacelle_left',
        jointId: 'left_thruster',
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [-8, -12],
            [4, -12],
            [6, 14],
            [-6, 14]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.3 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0 }, width: 1.5 },
          opacity: 1,
          lit: true
        }
      },
      {
        id: 'thruster_flame_left',
        jointId: 'left_thruster',
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [-4, -12],
            [2, -12],
            [-1, -26]
          ]
        },
        style: {
          fill: { kind: 'solid', color: '#00ffff' },
          opacity: 0.85,
          lit: false
        }
      },
      {
        id: 'thruster_nacelle_right',
        jointId: 'right_thruster',
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [-4, -12],
            [8, -12],
            [6, 14],
            [-6, 14]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.3 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0 }, width: 1.5 },
          opacity: 1,
          lit: true
        }
      },
      {
        id: 'thruster_flame_right',
        jointId: 'right_thruster',
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [-2, -12],
            [4, -12],
            [1, -26]
          ]
        },
        style: {
          fill: { kind: 'solid', color: '#00ffff' },
          opacity: 0.85,
          lit: false
        }
      },
      {
        id: 'drone_scanner',
        jointId: 'scanner_turret',
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [-6, -4],
            [6, -4],
            [4, 4],
            [-4, 4]
          ]
        },
        style: {
          fill: { kind: 'solid', color: '#ffbe0b' },
          stroke: { paint: { kind: 'solid', color: '#ffffff' }, width: 1 },
          opacity: 1,
          lit: false
        }
      }
    ],
    poseInterpolation: {
      loopFrames: 30,
      interpolationMode: 'cubic_spline',
      keyframes: [
        {
          frame: 0,
          jointTransforms: [
            { jointId: 'chassis_core', rotationZDegrees: 2 },
            { jointId: 'left_thruster', rotationZDegrees: 12 },
            { jointId: 'right_thruster', rotationZDegrees: -12 },
            { jointId: 'scanner_turret', rotationZDegrees: -10 }
          ]
        },
        {
          frame: 15,
          jointTransforms: [
            { jointId: 'chassis_core', rotationZDegrees: -2 },
            { jointId: 'left_thruster', rotationZDegrees: 18 },
            { jointId: 'right_thruster', rotationZDegrees: -18 },
            { jointId: 'scanner_turret', rotationZDegrees: 10 }
          ]
        },
        {
          frame: 30,
          jointTransforms: [
            { jointId: 'chassis_core', rotationZDegrees: 2 },
            { jointId: 'left_thruster', rotationZDegrees: 12 },
            { jointId: 'right_thruster', rotationZDegrees: -12 },
            { jointId: 'scanner_turret', rotationZDegrees: -10 }
          ]
        }
      ]
    },
    secondaryMotion: [],
    svgAsset: { idNamespace: 'drone' }
  };

  const highwayGantryRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.HIGHWAY_GANTRY,
    name: 'Overhead Highway Gantry & Directional Truss',
    type: 'prop',
    renderMode: 'planar',
    baseTransform: {
      position: [0, 240, -60],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    parts: [
      {
        id: 'gantry_beam',
        jointId: null,
        localOffset2D: [0, 0],
        shape: { kind: 'rect', size: [340, 26] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.2 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0 }, width: 2 },
          opacity: 0.95,
          lit: true
        }
      },
      {
        id: 'gantry_sign',
        jointId: null,
        localOffset2D: [0, -18],
        shape: { kind: 'rect', size: [190, 52] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: -0.4 },
          stroke: { paint: { kind: 'palette', role: 'accent', shade: 0.2 }, width: 2 },
          opacity: 0.95,
          lit: false
        }
      },
      {
        id: 'hazard_chevron_strip',
        jointId: null,
        localOffset2D: [0, 16],
        shape: { kind: 'rect', size: [280, 10] },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0 },
          opacity: 0.9,
          lit: false
        }
      },
      {
        id: 'gantry_support_left',
        jointId: null,
        localOffset2D: [-160, -120],
        shape: { kind: 'rect', size: [20, 240] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.35 },
          opacity: 0.9,
          lit: false
        }
      }
    ],
    secondaryMotion: [],
    svgAsset: { idNamespace: 'gantry' }
  };

  const neonBillboardRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.NEON_BILLBOARD,
    name: 'Cyberpunk Holographic Billboard',
    type: 'prop',
    renderMode: 'planar',
    baseTransform: {
      position: [0, 200, -320],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    parts: [
      {
        id: 'billboard_frame',
        jointId: null,
        localOffset2D: [0, 0],
        shape: { kind: 'rect', size: [240, 140] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.3 },
          stroke: { paint: { kind: 'palette', role: 'accent', shade: 0 }, width: 3 },
          opacity: 0.95,
          lit: true
        }
      },
      {
        id: 'billboard_screen',
        jointId: null,
        localOffset2D: [0, 0],
        shape: { kind: 'rect', size: [220, 120] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: -0.4 },
          opacity: 0.9,
          lit: false
        }
      },
      {
        id: 'billboard_glyph',
        jointId: null,
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [-50, -25],
            [0, 30],
            [50, -25],
            [30, -25],
            [0, 10],
            [-30, -25]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0.3 },
          opacity: 0.95,
          lit: false
        }
      },
      {
        id: 'billboard_mounting_pole',
        jointId: null,
        localOffset2D: [0, -100],
        shape: { kind: 'rect', size: [18, 200] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.5 },
          opacity: 0.85,
          lit: false
        }
      }
    ],
    secondaryMotion: [],
    svgAsset: { idNamespace: 'billboard' }
  };

  const bridgePylonRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.BRIDGE_PYLON,
    name: 'Suspension Bridge Mega Pylon Tower',
    type: 'parallax_midground',
    renderMode: 'planar',
    baseTransform: {
      position: [0, 260, -220],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    parts: [
      {
        id: 'pylon_left_column',
        jointId: null,
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [-55, -260],
            [-18, 260],
            [-6, 260],
            [-30, -260]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.3 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0 }, width: 2 },
          opacity: 0.95,
          lit: true
        }
      },
      {
        id: 'pylon_right_column',
        jointId: null,
        localOffset2D: [0, 0],
        shape: {
          kind: 'polygon',
          points: [
            [30, -260],
            [6, 260],
            [18, 260],
            [55, -260]
          ]
        },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.3 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: 0 }, width: 2 },
          opacity: 0.95,
          lit: true
        }
      },
      {
        id: 'pylon_cross_brace',
        jointId: null,
        localOffset2D: [0, 40],
        shape: { kind: 'rect', size: [80, 26] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: -0.15 },
          stroke: { paint: { kind: 'palette', role: 'accent', shade: 0 }, width: 1.5 },
          opacity: 0.9,
          lit: true
        }
      },
      {
        id: 'pylon_beacon_housing',
        jointId: null,
        localOffset2D: [0, 270],
        shape: { kind: 'rect', size: [32, 24] },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0.2 },
          stroke: { paint: { kind: 'solid', color: '#ffffff' }, width: 1.5 },
          opacity: 0.95,
          lit: false
        }
      }
    ],
    secondaryMotion: [],
    svgAsset: { idNamespace: 'bridge_pylon' }
  };

  const reactorCoreRig: AssetRigContract = {
    id: CANONICAL_RIG_IDS.REACTOR_CORE,
    name: 'Subterranean Reactor Power Conduit',
    type: 'parallax_midground',
    renderMode: 'planar',
    baseTransform: {
      position: [0, 180, -350],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    parts: [
      {
        id: 'reactor_main_cylinder',
        jointId: null,
        localOffset2D: [0, 0],
        shape: { kind: 'rect', size: [260, 360] },
        style: {
          fill: { kind: 'palette', role: 'secondary', shade: -0.4 },
          stroke: { paint: { kind: 'palette', role: 'primary', shade: -0.2 }, width: 2 },
          opacity: 0.95,
          lit: true
        }
      },
      {
        id: 'plasma_ring_upper',
        jointId: null,
        localOffset2D: [0, 80],
        shape: { kind: 'rect', size: [285, 32] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: 0.1 },
          stroke: { paint: { kind: 'palette', role: 'accent', shade: 0 }, width: 2.5 },
          opacity: 0.95,
          lit: false
        }
      },
      {
        id: 'plasma_ring_lower',
        jointId: null,
        localOffset2D: [0, -80],
        shape: { kind: 'rect', size: [285, 32] },
        style: {
          fill: { kind: 'palette', role: 'primary', shade: 0.1 },
          stroke: { paint: { kind: 'palette', role: 'accent', shade: 0 }, width: 2.5 },
          opacity: 0.95,
          lit: false
        }
      },
      {
        id: 'reactor_hazard_sign',
        jointId: null,
        localOffset2D: [0, 0],
        shape: { kind: 'rect', size: [170, 22] },
        style: {
          fill: { kind: 'palette', role: 'accent', shade: 0 },
          opacity: 0.9,
          lit: false
        }
      }
    ],
    secondaryMotion: [],
    svgAsset: { idNamespace: 'reactor' }
  };

  return {
    rigs: [
      skylineRig,
      factoryRig,
      foregroundPipesRig,
      chimneySmokeRig,
      runnerAuraRig,
      runnerRig,
      pursuitDroneRig,
      highwayGantryRig,
      neonBillboardRig,
      bridgePylonRig,
      reactorCoreRig
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
      '7. Secondary-motion parts ("coat_wing", "hair_ribbon") must set localOffset2D: [0, 0] and anchor root vertices at the joint pivot [0, 0] to satisfy PART_DETACHED_FROM_JOINT_PIVOT.',
      '8. Foreground parallax rigs ("rig-fg-pipes") must stay at a safe foreground depth (e.g. z = 140) strictly ahead of camera near-plane to satisfy FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE.',
      'JSON Schema Contract (draft-07):',
      RIG_CATALOG_JSON_SCHEMA,
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

    const repairSection = formatRepairFeedbackPrompt(
      input.repairErrors ?? [],
      input.previousDraft
    );
    return `${basePrompt}${repairSection}`;
  }

  public async generateRigs(input: RigAgentInput): Promise<Map<string, AssetRigContract>> {
    const prompt = this.buildUserPrompt(input);
    const catalog = await this.provider.generateStructuredJson(prompt, RigCatalogContractSchema, {
      systemPrompt: this.buildSystemPrompt(),
      temperature: 0.1,
      maxTokens: input.maxTokens ?? 4096,
      timeoutMs: input.timeoutMs,
      schemaName: 'RigCatalogContract',
      agentRole: 'rig',
      attempt: input.attempt ?? 1,
      repairErrors: input.repairErrors ?? [],
      previousDraft: input.previousDraft,
      onAttemptComplete: input.onAttemptComplete,
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
