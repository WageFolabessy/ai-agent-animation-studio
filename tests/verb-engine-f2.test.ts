import test from 'node:test';
import assert from 'node:assert/strict';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { validateProjectContracts, validateChoreography } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';
import type { StoryBeatContract, StoryBeat } from '../src/schemas/story-beat.contract.js';

test('F2 Verb Compiler Multi-Beat & Invariant Suite', async (t) => {
  const createBaseContract = (beats: StoryBeat[], totalFrames: number): StoryBeatContract => ({
    projectId: 'test_f2_contract',
    songDurationSec: totalFrames / 30,
    fps: 30,
    sliceFrameRange: { startFrame: 0, endFrame: totalFrames },
    cast: [
      {
        instanceId: 'hero',
        role: 'PROTAGONIST',
        archetypeId: 'hero_silhouette',
        palette: { primary: '#0a1128', accent: '#00f0ff' }
      }
    ],
    beats,
    unfulfilledRequests: []
  });

  const createBeat = (
    beatId: string,
    startFrame: number,
    endFrame: number,
    actions?: StoryBeat['actions']
  ): StoryBeat => ({
    beatId,
    startFrame,
    endFrame,
    lyricSnippet: '',
    emotionalTone: 'reflective',
    narrativeSubtext: 'f2 test beat',
    presentCharacters: ['hero'],
    set: {
      kitId: 'ARCHITECTURAL_INTERIOR',
      variantId: 'moody_night',
      landmarkProps: actions?.some(a => a.associatedPropId || a.target?.kind === 'prop') ? ['coffee_cup'] : [],
      landmarkPlacements: {
        coffee_cup: [0, 68, 0]
      },
      atmosphericDensity: 0.5
    },
    camera: {
      framing: 'WIDE',
      movement: 'STATIC',
      focalCharacterId: 'hero',
      lookRoom: 'center',
      dutchAngleDeg: 0
    },
    actions: actions ?? [
      {
        instanceId: 'hero',
        verb: 'walk_to',
        target: { kind: 'position', pos: [20, 0, 0] },
        speedNorm: 1.0,
        intensityNorm: 0.7
      }
    ]
  });

  await t.test('Compiles and passes project & choreography invariants for 1, 2, 3, 4, and 40 beats', () => {
    const testBeatCounts = [
      { count: 1, totalFrames: 90 },
      { count: 2, totalFrames: 72 },
      { count: 3, totalFrames: 36 }, // 3 x 12 frames minimal beat length
      { count: 4, totalFrames: 120 },
      { count: 40, totalFrames: 480 } // 40 x 12 frames
    ];

    for (const { count, totalFrames } of testBeatCounts) {
      const beatLen = Math.floor(totalFrames / count);
      const beats: StoryBeat[] = [];
      for (let i = 0; i < count; i++) {
        const s = i * beatLen;
        const e = i === count - 1 ? totalFrames : (i + 1) * beatLen;
        beats.push(createBeat(`beat_${String(i + 1).padStart(2, '0')}`, s, e));
      }

      const contract = createBaseContract(beats, totalFrames);
      const production = VerbCompiler.compile(contract);

      // Verify Act invariants: exactly 3 acts covering the full timeline contiguously
      assert.equal(production.storyboard.acts.length, 3, `Must produce 3 acts for ${count} beats`);
      assert.equal(production.storyboard.acts[0].frameRange.startFrameInclusive, 0);
      assert.equal(
        production.storyboard.acts[0].frameRange.endFrameExclusive,
        production.storyboard.acts[1].frameRange.startFrameInclusive
      );
      assert.equal(
        production.storyboard.acts[1].frameRange.endFrameExclusive,
        production.storyboard.acts[2].frameRange.startFrameInclusive
      );
      assert.equal(
        production.storyboard.acts[2].frameRange.endFrameExclusive,
        totalFrames
      );

      // Verify shot subdivision reporting
      if (count === 1) {
        assert.equal(production.compileReport.shotSubdivisions.length, 3);
        assert.equal(production.storyboard.shots.length, 3);
      } else if (count === 2) {
        assert.equal(production.compileReport.shotSubdivisions.length, 2);
        assert.equal(production.storyboard.shots.length, 3);
      } else {
        assert.equal(production.compileReport.shotSubdivisions.length, 0);
        assert.equal(production.storyboard.shots.length, count);
      }

      // Project contract invariants
      const audioManifest = {
        metadata: {
          audioFilePath: 'synthetic.wav',
          sampleRate: 44100 as const,
          durationSeconds: totalFrames / 30,
          totalFrames,
          fps: 30 as const
        },
        normalization: { globalRmsMax: 1.0, localWindowFrames: 30 },
        lyrics: [],
        beatEvents: [],
        storageReference: { type: 'memory_columnar' as const, columnLayoutVersion: 1 as const }
      };

      const renderConfig = createRenderConfig({
        width: 1920,
        height: 1080,
        fps: 30,
        pixelFormat: 'rgba',
        totalFrames
      });

      const projectReport = validateProjectContracts(
        audioManifest,
        production.storyboard,
        renderConfig,
        production.rigs
      );
      const fatalProject = projectReport.errors.filter(
        (e) => e.severity === 'fatal' || e.severity === 'error'
      );
      assert.deepEqual(fatalProject, [], `Project invariants failed for ${count} beats: ${JSON.stringify(fatalProject)}`);

      // Choreography contract invariants
      const choreoReport = validateChoreography(
        production.choreography,
        production.storyboard,
        production.rigs
      );
      const fatalChoreo = choreoReport.errors.filter(
        (e) => e.severity === 'fatal' || e.severity === 'error'
      );
      assert.deepEqual(fatalChoreo, [], `Choreography invariants failed for ${count} beats: ${JSON.stringify(fatalChoreo)}`);
    }
  });

  await t.test('Contract validation throws descriptive errors for malformed contracts', () => {
    // 1. Beat duration shorter than MIN_BEAT_LENGTH_FRAMES (12)
    assert.throws(
      () => {
        const contract = createBaseContract([createBeat('b1', 0, 10)], 10);
        VerbCompiler.compile(contract);
      },
      /shorter than minimum length 12/i
    );

    // 2. Inverted frame range
    assert.throws(
      () => {
        const contract = createBaseContract([createBeat('b1', 0, 0)], 0);
        VerbCompiler.compile(contract);
      },
      /invalid frame range/i
    );

    // 3. Gap between beats
    assert.throws(
      () => {
        const contract = createBaseContract(
          [
            createBeat('b1', 0, 30),
            createBeat('b2', 40, 70)
          ],
          70
        );
        VerbCompiler.compile(contract);
      },
      /gap detected between beat/i
    );

    // 4. Overlapping beats
    assert.throws(
      () => {
        const contract = createBaseContract(
          [
            createBeat('b1', 0, 40),
            createBeat('b2', 30, 70)
          ],
          70
        );
        VerbCompiler.compile(contract);
      },
      /overlap/i
    );

    // 5. Slice mismatch at start
    assert.throws(
      () => {
        const contract = createBaseContract([createBeat('b1', 10, 50)], 50);
        VerbCompiler.compile(contract);
      },
      /does not align with sliceFrameRange.startFrame/i
    );

    // 6. Slice mismatch at end
    assert.throws(
      () => {
        const contract = createBaseContract([createBeat('b1', 0, 40)], 50);
        VerbCompiler.compile(contract);
      },
      /does not align with sliceFrameRange.endFrame/i
    );

    // 7. Undefined character in presentCharacters
    assert.throws(
      () => {
        const beat = createBeat('b1', 0, 30);
        beat.presentCharacters = ['ghost_character'];
        const contract = createBaseContract([beat], 30);
        VerbCompiler.compile(contract);
      },
      /references undefined character instanceId "ghost_character" in presentCharacters/i
    );

    // 8. Undefined character in camera focalCharacterId
    assert.throws(
      () => {
        const beat = createBeat('b1', 0, 30);
        beat.camera.focalCharacterId = 'phantom';
        const contract = createBaseContract([beat], 30);
        VerbCompiler.compile(contract);
      },
      /references undefined character instanceId "phantom" as camera focalCharacterId/i
    );

    // 9. Undefined character in action
    assert.throws(
      () => {
        const beat = createBeat('b1', 0, 30, [
          {
            instanceId: 'missing_char',
            verb: 'walk_to',
            target: { kind: 'position', pos: [10, 0, 0] },
            speedNorm: 1.0,
            intensityNorm: 0.7
          }
        ]);
        const contract = createBaseContract([beat], 30);
        VerbCompiler.compile(contract);
      },
      /action references undefined character instanceId "missing_char"/i
    );

    // 10. Undefined target character in action
    assert.throws(
      () => {
        const beat = createBeat('b1', 0, 30, [
          {
            instanceId: 'hero',
            verb: 'walk_to',
            target: { kind: 'character', targetId: 'unknown_partner' },
            speedNorm: 1.0,
            intensityNorm: 0.7
          }
        ]);
        const contract = createBaseContract([beat], 30);
        VerbCompiler.compile(contract);
      },
      /action target references undefined character targetId "unknown_partner"/i
    );

    // 11. Missing prop in landmarkProps
    assert.throws(
      () => {
        const beat = createBeat('b1', 0, 30, [
          {
            instanceId: 'hero',
            verb: 'reach_and_grasp',
            target: { kind: 'prop', propId: 'non_existent_prop' },
            speedNorm: 1.0,
            intensityNorm: 0.7
          }
        ]);
        const contract = createBaseContract([beat], 30);
        VerbCompiler.compile(contract);
      },
      /references prop "non_existent_prop" not present in set.landmarkProps/i
    );

    // 12. Missing associatedPropId in landmarkProps
    assert.throws(
      () => {
        const beat = createBeat('b1', 0, 30, [
          {
            instanceId: 'hero',
            verb: 'walk_to',
            associatedPropId: 'missing_prop',
            speedNorm: 1.0,
            intensityNorm: 0.7
          }
        ]);
        const contract = createBaseContract([beat], 30);
        VerbCompiler.compile(contract);
      },
      /references associatedPropId "missing_prop" not present in set.landmarkProps/i
    );
  });

  await t.test('F2 Regression: Reach and shoulder derived values change when rig arm lengths or scale change', () => {
    const standardMetrics = VerbCompiler.deriveRigArmMetrics(undefined, 'hand_r');
    assert.equal(standardMetrics.upperArmLength, 18);
    assert.equal(standardMetrics.lowerArmLength, 16);
    assert.equal(standardMetrics.maxReach, 34);

    const customRig = {
      id: 'custom_char',
      type: 'character' as const,
      baseTransform: { position: [0, 0, 0] as [number, number, number], rotationZDegrees: 0, scale: [1, 1] as [number, number], opacity: 1 },
      skeleton: {
        rootJointId: 'torso',
        joints: [
          { id: 'torso', parentJointId: null, localOffset2D: [0, 20] as [number, number], length: 20 },
          { id: 'arm_r_upper', parentJointId: 'torso', localOffset2D: [10, 18] as [number, number], length: 30 },
          { id: 'arm_r_lower', parentJointId: 'arm_r_upper', localOffset2D: [0, -30] as [number, number], length: 25 }
        ]
      },
      parts: []
    };

    const customMetrics = VerbCompiler.deriveRigArmMetrics(customRig as any, 'hand_r');
    assert.equal(customMetrics.upperArmLength, 30);
    assert.equal(customMetrics.lowerArmLength, 25);
    assert.equal(customMetrics.maxReach, 55);
    assert.notEqual(customMetrics.maxReach, standardMetrics.maxReach);
    assert.deepEqual(customMetrics.shoulderOffset, [10, 38]);
  });

  await t.test('F2 Regression: One-shot clip timing follows actual clip length (loopFrames)', () => {
    const beat = createBeat('b1', 0, 70, [
      {
        instanceId: 'hero',
        verb: 'reach_and_grasp',
        associatedPropId: 'coffee_cup',
        speedNorm: 1.0,
        intensityNorm: 0.7
      }
    ]);
    const contract = createBaseContract([beat], 70);
    const prod = VerbCompiler.compile(contract);
    const track = prod.choreography.tracks.find((t) => t.rigId === 'hero');
    assert.ok(track);
    assert.equal(track.pose?.timeScale, 3.0);
  });

  await t.test('F2 Regression: Compile errors for undeterminable prop placement', () => {
    const beat: StoryBeat = {
      beatId: 'b_undeterminable',
      startFrame: 0,
      endFrame: 60,
      lyricSnippet: '',
      emotionalTone: 'reflective',
      narrativeSubtext: 'undeterminable prop',
      presentCharacters: ['hero'],
      set: {
        kitId: 'ARCHITECTURAL_INTERIOR',
        variantId: 'moody_night',
        landmarkProps: ['coffee_cup'],
        atmosphericDensity: 0.5
      },
      camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
      actions: [
        {
          instanceId: 'hero',
          verb: 'walk_to',
          target: { kind: 'position', pos: [20, 0, 0] },
          speedNorm: 1.0,
          intensityNorm: 0.7
        }
      ]
    };
    const contract = createBaseContract([beat], 60);
    assert.throws(
      () => VerbCompiler.compile(contract),
      /Unable to determine initial placement for prop "coffee_cup"/i
    );
  });
});
