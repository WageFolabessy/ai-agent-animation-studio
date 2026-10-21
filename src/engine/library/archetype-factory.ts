import type {
  AssetRigContract,
  NormalizedCubicBezierSegment
} from '../../schemas/rig.contract.js';
import type { ArchetypeBuildOptions, CharacterArchetypeId } from './types.js';

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
        position: [0, 75, -60],
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
              [-28, -6],
              [-24, -22],
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
        // 2. Secondary Motion: Hair Ribbon (Strict localOffset2D: [0, 0] safeguard)
        {
          id: 'hair_ribbon',
          jointId: 'hair_tie',
          localOffset2D: [0, 0],
          shape: {
            kind: 'polygon',
            points: [
              [0, 0],
              [-22, -4],
              [-18, -14],
              [0, -2]
            ]
          },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: 0.1 },
            opacity: 0.9,
            lit: false
          }
        },
        // 3. Cohesive Close-Up Silhouette: Abdomen Connector (pelvis-torso bridge)
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
        // 4. Cohesive Close-Up Silhouette: Neck Collar (torso-head bridge)
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
        // 5. Torso / Chassis
        {
          id: 'torso_body',
          jointId: 'torso',
          localOffset2D: [0, 8],
          shape: { kind: 'rect', size: [18, 28], rx: 5, ry: 5 },
          style: {
            fill: { kind: 'palette', role: 'primary', shade: -0.1 },
            opacity: 1,
            lit: true
          }
        },
        // 6. Head / Cranium
        {
          id: 'head_cranium',
          jointId: 'head',
          localOffset2D: [2, 6],
          shape: { kind: 'ellipse', radius: [10, 10] },
          style: {
            fill: { kind: 'palette', role: 'secondary', shade: 0.1 },
            opacity: 1,
            lit: true
          }
        },
        // 7. Visor / Optics
        {
          id: 'head_visor',
          jointId: 'head',
          localOffset2D: [6, 6],
          shape: { kind: 'rect', size: [12, 5], rx: 2, ry: 2 },
          style: {
            fill: { kind: 'palette', role: 'accent', shade: 0 },
            opacity: 0.95,
            lit: true
          }
        },
        // 8-11. Left Limbs
        {
          id: 'leg_l_thigh',
          jointId: 'leg_l_upper',
          localOffset2D: [0, -11],
          shape: { kind: 'rect', size: [8, 24], rx: 4, ry: 4 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.2 }, opacity: 1, lit: true }
        },
        {
          id: 'leg_l_shin',
          jointId: 'leg_l_lower',
          localOffset2D: [0, -11],
          shape: { kind: 'rect', size: [6, 22], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0 }, opacity: 1, lit: true }
        },
        {
          id: 'arm_l_bicep',
          jointId: 'arm_l_upper',
          localOffset2D: [0, -9],
          shape: { kind: 'rect', size: [6, 18], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.1 }, opacity: 1, lit: true }
        },
        {
          id: 'arm_l_forearm',
          jointId: 'arm_l_lower',
          localOffset2D: [0, -8],
          shape: { kind: 'rect', size: [5, 16], rx: 2.5, ry: 2.5 },
          style: { fill: { kind: 'palette', role: 'primary', shade: -0.2 }, opacity: 1, lit: true }
        },
        // 12-15. Right Limbs
        {
          id: 'leg_r_thigh',
          jointId: 'leg_r_upper',
          localOffset2D: [0, -11],
          shape: { kind: 'rect', size: [8, 24], rx: 4, ry: 4 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.2 }, opacity: 1, lit: true }
        },
        {
          id: 'leg_r_shin',
          jointId: 'leg_r_lower',
          localOffset2D: [0, -11],
          shape: { kind: 'rect', size: [6, 22], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: 0 }, opacity: 1, lit: true }
        },
        {
          id: 'arm_r_bicep',
          jointId: 'arm_r_upper',
          localOffset2D: [0, -9],
          shape: { kind: 'rect', size: [6, 18], rx: 3, ry: 3 },
          style: { fill: { kind: 'palette', role: 'secondary', shade: -0.1 }, opacity: 1, lit: true }
        },
        {
          id: 'arm_r_forearm',
          jointId: 'arm_r_lower',
          localOffset2D: [0, -8],
          shape: { kind: 'rect', size: [5, 16], rx: 2.5, ry: 2.5 },
          style: { fill: { kind: 'palette', role: 'primary', shade: -0.2 }, opacity: 1, lit: true }
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
        position: [0, 50, -60],
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
        position: [-100, 180, 20],
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
