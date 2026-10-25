import test from 'node:test';
import assert from 'node:assert/strict';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { computeSkeletonFK, applyAffine2D } from '../src/engine/rigging/kinematics.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';
import type { StoryBeatContract } from '../src/schemas/story-beat.contract.js';
import { CHOREOGRAPHY_CONTRACT_VERSION } from '../src/schemas/choreography.contract.js';

function createSyntheticAudioManifest(totalFrames: number, fps: 30 | 60 = 30): AudioAnalysisManifest {
  return {
    metadata: {
      audioFilePath: 'synthetic.wav',
      sampleRate: 44100,
      durationSeconds: totalFrames / fps,
      totalFrames,
      fps
    },
    normalization: {
      globalRmsMax: 1.0,
      localWindowFrames: 30
    },
    lyrics: [],
    beatEvents: [],
    storageReference: {
      type: 'memory_columnar',
      columnLayoutVersion: 1
    }
  };
}

function createMockAudioFeature(frameIndex: number): AudioFrameFeature {
  return {
    frameIndex,
    timestamp: frameIndex / 30,
    rms: 0.5,
    rmsRelativeGlobal: 0.5,
    rmsRelativeLocal: 0.5,
    localWindowFrames: 30,
    spectralFlux: 0.1,
    onsetStrength: 0,
    isOnset: false,
    bands: {
      subBass: 0.1,
      bass: 0.2,
      lowMid: 0.3,
      mid: 0.3,
      highMid: 0.2,
      presence: 0.1,
      brilliance: 0.05
    }
  };
}

