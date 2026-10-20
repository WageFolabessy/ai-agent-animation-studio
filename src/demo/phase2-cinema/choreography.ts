import type { ChoreographyContract } from '../../schemas/choreography.contract.js';

export const demoChoreography: ChoreographyContract = {
  projectId: 'cinema-demo-phase2',
  tracks: [
    // --- SHOT 0 [0, 60): Industrial Awakening (Parallax Establishing) ---
    {
      shotId: 'shot-0',
      rigId: 'rig-skyline',
      transform: {
        keyframes: [
          {
            frame: 0,
            position: [0, 200, -900],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 0.85,
            easing: 'linear'
          }
        ]
      },
      morphKeyframes: {},
      morphBindings: []
    },
    {
      shotId: 'shot-0',
      rigId: 'rig-factories',
      transform: {
        keyframes: [
          {
            frame: 0,
            position: [0, 150, -400],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 0.95,
            easing: 'linear'
          }
        ]
      },
      morphKeyframes: {},
      morphBindings: []
    },
    {
      shotId: 'shot-0',
      rigId: 'rig-fg-pipes',
      transform: {
        keyframes: [
          {
            frame: 0,
            position: [0, 50, 700],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 0.95,
            easing: 'linear'
          }
        ]
      },
      morphKeyframes: {},
      morphBindings: []
    },
    {
      shotId: 'shot-0',
      rigId: 'rig-smoke',
      transform: {
        keyframes: [
          {
            frame: 0,
            position: [-150, 220, -380],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'linear'
          }
        ]
      },
      morphKeyframes: {},
      morphBindings: []
    },
    {
      shotId: 'shot-0',
      rigId: 'rig-runner',
      transform: {
        keyframes: [
          {
            frame: 0,
            position: [-50, 95, 0],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'linear'
          },
          {
            frame: 59,
            position: [10, 95, 0],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'linear'
          }
        ]
      },
      pose: {
        timeScale: 1.0,
        startPoseFrame: 0
      },
      morphKeyframes: {},
      morphBindings: []
    },

    // --- SHOT 1 [60, 100): Kinematic Acceleration (Tracking Run) ---
    {
      shotId: 'shot-1',
      rigId: 'rig-skyline',
      transform: {
        keyframes: [
          {
            frame: 60,
            position: [80, 200, -900],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 0.85,
            easing: 'linear'
          }
        ]
      },
      morphKeyframes: {},
      morphBindings: []
    },
    {
      shotId: 'shot-1',
      rigId: 'rig-factories',
      transform: {
        keyframes: [
          {
            frame: 60,
            position: [140, 150, -400],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 0.95,
            easing: 'linear'
          }
        ]
      },
      morphKeyframes: {},
      morphBindings: []
    },
    {
      shotId: 'shot-1',
      rigId: 'rig-fg-pipes',
      transform: {
        keyframes: [
          {
            frame: 60,
            position: [200, 50, 700],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 0.95,
            easing: 'linear'
          }
        ]
      },
      morphKeyframes: {},
      morphBindings: []
    },
    {
      shotId: 'shot-1',
      rigId: 'rig-runner',
      transform: {
        keyframes: [
          {
            frame: 60,
            position: [20, 95, 0],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'linear'
          },
          {
            frame: 99,
            position: [280, 95, 0],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'linear'
          }
        ]
      },
      pose: {
        timeScale: 1.2,
        startPoseFrame: 0
      },
      morphKeyframes: {},
      morphBindings: []
    },

    // --- SHOT 2 [100, 135): Orbit Perspective (Circular Arc) ---
    {
      shotId: 'shot-2',
      rigId: 'rig-runner',
      transform: {
        keyframes: [
          {
            frame: 100,
            position: [280, 95, 0],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'linear'
          },
          {
            frame: 134,
            position: [295, 95, 0],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'linear'
          }
        ]
      },
      pose: {
        timeScale: 0.6,
        startPoseFrame: 0
      },
      morphKeyframes: {},
      morphBindings: []
    },
    {
      shotId: 'shot-2',
      rigId: 'rig-smoke',
      transform: {
        keyframes: [
          {
            frame: 100,
            position: [250, 120, -60],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'linear'
          }
        ]
      },
      morphKeyframes: {},
      morphBindings: []
    },

    // --- SHOT 3 [135, 180): Climax Close-Up (Dutch Roll + Morph Expressions) ---
    {
      shotId: 'shot-3',
      rigId: 'rig-runner',
      transform: {
        keyframes: [
          {
            frame: 135,
            position: [300, 95, 0],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'springImpulse'
          },
          {
            frame: 179,
            position: [301, 95, 0],
            rotationZDegrees: 0,
            scale: [1, 1],
            opacity: 1.0,
            easing: 'linear'
          }
        ]
      },
      pose: {
        timeScale: 0.25,
        startPoseFrame: 0
      },
      morphKeyframes: {
        blink: [
          { frame: 140, weight: 0.0 },
          { frame: 144, weight: 1.0 },
          { frame: 148, weight: 0.0 },
          { frame: 165, weight: 0.0 },
          { frame: 168, weight: 1.0 },
          { frame: 172, weight: 0.0 }
        ]
      },
      morphBindings: [
        {
          target: 'mouthOpen',
          source: 'audio.rms',
          gain: 1.2,
          bias: 0.0
        },
        {
          target: 'browRaise',
          source: 'audio.onsetStrength',
          gain: 0.8,
          bias: 0.0,
          spring: { zeta: 0.3, omega: 20 }
        }
      ]
    }
  ]
};
