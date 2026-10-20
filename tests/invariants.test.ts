import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectContracts, validateChoreography } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';
import type { DirectorStoryboardContract } from '../src/schemas/storyboard.contract.js';
import type { AssetRigContract } from '../src/schemas/rig.contract.js';
import type { ChoreographyContract } from '../src/schemas/choreography.contract.js';

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
        renderMode: 'billboard',
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
        parts: [
          {
            id: 'part_body',
            jointId: 'joint_root',
            localOffset2D: [0, 0],
            shape: { kind: 'rect', size: [20, 30] },
            style: { fill: { kind: 'solid', color: '#123456' }, opacity: 1, lit: true }
          }
        ],
        secondaryMotion: [],
        svgAsset: {
          idNamespace: 'char_ns'
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

test('Invariants: Detects rig map key mismatch against rig.id', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  const rig = rigs.get('rig_character')!;
  const badMap = new Map<string, AssetRigContract>([['wrong_key', rig]]);

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, badMap);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'RIG_MAP_KEY_MISMATCH'));
});

test('Invariants: Detects camera projectionMode mismatch between start and end', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  // storyboard shot cameraEnd set to orthographic while cameraStart is perspective
  storyboard.shots[0].cameraEnd = {
    projectionMode: 'orthographic',
    position: [0, 0, 100],
    target: [0, 0, 0],
    up: [0, 1, 0],
    nearPlane: 1,
    farPlane: 1000,
    rollDegrees: 0,
    orthographicHeight: 1080
  };

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'CAMERA_PROJECTION_MODE_MISMATCH'));
});

test('Invariants: Detects part referencing non-existent joint or missing skeleton', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  const rig = rigs.get('rig_character')!;
  rig.parts.push({
    id: 'part_orphan',
    jointId: 'joint_does_not_exist',
    localOffset2D: [0, 0],
    shape: { kind: 'rect', size: [10, 10] },
    style: { opacity: 1, lit: true }
  });

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'PART_JOINT_NOT_FOUND'));
});

test('Invariants: Detects morph segment C0 discontinuity', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  const rig = rigs.get('rig_character')!;
  rig.morphTopology = {
    baseSegments: [
      { p0: [0, 0], p1: [10, 10], p2: [20, 10], p3: [30, 0] },
      // Discontinuity: next segment starts at [35, 0] instead of [30, 0]
      { p0: [35, 0], p1: [40, 10], p2: [50, 10], p3: [60, 0] }
    ],
    targets: []
  };

  const report = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.code === 'MORPH_C0_DISCONTINUITY'));
});

test('Invariants: Detects particle emitter requirements and capacity violations', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();
  rigs.set('rig_emitter', {
    id: 'rig_emitter',
    name: 'Particle Emitter',
    type: 'particle_emitter',
    baseTransform: { position: [0, 0, 0], rotationZDegrees: 0, scale: [1, 1] },
    parts: [],
    secondaryMotion: [],
    svgAsset: { idNamespace: 'emitter_ns' }
    // emitter missing!
  });

  const reportNoEmitter = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(reportNoEmitter.isValid, false);
  assert.ok(reportNoEmitter.errors.some((e) => e.code === 'EMITTER_REQUIRED'));

  // Now provide emitter that violates capacity
  const emitterRig = rigs.get('rig_emitter')!;
  emitterRig.emitter = {
    seed: 42,
    maxParticles: 50,
    ratePerSecond: 100, // 100 * (60 frames / 30 fps) = 200 particles > 50 max
    lifetimeFrames: 60,
    spawn: { kind: 'point' },
    velocity: { angleDegrees: 0, spreadDegrees: 45, speedMin: 10, speedMax: 50 },
    gravity: [0, -9.8],
    radiusRange: [1, 5],
    paintRole: 'primary',
    baseOpacity: 0.8
  };

  const reportOverCapacity = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(reportOverCapacity.isValid, false);
  assert.ok(reportOverCapacity.errors.some((e) => e.code === 'EMITTER_CAPACITY'));
});

