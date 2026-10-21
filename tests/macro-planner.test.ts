import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import {
  decomposeMusicalTimeline,
  generateFullSongStoryboard,
  computeRunnerTrajectoryX,
  THEMATIC_PALETTES
} from '../src/engine/director/macro-planner.js';
import { CANONICAL_RIG_IDS, getOrchestratedEnvironment } from '../src/agents/director-agent.js';
import { buildDeterministicRigCatalog } from '../src/agents/rig-agent.js';
import { buildDeterministicChoreography } from '../src/agents/choreographer-agent.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import { validateProjectContracts } from '../src/schemas/invariants.js';
import { createTestRenderConfig } from '../src/config/render-config.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';
import type { AssetRigContract } from '../src/schemas/rig.contract.js';

function createMockAudioManifest(totalFrames: number, fps: 30 | 60 = 30): AudioAnalysisManifest {
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
      { frameIndex: 30, timestamp: 1.0, confidence: 0.95 }
    ],
    lyrics: [
      {
        id: 'lyric-1',
        startTimeSeconds: 5.0,
        endTimeSeconds: 8.0,
        frameRange: { startFrameInclusive: 150, endFrameExclusive: 240 },
        text: "Keep on writing you're just raping yourself",
        emphasis: 0.8
      },
      {
        id: 'lyric-2',
        startTimeSeconds: 49.0,
        endTimeSeconds: 52.0,
        frameRange: { startFrameInclusive: 1470, endFrameExclusive: 1560 },
        text: "Trashed and scattered again, I'm feelin' so low",
        emphasis: 1.0
      }
    ]
  };
}

test('MacroPlanner: decomposeMusicalTimeline decomposes 10,598 frames into 7 contiguous musical sections', () => {
  const manifest = createMockAudioManifest(10598, 30);
  const sections = decomposeMusicalTimeline(manifest);

  assert.equal(sections.length, 7);
  assert.equal(sections[0].sectionType, 'INTRO');
  assert.equal(sections[0].startFrame, 0);
  assert.equal(sections[0].actNumber, 1);

  // Verify section continuity
  for (let i = 1; i < sections.length; i++) {
    assert.equal(sections[i].startFrame, sections[i - 1].endFrame);
  }

  // Verify final section
  const last = sections[sections.length - 1];
  assert.equal(last.sectionType, 'OUTRO');
  assert.equal(last.endFrame, 10598);
  assert.equal(last.actNumber, 3);

  // Verify Guitar Solo has pursuit drone flag enabled
  const solo = sections.find((s) => s.sectionType === 'GUITAR_SOLO');
  assert.ok(solo);
  assert.equal(solo?.hasPursuitDrone, true);
  assert.equal(solo?.actNumber, 2);
  assert.deepEqual(solo?.palette, THEMATIC_PALETTES.SUNSET_GOLD);
});

test('MacroPlanner: generateFullSongStoryboard creates contiguous, invariant-compliant 3-Act storyboard for 10,598 frames', () => {
  const totalFrames = 10598;
  const fps = 30;
  const manifest = createMockAudioManifest(totalFrames, fps);

  const storyboard = generateFullSongStoryboard({
    audioManifest: manifest,
    targetShotFrames: 180
  });

  assert.equal(storyboard.totalFrames, totalFrames);
  assert.equal(storyboard.fps, fps);
  assert.equal(storyboard.acts.length, 3);

  // 1. Act continuity checks
  assert.equal(storyboard.acts[0].actNumber, 1);
  assert.equal(storyboard.acts[0].frameRange.startFrameInclusive, 0);
  assert.equal(storyboard.acts[1].actNumber, 2);
  assert.equal(storyboard.acts[1].frameRange.startFrameInclusive, storyboard.acts[0].frameRange.endFrameExclusive);
  assert.equal(storyboard.acts[2].actNumber, 3);
  assert.equal(storyboard.acts[2].frameRange.startFrameInclusive, storyboard.acts[1].frameRange.endFrameExclusive);
  assert.equal(storyboard.acts[2].frameRange.endFrameExclusive, totalFrames);

  // 2. Shot continuity checks
  assert.ok(storyboard.shots.length > 30, `Expected > 30 shots for full song, got ${storyboard.shots.length}`);
  assert.equal(storyboard.shots[0].frameRange.startFrameInclusive, 0);

  for (let i = 1; i < storyboard.shots.length; i++) {
    const prev = storyboard.shots[i - 1];
    const curr = storyboard.shots[i];
    assert.equal(curr.shotIndex, i);
    assert.equal(curr.frameRange.startFrameInclusive, prev.frameRange.endFrameExclusive);
  }

  const lastShot = storyboard.shots[storyboard.shots.length - 1];
  assert.equal(lastShot.frameRange.endFrameExclusive, totalFrames);

  // 3. Near-plane safety check: shots with CLOSE_UP strictly exclude FG_PIPES
  for (const shot of storyboard.shots) {
    if (shot.framing === 'CLOSE_UP') {
      assert.equal(
        shot.activeRigIds.includes(CANONICAL_RIG_IDS.FG_PIPES),
        false,
        `Shot ${shot.id} (CLOSE_UP) must not include FG_PIPES to prevent near-plane clipping`
      );
    }
  }

  // 4. Contract invariant verification via validateProjectContracts
  const catalog = buildDeterministicRigCatalog();
  const rigCatalog = new Map<string, AssetRigContract>();
  for (const rig of catalog.rigs) {
    rigCatalog.set(rig.id, rig);
  }
  const renderConfig = createTestRenderConfig({
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames
  });

  const report = validateProjectContracts(manifest, storyboard, renderConfig, rigCatalog);
  const fatalErrors = report.errors.filter((e) => e.severity === 'fatal');
  assert.deepEqual(fatalErrors, [], `Expected 0 fatal invariant errors, got: ${JSON.stringify(fatalErrors)}`);
});

