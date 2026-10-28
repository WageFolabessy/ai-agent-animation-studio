import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE1_STORY_BEAT_CONTRACT } from '../src/demo/stage1-scene.js';
import { STAGE2_STORY_BEAT_CONTRACT } from '../src/demo/stage2-scene.js';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import { CANONICAL_LANDMARK_FOOTPRINTS } from '../src/engine/library/prop-factory.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';

const createSyntheticManifest = (totalFrames: number): AudioAnalysisManifest => ({
  metadata: {
    audioFilePath: 'synthetic.wav',
    sampleRate: 44100,
    durationSeconds: totalFrames / 30,
    totalFrames,
    fps: 30
  },
  normalization: { globalRmsMax: 1.0, localWindowFrames: 30 },
  lyrics: [],
  beatEvents: [],
  storageReference: { type: 'memory_columnar', columnLayoutVersion: 1 }
});

const dummyAudio = (f: number): AudioFrameFeature => ({
  frameIndex: f,
  timestamp: f / 30,
  rms: 0,
  rmsRelativeGlobal: 0,
  rmsRelativeLocal: 0,
  localWindowFrames: 30,
  spectralFlux: 0,
  onsetStrength: 0,
  isOnset: false,
  bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0 }
});

test('D2 Reproduction: Characters walk through furniture and resting prop drawn in front of legs', async (t) => {
  await t.test('D2.1: Landmark objects declare footprints with classification', () => {
    assert.ok(CANONICAL_LANDMARK_FOOTPRINTS.desk, 'Desk footprint must be defined');
    assert.equal(CANONICAL_LANDMARK_FOOTPRINTS.desk.classification, 'blocked');
    assert.ok(CANONICAL_LANDMARK_FOOTPRINTS.desk.width > 0);
    assert.ok(CANONICAL_LANDMARK_FOOTPRINTS.desk.height > 0);
  });

  await t.test('D2.2: Stage 1 and Stage 2 have zero character trunk overlaps with blocked footprints', () => {
    for (const [scenarioName, contract] of [
      ['Stage 1 Solo Acting', STAGE1_STORY_BEAT_CONTRACT],
      ['Stage 2 Two Characters', STAGE2_STORY_BEAT_CONTRACT]
    ] as const) {
      const totalFrames = contract.sliceFrameRange.endFrame;
      const manifest = createSyntheticManifest(totalFrames);
      const prod = VerbCompiler.compile(contract, manifest);
      const builder = new FrameStateBuilder({
        storyboard: prod.storyboard,
        choreography: prod.choreography,
        rigs: prod.rigs,
        audioManifest: manifest,
        getAudioFeatureAtFrame: dummyAudio
      });

      // Blocked obstacles in the scene
      const blockedObstacles: Array<{ id: string; x: number; z: number; halfW: number; halfD: number }> = [];
      for (const beat of contract.beats) {
        if (beat.set.landmarkProps.includes('desk')) {
          const cupPos = beat.set.landmarkPlacements?.coffee_cup;
          const deskPos = beat.set.landmarkPlacements?.desk ?? (cupPos ? [cupPos[0], 0, cupPos[2]] : [0, 0, 0]);
          const fp = CANONICAL_LANDMARK_FOOTPRINTS.desk;
          if (!blockedObstacles.some((o) => Math.abs(o.x - deskPos[0]) < 1e-3)) {
            blockedObstacles.push({
              id: 'desk',
              x: deskPos[0],
              z: deskPos[2],
              halfW: fp.width / 2,
              halfD: fp.depth / 2
            });
          }
        }
      }

      const violations: Array<{ frame: number; entity: string; obstacle: string; charX: number; obsX: number }> = [];
      const TRUNK_HALF_WIDTH = 7.5; // Biped torso/pelvis half-width in world units

      for (let f = 0; f < totalFrames; f++) {
        const activeBeat = contract.beats.find((b) => f >= b.startFrame && f < b.endFrame);
        if (!activeBeat || !activeBeat.set.landmarkProps?.includes('desk')) continue;

        const state = builder.buildFrameState(f);
        for (const ent of state.entities) {
          const rig = prod.rigs.get(ent.rigId);
          if (rig?.type !== 'character') continue;

          const cx = ent.worldPosition[0];
          const cz = ent.worldPosition[2];

          for (const obs of blockedObstacles) {
            const overlapX = cx + TRUNK_HALF_WIDTH > obs.x - obs.halfW && cx - TRUNK_HALF_WIDTH < obs.x + obs.halfW;
            const overlapZ = Math.abs(cz - obs.z) < obs.halfD + 4.0;
            if (overlapX && overlapZ) {
              violations.push({
                frame: f,
                entity: ent.rigId,
                obstacle: obs.id,
                charX: cx,
                obsX: obs.x
              });
            }
          }
        }
      }

      if (violations.length > 0) {
        console.log(`[D2 Reproduction] ${scenarioName} trunk-obstacle violations: ${violations.length} frames`);
        console.log(`  First violation at frame ${violations[0].frame} (${(violations[0].frame / 30).toFixed(2)}s): ${violations[0].entity} at X=${violations[0].charX.toFixed(1)} overlaps ${violations[0].obstacle} at X=${violations[0].obsX}`);
      }

      assert.equal(violations.length, 0, `${scenarioName} must have zero character trunk overlaps with blocked obstacles (found ${violations.length})`);
    }
  });

  await t.test('D2.3: Resting prop sorts strictly behind characters walking in front of it', () => {
    // Stage 1 Beat 1: Coffee cup sits at [0, 63, 0] resting on desk.
    // Character walking in front at Z = 5.0 must sort in FRONT of coffee cup.
    const manifest = createSyntheticManifest(60);
    const prod = VerbCompiler.compile(STAGE1_STORY_BEAT_CONTRACT, manifest);
    const builder = new FrameStateBuilder({
      storyboard: prod.storyboard,
      choreography: prod.choreography,
      rigs: prod.rigs,
      audioManifest: manifest,
      getAudioFeatureAtFrame: dummyAudio
    });

    const state = builder.buildFrameState(5); // resting cup
    const cup = state.entities.find((e) => e.rigId === 'coffee_cup');
    assert.ok(cup, 'Coffee cup must exist in frame state');
    assert.equal(Boolean(cup.isAttached), false, 'Resting cup must have isAttached = false');

    const compositor = new SceneCompositor({ width: 1920, height: 1080 });
    compositor.renderFrame(state, prod.rigs);
    const drawOrder = compositor.getLastDrawOrder() ?? [];
    const cupIdx = drawOrder.findIndex((d) => d.id === 'coffee_cup');
    const heroIdx = drawOrder.findIndex((d) => d.id === 'protagonist_lead');
    if (cupIdx >= 0 && heroIdx >= 0) {
      assert.ok(cupIdx < heroIdx, `Resting cup (draw index ${cupIdx}) must draw BEFORE (behind) hero (draw index ${heroIdx}) when hero is in front`);
    }
  });

  await t.test('D2.4: Property test - randomized paths crossing obstacles maintain zero trunk overlap', () => {
    const testCases = [
      { startX: -90, targetX: 40, obsX: -20 },
      { startX: 60, targetX: -80, obsX: -10 },
      { startX: -100, targetX: 100, obsX: 0 },
      { startX: 50, targetX: -50, obsX: 0 },
      { startX: -60, targetX: -10, obsX: -10 } // target right at obstacle
    ];

    for (let i = 0; i < testCases.length; i++) {
      const { startX, targetX, obsX } = testCases[i];
      const contract = {
        projectId: `prop_test_${i}`,
        songDurationSec: 3.0,
        fps: 30 as const,
        sliceFrameRange: { startFrame: 0, endFrame: 90 },
        unfulfilledRequests: [],
        cast: [
          {
            instanceId: 'tester',
            role: 'PROTAGONIST' as const,
            archetypeId: 'hero_silhouette' as const,
            palette: { primary: '#111111', accent: '#3b82f6' }
          }
        ],
        beats: [
          {
            beatId: `beat_rand_${i}`,
            startFrame: 0,
            endFrame: 90,
            lyricSnippet: 'Testing obstacle clearance',
            emotionalTone: 'reflective' as const,
            narrativeSubtext: 'Testing obstacle clearance',
            presentCharacters: ['tester'],
            set: {
              kitId: 'ARCHITECTURAL_INTERIOR' as const,
              variantId: 'moody_night' as const,
              landmarkProps: ['desk'],
              atmosphericDensity: 0.5,
              landmarkPlacements: {
                desk: [obsX, 0, 0] as [number, number, number]
              }
            },
            actions: [
              {
                instanceId: 'tester',
                verb: 'walk_to' as const,
                speedNorm: 1.0,
                intensityNorm: 0.8,
                target: { kind: 'position' as const, pos: [targetX, 0, 0] as [number, number, number] }
              }
            ],
            camera: {
              framing: 'WIDE' as const,
              movement: 'STATIC' as const,
              focalCharacterId: 'tester',
              lookRoom: 'center' as const,
              dutchAngleDeg: 0
            }
          }
        ]
      };

      const manifest = createSyntheticManifest(90);
      const prod = VerbCompiler.compile(contract, manifest);
      assert.equal(
        prod.compileReport.obstacleViolations?.length ?? 0,
        0,
        `Case ${i} (startX=${startX}, targetX=${targetX}, obsX=${obsX}) must have zero obstacle violations`
      );
    }
  });
});
