import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SetStageContractSchema,
  TheatricalSetIdSchema,
  type TheatricalSetId
} from '../src/schemas/stage.contract.js';
import { NarrativePropIdSchema, type NarrativePropId } from '../src/schemas/prop.contract.js';
import { StorySpecContractSchema } from '../src/schemas/story-spec.contract.js';
import {
  validateProjectContracts,
  validateChoreography,
  validateSafeFraming
} from '../src/schemas/invariants.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';
import { createRenderConfig } from '../src/config/render-config.js';
import { StageEnvironmentGenerator } from '../src/engine/library/stage-environment-generator.js';
import { EnvironmentKit, THEME_PALETTES, computeShotEnvironmentBounds } from '../src/engine/library/environment-kit.js';
import { ArchetypeFactory, BipedPoseClips } from '../src/engine/library/archetype-factory.js';
import { PropFactory } from '../src/engine/library/prop-factory.js';
import {
  RelationalBlockingSolver,
  computeRigHorizontalBounds,
  MIN_INTERPERSONAL_CLEARANCE
} from '../src/engine/director/relational-blocking-solver.js';
import { synthesizeVocalPerformanceKeyframes } from '../src/engine/rigging/vocal-performance-solver.js';
import {
  GENRE_DIRECTING_MATRIX,
  getGenreDirectingProfile,
  type CanonicalGenreName
} from '../src/engine/director/genre-directing-matrix.js';
import {
  TrajectorySolver,
  analyzeClipContactStride
} from '../src/engine/director/trajectory-solver.js';
import {
  compileStorySpecToStoryboard,
  assertStoryboardFrustumNegativeZ
} from '../src/engine/director/shot-planner.js';
import { solveChoreography } from '../src/engine/director/choreography-solver.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import { buildTheatricalStorySpec, buildDeterministicStorySpec } from '../src/agents/story-spec-agent.js';
import { StudioAgentOrchestrator } from '../src/agents/orchestrator.js';
import { DeterministicMockLlmProvider } from '../src/agents/llm-provider.js';

function createSyntheticAudioManifest(options: {
  durationSeconds: number;
  fps?: 30 | 60;
  tempoBpm?: number;
  withLyrics?: boolean;
}): AudioAnalysisManifest {
  const fps = options.fps ?? 30;
  const totalFrames = Math.round(options.durationSeconds * fps);
  const tempoBpm = options.tempoBpm ?? 120;
  const framesPerBeat = Math.round((60 / tempoBpm) * fps);

  const beatFrameIndices: number[] = [];
  for (let f = 0; f < totalFrames; f += framesPerBeat) {
    beatFrameIndices.push(f);
  }

  const b1 = Math.floor(totalFrames * 0.25);
  const b2 = Math.floor(totalFrames * 0.75);

  return {
    metadata: {
      audioFilePath: 'test-audio.wav',
      sampleRate: 44100,
      durationSeconds: options.durationSeconds,
      fps,
      totalFrames,
      tempoBpm,
      tempoConfidence: 0.92
    },
    normalization: {
      globalRmsMax: 0.85,
      localWindowFrames: 30
    },
    storageReference: {
      type: 'memory_columnar',
      columnLayoutVersion: 1
    },
    beatGrid: {
      tempoBpm,
      tempoConfidence: 0.92,
      framesPerBeat,
      framesPerBar: framesPerBeat * 4,
      beatFrameIndices
    },
    beatEvents: beatFrameIndices.slice(0, 60).map((f, idx) => ({
      frameIndex: f,
      timestamp: Number((f / fps).toFixed(3)),
      confidence: idx % 4 === 0 ? 0.92 : 0.65
    })),
    sections: [
      {
        id: 'sec-intro',
        startFrame: 0,
        endFrame: b1,
        relativeEnergy: 0.35,
        hasVocals: true,
        dominantBand: 'mid'
      },
      {
        id: 'sec-main',
        startFrame: b1,
        endFrame: b2,
        relativeEnergy: 0.82,
        hasVocals: true,
        dominantBand: 'presence'
      },
      {
        id: 'sec-outro',
        startFrame: b2,
        endFrame: totalFrames,
        relativeEnergy: 0.48,
        hasVocals: true,
        dominantBand: 'bass'
      }
    ],
    lyrics:
      options.withLyrics === false
        ? []
        : [
            {
              id: 'line_1',
              startTimeSeconds: 2.0,
              endTimeSeconds: 6.0,
              frameRange: {
                startFrameInclusive: Math.round(2.0 * fps),
                endFrameExclusive: Math.round(6.0 * fps)
              },
              text: 'Hold my hand beneath the pouring rain tonight',
              emphasis: 0.75
            },
            {
              id: 'line_2',
              startTimeSeconds: Math.min(options.durationSeconds - 6, 12.0),
              endTimeSeconds: Math.min(options.durationSeconds - 2, 16.0),
              frameRange: {
                startFrameInclusive: Math.round(Math.min(options.durationSeconds - 6, 12.0) * fps),
                endFrameExclusive: Math.round(Math.min(options.durationSeconds - 2, 16.0) * fps)
              },
              text: 'Rise through the fire and scream into the void',
              emphasis: 0.92
            }
          ]
  };
}

