import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectContracts } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';
import type { DirectorStoryboardContract } from '../src/schemas/storyboard.contract.js';
import type { AssetRigContract } from '../src/schemas/rig.contract.js';

function getValidFixtures() {
  const audioManifest: AudioAnalysisManifest = {
    metadata: {
      audioFilePath: 'test.mp3',
      sampleRate: 44100,
      durationSeconds: 5,
      fps: 30,
      totalFrames: 150
    },
    normalization: {
      globalRmsMax: 1,
      localWindowFrames: 15
    },
    lyrics: [],
    beatEvents: [],
    storageReference: {
      type: 'memory_columnar',
      columnLayoutVersion: 1
    }
  };

  const renderConfig = createRenderConfig({
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 150
  });

  const storyboard: DirectorStoryboardContract = {
    projectId: 'test_project',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    totalFrames: 150,
    acts: [
      { actNumber: 1, title: 'Act 1', narrativeArc: 'Arc 1', frameRange: { startFrameInclusive: 0, endFrameExclusive: 50 } },
      { actNumber: 2, title: 'Act 2', narrativeArc: 'Arc 2', frameRange: { startFrameInclusive: 50, endFrameExclusive: 100 } },
      { actNumber: 3, title: 'Act 3', narrativeArc: 'Arc 3', frameRange: { startFrameInclusive: 100, endFrameExclusive: 150 } }
    ],
    shots: [
      {
        id: 'shot_1',
        shotIndex: 0,
        actNumber: 1,
        frameRange: { startFrameInclusive: 0, endFrameExclusive: 50 },
        framing: 'MEDIUM',
        movement: 'STATIC',
        viewpoint: 'OBJECTIVE_THIRD_PERSON',
        cameraStart: {
          projectionMode: 'perspective',
          position: [0, 0, 10],
          target: [0, 0, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 60,
          nearPlane: 0.1,
          farPlane: 1000,
          rollDegrees: 0
        },
        cameraEnd: {
          projectionMode: 'perspective',
          position: [0, 0, 10],
          target: [0, 0, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 60,
          nearPlane: 0.1,
          farPlane: 1000,
          rollDegrees: 0
        },
        cameraEasing: 'linear',
        palette: {
          background: '#000000',
          primary: '#ffffff',
          secondary: '#888888',
          accent: '#ff0000',
          ambientLightColor: '#111111',
          ambientIntensity: 0.5,
          keyLightDirection: [0, 1, 1],
          audioReactiveGain: 1
        },
        narrativeAction: 'Action 1',
        activeRigIds: ['rig_character']
      },
      {
        id: 'shot_2',
        shotIndex: 1,
        actNumber: 2,
        frameRange: { startFrameInclusive: 50, endFrameExclusive: 100 },
        framing: 'CLOSE_UP',
        movement: 'ORBIT',
        viewpoint: 'OBJECTIVE_THIRD_PERSON',
        cameraStart: {
          projectionMode: 'perspective',
          position: [0, 0, 10],
          target: [0, 0, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 60,
          nearPlane: 0.1,
          farPlane: 1000,
          rollDegrees: 0
        },
        cameraEnd: {
          projectionMode: 'perspective',
          position: [0, 0, 10],
          target: [0, 0, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 60,
          nearPlane: 0.1,
          farPlane: 1000,
          rollDegrees: 0
        },
        cameraEasing: 'linear',
        palette: {
          background: '#000000',
          primary: '#ffffff',
          secondary: '#888888',
          accent: '#ff0000',
          ambientLightColor: '#111111',
          ambientIntensity: 0.5,
          keyLightDirection: [0, 1, 1],
          audioReactiveGain: 1
        },
        narrativeAction: 'Action 2',
        activeRigIds: ['rig_character']
      },
      {
        id: 'shot_3',
        shotIndex: 2,
        actNumber: 3,
        frameRange: { startFrameInclusive: 100, endFrameExclusive: 150 },
        framing: 'EXTREME_WIDE',
        movement: 'STATIC',
        viewpoint: 'OBJECTIVE_THIRD_PERSON',
        cameraStart: {
          projectionMode: 'perspective',
          position: [0, 0, 10],
          target: [0, 0, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 60,
          nearPlane: 0.1,
          farPlane: 1000,
          rollDegrees: 0
        },
        cameraEnd: {
          projectionMode: 'perspective',
          position: [0, 0, 10],
          target: [0, 0, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 60,
          nearPlane: 0.1,
          farPlane: 1000,
          rollDegrees: 0
        },
        cameraEasing: 'linear',
        palette: {
          background: '#000000',
          primary: '#ffffff',
          secondary: '#888888',
          accent: '#ff0000',
          ambientLightColor: '#111111',
          ambientIntensity: 0.5,
          keyLightDirection: [0, 1, 1],
          audioReactiveGain: 1
        },
        narrativeAction: 'Action 3',
        activeRigIds: ['rig_character']
      }
    ]
  };

  const rigs = new Map<string, AssetRigContract>([
    [
      'rig_character',
      {
        id: 'rig_character',
        name: 'Main Character',
        type: 'character',
        parallaxDepthZ: 0,
        baseTransform: {
          position: [0, 0, 0],
          rotationZDegrees: 0,
          scale: [1, 1]
        },
        skeleton: {
          rootJointId: 'joint_root',
          joints: [
            { id: 'joint_root', parentId: null, localOffset2D: [0, 0], length: 10, rotationZDegrees: 0 },
            { id: 'joint_arm', parentId: 'joint_root', localOffset2D: [0, 10], length: 5, rotationZDegrees: 45 }
          ]
        },
        svgAsset: {
          idNamespace: 'char_ns',
          viewBox: '0 0 100 100'
        }
      }
    ]
  ]);

  return { audioManifest, storyboard, renderConfig, rigs };
}

test('Invariants: Valid contract passes with zero errors', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, true);
  assert.equal(report.errors.length, 0);
});

test('Invariants: Detects missing rig in storyboard activeRigIds', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  storyboard.shots[0].activeRigIds.push('non_existent_rig');

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'RIG_NOT_FOUND'));
});

test('Invariants: Detects timeline gap between shots', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  // Introduce gap: shot 1 ends at 50, shot 2 starts at 60
  storyboard.shots[1].frameRange.startFrameInclusive = 60;

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'SHOT_TIMELINE_GAP'));
});

