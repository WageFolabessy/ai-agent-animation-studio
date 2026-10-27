import type { AssetRigContract, RigPart } from '../../schemas/rig.contract.js';
import type { NarrativePropId, RigSocket } from '../../schemas/prop.contract.js';
import { NarrativePropIdSchema } from '../../schemas/prop.contract.js';

export const CANONICAL_BIPED_SOCKETS: readonly RigSocket[] = [
  {
    id: 'hand_r',
    jointId: 'arm_r_lower',
    localOffset2D: [0, -16],
    rotationOffsetDeg: 0
  },
  {
    id: 'hand_l',
    jointId: 'arm_l_lower',
    localOffset2D: [0, -16],
    rotationOffsetDeg: 0
  },
  {
    id: 'head',
    jointId: 'head',
    localOffset2D: [0, 24],
    rotationOffsetDeg: 0
  },
  {
    id: 'torso',
    jointId: 'torso',
    localOffset2D: [2, 12],
    rotationOffsetDeg: 0
  }
];

/**
 * Generates stylized 2.5D vector RigParts for handheld, worn, and instrument narrative props
 * (Pillar 4 of Theatrical Narrative Architecture), attached directly to character skeletal joint sockets.
 */
export class PropFactory {
  public static isNarrativePropId(value: string): value is NarrativePropId {
    return NarrativePropIdSchema.safeParse(value).success;
  }