test('Invariants: validateChoreography validates tracks, detects unknown shot/rig, bounds, and order', () => {
  const { storyboard, rigs } = getValidFixtures();

  const validChoreography: ChoreographyContract = {
    projectId: 'demo_proj',
    tracks: [
      {
        rigId: 'rig_character',
        shotId: 'shot_1',
        transform: {
          keyframes: [
            { frame: 0, position: [0, 0, 0], rotationZDegrees: 0, scale: [1, 1], opacity: 1, easing: 'linear' },
            { frame: 25, position: [100, 0, 0], rotationZDegrees: 10, scale: [1, 1], opacity: 1, easing: 'easeInOutSine' }
          ]
        },
        morphKeyframes: {},
        morphBindings: []
      }
    ]
  };

  const reportValid = validateChoreography(validChoreography, storyboard, rigs);
  assert.equal(reportValid.isValid, true);
  assert.equal(reportValid.errors.length, 0);

  // Unknown shot ID
  const invalidShotChoreo: ChoreographyContract = {
    projectId: 'demo_proj',
    tracks: [
      {
        ...validChoreography.tracks[0],
        shotId: 'shot_unknown'
      }
    ]
  };
  const reportBadShot = validateChoreography(invalidShotChoreo, storyboard, rigs);
  assert.equal(reportBadShot.isValid, false);
  assert.ok(reportBadShot.errors.some((e) => e.code === 'TRACK_SHOT_NOT_FOUND'));

  // Keyframe out of shot bounds (shot 1 is [0, 50), frame 55 is out of bounds)
  const oobChoreo: ChoreographyContract = {
    projectId: 'demo_proj',
    tracks: [
      {
        rigId: 'rig_character',
        shotId: 'shot_1',
        transform: {
          keyframes: [
            { frame: 0, position: [0, 0, 0], rotationZDegrees: 0, scale: [1, 1], opacity: 1, easing: 'linear' },
            { frame: 55, position: [100, 0, 0], rotationZDegrees: 10, scale: [1, 1], opacity: 1, easing: 'easeInOutSine' }
          ]
        },
        morphKeyframes: {},
        morphBindings: []
      }
    ]
  };
  const reportOOB = validateChoreography(oobChoreo, storyboard, rigs);
  assert.equal(reportOOB.isValid, false);
  assert.ok(reportOOB.errors.some((e) => e.code === 'TRACK_KEYFRAME_OUT_OF_BOUNDS'));
});

test('Invariants: Enforces sorted, non-overlapping lyric timeline and time-frame alignment', () => {
  const { audioManifest, storyboard, renderConfig, rigs } = getValidFixtures();

  // 1. Unsorted lyrics
  audioManifest.lyrics = [
    {
      id: 'lyric-b',
      frameRange: { startFrameInclusive: 60, endFrameExclusive: 90 },
      startTimeSeconds: 2.0,
      endTimeSeconds: 3.0,
      text: 'Second line',
      emphasis: 0.8
    },
    {
      id: 'lyric-a',
      frameRange: { startFrameInclusive: 30, endFrameExclusive: 60 },
      startTimeSeconds: 1.0,
      endTimeSeconds: 2.0,
      text: 'First line out of order',
      emphasis: 0.7
    }
  ];
  const reportUnsorted = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(reportUnsorted.isValid, false);
  assert.ok(reportUnsorted.errors.some((e) => e.code === 'LYRIC_TIMELINE_UNSORTED'));

  // 2. Overlapping lyrics
  audioManifest.lyrics = [
    {
      id: 'lyric-1',
      frameRange: { startFrameInclusive: 0, endFrameExclusive: 60 },
      startTimeSeconds: 0.0,
      endTimeSeconds: 2.0,
      text: 'Line 1',
      emphasis: 0.7
    },
    {
      id: 'lyric-2',
      frameRange: { startFrameInclusive: 45, endFrameExclusive: 90 },
      startTimeSeconds: 1.5,
      endTimeSeconds: 3.0,
      text: 'Line 2 overlapping Line 1',
      emphasis: 0.8
    }
  ];
  const reportOverlap = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(reportOverlap.isValid, false);
  assert.ok(reportOverlap.errors.some((e) => e.code === 'LYRIC_TIMELINE_OVERLAP'));

  // 3. Time-frame mismatch (> 1 frame difference between startTimeSeconds * fps and startFrameInclusive)
  audioManifest.lyrics = [
    {
      id: 'lyric-mismatch',
      frameRange: { startFrameInclusive: 0, endFrameExclusive: 60 },
      startTimeSeconds: 0.5, // 0.5 * 30 = frame 15 != 0
      endTimeSeconds: 2.0,
      text: 'Mismatched timestamp',
      emphasis: 0.7
    }
  ];
  const reportMismatch = validateProjectContracts(audioManifest, storyboard, renderConfig, rigs);
  assert.equal(reportMismatch.isValid, false);
  assert.ok(reportMismatch.errors.some((e) => e.code === 'LYRIC_TIME_FRAME_MISMATCH'));
});


