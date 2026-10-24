import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import {
  BASE_MOUTH_REST_SEGMENTS,
  MOUTH_WIDE_A_SEGMENTS,
  MOUTH_OPEN_O_SEGMENTS,
  synthesizeVocalPerformanceKeyframes,
  type VocalLyricSpan
} from '../src/engine/rigging/vocal-performance-solver.js';
import { blendMorphTargets } from '../src/engine/rigging/morpher.js';
import { solveChoreography } from '../src/engine/director/choreography-solver.js';
import { compileStorySpecToStoryboard, THEATRICAL_CINEMATIC_ANGLES } from '../src/engine/director/shot-planner.js';
import { buildTheatricalStorySpec } from '../src/agents/story-spec-agent.js';
import { TrajectorySolver } from '../src/engine/director/trajectory-solver.js';
import type { AudioFrameFeature } from '../src/schemas/audio.contract.js';
import { createSyntheticAudioManifest } from './helpers/manifest-factory.js';
import type { Vec3 } from '../src/schemas/primitives.schema.js';
import { computeCameraBasis } from '../src/engine/camera/camera-3d.js';
import { createBillboardContext, projectBillboardPoint } from '../src/engine/rigging/kinematics.js';

function createMockAudioFeatureWithVocal(
  frameIndex: number,
  vocalEnergy: number
): AudioFrameFeature {
  return {
    frameIndex,
    timestamp: frameIndex / 30,
    rms: vocalEnergy,
    rmsRelativeGlobal: vocalEnergy,
    rmsRelativeLocal: vocalEnergy,
    localWindowFrames: 90,
    spectralFlux: vocalEnergy,
    onsetStrength: 0,
    isOnset: false,
    bands: {
      subBass: 0.1,
      bass: 0.1,
      lowMid: vocalEnergy * 0.5,
      mid: vocalEnergy,
      highMid: vocalEnergy,
      presence: vocalEnergy,
      brilliance: 0.1
    }
  };
}

