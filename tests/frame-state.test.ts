import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { evaluateParticleEmitter } from '../src/engine/effects/particle-emitter.js';
import { evaluateEntityTrack } from '../src/engine/director/choreography.js';
import { FrameStateContractSchema } from '../src/schemas/frame.contract.js';
import type { ParticleEmitter, AssetRigContract } from '../src/schemas/rig.contract.js';
import type { EntityTrack } from '../src/schemas/choreography.contract.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';
import type { DirectorStoryboardContract } from '../src/schemas/storyboard.contract.js';

test('Effects: evaluateParticleEmitter calculates steady stream, velocity, and gravity', () => {
  const emitter: ParticleEmitter = {
    seed: 1234,
    maxParticles: 100,
    ratePerSecond: 20,
    lifetimeFrames: 30,
    spawn: { kind: 'point' },
    velocity: {
      angleDegrees: 90, // straight up (+y)
      spreadDegrees: 0,
      speedMin: 100,
      speedMax: 100
    },
    gravity: [0, -50], // pulls downwards
    radiusRange: [2, 4],
    paintRole: 'primary',
    baseOpacity: 0.8
  };

  // At frame 0: 1 particle spawned at origin
  const p0 = evaluateParticleEmitter(emitter, 0, 30);
  assert.equal(p0.length, 1);
  assert.equal(p0[0].position[0], 0);
  assert.equal(p0[0].position[1], 0);

  // At frame 15: particle 0 has aged 15 frames = 0.5s
  // py = 0 + 100 * 0.5 + 0.5 * (-50) * 0.5^2 = 50 - 6.25 = 43.75
  const p15 = evaluateParticleEmitter(emitter, 15, 30);
  const p0At15 = p15.find((p) => p.id === 0)!;
  assert.ok(p0At15);
  assert.ok(Math.abs(p0At15.position[1] - 43.75) < 1e-4);
});

test('Effects: evaluateParticleEmitter spawns bursts on audio onset frames', () => {
  const emitter: ParticleEmitter = {
    seed: 5678,
    maxParticles: 100,
    ratePerSecond: 0, // no steady emission
    lifetimeFrames: 20,
    spawn: { kind: 'point' },
    velocity: { angleDegrees: 0, spreadDegrees: 45, speedMin: 50, speedMax: 50 },
    gravity: [0, 0],
    radiusRange: [1, 3],
    paintRole: 'accent',
    baseOpacity: 1.0,
    audio: {
      onsetBurstCount: 10,
      rateBand: 'bass',
      rateGain: 1.0
    }
  };

  const onsetFrames = [10, 30];

  // Before onset at frame 5: 0 particles
  const p5 = evaluateParticleEmitter(emitter, 5, 30, onsetFrames);
  assert.equal(p5.length, 0);

  // At frame 15: 10 particles spawned from onset at frame 10 (age = 5 frames < 20)
  const p15 = evaluateParticleEmitter(emitter, 15, 30, onsetFrames);
  assert.equal(p15.length, 10);
});

test('Choreography: evaluateEntityTrack interpolates position and evaluates morph bindings', () => {
  const track: EntityTrack = {
    rigId: 'rig_hero',
    shotId: 'shot_0',
    transform: {
      keyframes: [
        { frame: 0, position: [0, 0, 0], rotationZDegrees: 0, scale: [1, 1], opacity: 1, easing: 'linear' },
        { frame: 20, position: [100, 200, 0], rotationZDegrees: 45, scale: [2, 2], opacity: 0.5, easing: 'linear' }
      ]
    },
    morphKeyframes: {
      mouth_open: [{ frame: 0, weight: 0 }, { frame: 20, weight: 1.0 }]
    },
    morphBindings: [
      { target: 'mouth_open', source: 'audio.rms', gain: 0.5, bias: 0 }
    ]
  };

  const mockAudio = (f: number): AudioFrameFeature => ({
    frameIndex: f,
    timestamp: f / 30,
    rms: 0.4,
    rmsRelativeGlobal: 0.4,
    rmsRelativeLocal: 0.4,
    localWindowFrames: 15,
    spectralFlux: 0,
    onsetStrength: 0,
    isOnset: false,
    bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0 }
  });

  // At frame 10 (halfway):
  // position should be [50, 100, 0]
  // keyframed mouth_open = 0.5, bound = 0.5 * 0.4 = 0.2 -> total = 0.7
  const state10 = evaluateEntityTrack(track, 10, 30, mockAudio);
  assert.deepEqual(state10.worldPosition, [50, 100, 0]);
  assert.ok(Math.abs(state10.morphWeights.mouth_open - 0.7) < 1e-4);
});

