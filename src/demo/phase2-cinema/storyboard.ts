import type {
  DirectorStoryboardContract,
  ColorLightingPalette
} from '../../schemas/storyboard.contract.js';

export const demoPalette: ColorLightingPalette = {
  background: '#0a0a14',
  primary: '#00f0ff',
  secondary: '#1a1d36',
  accent: '#ff0055',
  ambientLightColor: '#2a3250',
  ambientIntensity: 0.35,
  keyLightDirection: [0.6, 0.7, 0.4],
  audioReactiveGain: 1.2
};

export const demoStoryboard: DirectorStoryboardContract = {
  projectId: 'cinema-demo-phase2',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  totalFrames: 180,
  acts: [
    {
      actNumber: 1,
      title: 'Industrial Awakening',
      narrativeArc: 'Establishing industrial horizon and distant runner',
      frameRange: { startFrameInclusive: 0, endFrameExclusive: 60 }
    },
    {
      actNumber: 2,
      title: 'Kinematic Acceleration',
      narrativeArc: 'Runner acceleration and orbit perspective',
      frameRange: { startFrameInclusive: 60, endFrameExclusive: 135 }
    },
    {
      actNumber: 3,
      title: 'Convergence',
      narrativeArc: 'Close-up Dutch roll, trauma camera shake, and facial morph climax',
      frameRange: { startFrameInclusive: 135, endFrameExclusive: 180 }
    }
  ],
  shots: [
    {
      id: 'shot-0',
      shotIndex: 0,
      actNumber: 1,
      frameRange: { startFrameInclusive: 0, endFrameExclusive: 60 },
      framing: 'EXTREME_WIDE',
      movement: 'DOLLY',
      viewpoint: 'OBJECTIVE_THIRD_PERSON',
      cameraEasing: 'easeInOutSine',
      cameraStart: {
        projectionMode: 'perspective',
        position: [-200, 260, 1500],
        target: [0, 200, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 70,
        nearPlane: 10,
        farPlane: 4000,
        rollDegrees: 0
      },
      cameraEnd: {
        projectionMode: 'perspective',
        position: [-120, 230, 1150],
        target: [0, 200, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 70,
        nearPlane: 10,
        farPlane: 4000,
        rollDegrees: 0
      },
      palette: demoPalette,
      narrativeAction: 'Industrial parallax establishing shot with ground grid and distant smoke',
      activeRigIds: ['rig-skyline', 'rig-factories', 'rig-fg-pipes', 'rig-smoke', 'rig-runner']
    },
    {
      id: 'shot-1',
      shotIndex: 1,
      actNumber: 2,
      frameRange: { startFrameInclusive: 60, endFrameExclusive: 100 },
      framing: 'MEDIUM',
      movement: 'TRACKING',
      viewpoint: 'OBJECTIVE_THIRD_PERSON',
      cameraEasing: 'linear',
      cameraStart: {
        projectionMode: 'perspective',
        position: [0, 110, 520],
        target: [20, 95, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 50,
        nearPlane: 10,
        farPlane: 3000,
        rollDegrees: 0
      },
      cameraEnd: {
        projectionMode: 'perspective',
        position: [260, 110, 520],
        target: [280, 95, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 50,
        nearPlane: 10,
        farPlane: 3000,
        rollDegrees: 0
      },
      palette: demoPalette,
      narrativeAction: 'Medium tracking shot following articulated runner with secondary motion',
      activeRigIds: ['rig-skyline', 'rig-factories', 'rig-fg-pipes', 'rig-runner']
    },
    {
      id: 'shot-2',
      shotIndex: 2,
      actNumber: 2,
      frameRange: { startFrameInclusive: 100, endFrameExclusive: 135 },
      framing: 'WIDE',
      movement: 'ORBIT',
      viewpoint: 'OBJECTIVE_THIRD_PERSON',
      cameraEasing: 'easeInOutSine',
      cameraStart: {
        projectionMode: 'perspective',
        position: [260, 110, 520],
        target: [280, 95, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 55,
        nearPlane: 10,
        farPlane: 3000,
        rollDegrees: 0
      },
      cameraEnd: {
        projectionMode: 'perspective',
        position: [300, 140, 400],
        target: [280, 95, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 55,
        nearPlane: 10,
        farPlane: 3000,
        rollDegrees: 0
      },
      palette: demoPalette,
      narrativeAction: 'Arc orbit camera wrapping around runner and active particle emitter',
      activeRigIds: ['rig-runner', 'rig-smoke']
    },
    {
      id: 'shot-3',
      shotIndex: 3,
      actNumber: 3,
      frameRange: { startFrameInclusive: 135, endFrameExclusive: 180 },
      framing: 'CLOSE_UP',
      movement: 'DOLLY',
      viewpoint: 'LOW_ANGLE',
      cameraEasing: 'springImpulse',
      cameraStart: {
        projectionMode: 'perspective',
        position: [310, 140, 150],
        target: [300, 138, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 40,
        nearPlane: 5,
        farPlane: 2000,
        rollDegrees: 8
      },
      cameraEnd: {
        projectionMode: 'perspective',
        position: [305, 138, 115],
        target: [300, 138, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 40,
        nearPlane: 5,
        farPlane: 2000,
        rollDegrees: 16
      },
      palette: demoPalette,
      narrativeAction: 'Close-up with Dutch roll rollDegrees 8 to 16, spring impulse, and active head morphing',
      activeRigIds: ['rig-runner']
    }
  ]
};