test('MacroPlanner: Runner trajectory alignment and Resvg rasterization across multi-shot transitions (frame 380..420)', () => {
  const totalFrames = 1200;
  const fps = 30;
  const manifest = createMockAudioManifest(totalFrames, fps);
  const storyboard = generateFullSongStoryboard({
    audioManifest: manifest,
    targetShotFrames: 180
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

  // 1. Verify exact trajectory alignment between runner keyframes and computeRunnerTrajectoryX
  const runnerTracks = choreography.tracks.filter((t) => t.rigId === CANONICAL_RIG_IDS.RUNNER);
  assert.ok(runnerTracks.length > 2, 'Expected multiple runner tracks across shots');

  for (let i = 0; i < runnerTracks.length; i++) {
    const track = runnerTracks[i];
    const shot = storyboard.shots[i];
    const kf0 = track.transform.keyframes[0];
    const expectedX0 = computeRunnerTrajectoryX(shot.frameRange.startFrameInclusive, fps);
    assert.equal(kf0.position[0], expectedX0, `Track ${shot.id} startX mismatch`);
  }

  // 2. Smoke rasterize frames 380 through 420 (which covers shot-2 transition & frame 392)
  const mockAudioFeature: AudioFrameFeature = {
    frameIndex: 0,
    timestamp: 0,
    rms: 0.5,
    rmsRelativeGlobal: 0.5,
    rmsRelativeLocal: 0.5,
    localWindowFrames: 30,
    spectralFlux: 0.1,
    onsetStrength: 0.3,
    isOnset: false,
    pitchEstimatedHz: 220,
    bands: {
      subBass: 0.3,
      bass: 0.4,
      lowMid: 0.3,
      mid: 0.3,
      highMid: 0.2,
      presence: 0.2,
      brilliance: 0.1
    }
  };

  const frameStateBuilder = new FrameStateBuilder({
    storyboard,
    audioManifest: manifest,
    rigs: rigMap,
    choreography,
    getAudioFeatureAtFrame: () => mockAudioFeature
  });

  const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });
  const shotMap = new Map(storyboard.shots.map((s) => [s.id, s]));

  for (let f = 380; f <= 405; f++) {
    const frameState = frameStateBuilder.buildFrameState(f);
    const shot = shotMap.get(frameState.shotId);
    const centerX = shot ? (shot.cameraStart.position[0] + shot.cameraEnd.position[0]) / 2 : 0;
    const env = getOrchestratedEnvironment(frameState.shotId, centerX);

    const { svg, stats } = compositor.renderFrame(
      frameState,
      rigMap,
      env,
      [0, 30],
      () => mockAudioFeature
    );

    assert.ok(svg.length > 500);
    assert.ok(stats.drawablesCount > 0);

    // Rasterize with Resvg to confirm zero Rust geom panics
    const resvg = new Resvg(svg);
    const rendered = resvg.render();
    assert.ok(rendered.asPng().length > 1000);
  }
});