  public static buildAttachedPropParts(propId: NarrativePropId): RigPart[] {
    switch (propId) {
      case 'microphone':
        return [
          {
            id: 'prop_microphone_body',
            jointId: 'arm_r_lower',
            localOffset2D: [2, -16],
            shape: {
              kind: 'polygon',
              points: [
                [-1.2, -5.0],
                [1.2, -5.0],
                [1.8, 3.5],
                [-1.8, 3.5]
              ]
            },
            style: {
              fill: { kind: 'palette', role: 'secondary', shade: -0.35 },
              opacity: 1,
              lit: true
            }
          },
          {
            id: 'prop_microphone_capsule',
            jointId: 'arm_r_lower',
            localOffset2D: [2, -10.5],
            shape: {
              kind: 'ellipse',
              radius: [2.6, 3.0]
            },
            style: {
              fill: { kind: 'palette', role: 'primary', shade: 0.25 },
              stroke: {
                paint: { kind: 'palette', role: 'accent', shade: 0.1 },
                width: 1.0
              },
              opacity: 1,
              lit: false
            }
          }
        ];

      case 'umbrella':
        return [
          {
            id: 'prop_umbrella_shaft',
            jointId: 'arm_r_lower',
            localOffset2D: [0, 24],
            shape: {
              kind: 'rect',
              size: [2.2, 48]
            },
            style: {
              fill: { kind: 'solid', color: '#cbd5e1' },
              opacity: 1,
              lit: false
            }
          },
          {
            id: 'prop_umbrella_canopy',
            jointId: 'arm_r_lower',
            localOffset2D: [-10, 48],
            shape: {
              kind: 'polygon',
              points: [
                [-30, -6],
                [-28, -2],
                [-22, 5],
                [-14, 10],
                [-5, 12],
                [0, 12.5],
                [5, 12.5],
                [14, 10],
                [22, 5],
                [28, -2],
                [30, -6],
                [0, -2]
              ]
            },
            style: {
              fill: { kind: 'solid', color: '#d97706' },
              stroke: {
                paint: { kind: 'solid', color: '#92400e' },
                width: 1.4
              },
              opacity: 0.96,
              lit: true
            }
          }
        ];

      case 'coffee_cup':
        return [
          {
            id: 'prop_coffee_cup_mug',
            jointId: 'arm_r_lower',
            localOffset2D: [2, -16],
            shape: {
              kind: 'polygon',
              points: [
                [-2.6, -3.5],
                [2.6, -3.5],
                [3.2, 3.5],
                [-3.2, 3.5]
              ]
            },
            style: {
              fill: { kind: 'solid', color: '#f43f5e' },
              stroke: {
                paint: { kind: 'solid', color: '#fda4af' },
                width: 1.0
              },
              opacity: 1,
              lit: true
            }
          }
        ];

      case 'rose':
        return [
          {
            id: 'prop_rose_stem',
            jointId: 'arm_r_lower',
            localOffset2D: [2, -14],
            shape: {
              kind: 'rect',
              size: [1.2, 14]
            },
            style: {
              fill: { kind: 'palette', role: 'secondary', shade: 0.1 },
              opacity: 1,
              lit: false
            }
          },
          {
            id: 'prop_rose_bloom',
            jointId: 'arm_r_lower',
            localOffset2D: [2, -6],
            shape: {
              kind: 'polygon',
              points: [
                [0, -3.5],
                [3.8, -1.0],
                [2.6, 3.6],
                [0, 2.4],
                [-2.6, 3.6],
                [-3.8, -1.0]
              ]
            },
            style: {
              fill: { kind: 'palette', role: 'accent', shade: 0.1 },
              opacity: 1,
              lit: false
            }
          }
        ];

      case 'acoustic_guitar':
        return [
          {
            id: 'prop_acoustic_guitar_body',
            jointId: 'torso',
            localOffset2D: [3, 10],
            shape: {
              kind: 'polygon',
              points: [
                [-12, -8],
                [-2, -10],
                [8, -6],
                [10, 0],
                [8, 6],
                [-2, 10],
                [-12, 8],
                [-14, 0]
              ]
            },
            style: {
              fill: { kind: 'palette', role: 'secondary', shade: 0.25 },
              stroke: {
                paint: { kind: 'palette', role: 'accent', shade: 0.15 },
                width: 1.4
              },
              opacity: 1,
              lit: true
            }
          },
          {
            id: 'prop_acoustic_guitar_neck',
            jointId: 'torso',
            localOffset2D: [16, 14],
            shape: {
              kind: 'polygon',
              points: [
                [-8, -1.8],
                [14, 3.2],
                [14, 6.2],
                [-8, 1.2]
              ]
            },
            style: {
              fill: { kind: 'palette', role: 'primary', shade: -0.2 },
              opacity: 1,
              lit: false
            }
          }
        ];

      case 'electric_guitar':
        return [
          {
            id: 'prop_electric_guitar_body',
            jointId: 'torso',
            localOffset2D: [3, 10],
            shape: {
              kind: 'polygon',
              points: [
                [-15, -9],
                [2, -6],
                [12, -10],
                [6, 0],
                [13, 9],
                [1, 6],
                [-13, 10],
                [-9, 0]
              ]
            },
            style: {
              fill: { kind: 'palette', role: 'accent', shade: 0.1 },
              stroke: {
                paint: { kind: 'palette', role: 'primary', shade: 0.25 },
                width: 1.5
              },
              opacity: 1,
              lit: true
            }
          },
          {
            id: 'prop_electric_guitar_neck',
            jointId: 'torso',
            localOffset2D: [16, 14],
            shape: {
              kind: 'polygon',
              points: [
                [-8, -1.6],
                [16, 4.0],
                [15, 7.0],
                [-8, 1.4]
              ]
            },
            style: {
              fill: { kind: 'palette', role: 'primary', shade: 0.2 },
              opacity: 1,
              lit: false
            }
          }
        ];

      case 'crown':
        return [
          {
            id: 'prop_crown_diadem',
            jointId: 'head',
            localOffset2D: [0, 26],
            shape: {
              kind: 'polygon',
              points: [
                [-7.5, 0],
                [7.5, 0],
                [8.5, 7.5],
                [4.0, 3.5],
                [0, 9.0],
                [-4.0, 3.5],
                [-8.5, 7.5]
              ]
            },
            style: {
              fill: { kind: 'palette', role: 'accent', shade: 0.25 },
              stroke: {
                paint: { kind: 'palette', role: 'primary', shade: 0.3 },
                width: 1.2
              },
              opacity: 1,
              lit: false
            }
          }
        ];

      case 'fedora_hat':
        return [
          {
            id: 'prop_fedora_brim',
            jointId: 'head',
            localOffset2D: [0, 25],
            shape: {
              kind: 'polygon',
              points: [
                [-13, 0],
                [14, -1],
                [9, 2.5],
                [7, 8.5],
                [-6, 8.0],
                [-9, 2.5]
              ]
            },
            style: {
              fill: { kind: 'palette', role: 'secondary', shade: -0.3 },
              stroke: {
                paint: { kind: 'palette', role: 'accent', shade: 0.15 },
                width: 1.2
              },
              opacity: 1,
              lit: true
            }
          }
        ];
    }
  }