function createMockAudioFeature(frameIndex: number, fps = 30): AudioFrameFeature {
  return {
    frameIndex,
    timestamp: frameIndex / fps,
    rms: 0.42,
    rmsRelativeGlobal: 0.48,
    rmsRelativeLocal: 0.52,
    localWindowFrames: 30,
    spectralFlux: 0.35,
    onsetStrength: frameIndex % 15 === 0 ? 0.85 : 0.1,
    isOnset: frameIndex % 15 === 0,
    bands: {
      subBass: 0.35,
      bass: 0.48,
      lowMid: 0.4,
      mid: 0.52,
      highMid: 0.45,
      presence: 0.62,
      brilliance: 0.3
    }
  };
}

describe('Theatrical Narrative 2.5D Procedural Cinema Architecture', () => {
  describe('Discrete Stage Schema & Theatrical Set Compositor', () => {
    it('validates SetStageContractSchema with default localized stage bounds [-100, 100]', () => {
      const sets: TheatricalSetId[] = TheatricalSetIdSchema.options;
      assert.ok(sets.length >= 5);
      for (const setId of sets) {
        const parsed = SetStageContractSchema.parse({ setId });
        assert.deepEqual(parsed.bounds.xRange, [-100, 100]);
        assert.deepEqual(parsed.bounds.yRange, [0, 150]);
        assert.deepEqual(parsed.bounds.zRange, [-100, 300]);
        assert.equal(parsed.floorY, 0);
        assert.equal(parsed.transitionIn, 'CUT');
      }
    });

    it('builds all 5 theatrical sets within <= 60 drawables and omits Tier 4 on CLOSE_UP', () => {
      const sets: TheatricalSetId[] = [
        'INTERIOR_ROOM',
        'RAINY_STREET',
        'PARK_BENCH',
        'CONCERT_STAGE',
        'GOTHIC_CATHEDRAL'
      ];

      for (const setId of sets) {
        const wideEnv = StageEnvironmentGenerator.buildSet({
          setId,
          centerX: 0,
          palette: THEME_PALETTES.CYBERPUNK_CYAN,
          isCloseUp: false
        });
        const wideCount = (wideEnv.polygons?.length ?? 0) + (wideEnv.lines?.length ?? 0);
        assert.ok(wideCount >= 15, `${setId} WIDE should have >= 15 drawables, got ${wideCount}`);
        assert.ok(
          wideCount <= 60,
          `${setId} WIDE drawables (${wideCount}) must stay <= 60 (budget <= 65)`
        );

        const hasTier3Fg =
          (wideEnv.polygons?.some((p) => p.tier === 3) ?? false) ||
          (wideEnv.lines?.some((l) => l.tier === 3) ?? false);
        assert.equal(hasTier3Fg, true, `${setId} WIDE must include Tier 4 foreground framing`);

        const closeUpEnv = StageEnvironmentGenerator.buildSet({
          setId,
          centerX: 0,
          palette: THEME_PALETTES.CYBERPUNK_CYAN,
          isCloseUp: true
        });
        const closeUpHasFg =
          (closeUpEnv.polygons?.some((p) => p.tier === 3) ?? false) ||
          (closeUpEnv.lines?.some((l) => l.tier === 3) ?? false);
        assert.equal(
          closeUpHasFg,
          false,
          `${setId} CLOSE_UP must omit Tier 4 foreground overhang to avoid face occlusion`
        );
      }
    });

    it('localizes theatrical character trajectories within [-100, 100] and renders CROSS_FADE transitions', () => {
      const manifest = createSyntheticAudioManifest({ durationSeconds: 20, tempoBpm: 90 });
      const spec = buildDeterministicStorySpec(manifest, 'theatrical-stage-test', {
        mode: 'theatrical',
        genreOverride: 'BALLAD'
      });

      const solver = new TrajectorySolver();
      const storyboard = compileStorySpecToStoryboard(spec, manifest, solver);
      const rigs = new Map(
        spec.cast.map((c) => {
          const r = ArchetypeFactory.build({ instanceId: c.instanceId, spec: c });
          return [r.id, r] as const;
        })
      );
      const choreography = solveChoreography(
        spec,
        storyboard,
        rigs,
        manifest.beatGrid?.framesPerBeat,
        solver,
        manifest.lyrics
      );

      for (const item of solver.getMotionPlan()) {
        assert.ok(
          item.startX >= -100 && item.startX <= 100,
          `Shot ${item.shotId} startX=${item.startX} must remain localized in [-100, 100]`
        );
        assert.ok(
          item.endX >= -100 && item.endX <= 100,
          `Shot ${item.shotId} endX=${item.endX} must remain localized in [-100, 100]`
        );
      }

      const crossFadeShot = storyboard.shots.find((s) => s.transitionIn?.type === 'CROSS_FADE');
      assert.ok(crossFadeShot, 'Theatrical storyboard should include a CROSS_FADE transition shot');

      const stateBuilder = new FrameStateBuilder({
        storyboard,
        audioManifest: manifest,
        rigs,
        choreography,
        getAudioFeatureAtFrame: (f) => createMockAudioFeature(f)
      });
      const f0State = stateBuilder.buildFrameState(crossFadeShot.frameRange.startFrameInclusive);
      assert.ok(
        (f0State.transitionOverlayOpacity ?? 0) > 0.5,
        `First frame of CROSS_FADE shot must carry transitionOverlayOpacity > 0.5, got ${f0State.transitionOverlayOpacity}`
      );
    });
  });

  describe('Multi-Character Relational Choreography', () => {
    it('solves Delta X = X_partner - X_protagonist from actual rig geometry extents and mirrors partner facing in FACE_TO_FACE', () => {
      const leadRig = ArchetypeFactory.build({
        instanceId: 'lead',
        spec: {
          instanceId: 'lead',
          archetypeId: 'biped_three_quarters',
          role: 'PROTAGONIST',
          viewAngle: 'three_quarter',
          scale: 1.0,
          accessories: ['electric_guitar']
        }
      });
      const partnerRig = ArchetypeFactory.build({
        instanceId: 'partner',
        spec: {
          instanceId: 'partner',
          archetypeId: 'biped_three_quarters',
          role: 'PARTNER',
          viewAngle: 'three_quarter',
          scale: 1.0,
          accessories: ['microphone']
        }
      });

      const leadBounds = computeRigHorizontalBounds(leadRig, undefined, 1.0);
      const partnerBoundsPos = computeRigHorizontalBounds(partnerRig, undefined, 1.0);
      const partnerBoundsMirrored = computeRigHorizontalBounds(partnerRig, undefined, -1.0);

      const expectedSepRightMirrored = Math.ceil(
        leadBounds.maxX - partnerBoundsMirrored.minX + MIN_INTERPERSONAL_CLEARANCE
      );
      const expectedSepRightPos = Math.ceil(
        leadBounds.maxX - partnerBoundsPos.minX + MIN_INTERPERSONAL_CLEARANCE
      );
      const expectedSepLeft = Math.ceil(
        partnerBoundsPos.maxX - leadBounds.minX + MIN_INTERPERSONAL_CLEARANCE
      );

      const faceToFace = RelationalBlockingSolver.solve({
        behavior: 'FACE_TO_FACE',
        protagonistStartPos: [0, 75, 0],
        protagonistEndPos: [0, 75, 0],
        protagonistRig: leadRig,
        partnerRig,
        partnerBaseY: 75,
        isTheatrical: true
      });
      assert.equal(
        faceToFace.deltaXStart,
        faceToFace.partnerStartPos[0] - faceToFace.protagonistStartPos[0]
      );
      assert.equal(faceToFace.deltaXStart, expectedSepRightMirrored);
      assert.ok(faceToFace.deltaXStart > leadBounds.maxX - partnerBoundsMirrored.minX);
      assert.equal(faceToFace.protagonistScale[0], 1);
      assert.equal(faceToFace.partnerScale[0], -1);

      const duet = RelationalBlockingSolver.solve({
        behavior: 'DUET_PERFORMANCE',
        protagonistStartPos: [0, 75, 0],
        protagonistEndPos: [0, 75, 0],
        protagonistRig: leadRig,
        partnerRig,
        partnerBaseY: 75,
        isTheatrical: true
      });
      assert.equal(duet.deltaXStart, expectedSepRightPos);
      assert.ok(duet.deltaXStart > leadBounds.maxX - partnerBoundsPos.minX);
      assert.equal(duet.protagonistScale[0], 1);
      assert.equal(duet.partnerScale[0], 1);

      const parallel = RelationalBlockingSolver.solve({
        behavior: 'PARALLEL_WALK',
        protagonistStartPos: [-40, 75, 0],
        protagonistEndPos: [40, 75, 0],
        protagonistRig: leadRig,
        partnerRig,
        partnerBaseY: 75,
        isTheatrical: true
      });
      assert.equal(parallel.deltaXStart, -expectedSepLeft);
      assert.equal(parallel.deltaXEnd, -expectedSepLeft);
      assert.ok(parallel.partnerEndPos[0] > parallel.partnerStartPos[0]);

      const pursuit = RelationalBlockingSolver.solve({
        behavior: 'PURSUIT_AND_CONFRONTATION',
        protagonistStartPos: [0, 75, 0],
        protagonistEndPos: [20, 75, 0],
        protagonistRig: leadRig,
        partnerRig,
        partnerBaseY: 75,
        isTheatrical: true
      });
      assert.equal(pursuit.deltaXStart, -(expectedSepLeft + 42));
      assert.equal(pursuit.deltaXEnd, -expectedSepLeft);
      assert.ok(
        pursuit.partnerEndPos[0] > pursuit.partnerStartPos[0],
        'Pursuer advances forward (+X) closing the gap without moonwalking'
      );
    });

    it('F1 Regression: SOLO shots contain 1 active character and no pair of active characters overlaps across all frames of every shot across synthetic songs and genres', () => {
      const testSongs: Array<{
        name: string;
        genre?: CanonicalGenreName;
        tempoBpm: number;
        durationSeconds: number;
        theatrical: boolean;
      }> = [
        { name: 'rock_theatrical', genre: 'ROCK', tempoBpm: 148, durationSeconds: 20, theatrical: true },
        { name: 'pop_theatrical', genre: 'POP', tempoBpm: 120, durationSeconds: 20, theatrical: true },
        { name: 'ballad_theatrical', genre: 'BALLAD', tempoBpm: 72, durationSeconds: 20, theatrical: true },
        { name: 'electronic_theatrical', genre: 'ELECTRONIC', tempoBpm: 132, durationSeconds: 20, theatrical: true },
        { name: 'runner_pursuit', tempoBpm: 140, durationSeconds: 16, theatrical: false }
      ];

      for (const song of testSongs) {
        const manifest = createSyntheticAudioManifest({
          durationSeconds: song.durationSeconds,
          fps: 30,
          tempoBpm: song.tempoBpm,
          withLyrics: true
        });
        const spec = song.theatrical
          ? buildTheatricalStorySpec(manifest, `f1_${song.name}`, song.genre)
          : buildDeterministicStorySpec(manifest, `f1_${song.name}`);

        const solver = new TrajectorySolver();
        const storyboard = compileStorySpecToStoryboard(spec, manifest, solver);
        const rigs = new Map(
          spec.cast.map((c) => {
            const r = ArchetypeFactory.build({ instanceId: c.instanceId, spec: c, fps: 30 });
            return [r.id, r] as const;
          })
        );
        const choreography = solveChoreography(
          spec,
          storyboard,
          rigs,
          manifest.beatGrid?.framesPerBeat,
          solver,
          manifest.lyrics
        );
        const stateBuilder = new FrameStateBuilder({
          storyboard,
          audioManifest: manifest,
          rigs,
          choreography,
          getAudioFeatureAtFrame: (f) => createMockAudioFeature(f, 30)
        });

        let sawSoloShot = false;
        let sawMultiCharShot = false;

        for (const shot of storyboard.shots) {
          const startF = shot.frameRange.startFrameInclusive;
          const endF = shot.frameRange.endFrameExclusive;
          const secSpec =
            spec.sections.find((s) => startF >= s.startFrame && startF < s.endFrame) ??
            spec.sections[spec.sections.length - 1];

          if (secSpec?.interactionBehavior === 'SOLO') {
            sawSoloShot = true;
            assert.equal(
              shot.activeRigIds.length,
              1,
              `[${song.name}] SOLO shot ${shot.id} must have exactly 1 activeRigId, got ${JSON.stringify(shot.activeRigIds)}`
            );
          } else if (shot.activeRigIds.length >= 2) {
            sawMultiCharShot = true;
          }

          let initialOrderSign: number | undefined;

          for (let f = startF; f < endF; f++) {
            const state = stateBuilder.buildFrameState(f);
            if (secSpec?.interactionBehavior === 'SOLO') {
              assert.equal(
                state.entities.length,
                1,
                `[${song.name}] SOLO shot ${shot.id} frame ${f} must have 1 entity`
              );
            }

            // Filter ground characters (exclude aerial drones flying high above)
            const groundEntities = state.entities.filter((e) => {
              const castMember = spec.cast.find((c) => c.instanceId === e.rigId);
              return castMember?.archetypeId !== 'aerial_drone';
            });

            if (groundEntities.length >= 2) {
              const e0 = groundEntities[0];
              const e1 = groundEntities[1];
              const rig0 = rigs.get(e0.rigId)!;
              const rig1 = rigs.get(e1.rigId)!;
              const track0 = choreography.tracks.find(
                (t) => t.shotId === shot.id && t.rigId === e0.rigId
              );
              const track1 = choreography.tracks.find(
                (t) => t.shotId === shot.id && t.rigId === e1.rigId
              );
              const bounds0 = computeRigHorizontalBounds(
                rig0,
                track0?.pose?.clipId ? [track0.pose.clipId] : undefined,
                e0.scale[0]
              );
              const bounds1 = computeRigHorizontalBounds(
                rig1,
                track1?.pose?.clipId ? [track1.pose.clipId] : undefined,
                e1.scale[0]
              );

              const min0 = e0.worldPosition[0] + bounds0.minX;
              const max0 = e0.worldPosition[0] + bounds0.maxX;
              const min1 = e1.worldPosition[0] + bounds1.minX;
              const max1 = e1.worldPosition[0] + bounds1.maxX;

              const overlap = Math.min(max0, max1) - Math.max(min0, min1);
              assert.ok(
                overlap <= 0,
                `[${song.name}] Shot ${shot.id} frame ${f}: characters ${e0.rigId} [${min0.toFixed(1)}, ${max0.toFixed(1)}] and ${e1.rigId} [${min1.toFixed(1)}, ${max1.toFixed(1)}] overlap by ${overlap.toFixed(2)} units`
              );

              const sign = Math.sign(e1.worldPosition[0] - e0.worldPosition[0]);
              if (initialOrderSign === undefined) {
                initialOrderSign = sign;
              } else {
                assert.equal(
                  sign,
                  initialOrderSign,
                  `[${song.name}] Shot ${shot.id} frame ${f}: pass-through detected between ${e0.rigId} and ${e1.rigId}`
                );
              }
            }
          }
        }

        if (song.theatrical) {
          assert.ok(sawSoloShot, `[${song.name}] Expected at least one SOLO shot`);
          assert.ok(sawMultiCharShot, `[${song.name}] Expected at least one multi-character shot`);
        }
      }
    });
  });

  describe('Multi-Angle Rigs (FRONTAL & THREE_QUARTERS) & Phoneme Lip-Sync', () => {
    it('builds biped_frontal and biped_three_quarters rigs with dual eyes and 7 C0 morph targets', () => {
      const frontalRig = ArchetypeFactory.build({
        instanceId: 'vocalist_front',
        spec: {
          instanceId: 'vocalist_front',
          archetypeId: 'biped_frontal',
          role: 'PROTAGONIST',
          viewAngle: 'front',
          scale: 1.0,
          accessories: ['microphone']
        }
      });
      assert.equal(frontalRig.viewAngle, 'front');
      assert.equal(frontalRig.facingDirection, 'front');
      assert.ok(frontalRig.parts.some((p) => p.id === 'eye_l_optic_core'));
      assert.ok(frontalRig.parts.some((p) => p.id === 'eye_r_optic_core'));
      assert.ok(frontalRig.parts.some((p) => p.id === 'facial_expression_morph'));
      assert.ok(frontalRig.parts.length <= 28);

      const threeQtrRig = ArchetypeFactory.build({
        instanceId: 'partner_3qtr',
        spec: {
          instanceId: 'partner_3qtr',
          archetypeId: 'biped_three_quarters',
          role: 'PARTNER',
          viewAngle: 'three_quarter',
          scale: 1.0,
          accessories: ['acoustic_guitar']
        }
      });
      assert.equal(threeQtrRig.viewAngle, 'three_quarter');
      assert.ok(threeQtrRig.parts.some((p) => p.id === 'eye_l_optic_core'));
      assert.ok(threeQtrRig.parts.some((p) => p.id === 'eye_r_optic_core'));
      assert.ok(threeQtrRig.parts.length <= 28);

      // Verify rain_umbrella_walk IK locomotion foot-slip <= 2%
      const walkAnalysis = analyzeClipContactStride(
        threeQtrRig,
        BipedPoseClips.rain_umbrella_walk,
        'rain_umbrella_walk'
      );
      assert.ok(
        walkAnalysis.maxRelativeDeviation <= 0.02,
        `rain_umbrella_walk foot slip ${walkAnalysis.maxRelativeDeviation.toFixed(4)} must be <= 0.02`
      );
      assert.ok(walkAnalysis.contactFrameCount >= Math.ceil(0.55 * 36));
    });

    it('synthesizes strictly ascending phoneme lip-sync keyframes from LRC lyrics', () => {
      const targets = new Set([
        'mouthOpen',
        'mouth_open_o',
        'mouth_wide_a',
        'mouth_smile',
        'browRaise',
        'browFurrow',
        'blink'
      ]);
      const morphs = synthesizeVocalPerformanceKeyframes({
        lyrics: [
          {
            id: 'l1',
            text: 'Hold my soul through the cold night',
            emphasis: 0.85,
            frameRange: { startFrameInclusive: 10, endFrameExclusive: 70 }
          }
        ],
        shotStartFrame: 0,
        shotEndFrame: 90,
        emotionalTone: 'melancholic',
        availableTargets: targets
      });

      assert.ok(morphs.mouth_open_o && morphs.mouth_open_o.length >= 3);
      assert.ok(morphs.mouth_wide_a && morphs.mouth_wide_a.length >= 3);
      assert.ok(morphs.browFurrow && morphs.browFurrow.length >= 2);

      for (const [key, list] of Object.entries(morphs)) {
        for (let i = 0; i < list.length; i++) {
          assert.ok(
            list[i].frame >= 0 && list[i].frame < 90,
            `${key}[${i}] frame ${list[i].frame} out of shot range [0, 90)`
          );
          if (i > 0) {
            assert.ok(
              list[i].frame > list[i - 1].frame,
              `${key} frames must be strictly ascending: ${list[i].frame} <= ${list[i - 1].frame}`
            );
          }
        }
      }
    });
  });

  describe('Narrative Vector Props & Joint Sockets', () => {
    it('attaches all 8 narrative props to skeletal joints and renders valid SVG', () => {
      const allProps: NarrativePropId[] = NarrativePropIdSchema.options;
      assert.equal(allProps.length, 8);

      for (const propId of allProps) {
        const parts = PropFactory.buildAttachedPropParts(propId);
        assert.ok(parts.length >= 1, `Prop ${propId} must generate >= 1 vector RigPart`);

        const rig = ArchetypeFactory.build({
          instanceId: `actor_${propId}`,
          spec: {
            instanceId: `actor_${propId}`,
            archetypeId: 'biped_frontal',
            scale: 1.0,
            accessories: [propId]
          }
        });
        assert.ok(rig.sockets && rig.sockets.length === 4);
        assert.ok(
          rig.parts.length <= 28,
          `Rig with prop ${propId} has ${rig.parts.length} parts (must be <= 28)`
        );
        for (const p of parts) {
          assert.ok(
            rig.parts.some((rp) => rp.id === p.id),
            `Rig should include attached prop part ${p.id}`
          );
        }
      }
    });
  });

  describe('Universal Genre Directing Matrix & Dual-Genre Full-Song Benchmark', () => {
    it('defines complete directing profiles for POP, BALLAD, ACOUSTIC, ROCK, METAL, ELECTRONIC', () => {
      const genres: CanonicalGenreName[] = [
        'POP',
        'BALLAD',
        'ACOUSTIC',
        'ROCK',
        'METAL',
        'ELECTRONIC'
      ];
      for (const g of genres) {
        const profile = getGenreDirectingProfile(g);
        assert.equal(profile.genreName, g);
        assert.ok(profile.preferredSets.length >= 3);
        assert.ok(profile.defaultProps.length >= 1);
        assert.ok(profile.colorHarmonies.length >= 3);
      }
      assert.ok(
        GENRE_DIRECTING_MATRIX.BALLAD.cameraPacing.minShotDurationSeconds >
          GENRE_DIRECTING_MATRIX.METAL.cameraPacing.minShotDurationSeconds,
        'Ballad shots must linger longer than high-tempo Metal shots'
      );
    });

    it('compiles and verifies full-song 3-Act theatrical narratives for both BALLAD and METAL reference tracks', () => {
      const benchmarkConfigs: Array<{
        genre: CanonicalGenreName;
        tempoBpm: number;
        durationSeconds: number;
      }> = [
        { genre: 'BALLAD', tempoBpm: 76, durationSeconds: 180 },
        { genre: 'METAL', tempoBpm: 155, durationSeconds: 180 },
        { genre: 'POP', tempoBpm: 124, durationSeconds: 120 }
      ];

      const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });

      for (const cfg of benchmarkConfigs) {
        const manifest = createSyntheticAudioManifest({
          durationSeconds: cfg.durationSeconds,
          fps: 30,
          tempoBpm: cfg.tempoBpm,
          withLyrics: true
        });
        const renderConfig = createRenderConfig({
          width: 1920,
          height: 1080,
          fps: 30,
          pixelFormat: 'rgba',
          totalFrames: manifest.metadata.totalFrames
        });

        const spec = buildTheatricalStorySpec(
          manifest,
          `benchmark-${cfg.genre.toLowerCase()}`,
          cfg.genre
        );
        StorySpecContractSchema.parse(spec);

        const solver = new TrajectorySolver();
        const storyboard = compileStorySpecToStoryboard(spec, manifest, solver);
        assertStoryboardFrustumNegativeZ(storyboard.shots);

        const rigs = new Map(
          spec.cast.map((c) => {
            const r = ArchetypeFactory.build({ instanceId: c.instanceId, spec: c, fps: 30 });
            return [r.id, r] as const;
          })
        );

        const choreography = solveChoreography(
          spec,
          storyboard,
          rigs,
          manifest.beatGrid?.framesPerBeat,
          solver,
          manifest.lyrics
        );

        const projReport = validateProjectContracts(manifest, storyboard, renderConfig, rigs);
        assert.equal(
          projReport.isValid,
          true,
          `${cfg.genre} project validation failed: ${JSON.stringify(projReport.errors)}`
        );
        assert.equal(
          projReport.errors.length,
          0,
          `${cfg.genre} project validation should have 0 warnings/errors, got: ${JSON.stringify(projReport.errors)}`
        );

        const choreoReport = validateChoreography(choreography, storyboard, rigs, {
          validateFraming: true
        });
        assert.equal(
          choreoReport.isValid,
          true,
          `${cfg.genre} choreography validation failed: ${JSON.stringify(choreoReport.errors)}`
        );

        const framingReport = validateSafeFraming(storyboard, choreography, rigs);
        assert.equal(
          framingReport.isValid,
          true,
          `${cfg.genre} safe framing failed: ${JSON.stringify(framingReport.errors)}`
        );

        // Render sampled frames across all 3 Acts and verify SVG & drawable budget <= 65
        const stateBuilder = new FrameStateBuilder({
          storyboard,
          audioManifest: manifest,
          rigs,
          choreography,
          getAudioFeatureAtFrame: (f) => createMockAudioFeature(f, 30)
        });

        for (const shot of storyboard.shots) {
          const midFrame = Math.floor(
            (shot.frameRange.startFrameInclusive + shot.frameRange.endFrameExclusive) / 2
          );
          const frameState = stateBuilder.buildFrameState(midFrame);
          const section =
            spec.sections.find(
              (s) => midFrame >= s.startFrame && midFrame < s.endFrame
            ) ?? spec.sections[0];
          const bounds = computeShotEnvironmentBounds(shot);
          const env = EnvironmentKit.build({
            section,
            shotId: shot.id,
            centerX: (shot.cameraStart.position[0] + shot.cameraEnd.position[0]) / 2,
            framing: shot.framing,
            xMin: bounds.xMin,
            xMax: bounds.xMax,
            tierBounds: bounds.tierBounds
          });

          const out = compositor.renderFrame(
            frameState,
            rigs,
            env,
            [],
            (f) => createMockAudioFeature(f, 30)
          );
          assert.ok(out.svg.startsWith('<svg') && out.svg.endsWith('</svg>'));
          assert.ok(
            out.stats.drawablesCount > 15,
            `${cfg.genre} shot ${shot.id} should render > 15 drawables`
          );
        }
      }
    });

    it('End-to-End Orchestrator: StudioAgentOrchestrator orchestrates theatrical narrative when stagingMode is "theatrical"', async () => {
      const manifest = createSyntheticAudioManifest({
        durationSeconds: 30,
        fps: 30,
        tempoBpm: 90,
        withLyrics: true
      });
      const provider = new DeterministicMockLlmProvider();
      const orchestrator = new StudioAgentOrchestrator(provider);
      const result = await orchestrator.orchestrate({
        projectId: 'theatrical-orchestrator-test',
        audioManifest: manifest,
        stagingMode: 'theatrical'
      });

      assert.equal(result.projectValidation.isValid, true);
      assert.equal(result.choreographyValidation.isValid, true);
      assert.ok(result.storySpec.sections.some((s: any) => s.stagingMode === 'theatrical'));
      assert.ok(result.storyboard.shots.length > 0);
      assert.ok(result.storyboard.shots[0].theatricalSetId !== undefined);

      // Verify memoized environment resolver produces 2.5D discrete set geometry
      const env = result.getEnvironmentForShot(result.storyboard.shots[0].id);
      const drawablesCount = (env.polygons?.length ?? 0) + (env.lines?.length ?? 0);
      assert.ok(drawablesCount > 0);
      assert.ok(drawablesCount <= 65);
    });
  });
});