describe('Lip-Sync Geometry, Viseme Articulation, and Audio Gating (F4 Regression)', () => {
  it('open/closed mouth height differs by >= 6 px at 1080p in tightest close-up framing from projected path geometry', () => {
    // 1. Setup tightest close-up camera angle from planner: DRAMATIC_DUTCH_TILT (fov 34, Z = 145..155)
    const angle = THEATRICAL_CINEMATIC_ANGLES.find((a) => a.name === 'DRAMATIC_DUTCH_TILT')!;
    assert.ok(angle, 'DRAMATIC_DUTCH_TILT angle must exist');

    const width = 1920;
    const height = 1080;
    const camera = {
      position: [10, 45, 145] as Vec3,
      target: [10, 45, 0] as Vec3,
      up: [0, 1, 0] as Vec3,
      nearPlane: 0.1,
      farPlane: 2000,
      rollDegrees: angle.rollDegrees,
      verticalFovDegrees: angle.fov,
      projectionMode: 'perspective' as const
    };
    const basis = computeCameraBasis(camera);

    // Entity billboard at origin with default biped character scale 1.35
    const charWorldPos: Vec3 = [10, 45, 0];
    const charScale: [number, number] = [1.35, 1.35];
    const ctx = createBillboardContext(charWorldPos, 0, charScale, camera, basis, width, height)!;
    assert.ok(ctx, 'Billboard context must be created within view frustum');

    // 2. Measure projected path height of rest mouth vs open mouths
    const rig = ArchetypeFactory.build({
      instanceId: 'lead',
      spec: {
        instanceId: 'lead',
        archetypeId: 'biped_three_quarters',
        scale: 1.0,
        accessories: []
      }
    });

    const mouthPart = rig.parts.find((p) => p.id === 'facial_expression_morph')!;
    assert.ok(mouthPart, 'facial_expression_morph must exist on rig');
    const morphTopology = rig.morphTopology!;
    assert.ok(morphTopology, 'morphTopology must exist on rig');

    function computeProjectedMouthHeight(weights: Record<string, number>): number {
      const blended = blendMorphTargets(
        morphTopology.baseSegments,
        morphTopology.targets,
        weights,
        true
      );
      // Transform each Bezier point through mouth part localOffset2D and billboard projection
      let minY = Infinity;
      let maxY = -Infinity;
      for (const seg of blended.segments) {
        for (const pt of [seg.p0, seg.p1, seg.p2, seg.p3]) {
          const localX = pt[0] + mouthPart.localOffset2D[0];
          const localY = pt[1] + mouthPart.localOffset2D[1];
          const screenPt = projectBillboardPoint([localX, localY], ctx);
          if (screenPt[1] < minY) minY = screenPt[1];
          if (screenPt[1] > maxY) maxY = screenPt[1];
        }
      }
      return maxY - minY;
    }

    const restHeightPx = computeProjectedMouthHeight({});
    const openHeightPx = computeProjectedMouthHeight({ mouthOpen: 1.0 });
    const wideAHeightPx = computeProjectedMouthHeight({ mouth_wide_a: 1.0 });
    const openOHeightPx = computeProjectedMouthHeight({ mouth_open_o: 1.0 });

    const openDeltaPx = openHeightPx - restHeightPx;
    const wideADeltaPx = wideAHeightPx - restHeightPx;
    const openODeltaPx = openOHeightPx - restHeightPx;

    // Minimum required threshold is 6 px difference in projected mouth height at 1080p
    const REQUIRED_THRESHOLD_PX = 6.0;

    assert.ok(
      openDeltaPx >= REQUIRED_THRESHOLD_PX,
      `Projected open delta ${openDeltaPx.toFixed(1)} px must be >= ${REQUIRED_THRESHOLD_PX} px`
    );
    assert.ok(
      wideADeltaPx >= REQUIRED_THRESHOLD_PX,
      `Projected wide_a delta ${wideADeltaPx.toFixed(1)} px must be >= ${REQUIRED_THRESHOLD_PX} px`
    );
    assert.ok(
      openODeltaPx >= REQUIRED_THRESHOLD_PX,
      `Projected open_o delta ${openODeltaPx.toFixed(1)} px must be >= ${REQUIRED_THRESHOLD_PX} px`
    );
  });

  it('viseme sequence changes projected mouth geometry between consecutive syllables', () => {
    // Lyric line: "No way" -> syllable 0: "no" (rounded 'o'), syllable 1: "way" (unrounded 'a')
    const lyric: VocalLyricSpan = {
      id: 'lyric-1',
      text: 'No way',
      emphasis: 0.8,
      frameRange: { startFrameInclusive: 0, endFrameExclusive: 60 }
    };

    const targetNames = new Set(['mouth_wide_a', 'mouth_open_o', 'mouth_smile', 'browFurrow']);
    const morphs = synthesizeVocalPerformanceKeyframes({
      lyrics: [lyric],
      shotStartFrame: 0,
      shotEndFrame: 60,
      emotionalTone: 'reflective',
      availableTargets: targetNames
    });

    assert.ok(morphs.mouth_open_o && morphs.mouth_open_o.length > 0);
    assert.ok(morphs.mouth_wide_a && morphs.mouth_wide_a.length > 0);

    // Rounded vowel peak (syllable "No") vs unrounded vowel peak (syllable "way")
    const maxOpenO = Math.max(...morphs.mouth_open_o.map((k) => k.weight));
    const maxWideA = Math.max(...morphs.mouth_wide_a.map((k) => k.weight));
    assert.ok(maxOpenO >= 0.7, 'Rounded vowel must have strong mouth_open_o weight');
    assert.ok(maxWideA >= 0.7, 'Unrounded vowel must have strong mouth_wide_a weight');

    // Verify projected width differs significantly between rounded O and wide A
    const camera = {
      position: [10, 45, 145] as Vec3,
      target: [10, 45, 0] as Vec3,
      up: [0, 1, 0] as Vec3,
      nearPlane: 0.1,
      farPlane: 2000,
      rollDegrees: 0,
      verticalFovDegrees: 34,
      projectionMode: 'perspective' as const
    };
    const basis = computeCameraBasis(camera);
    const ctx = createBillboardContext([10, 45, 0], 0, [1.35, 1.35], camera, basis, 1920, 1080)!;

    function computeProjectedMouthWidth(weights: Record<string, number>): number {
      const blended = blendMorphTargets(
        BASE_MOUTH_REST_SEGMENTS,
        [
          { name: 'mouth_wide_a', segments: MOUTH_WIDE_A_SEGMENTS },
          { name: 'mouth_open_o', segments: MOUTH_OPEN_O_SEGMENTS }
        ],
        weights,
        true
      );
      let minX = Infinity;
      let maxX = -Infinity;
      for (const seg of blended.segments) {
        for (const pt of [seg.p0, seg.p1, seg.p2, seg.p3]) {
          const screenPt = projectBillboardPoint([pt[0], pt[1]], ctx);
          if (screenPt[0] < minX) minX = screenPt[0];
          if (screenPt[0] > maxX) maxX = screenPt[0];
        }
      }
      return maxX - minX;
    }

    const widthSyllable0 = computeProjectedMouthWidth({ mouth_open_o: maxOpenO, mouth_wide_a: 0.08 });
    const widthSyllable1 = computeProjectedMouthWidth({ mouth_wide_a: maxWideA, mouth_open_o: 0.08 });

    // Wide 'a' must be visibly wider than rounded 'o' by at least 15 px at 1080p
    const widthDiffPx = widthSyllable1 - widthSyllable0;
    assert.ok(
      widthDiffPx >= 15.0,
      `Projected width difference between consecutive syllables ${widthDiffPx.toFixed(1)} px must be >= 15 px`
    );
  });

  it('gates mouth closed during synthetic instrumental gaps and trailing lyric gaps', () => {
    // Lyric line spanning frames 0 to 120 (4 seconds), with short text "Hello" (2 syllables = ~18 frames of singing)
    // Audio has vocals during frames 0..30, and zero vocal energy (instrumental gap) during frames 31..120
    const lyric: VocalLyricSpan = {
      id: 'lyric-trailing-gap',
      text: 'Hello',
      frameRange: { startFrameInclusive: 0, endFrameExclusive: 120 }
    };

    const targetNames = new Set(['mouth_wide_a', 'mouth_open_o']);

    const morphsWithAudioGating = synthesizeVocalPerformanceKeyframes({
      lyrics: [lyric],
      shotStartFrame: 0,
      shotEndFrame: 120,
      availableTargets: targetNames,
      getAudioFeatureAtFrame: (f) => {
        // High vocal energy during singing (frames 0..20), then drop to 0 for instrumental gap
        const vocal = f <= 20 ? 0.75 : 0.02;
        return createMockAudioFeatureWithVocal(f, vocal);
      }
    });

    // In the trailing gap (after frame 30), mouth must be closed
    const trailingKeysWideA = (morphsWithAudioGating.mouth_wide_a ?? []).filter((k) => k.frame >= 30);
    const trailingKeysOpenO = (morphsWithAudioGating.mouth_open_o ?? []).filter((k) => k.frame >= 30);

    for (const k of [...trailingKeysWideA, ...trailingKeysOpenO]) {
      assert.equal(
        k.weight,
        0,
        `Frame ${k.frame} during trailing instrumental gap must have weight 0, got ${k.weight}`
      );
    }

    // Completely silent / instrumental section without vocals: mouth remains closed throughout
    const silentMorphs = synthesizeVocalPerformanceKeyframes({
      lyrics: [lyric],
      shotStartFrame: 0,
      shotEndFrame: 120,
      availableTargets: targetNames,
      getAudioFeatureAtFrame: (f) => createMockAudioFeatureWithVocal(f, 0.02)
    });

    const allSilentWideA = silentMorphs.mouth_wide_a ?? [];
    const allSilentOpenO = silentMorphs.mouth_open_o ?? [];
    for (const k of [...allSilentWideA, ...allSilentOpenO]) {
      assert.equal(
        k.weight,
        0,
        `Frame ${k.frame} during silent section must have weight 0, got ${k.weight}`
      );
    }
  });

  it('no permanent binding of mouthOpen to presence remains in compiled choreography tracks', () => {
    const manifest = createSyntheticAudioManifest({
      totalFrames: 450,
      fps: 30,
      tempoBpm: 140,
      lyrics: [
        {
          timestamp: 1.0,
          durationSeconds: 2.0,
          text: 'Shout into the void',
          emphasis: 0.8
        }
      ]
    });

    const spec = buildTheatricalStorySpec(manifest, 'no_presence_binding', 'ROCK');
    const solver = new TrajectorySolver();
    const storyboard = compileStorySpecToStoryboard(spec, manifest, solver);
    const rigs = new Map(
      spec.cast.map((c) => [
        c.instanceId,
        ArchetypeFactory.build({ instanceId: c.instanceId, spec: c, fps: 30 })
      ])
    );

    const choreography = solveChoreography(
      spec,
      storyboard,
      rigs,
      manifest.beatGrid?.framesPerBeat,
      solver,
      manifest.lyrics
    );

    // Verify all entity tracks across all shots
    for (const track of choreography.tracks) {
      for (const binding of track.morphBindings) {
        assert.ok(
          binding.target !== 'mouthOpen' || binding.source !== 'audio.bands.presence',
          `Track for ${track.rigId} shot ${track.shotId} must not contain permanent mouthOpen binding to presence`
        );
      }
    }
  });
});