  public static buildStandalonePropRig(
    propId: NarrativePropId,
    instanceId: string,
    basePosition?: [number, number, number]
  ): AssetRigContract {
    const defaultBasePos: [number, number, number] =
      basePosition ?? (propId === 'coffee_cup' ? [0, 63, 0] : [0, 35, 0]);
    const parts: RigPart[] =
      propId === 'umbrella'
        ? [
            {
              id: `${instanceId}_shaft`,
              jointId: null,
              localOffset2D: [0, 24],
              shape: { kind: 'rect', size: [2.2, 48] },
              style: {
                fill: { kind: 'solid', color: '#cbd5e1' },
                opacity: 1,
                lit: false
              }
            },
            {
              id: `${instanceId}_canopy`,
              jointId: null,
              localOffset2D: [-10, 48],
              shape: {
                kind: 'polygon',
                points: [
                  [-30, -6],
                  [-28, -2],
                  [-22, 5],
                  [-14, 10],
                  [-5, 12],
                  [0, 12.5],
                  [5, 12.5],
                  [14, 10],
                  [22, 5],
                  [28, -2],
                  [30, -6],
                  [0, -2]
                ]
              },
              style: {
                fill: { kind: 'solid', color: '#d97706' },
                stroke: { paint: { kind: 'solid', color: '#92400e' }, width: 1.4 },
                opacity: 1,
                lit: true
              }
            }
          ]
        : [
            {
              id: `${instanceId}_body`,
              jointId: null,
              localOffset2D: [0, 0],
              shape: {
                kind: 'polygon',
                points: [
                  [-3.0, 0.0],
                  [3.0, 0.0],
                  [3.6, 7.0],
                  [-3.6, 7.0]
                ]
              },
              style: {
                fill: { kind: 'solid', color: '#f43f5e' },
                stroke: { paint: { kind: 'solid', color: '#fda4af' }, width: 1.0 },
                opacity: 1,
                lit: true
              }
            },
            {
              id: `${instanceId}_handle`,
              jointId: null,
              localOffset2D: [3.4, 3.5],
              shape: {
                kind: 'path',
                segments: [
                  {
                    p0: [0, -2.5],
                    p1: [2.5, -2.5],
                    p2: [2.5, 2.5],
                    p3: [0, 2.5]
                  }
                ],
                closed: false
              },
              style: {
                fill: { kind: 'solid', color: '#fda4af' },
                stroke: { paint: { kind: 'solid', color: '#fda4af' }, width: 1.2 },
                opacity: 1,
                lit: true
              }
            }
          ];

    return {
      id: instanceId,
      name: `Prop ${propId} (${instanceId})`,
      type: 'prop',
      renderMode: 'billboard',
      baseTransform: {
        position: defaultBasePos,
        rotationZDegrees: 0,
        scale: [1, 1]
      },
      secondaryMotion: [],
      parts,
      svgAsset: {
        idNamespace: `prop_${instanceId}`
      }
    };
  }
}