test('Invariants: Detects timeline overlap between shots', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  // Introduce overlap: shot 1 ends at 50, shot 2 starts at 40
  storyboard.shots[1].frameRange.startFrameInclusive = 40;

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'SHOT_TIMELINE_OVERLAP'));
});

test('Invariants: Rejects storyboard when first shot does not start at frame 0', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  storyboard.shots[0].frameRange.startFrameInclusive = 5;

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'FIRST_SHOT_START_NON_ZERO'));
});

test('Invariants: Rejects storyboard when last shot does not end at totalFrames', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  storyboard.shots[2].frameRange.endFrameExclusive = 145; // totalFrames is 150

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'LAST_SHOT_END_MISMATCH'));
});

test('Invariants: Rejects shot that exceeds act boundaries', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  // Act 1 is [0, 50), let shot 1 extend to 55
  storyboard.shots[0].frameRange.endFrameExclusive = 55;
  storyboard.shots[1].frameRange.startFrameInclusive = 55;

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'SHOT_OUTSIDE_ACT_BOUNDARY'));
});

test('Invariants: Rejects shot with frame range inverted or out of bounds', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  storyboard.shots[0].frameRange.startFrameInclusive = 50;
  storyboard.shots[0].frameRange.endFrameExclusive = 20;

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'SHOT_FRAME_RANGE_INVERTED'));
});

test('Invariants: Detects joint hierarchy cycle in rig skeleton', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  const charRig = rigs.get('rig_character')!;
  // Create cycle: root -> arm -> root
  charRig.skeleton!.joints[0].parentId = 'joint_arm';

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(
    report.errors.some(
      (e) => e.code === 'SKELETON_CYCLE_DETECTED' || e.code === 'SKELETON_ROOT_COUNT_INVALID'
    )
  );
});

test('Invariants: Rejects audio manifest when durationSeconds * fps differs from totalFrames by > 1', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  // durationSeconds = 5.2s, fps = 30 -> expected 156 frames, but totalFrames = 150 (diff: 6 > 1)
  audioManifest.metadata.durationSeconds = 5.2;

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);

  const durationError = report.errors.find((e) => e.code === 'AUDIO_DURATION_TOTAL_FRAMES_MISMATCH');
  assert.ok(durationError, 'Expected AUDIO_DURATION_TOTAL_FRAMES_MISMATCH error');
  assert.equal(durationError.severity, 'fatal');
  // Ensure the error message includes durationSeconds, fps, expected frame count, and actual totalFrames
  assert.ok(durationError.message.includes('5.2'), 'Error message must include durationSeconds');
  assert.ok(durationError.message.includes('30'), 'Error message must include fps');
  assert.ok(durationError.message.includes('156'), 'Error message must include expected frame count');
  assert.ok(durationError.message.includes('150'), 'Error message must include actual totalFrames');
});

test('Invariants: Accepts audio manifest when durationSeconds * fps is within boundary tolerance (<= 1 frame)', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  // durationSeconds = 5.03s, fps = 30 -> 150.9 frames (diff: 0.9 <= 1.0)
  audioManifest.metadata.durationSeconds = 5.03;

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, true);
  assert.equal(report.errors.some((e) => e.code === 'AUDIO_DURATION_TOTAL_FRAMES_MISMATCH'), false);

  // Exact boundary: 5.03333333s * 30 = 151 (diff: exactly 1.0)
  audioManifest.metadata.durationSeconds = 151 / 30;
  const reportBoundary = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(reportBoundary.isValid, true);
  assert.equal(reportBoundary.errors.some((e) => e.code === 'AUDIO_DURATION_TOTAL_FRAMES_MISMATCH'), false);
});
