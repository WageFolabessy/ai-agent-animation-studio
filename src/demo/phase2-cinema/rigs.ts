import type { AssetRigContract } from '../../schemas/rig.contract.js';

export const skylineRig: AssetRigContract = {
  id: 'rig-skyline',
  name: 'Skyline Backdrop',
  type: 'parallax_background',
  renderMode: 'planar',
  baseTransform: {
    position: [0, 200, -900],
    rotationZDegrees: 0,
    scale: [1, 1]
  },
  parts: [
    {
      id: 'skyline-bldg-1',
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
      id: 'skyline-bldg-2',
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
      id: 'skyline-bldg-3',
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
      id: 'skyline-bldg-4',
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
      id: 'skyline-tower',
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
  svgAsset: {
    idNamespace: 'skyline'
  }
};

export const factoriesRig: AssetRigContract = {
  id: 'rig-factories',
  name: 'Industrial Factories',
  type: 'parallax_midground',
  renderMode: 'planar',
  baseTransform: {
    position: [0, 150, -400],
    rotationZDegrees: 0,
    scale: [1, 1]
  },
  parts: [
    {
      id: 'factory-base-1',
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
      id: 'factory-chimney-1',
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
      id: 'factory-chimney-rim',
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
      id: 'factory-roof-saw',
      jointId: null,
      localOffset2D: [-280, 50],
      shape: {
        kind: 'polygon',
        points: [
          [-60, 0],
          [-20, 40],
          [-20, 0],
          [20, 40],
          [20, 0],
          [60, 40],
          [60, 0]
        ]
      },
      style: {
        fill: { kind: 'palette', role: 'primary', shade: -0.4 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'factory-complex-2',
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
  svgAsset: {
    idNamespace: 'factories'
  }
};

export const fgPipesRig: AssetRigContract = {
  id: 'rig-fg-pipes',
  name: 'Foreground Industrial Pipes',
  type: 'parallax_foreground',
  renderMode: 'planar',
  baseTransform: {
    position: [0, 50, 700],
    rotationZDegrees: 0,
    scale: [1, 1]
  },
  parts: [
    {
      id: 'fg-pipe-horiz',
      jointId: null,
      localOffset2D: [0, -180],
      shape: { kind: 'rect', size: [1800, 48] },
      style: {
        fill: { kind: 'palette', role: 'secondary', shade: -0.4 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'fg-pipe-support-left',
      jointId: null,
      localOffset2D: [-500, -260],
      shape: { kind: 'rect', size: [40, 160] },
      style: {
        fill: { kind: 'palette', role: 'secondary', shade: -0.5 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'fg-pipe-support-right',
      jointId: null,
      localOffset2D: [500, -260],
      shape: { kind: 'rect', size: [40, 160] },
      style: {
        fill: { kind: 'palette', role: 'secondary', shade: -0.5 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'fg-valve-glow',
      jointId: null,
      localOffset2D: [-200, -180],
      shape: { kind: 'ellipse', radius: [20, 20] },
      style: {
        fill: { kind: 'palette', role: 'accent', shade: 0.2 },
        opacity: 1.0,
        lit: false
      }
    }
  ],
  secondaryMotion: [],
  svgAsset: {
    idNamespace: 'fgpipes'
  }
};

export const smokeRig: AssetRigContract = {
  id: 'rig-smoke',
  name: 'Chimney Smoke Emitter',
  type: 'particle_emitter',
  renderMode: 'planar',
  baseTransform: {
    position: [-150, 220, -380],
    rotationZDegrees: 0,
    scale: [1, 1]
  },
  emitter: {
    seed: 42,
    maxParticles: 120,
    ratePerSecond: 15,
    lifetimeFrames: 45,
    spawn: { kind: 'disc', radius: 10 },
    velocity: {
      angleDegrees: 85,
      spreadDegrees: 30,
      speedMin: 20,
      speedMax: 45
    },
    gravity: [0, -4],
    radiusRange: [4, 16],
    paintRole: 'accent',
    baseOpacity: 0.6,
    audio: {
      onsetBurstCount: 4,
      rateBand: 'bass',
      rateGain: 1.5
    }
  },
  parts: [],
  secondaryMotion: [],
  svgAsset: {
    idNamespace: 'smoke'
  }
};

export const runnerRig: AssetRigContract = {
  id: 'rig-runner',
  name: 'Articulated Cybernetic Runner',
  type: 'character',
  renderMode: 'billboard',
  baseTransform: {
    position: [0, 95, 0],
    rotationZDegrees: 0,
    scale: [1, 1]
  },
  skeleton: {
    rootJointId: 'root',
    joints: [
      {
        id: 'root',
        parentId: null,
        localOffset2D: [0, 0],
        length: 20,
        rotationZDegrees: 0
      },
      {
        id: 'torso',
        parentId: 'root',
        localOffset2D: [0, 20],
        length: 25,
        rotationZDegrees: 0,
        constraintsDeg: [-25, 25]
      },
      {
        id: 'head',
        parentId: 'torso',
        localOffset2D: [0, 25],
        length: 15,
        rotationZDegrees: 0,
        constraintsDeg: [-30, 30]
      },
      {
        id: 'arm_l_upper',
        parentId: 'torso',
        localOffset2D: [-12, 18],
        length: 20,
        rotationZDegrees: -20,
        constraintsDeg: [-120, 120]
      },
      {
        id: 'arm_l_lower',
        parentId: 'arm_l_upper',
        localOffset2D: [0, -20],
        length: 18,
        rotationZDegrees: 30,
        constraintsDeg: [-10, 140]
      },
      {
        id: 'arm_r_upper',
        parentId: 'torso',
        localOffset2D: [12, 18],
        length: 20,
        rotationZDegrees: 20,
        constraintsDeg: [-120, 120]
      },
      {
        id: 'arm_r_lower',
        parentId: 'arm_r_upper',
        localOffset2D: [0, -20],
        length: 18,
        rotationZDegrees: -30,
        constraintsDeg: [-10, 140]
      },
      {
        id: 'leg_l_upper',
        parentId: 'root',
        localOffset2D: [-8, -5],
        length: 25,
        rotationZDegrees: -25,
        constraintsDeg: [-90, 90]
      },
      {
        id: 'leg_l_lower',
        parentId: 'leg_l_upper',
        localOffset2D: [0, -25],
        length: 25,
        rotationZDegrees: 40,
        constraintsDeg: [0, 140]
      },
      {
        id: 'leg_r_upper',
        parentId: 'root',
        localOffset2D: [8, -5],
        length: 25,
        rotationZDegrees: 25,
        constraintsDeg: [-90, 90]
      },
      {
        id: 'leg_r_lower',
        parentId: 'leg_r_upper',
        localOffset2D: [0, -25],
        length: 25,
        rotationZDegrees: -40,
        constraintsDeg: [0, 140]
      },
      {
        id: 'coat_tail',
        parentId: 'torso',
        localOffset2D: [-10, -5],
        length: 30,
        rotationZDegrees: -15,
        constraintsDeg: [-60, 60]
      }
    ]
  },
  secondaryMotion: [
    {
      jointId: 'coat_tail',
      spring: { zeta: 0.25, omega: 18 },
      drive: 'audio.onsetStrength',
      gainDegrees: 35
    }
  ],
  poseInterpolation: {
    interpolationMode: 'cubic_spline',
    loopFrames: 16,
    keyframes: [
      {
        frame: 0,
        jointTransforms: [
          { jointId: 'root', rotationZDegrees: 0 },
          { jointId: 'torso', rotationZDegrees: 5 },
          { jointId: 'head', rotationZDegrees: -5 },
          { jointId: 'leg_l_upper', rotationZDegrees: -30 },
          { jointId: 'leg_l_lower', rotationZDegrees: 20 },
          { jointId: 'leg_r_upper', rotationZDegrees: 30 },
          { jointId: 'leg_r_lower', rotationZDegrees: 60 },
          { jointId: 'arm_l_upper', rotationZDegrees: 40 },
          { jointId: 'arm_l_lower', rotationZDegrees: 50 },
          { jointId: 'arm_r_upper', rotationZDegrees: -40 },
          { jointId: 'arm_r_lower', rotationZDegrees: 20 }
        ]
      },
      {
        frame: 4,
        jointTransforms: [
          { jointId: 'root', rotationZDegrees: 0 },
          { jointId: 'torso', rotationZDegrees: 2 },
          { jointId: 'head', rotationZDegrees: -2 },
          { jointId: 'leg_l_upper', rotationZDegrees: 0 },
          { jointId: 'leg_l_lower', rotationZDegrees: 60 },
          { jointId: 'leg_r_upper', rotationZDegrees: 10 },
          { jointId: 'leg_r_lower', rotationZDegrees: 20 },
          { jointId: 'arm_l_upper', rotationZDegrees: 10 },
          { jointId: 'arm_l_lower', rotationZDegrees: 30 },
          { jointId: 'arm_r_upper', rotationZDegrees: -10 },
          { jointId: 'arm_r_lower', rotationZDegrees: 40 }
        ]
      },
      {
        frame: 8,
        jointTransforms: [
          { jointId: 'root', rotationZDegrees: 0 },
          { jointId: 'torso', rotationZDegrees: -5 },
          { jointId: 'head', rotationZDegrees: 5 },
          { jointId: 'leg_l_upper', rotationZDegrees: 30 },
          { jointId: 'leg_l_lower', rotationZDegrees: 60 },
          { jointId: 'leg_r_upper', rotationZDegrees: -30 },
          { jointId: 'leg_r_lower', rotationZDegrees: 20 },
          { jointId: 'arm_l_upper', rotationZDegrees: -40 },
          { jointId: 'arm_l_lower', rotationZDegrees: 20 },
          { jointId: 'arm_r_upper', rotationZDegrees: 40 },
          { jointId: 'arm_r_lower', rotationZDegrees: 50 }
        ]
      },
      {
        frame: 12,
        jointTransforms: [
          { jointId: 'root', rotationZDegrees: 0 },
          { jointId: 'torso', rotationZDegrees: -2 },
          { jointId: 'head', rotationZDegrees: 2 },
          { jointId: 'leg_l_upper', rotationZDegrees: 10 },
          { jointId: 'leg_l_lower', rotationZDegrees: 20 },
          { jointId: 'leg_r_upper', rotationZDegrees: 0 },
          { jointId: 'leg_r_lower', rotationZDegrees: 60 },
          { jointId: 'arm_l_upper', rotationZDegrees: -10 },
          { jointId: 'arm_l_lower', rotationZDegrees: 40 },
          { jointId: 'arm_r_upper', rotationZDegrees: 10 },
          { jointId: 'arm_r_lower', rotationZDegrees: 30 }
        ]
      },
      {
        frame: 16,
        jointTransforms: [
          { jointId: 'root', rotationZDegrees: 0 },
          { jointId: 'torso', rotationZDegrees: 5 },
          { jointId: 'head', rotationZDegrees: -5 },
          { jointId: 'leg_l_upper', rotationZDegrees: -30 },
          { jointId: 'leg_l_lower', rotationZDegrees: 20 },
          { jointId: 'leg_r_upper', rotationZDegrees: 30 },
          { jointId: 'leg_r_lower', rotationZDegrees: 60 },
          { jointId: 'arm_l_upper', rotationZDegrees: 40 },
          { jointId: 'arm_l_lower', rotationZDegrees: 50 },
          { jointId: 'arm_r_upper', rotationZDegrees: -40 },
          { jointId: 'arm_r_lower', rotationZDegrees: 20 }
        ]
      }
    ]
  },
  morphTopology: {
    baseSegments: [
      {
        p0: [-10, 0],
        p1: [-10, 12],
        p2: [10, 12],
        p3: [10, 0]
      },
      {
        p0: [10, 0],
        p1: [10, -6],
        p2: [5, -12],
        p3: [0, -14]
      },
      {
        p0: [0, -14],
        p1: [-5, -12],
        p2: [-10, -6],
        p3: [-10, 0]
      }
    ],
    targets: [
      {
        name: 'mouthOpen',
        segments: [
          {
            p0: [-10, 0],
            p1: [-10, 12],
            p2: [10, 12],
            p3: [10, 0]
          },
          {
            p0: [10, 0],
            p1: [10, -8],
            p2: [6, -18],
            p3: [0, -22]
          },
          {
            p0: [0, -22],
            p1: [-6, -18],
            p2: [-10, -8],
            p3: [-10, 0]
          }
        ]
      },
      {
        name: 'browRaise',
        segments: [
          {
            p0: [-10, 0],
            p1: [-10, 16],
            p2: [10, 16],
            p3: [10, 0]
          },
          {
            p0: [10, 0],
            p1: [10, -6],
            p2: [5, -12],
            p3: [0, -14]
          },
          {
            p0: [0, -14],
            p1: [-5, -12],
            p2: [-10, -6],
            p3: [-10, 0]
          }
        ]
      },
      {
        name: 'blink',
        segments: [
          {
            p0: [-10, -2],
            p1: [-10, 6],
            p2: [10, 6],
            p3: [10, -2]
          },
          {
            p0: [10, -2],
            p1: [10, -7],
            p2: [5, -13],
            p3: [0, -14]
          },
          {
            p0: [0, -14],
            p1: [-5, -13],
            p2: [-10, -7],
            p3: [-10, -2]
          }
        ]
      }
    ]
  },
  parts: [
    {
      id: 'runner-pelvis',
      jointId: 'root',
      localOffset2D: [0, 0],
      shape: { kind: 'ellipse', radius: [14, 10] },
      style: {
        fill: { kind: 'palette', role: 'primary', shade: -0.2 },
        opacity: 1.0,
        lit: true
      }
    },
    {
      id: 'runner-torso',
      jointId: 'torso',
      localOffset2D: [0, 10],
      shape: { kind: 'rect', size: [22, 28] },
      style: {
        fill: { kind: 'palette', role: 'secondary', shade: 0.1 },
        opacity: 1.0,
        lit: true
      }
    },
    {
      id: 'runner-head-morph',
      jointId: 'head',
      localOffset2D: [0, 8],
      shape: { kind: 'morph' },
      style: {
        fill: { kind: 'palette', role: 'primary', shade: 0.1 },
        opacity: 1.0,
        lit: true
      }
    },
    {
      id: 'runner-eye-l',
      jointId: 'head',
      localOffset2D: [-4, 6],
      shape: { kind: 'ellipse', radius: [2, 2] },
      style: {
        fill: { kind: 'palette', role: 'accent', shade: 0.2 },
        opacity: 1.0,
        lit: false
      }
    },
    {
      id: 'runner-eye-r',
      jointId: 'head',
      localOffset2D: [4, 6],
      shape: { kind: 'ellipse', radius: [2, 2] },
      style: {
        fill: { kind: 'palette', role: 'accent', shade: 0.2 },
        opacity: 1.0,
        lit: false
      }
    },
    {
      id: 'runner-arm-l-up',
      jointId: 'arm_l_upper',
      localOffset2D: [0, -10],
      shape: { kind: 'rect', size: [8, 18] },
      style: {
        fill: { kind: 'palette', role: 'secondary', shade: -0.1 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'runner-arm-l-low',
      jointId: 'arm_l_lower',
      localOffset2D: [0, -8],
      shape: { kind: 'rect', size: [6, 16] },
      style: {
        fill: { kind: 'palette', role: 'primary', shade: 0.05 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'runner-arm-r-up',
      jointId: 'arm_r_upper',
      localOffset2D: [0, -10],
      shape: { kind: 'rect', size: [8, 18] },
      style: {
        fill: { kind: 'palette', role: 'secondary', shade: -0.1 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'runner-arm-r-low',
      jointId: 'arm_r_lower',
      localOffset2D: [0, -8],
      shape: { kind: 'rect', size: [6, 16] },
      style: {
        fill: { kind: 'palette', role: 'primary', shade: 0.05 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'runner-leg-l-up',
      jointId: 'leg_l_upper',
      localOffset2D: [0, -12],
      shape: { kind: 'rect', size: [10, 22] },
      style: {
        fill: { kind: 'palette', role: 'secondary', shade: -0.2 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'runner-leg-l-low',
      jointId: 'leg_l_lower',
      localOffset2D: [0, -12],
      shape: { kind: 'rect', size: [8, 22] },
      style: {
        fill: { kind: 'palette', role: 'primary', shade: -0.1 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'runner-leg-r-up',
      jointId: 'leg_r_upper',
      localOffset2D: [0, -12],
      shape: { kind: 'rect', size: [10, 22] },
      style: {
        fill: { kind: 'palette', role: 'secondary', shade: -0.2 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'runner-leg-r-low',
      jointId: 'leg_r_lower',
      localOffset2D: [0, -12],
      shape: { kind: 'rect', size: [8, 22] },
      style: {
        fill: { kind: 'palette', role: 'primary', shade: -0.1 },
        opacity: 0.95,
        lit: true
      }
    },
    {
      id: 'runner-coat-tail',
      jointId: 'coat_tail',
      localOffset2D: [-12, -15],
      shape: {
        kind: 'polygon',
        points: [
          [0, 0],
          [-25, -15],
          [-20, -35],
          [5, -10]
        ]
      },
      style: {
        fill: { kind: 'palette', role: 'accent', shade: 0.1 },
        opacity: 0.9,
        lit: true
      }
    }
  ],
  svgAsset: {
    idNamespace: 'runner'
  }
};

export const demoRigsMap = new Map<string, AssetRigContract>([
  [skylineRig.id, skylineRig],
  [factoriesRig.id, factoriesRig],
  [fgPipesRig.id, fgPipesRig],
  [smokeRig.id, smokeRig],
  [runnerRig.id, runnerRig]
]);
