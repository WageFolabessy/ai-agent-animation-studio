import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import {
  buildRooftopEnvironment,
  buildHighwayEnvironment,
  buildBridgeEnvironment,
  buildReactorTunnelEnvironment
} from '../src/engine/director/environment-generator.js';
import {
  generateFullSongStoryboard,
  THEMATIC_PALETTES
} from '../src/engine/director/macro-planner.js';
import {
  buildDeterministicRigCatalog,
  RigCatalogContractSchema
} from '../src/agents/rig-agent.js';
import { CANONICAL_RIG_IDS, getOrchestratedEnvironment } from '../src/agents/director-agent.js';
import { buildDeterministicChoreography } from '../src/agents/choreographer-agent.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import { validateChoreography, validateProjectContracts } from '../src/schemas/invariants.js';
import { createTestRenderConfig } from '../src/config/render-config.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';
import type { AssetRigContract } from '../src/schemas/rig.contract.js';

function createMockAudioManifest(totalFrames = 10598, fps: 30 | 60 = 30): AudioAnalysisManifest {
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
        startTimeSeconds: 1.0,
        endTimeSeconds: 4.0,
        frameRange: { startFrameInclusive: 30, endFrameExclusive: 120 },
        text: 'Testing multi-zone narrative environments',
        emphasis: 0.8
      }
    ]
  };
}