test('FrameStateBuilder: Builds valid FrameStateContract satisfying schema and strict determinism', () => {
  const basePalette = {
    background: '#08081a',
    primary: '#00d4ff',
    secondary: '#ff0077',
    accent: '#ffe600',
    ambientLightColor: '#ffffff',
    ambientIntensity: 0.5,
    keyLightDirection: [0.5, 0.8, -0.3] as [number, number, number],
    audioReactiveGain: 1.0
  };

  const storyboard: DirectorStoryboardContract = {
    projectId: 'test_project',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    totalFrames: 90,
    acts: [
      { actNumber: 1, title: 'Act 1', narrativeArc: 'A1', frameRange: { startFrameInclusive: 0, endFrameExclusive: 30 } },
      { actNumber: 2, title: 'Act 2', narrativeArc: 'A2', frameRange: { startFrameInclusive: 30, endFrameExclusive: 60 } },
      { actNumber: 3, title: 'Act 3', narrativeArc: 'A3', frameRange: { startFrameInclusive: 60, endFrameExclusive: 90 } }
    ],
    shots: [
      {
        id: 'shot_0',
        shotIndex: 0,
        actNumber: 1,
        frameRange: { startFrameInclusive: 0, endFrameExclusive: 90 },
        framing: 'MEDIUM',
        movement: 'DOLLY',
        viewpoint: 'OBJECTIVE_THIRD_PERSON',
        cameraStart: {
          projectionMode: 'perspective',
          position: [0, 100, 500],
          target: [0, 100, 0],
          up: [0, 1, 0],
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: 0,
          verticalFovDegrees: 50
        },
        cameraEnd: {
          projectionMode: 'perspective',
          position: [50, 100, 450],
          target: [0, 100, 0],
          up: [0, 1, 0],
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: 0,
          verticalFovDegrees: 50
        },
        cameraEasing: 'linear',
        palette: basePalette,
        narrativeAction: 'Testing frame state',
        activeRigIds: ['rig_character']
      }
    ]
  };

  const audioManifest: AudioAnalysisManifest = {
    metadata: {
      audioFilePath: 'test.mp3',
      sampleRate: 44100,
      durationSeconds: 3.0,
      fps: 30,
      totalFrames: 90
    },
    normalization: { globalRmsMax: 1, localWindowFrames: 15 },
    lyrics: [
      {
        id: 'lyric_1',
        frameRange: { startFrameInclusive: 10, endFrameExclusive: 40 },
        startTimeSeconds: 10 / 30,
        endTimeSeconds: 40 / 30,
        text: 'Singing in the code',
        emphasis: 0.8
      }
    ],
    beatEvents: [],
    storageReference: { type: 'memory_columnar', columnLayoutVersion: 1 }
  };

  const rigs = new Map<string, AssetRigContract>([
    [
      'rig_character',
      {
        id: 'rig_character',
        name: 'Runner',
        type: 'character',
        renderMode: 'billboard',
        baseTransform: { position: [0, 0, 0], rotationZDegrees: 0, scale: [1, 1] },
        skeleton: {
          rootJointId: 'root',
          joints: [{ id: 'root', parentId: null, localOffset2D: [0, 0], length: 10, rotationZDegrees: 0 }]
        },
        parts: [],
        secondaryMotion: [],
        svgAsset: { idNamespace: 'char_ns' }
      }
    ]
  ]);

  const choreography = {
    projectId: 'test_project',
    tracks: [
      {
        rigId: 'rig_character',
        shotId: 'shot_0',
        transform: {
          keyframes: [
            { frame: 0, position: [0, 0, 0] as [number, number, number], rotationZDegrees: 0, scale: [1, 1] as [number, number], opacity: 1, easing: 'linear' as const },
            { frame: 90, position: [100, 0, 0] as [number, number, number], rotationZDegrees: 0, scale: [1, 1] as [number, number], opacity: 1, easing: 'linear' as const }
          ]
        },
        morphKeyframes: {},
        morphBindings: []
      }
    ]
  };

  const mockAudioFeature = (f: number): AudioFrameFeature => ({
    frameIndex: f,
    timestamp: f / 30,
    rms: 0.5,
    rmsRelativeGlobal: 0.5,
    rmsRelativeLocal: 0.5,
    localWindowFrames: 15,
    spectralFlux: 0.1,
    onsetStrength: f % 15 === 0 ? 0.9 : 0.0,
    isOnset: f % 15 === 0,
    bands: { subBass: 0.5, bass: 0.7, lowMid: 0.3, mid: 0.2, highMid: 0.1, presence: 0.1, brilliance: 0.1 }
  });

  const builder = new FrameStateBuilder({
    storyboard,
    audioManifest,
    rigs,
    choreography,
    getAudioFeatureAtFrame: mockAudioFeature
  });

  // Evaluate frame 20 (inside lyric_1 range [10, 40))
  const state20 = builder.buildFrameState(20);
  assert.doesNotThrow(() => FrameStateContractSchema.parse(state20));
  assert.ok(state20.lyric !== null);
  assert.equal(state20.lyric.text, 'Singing in the code');
  assert.ok(Math.abs(state20.lyric.progress - (10 / 30)) < 1e-4);
  assert.equal(state20.entities.length, 1);

  // Determinism check: evaluate frame 20 again, assert JSON is 100% identical
  const state20Repeat = builder.buildFrameState(20);
  assert.equal(JSON.stringify(state20), JSON.stringify(state20Repeat));

  // Evaluate frame 50 (outside lyric range)
  const state50 = builder.buildFrameState(50);
  assert.equal(state50.lyric, null);
});