test('F4 Analytical IK, Gaze & Runtime Verification Suite', async (t) => {
  // 1. Contract version bump and schema invariants
  await t.test('Contract version is bumped to 2 and choreography schema accepts ikTargets & gazeTargets', () => {
    assert.equal(CHOREOGRAPHY_CONTRACT_VERSION, 2);

    const contract: StoryBeatContract = {
      projectId: 'f4_version_test',
      songDurationSec: 3,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 90 },
      cast: [
        {
          instanceId: 'hero',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'b1',
          startFrame: 0,
          endFrame: 90,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'version check',
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
              verb: 'reach_and_grasp',
              associatedPropId: 'coffee_cup',
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        }
      ],
      unfulfilledRequests: []
    };

    const prod = VerbCompiler.compile(contract);
    assert.equal(prod.choreography.version, 2);
    const heroTrack = prod.choreography.tracks.find((tr) => tr.rigId === 'hero')!;
    assert.ok(heroTrack.ikTargets && heroTrack.ikTargets.length > 0, 'hero track must have ikTargets');
  });

  // 2. Grasp frame hand-tip tolerance <= 1.0 unit from prop
  await t.test('At grasp frame, real FK hand tip reaches prop within tolerance <= 1.0 unit', () => {
    const contract: StoryBeatContract = {
      projectId: 'grasp_fk_tolerance_test',
      songDurationSec: 10,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 300 },
      cast: [
        {
          instanceId: 'hero',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'b_walk',
          startFrame: 0,
          endFrame: 150,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'walk to desk',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'walk_to', speedNorm: 1.0, intensityNorm: 0.7 }]
        },
        {
          beatId: 'b_grasp',
          startFrame: 150,
          endFrame: 300,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'grasp test',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'CLOSE_UP', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [
            {
              instanceId: 'hero',
              verb: 'reach_and_grasp',
              associatedPropId: 'coffee_cup',
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        }
      ],
      unfulfilledRequests: []
    };

    const manifest = createSyntheticAudioManifest(300);
    const prod = VerbCompiler.compile(contract, manifest);

    // Find the grasp frame across all tracks for hero
    const allHeroIk = prod.choreography.tracks
      .filter((tr) => tr.rigId === 'hero')
      .flatMap((tr) => tr.ikTargets ?? []);
    const graspTarget = allHeroIk.find((ik) => ik.weight === 1.0)!;
    assert.ok(graspTarget, 'grasp target must exist');
    const graspFrame = graspTarget.frame!;
    assert.ok(graspFrame >= 150 && graspFrame < 300);

    const builder = new FrameStateBuilder({
      storyboard: prod.storyboard,
      audioManifest: manifest,
      rigs: prod.rigs,
      choreography: prod.choreography,
      getAudioFeatureAtFrame: createMockAudioFeature
    });

    const frameState = builder.buildFrameState(graspFrame);
    const heroEntity = frameState.entities.find((e) => e.rigId === 'hero')!;
    const heroRig = prod.rigs.get('hero')!;

    // Compute exact FK
    const fkMap = computeSkeletonFK(heroRig.skeleton!, heroEntity.jointAngles, heroEntity.jointOffsets);
    const handJointId = graspTarget.hand === 'hand_l' ? 'arm_l_lower' : 'arm_r_lower';
    const lowerArmTransform = fkMap.get(handJointId)!;
    assert.ok(lowerArmTransform, `transform for ${handJointId} must exist`);

    // Lower arm tip is at local [0, -16]
    const handTipRigLocal = applyAffine2D(lowerArmTransform, [0, -16]);
    const handTipWorld: [number, number] = [
      heroEntity.worldPosition[0] + handTipRigLocal[0] * heroEntity.scale[0],
      heroEntity.worldPosition[1] + handTipRigLocal[1] * heroEntity.scale[1]
    ];

    const propTarget = graspTarget.targetWorld;
    const distToTarget = Math.hypot(handTipWorld[0] - propTarget[0], handTipWorld[1] - propTarget[1]);

    assert.ok(
      distToTarget <= 1.0,
      `At grasp frame ${graspFrame}, hand tip [${handTipWorld.map((n) => n.toFixed(3))}] must be within 1.0 unit of target [${propTarget.map((n) => n.toFixed(3))}], got error ${distToTarget.toFixed(4)}`
    );
  });

  // 3. Continuous prop world displacement across attachment and release (zero pop)
  await t.test('Prop world position is continuous across attachment and release (displacement <= 1.0 unit, zero pop)', () => {
    const contract: StoryBeatContract = {
      projectId: 'prop_continuity_test',
      songDurationSec: 21,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 630 },
      cast: [
        {
          instanceId: 'hero',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'b_walk',
          startFrame: 0,
          endFrame: 210,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'walk to desk',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'walk_to', speedNorm: 1.0, intensityNorm: 0.7 }]
        },
        {
          beatId: 'b_grasp',
          startFrame: 210,
          endFrame: 420,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'grasp',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [
            {
              instanceId: 'hero',
              verb: 'reach_and_grasp',
              associatedPropId: 'coffee_cup',
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        },
        {
          beatId: 'b_carry',
          startFrame: 420,
          endFrame: 630,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'carry put down',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['desk', 'coffee_cup'],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [
            {
              instanceId: 'hero',
              verb: 'carry_put_down',
              associatedPropId: 'coffee_cup',
              target: { kind: 'position', pos: [-55, 68, 0] },
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        }
      ],
      unfulfilledRequests: []
    };

    const manifest = createSyntheticAudioManifest(630);
    const prod = VerbCompiler.compile(contract, manifest);

    const builder = new FrameStateBuilder({
      storyboard: prod.storyboard,
      audioManifest: manifest,
      rigs: prod.rigs,
      choreography: prod.choreography,
      getAudioFeatureAtFrame: createMockAudioFeature
    });

    // Check grasp continuity: frame before attach vs frame of attach
    const graspTrack = prod.choreography.tracks.find((tr) => tr.rigId === 'coffee_cup' && (tr.attachmentSpans?.length ?? 0) > 0)!;
    const graspFrame = graspTrack.attachmentSpans![0].startFrame;

    const stateBeforeGrasp = builder.buildFrameState(graspFrame - 1);
    const stateAtGrasp = builder.buildFrameState(graspFrame);

    const propBefore = stateBeforeGrasp.entities.find((e) => e.rigId === 'coffee_cup')!;
    const propAtGrasp = stateAtGrasp.entities.find((e) => e.rigId === 'coffee_cup')!;

    const graspDisplacement = Math.hypot(
      propAtGrasp.worldPosition[0] - propBefore.worldPosition[0],
      propAtGrasp.worldPosition[1] - propBefore.worldPosition[1]
    );

    assert.ok(
      graspDisplacement <= 1.0,
      `Prop displacement across grasp attachment frame ${graspFrame} must be <= 1.0 unit, got ${graspDisplacement.toFixed(4)}`
    );

    // Check release continuity: frame before release vs frame of release
    const carryPropTracks = prod.choreography.tracks.filter((tr) => tr.rigId === 'coffee_cup');
    const lastAttachedTrack = [...carryPropTracks].reverse().find((tr) => (tr.attachmentSpans?.length ?? 0) > 0 && tr.attachmentSpans![0].endFrame < 630);
    if (lastAttachedTrack) {
      const releaseFrame = lastAttachedTrack.attachmentSpans![0].endFrame;
      const stateBeforeRel = builder.buildFrameState(releaseFrame - 1);
      const stateAtRel = builder.buildFrameState(releaseFrame);

      const propBeforeRel = stateBeforeRel.entities.find((e) => e.rigId === 'coffee_cup')!;
      const propAtRel = stateAtRel.entities.find((e) => e.rigId === 'coffee_cup')!;

      const releaseDisplacement = Math.hypot(
        propAtRel.worldPosition[0] - propBeforeRel.worldPosition[0],
        propAtRel.worldPosition[1] - propBeforeRel.worldPosition[1]
      );

      assert.ok(
        releaseDisplacement <= 1.0,
        `Prop displacement across release frame ${releaseFrame} must be <= 1.0 unit, got ${releaseDisplacement.toFixed(4)}`
      );
    }
  });

  // 4. Arm and head joint angles strictly within anatomical limits across all frames
  await t.test('Arm and head joint angles strictly respect anatomical constraintsDeg across all evaluated frames', () => {
    const contract: StoryBeatContract = {
      projectId: 'limits_check_test',
      songDurationSec: 10,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 300 },
      cast: [
        {
          instanceId: 'hero',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'b_reach',
          startFrame: 0,
          endFrame: 150,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'reach',
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
              verb: 'reach_and_grasp',
              associatedPropId: 'coffee_cup',
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        },
        {
          beatId: 'b_point',
          startFrame: 150,
          endFrame: 300,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'point with gaze',
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
              verb: 'gesture_point',
              target: { kind: 'position', pos: [80, 120, 0] },
              gazeTarget: { kind: 'position', pos: [80, 120, 0] },
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        }
      ],
      unfulfilledRequests: []
    };

    const manifest = createSyntheticAudioManifest(300);
    const prod = VerbCompiler.compile(contract, manifest);

    const builder = new FrameStateBuilder({
      storyboard: prod.storyboard,
      audioManifest: manifest,
      rigs: prod.rigs,
      choreography: prod.choreography,
      getAudioFeatureAtFrame: createMockAudioFeature
    });

    for (let f = 0; f < 300; f += 5) {
      const state = builder.buildFrameState(f);
      const hero = state.entities.find((e) => e.rigId === 'hero')!;

      // arm_r_upper: [-120, 120]
      if (hero.jointAngles['arm_r_upper'] !== undefined) {
        assert.ok(
          hero.jointAngles['arm_r_upper'] >= -120.001 && hero.jointAngles['arm_r_upper'] <= 120.001,
          `Frame ${f}: arm_r_upper angle ${hero.jointAngles['arm_r_upper']} must be in [-120, 120]`
        );
      }
      // arm_r_lower: [0, 135]
      if (hero.jointAngles['arm_r_lower'] !== undefined) {
        assert.ok(
          hero.jointAngles['arm_r_lower'] >= -0.001 && hero.jointAngles['arm_r_lower'] <= 135.001,
          `Frame ${f}: arm_r_lower angle ${hero.jointAngles['arm_r_lower']} must be in [0, 135]`
        );
      }
      // head: [-40, 40]
      if (hero.jointAngles['head'] !== undefined) {
        assert.ok(
          hero.jointAngles['head'] >= -40.001 && hero.jointAngles['head'] <= 40.001,
          `Frame ${f}: head angle ${hero.jointAngles['head']} must be in [-40, 40]`
        );
      }
    }
  });

  // 5. Unreachable targets produce logged reach clamps
  await t.test('Unreachable beyond-reach targets produce logged reachClamps in compileReport', () => {
    const contract: StoryBeatContract = {
      projectId: 'unreachable_target_test',
      songDurationSec: 3,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 90 },
      cast: [
        {
          instanceId: 'hero',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'b_far',
          startFrame: 0,
          endFrame: 90,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'far reach',
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
              verb: 'reach_and_grasp',
              target: { kind: 'position', pos: [250, 75, 0] }, // 250 is far beyond reach from X=0
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        }
      ],
      unfulfilledRequests: []
    };

    const prod = VerbCompiler.compile(contract);
    assert.ok(prod.compileReport.reachClamps.length > 0, 'reachClamps must record beyond-reach target');
    const clamp = prod.compileReport.reachClamps[0];
    assert.equal(clamp.instanceId, 'hero');
    assert.deepEqual(clamp.target, [250, 75, 0]);
    assert.ok(clamp.clampedReach <= clamp.maxReach);
  });

  // 6. Determinism: frames evaluated in arbitrary or reversed order yield identical states
  await t.test('Determinism: Evaluating frames in shuffled or reversed order yields bit-exact identical states', () => {
    const contract: StoryBeatContract = {
      projectId: 'determinism_test',
      songDurationSec: 2,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 60 },
      cast: [
        {
          instanceId: 'hero',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'b_det',
          startFrame: 0,
          endFrame: 60,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'determinism check',
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
              verb: 'reach_and_grasp',
              associatedPropId: 'coffee_cup',
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        }
      ],
      unfulfilledRequests: []
    };

    const manifest = createSyntheticAudioManifest(60);
    const prod = VerbCompiler.compile(contract, manifest);

    const makeBuilder = () =>
      new FrameStateBuilder({
        storyboard: prod.storyboard,
        audioManifest: manifest,
        rigs: prod.rigs,
        choreography: prod.choreography,
        getAudioFeatureAtFrame: createMockAudioFeature
      });

    const builderSeq = makeBuilder();
    const sequentialStates: any[] = [];
    for (let f = 0; f < 60; f++) {
      sequentialStates.push(builderSeq.buildFrameState(f));
    }

    const builderRev = makeBuilder();
    const reversedStates = new Map();
    const shuffledOrder = [42, 10, 59, 0, 25, 17, 33, 5, 50, 12];
    for (const f of shuffledOrder) {
      reversedStates.set(f, builderRev.buildFrameState(f));
    }

    for (const f of shuffledOrder) {
      const seqState = sequentialStates[f];
      const revState = reversedStates.get(f)!;
      assert.deepEqual(
        revState.entities.map((e: any) => ({
          rigId: e.rigId,
          pos: e.worldPosition,
          jointAngles: e.jointAngles
        })),
        seqState.entities.map((e: any) => ({
          rigId: e.rigId,
          pos: e.worldPosition,
          jointAngles: e.jointAngles
        })),
        `Frame ${f} state must be strictly identical regardless of evaluation order`
      );
    }
  });

  // 7. Chunk independence: Standalone frame range evaluation matches full-sequence evaluation
  await t.test('Chunk independence: Standalone chunk evaluation produces identical frame states', () => {
    const contract: StoryBeatContract = {
      projectId: 'chunk_test',
      songDurationSec: 4,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 120 },
      cast: [
        {
          instanceId: 'hero',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'b1',
          startFrame: 0,
          endFrame: 60,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'chunk beat 1',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: [],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'walk_to', speedNorm: 1.0, intensityNorm: 0.7 }]
        },
        {
          beatId: 'b2',
          startFrame: 60,
          endFrame: 120,
          lyricSnippet: '',
          emotionalTone: 'defiant',
          narrativeSubtext: 'chunk beat 2',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'dramatic_twilight',
            landmarkProps: [],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'gesture_point', speedNorm: 1.0, intensityNorm: 0.7 }]
        }
      ],
      unfulfilledRequests: []
    };

    const manifest = createSyntheticAudioManifest(120);
    const prod = VerbCompiler.compile(contract, manifest);

    const builder1 = new FrameStateBuilder({
      storyboard: prod.storyboard,
      audioManifest: manifest,
      rigs: prod.rigs,
      choreography: prod.choreography,
      getAudioFeatureAtFrame: createMockAudioFeature
    });

    const builder2 = new FrameStateBuilder({
      storyboard: prod.storyboard,
      audioManifest: manifest,
      rigs: prod.rigs,
      choreography: prod.choreography,
      getAudioFeatureAtFrame: createMockAudioFeature
    });

    // Builder 1 evaluates entire sequence from frame 0
    for (let f = 0; f < 60; f++) {
      builder1.buildFrameState(f);
    }

    // Builder 2 starts cold directly on chunk [60, 120)
    for (let f = 60; f < 120; f += 10) {
      const state1 = builder1.buildFrameState(f);
      const state2 = builder2.buildFrameState(f);
      assert.deepEqual(state1.entities, state2.entities, `Frame ${f} in chunk must match across full run vs cold start`);
    }
  });
});