function createMockAudioFeature(frameIndex = 0): AudioFrameFeature {
  return {
    frameIndex,
    timestamp: frameIndex / 30,
    rms: 0.5,
    rmsRelativeGlobal: 0.5,
    rmsRelativeLocal: 0.5,
    localWindowFrames: 30,
    spectralFlux: 0.2,
    onsetStrength: 0.4,
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

test('EnvironmentNarrative: Generates valid 3D geometry across all 4 visual zones within drawable budgets', () => {
  const palette = THEMATIC_PALETTES.CYBERPUNK_CYAN;

  // 1. Rooftop Zone
  const rooftop = buildRooftopEnvironment(1000, palette);
  assert.ok(rooftop.polygons && rooftop.polygons.length >= 3, 'Expected rooftop floor and HVAC polygons');
  assert.ok(rooftop.lines && rooftop.lines.length >= 5, 'Expected parapet and stanchion lines');
  const rooftopDrawables = (rooftop.polygons?.length ?? 0) + (rooftop.lines?.length ?? 0);
  assert.ok(rooftopDrawables < 40, `Rooftop drawables (${rooftopDrawables}) exceeds 40`);

  // 2. Highway Zone
  const highway = buildHighwayEnvironment(1000, palette);
  assert.ok(highway.polygons && highway.polygons.length >= 2, 'Expected road floor and Jersey barrier polygons');
  assert.ok(highway.lines && highway.lines.length >= 10, 'Expected lane dashes and truss lines');
  const highwayDrawables = (highway.polygons?.length ?? 0) + (highway.lines?.length ?? 0);
  assert.ok(highwayDrawables < 45, `Highway drawables (${highwayDrawables}) exceeds 45`);

  // 3. Bridge Zone
  const bridge = buildBridgeEnvironment(1000, palette);
  assert.ok(bridge.polygons && bridge.polygons.length >= 1, 'Expected bridge deck polygon');
  assert.ok(bridge.lines && bridge.lines.length >= 8, 'Expected suspension cables and pylon lines');
  const bridgeDrawables = (bridge.polygons?.length ?? 0) + (bridge.lines?.length ?? 0);
  assert.ok(bridgeDrawables < 40, `Bridge drawables (${bridgeDrawables}) exceeds 40`);

  // 4. Reactor Zone
  const reactor = buildReactorTunnelEnvironment(1000, palette);
  assert.ok(reactor.polygons && reactor.polygons.length >= 1, 'Expected catwalk polygon');
  assert.ok(reactor.lines && reactor.lines.length >= 20, 'Expected tunnel portal arch ribs');
  const reactorDrawables = (reactor.polygons?.length ?? 0) + (reactor.lines?.length ?? 0);
  assert.ok(reactorDrawables < 45, `Reactor drawables (${reactorDrawables}) exceeds 45`);
});

test('EnvironmentNarrative: New thematic rigs pass AssetRigContractSchema validation', () => {
  const catalog = buildDeterministicRigCatalog();
  const parsed = RigCatalogContractSchema.safeParse(catalog);
  assert.equal(parsed.success, true, `RigCatalogContractSchema error: ${JSON.stringify(parsed)}`);

  const gantry = catalog.rigs.find((r) => r.id === CANONICAL_RIG_IDS.HIGHWAY_GANTRY);
  assert.ok(gantry, 'Expected HIGHWAY_GANTRY rig in catalog');
  assert.equal(gantry?.parts.length, 4);

  const billboard = catalog.rigs.find((r) => r.id === CANONICAL_RIG_IDS.NEON_BILLBOARD);
  assert.ok(billboard, 'Expected NEON_BILLBOARD rig in catalog');
  assert.equal(billboard?.parts.length, 4);

  const bridgePylon = catalog.rigs.find((r) => r.id === CANONICAL_RIG_IDS.BRIDGE_PYLON);
  assert.ok(bridgePylon, 'Expected BRIDGE_PYLON rig in catalog');
  assert.equal(bridgePylon?.parts.length, 4);

  const reactorCore = catalog.rigs.find((r) => r.id === CANONICAL_RIG_IDS.REACTOR_CORE);
  assert.ok(reactorCore, 'Expected REACTOR_CORE rig in catalog');
  assert.equal(reactorCore?.parts.length, 4);
});

test('EnvironmentNarrative: MacroPlanner decomposes timeline into 4 distinct story zones and validates choreography', () => {
  const manifest = createMockAudioManifest(10598, 30);
  const storyboard = generateFullSongStoryboard({
    audioManifest: manifest,
    targetShotFrames: 180
  });

  const zonesFound = new Set(storyboard.shots.map((s) => s.environmentZone));
  assert.ok(zonesFound.has('ROOFTOP'), 'Expected ROOFTOP zone shots');
  assert.ok(zonesFound.has('HIGHWAY'), 'Expected HIGHWAY zone shots');
  assert.ok(zonesFound.has('BRIDGE'), 'Expected BRIDGE zone shots');
  assert.ok(zonesFound.has('REACTOR'), 'Expected REACTOR zone shots');

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

  // Verify choreography invariants pass with zero fatal errors
  const choreoReport = validateChoreography(choreography, storyboard, rigMap);
  const fatalErrors = choreoReport.errors.filter((e) => e.severity === 'fatal');
  assert.deepEqual(fatalErrors, [], `Expected 0 fatal choreography errors, got: ${JSON.stringify(fatalErrors)}`);

  // Verify project contract invariants pass
  const renderConfig = createTestRenderConfig({
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 10598
  });
  const projectReport = validateProjectContracts(manifest, storyboard, renderConfig, rigMap);
  const fatalProjectErrors = projectReport.errors.filter((e) => e.severity === 'fatal');
  assert.deepEqual(fatalProjectErrors, [], `Expected 0 fatal project errors, got: ${JSON.stringify(fatalProjectErrors)}`);
});

test('EnvironmentNarrative: SceneCompositor and Resvg rasterize sample frames from each of the 4 zones cleanly', () => {
  const manifest = createMockAudioManifest(10598, 30);
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

  const frameStateBuilder = new FrameStateBuilder({
    storyboard,
    audioManifest: manifest,
    rigs: rigMap,
    choreography,
    getAudioFeatureAtFrame: (f) => createMockAudioFeature(f)
  });

  const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });

  // Pick 1 representative frame from each zone:
  const rooftopShot = storyboard.shots.find((s) => s.environmentZone === 'ROOFTOP');
  const highwayShot = storyboard.shots.find((s) => s.environmentZone === 'HIGHWAY');
  const bridgeShot = storyboard.shots.find((s) => s.environmentZone === 'BRIDGE');
  const reactorShot = storyboard.shots.find((s) => s.environmentZone === 'REACTOR');

  const testShots = [
    { name: 'ROOFTOP', shot: rooftopShot! },
    { name: 'HIGHWAY', shot: highwayShot! },
    { name: 'BRIDGE', shot: bridgeShot! },
    { name: 'REACTOR', shot: reactorShot! }
  ];

  for (const { name, shot } of testShots) {
    assert.ok(shot, `Expected shot for zone ${name}`);
    const sampleFrame = shot.frameRange.startFrameInclusive + 5;
    const frameState = frameStateBuilder.buildFrameState(sampleFrame);

    const centerX = (shot.cameraStart.position[0] + shot.cameraEnd.position[0]) / 2;
    const env = getOrchestratedEnvironment(shot.id, centerX, shot.environmentZone, shot.palette);

    const { svg, stats } = compositor.renderFrame(
      frameState,
      rigMap,
      env,
      [0, 30],
      () => createMockAudioFeature(sampleFrame)
    );

    assert.ok(svg.length > 500, `Zone ${name} produced empty SVG`);
    assert.ok(stats.drawablesCount > 0, `Zone ${name} has 0 drawables`);
    assert.ok(
      stats.drawablesCount < 180,
      `Zone ${name} drawables (${stats.drawablesCount}) exceeds green budget 180`
    );

    // Rasterize with Resvg to confirm zero Rust geom panics
    const resvg = new Resvg(svg);
    const rendered = resvg.render();
    assert.ok(rendered.asPng().length > 1000, `Zone ${name} produced invalid PNG`);
  }
});
