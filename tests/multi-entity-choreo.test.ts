import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicRigCatalog, RigCatalogContractSchema } from '../src/agents/rig-agent.js';
import { buildDeterministicChoreography } from '../src/agents/choreographer-agent.js';
import { CANONICAL_RIG_IDS } from '../src/agents/director-agent.js';
import { generateFullSongStoryboard } from '../src/engine/director/macro-planner.js';
import { validateChoreography } from '../src/schemas/invariants.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';
import type { AssetRigContract } from '../src/schemas/rig.contract.js';

function createMockFullSongManifest(totalFrames = 1200, fps: 30 | 60 = 30): AudioAnalysisManifest {
  const durationSeconds = totalFrames / fps;
  return {
    metadata: {
      audioFilePath: 'mock.wav',
      durationSeconds,
      sampleRate: 44100,
      fps,
      totalFrames,
      tempoBpm: 140
    },
    normalization: {
      globalRmsMax: 1.0,
      localWindowFrames: 30
    },
    storageReference: {
      type: 'external_binary',
      columnLayoutVersion: 1,
      binaryFilePath: 'mock.features.bin',
      byteLength: totalFrames * 53 + 32,
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    },
    beatEvents: [
      { frameIndex: 0, timestamp: 0, confidence: 0.9 },
      { frameIndex: 120, timestamp: 4.0, confidence: 0.95 }
    ],
    lyrics: [
      {
        id: 'lyric-1',
        startTimeSeconds: 1.0,
        endTimeSeconds: 4.0,
        frameRange: { startFrameInclusive: 30, endFrameExclusive: 120 },
        text: 'Testing multi-rig pursuit enforcer kinematics',
        emphasis: 0.8
      }
    ]
  };
}

function createMockAudioFeature(): AudioFrameFeature {
  return {
    frameIndex: 0,
    timestamp: 0,
    rms: 0.45,
    rmsRelativeGlobal: 0.45,
    rmsRelativeLocal: 0.5,
    localWindowFrames: 30,
    spectralFlux: 0.2,
    onsetStrength: 0.5,
    isOnset: false,
    pitchEstimatedHz: 220,
    bands: {
      subBass: 0.4,
      bass: 0.5,
      lowMid: 0.3,
      mid: 0.35,
      highMid: 0.25,
      presence: 0.2,
      brilliance: 0.15
    }
  };
}

test('MultiEntity: Rig catalog contains valid pursuit drone rig matching AssetRigContractSchema', () => {
  const catalog = buildDeterministicRigCatalog();
  const parsed = RigCatalogContractSchema.safeParse(catalog);
  assert.equal(parsed.success, true, `RigCatalogContractSchema parsing failed: ${JSON.stringify(parsed)}`);

  const droneRig = catalog.rigs.find((r) => r.id === CANONICAL_RIG_IDS.PURSUIT_DRONE);
  assert.ok(droneRig, 'Expected pursuit drone rig to exist in deterministic catalog');
  assert.equal(droneRig?.type, 'character');
  assert.equal(droneRig?.renderMode, 'billboard');
  assert.equal(droneRig?.skeleton?.rootJointId, 'chassis_core');
  assert.equal(droneRig?.parts.length, 7);
  assert.equal(droneRig?.svgAsset.idNamespace, 'drone');
});

test('MultiEntity: Choreographer synthesizes continuous drone flight tracks and passes validateChoreography', () => {
  const totalFrames = 1200;
  const manifest = createMockFullSongManifest(totalFrames, 30);
  const storyboard = generateFullSongStoryboard({
    audioManifest: manifest,
    targetShotFrames: 150
  });

  const catalog = buildDeterministicRigCatalog();
  const rigMap = new Map<string, AssetRigContract>();
  for (const rig of catalog.rigs) {
    rigMap.set(rig.id, rig);
  }

  const choreography = buildDeterministicChoreography({
    storyboard,
    rigs: rigMap,
    audioManifest: manifest
  });

  // Verify that shots with PURSUIT_DRONE contain corresponding entity tracks
  const droneShots = storyboard.shots.filter((s) =>
    s.activeRigIds.includes(CANONICAL_RIG_IDS.PURSUIT_DRONE)
  );
  assert.ok(droneShots.length > 0, 'Expected at least one shot to feature pursuit drone');

  for (const shot of droneShots) {
    const droneTrack = choreography.tracks.find(
      (t) => t.shotId === shot.id && t.rigId === CANONICAL_RIG_IDS.PURSUIT_DRONE
    );
    assert.ok(droneTrack, `Expected choreography track for drone in shot "${shot.id}"`);
    assert.ok(droneTrack?.transform.keyframes.length >= 1);
  }

  // Validate choreography invariants
  const report = validateChoreography(choreography, storyboard, rigMap);
  const fatalErrors = report.errors.filter((e) => e.severity === 'fatal');
  assert.deepEqual(fatalErrors, [], `Expected 0 fatal errors, got: ${JSON.stringify(fatalErrors)}`);
});

test('MultiEntity: SceneCompositor depth-sorts runner and pursuit drone simultaneously with valid SVG output', () => {
  const totalFrames = 600;
  const manifest = createMockFullSongManifest(totalFrames, 30);
  const storyboard = generateFullSongStoryboard({
    audioManifest: manifest,
    targetShotFrames: 150
  });

  const catalog = buildDeterministicRigCatalog();
  const rigMap = new Map<string, AssetRigContract>();
  for (const rig of catalog.rigs) {
    rigMap.set(rig.id, rig);
  }

  const choreography = buildDeterministicChoreography({
    storyboard,
    rigs: rigMap,
    audioManifest: manifest
  });

  const frameStateBuilder = new FrameStateBuilder({
    storyboard,
    audioManifest: manifest,
    rigs: rigMap,
    choreography,
    getAudioFeatureAtFrame: () => createMockAudioFeature()
  });

  const compositor = new SceneCompositor({
    width: 1920,
    height: 1080
  });

  // Find a frame where PURSUIT_DRONE is active
  const droneShot = storyboard.shots.find((s) =>
    s.activeRigIds.includes(CANONICAL_RIG_IDS.PURSUIT_DRONE)
  );
  assert.ok(droneShot, 'Expected a shot featuring pursuit drone');

  const testFrameIndex = droneShot!.frameRange.startFrameInclusive + 10;
  const frameState = frameStateBuilder.buildFrameState(testFrameIndex);

  const activeDrone = frameState.entities.find(
    (e) => e.rigId === CANONICAL_RIG_IDS.PURSUIT_DRONE
  );
  assert.ok(activeDrone, 'Expected active entity state for pursuit drone');

  const output = compositor.renderFrame(
    frameState,
    rigMap,
    {},
    [0, 120],
    () => createMockAudioFeature()
  );

  assert.ok(output.svg.length > 500, 'Expected non-trivial SVG output');
  assert.ok(output.svg.includes('<svg'), 'Expected valid SVG opening tag');
  assert.ok(output.svg.includes('</svg>'), 'Expected valid SVG closing tag');
  assert.ok(output.stats.drawablesCount > 0, 'Expected drawables count > 0');
  assert.ok(output.stats.drawablesCount < 220, 'Expected drawables count to stay within green budget (< 220)');
});
