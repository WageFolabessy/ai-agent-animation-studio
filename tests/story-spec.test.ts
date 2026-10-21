import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StorySpecContractSchema,
  type StorySpecContract
} from '../src/schemas/story-spec.contract.js';
import {
  buildDeterministicStorySpec,
  StorySpecAgent
} from '../src/agents/story-spec-agent.js';
import {
  compileStorySpecToStoryboard,
  snapShotBoundariesToBeats
} from '../src/engine/director/shot-planner.js';
import { solveChoreography } from '../src/engine/director/choreography-solver.js';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import { DeterministicMockLlmProvider } from '../src/agents/llm-provider.js';
import { StudioAgentOrchestrator } from '../src/agents/orchestrator.js';
import { demoAudioManifest } from '../src/demo/phase2-cinema/index.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';
import { validateProjectContracts, validateChoreography } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';

test('StorySpec Contract & Spec-Then-Compile Pipeline Suite', async (t) => {
  await t.test('StorySpecContractSchema validation accepts valid spec and rejects malformed spec', () => {
    const validSpec: StorySpecContract = {
      projectId: 'test-song-spec',
      title: 'Neon Odyssey',
      overallMood: 'High-Octane Kinetic Action',
      cast: [
        {
          instanceId: 'hero',
          archetypeId: 'biped_runner',
          scale: 1.0,
          paletteOverrides: { primary: '#ff7700', accent: '#ffe600' },
          accessories: []
        }
      ],
      sections: [
        {
          sectionId: 'sec_01',
          narrativeIntent: 'High-speed urban traversal',
          environmentKitId: 'industrial_city',
          kitParams: { rooftopDensity: 0.6 },
          colorThemeId: 'VOLTAGE_ORANGE',
          cameraIntensity: 0.8,
          castDirectives: [
            {
              instanceId: 'hero',
              motionPreset: 'sprint',
              waypoints: [
                { frameProgress: 0, stagePosNorm: [-0.5, 0, 0] },
                { frameProgress: 1, stagePosNorm: [0.5, 0, 0] }
              ]
            }
          ]
        },
        {
          sectionId: 'sec_02',
          narrativeIntent: 'Abyss crossing encounter',
          environmentKitId: 'neon_chasm',
          kitParams: { abyssDepth: 600 },
          colorThemeId: 'CRIMSON_FURY',
          cameraIntensity: 0.95,
          castDirectives: [
            {
              instanceId: 'hero',
              motionPreset: 'sprint',
              waypoints: [
                { frameProgress: 0, stagePosNorm: [-0.5, 0, 0] },
                { frameProgress: 1, stagePosNorm: [0.5, 0, 0] }
              ]
            }
          ]
        },
        {
          sectionId: 'sec_03',
          narrativeIntent: 'Grid horizon sprint',
          environmentKitId: 'synth_grid',
          kitParams: { gridSpacing: 40 },
          colorThemeId: 'SUNSET_GOLD',
          cameraIntensity: 0.7,
          castDirectives: [
            {
              instanceId: 'hero',
              motionPreset: 'stride',
              waypoints: [
                { frameProgress: 0, stagePosNorm: [-0.4, 0, 0] },
                { frameProgress: 1, stagePosNorm: [0.4, 0, 0] }
              ]
            }
          ]
        }
      ]
    };

    const parsed = StorySpecContractSchema.parse(validSpec);
    assert.equal(parsed.projectId, 'test-song-spec');
    assert.equal(parsed.sections.length, 3);

    // Rejects empty cast
    assert.throws(() => StorySpecContractSchema.parse({ ...validSpec, cast: [] }));
    // Rejects less than 3 sections
    assert.throws(() => StorySpecContractSchema.parse({ ...validSpec, sections: [validSpec.sections[0]] }));
  });

  await t.test('buildDeterministicStorySpec is song-conditioned (different songs yield different specs)', () => {
    // 1. High-energy rock track (174 BPM, dense lyrics)
    const rockManifest: AudioAnalysisManifest = {
      ...demoAudioManifest,
      metadata: {
        ...demoAudioManifest.metadata,
        tempoBpm: 174,
        tempoConfidence: 0.92
      },
      lyrics: Array.from({ length: 40 }, (_, i) => ({
        id: `line_${i}`,
        text: `Lyric line ${i}`,
        startTimeSeconds: i * 1.0,
        endTimeSeconds: (i + 1) * 1.0,
        frameRange: { startFrameInclusive: i * 30, endFrameExclusive: (i + 1) * 30 },
        emphasis: 0.5
      }))
    };
    const rockSpec = buildDeterministicStorySpec(rockManifest, 'rock-film');
    assert.equal(rockSpec.overallMood, 'High-Octane Kinetic Action');
    assert.ok(rockSpec.cast.some((c) => c.archetypeId === 'biped_runner'));
    assert.ok(rockSpec.cast.some((c) => c.archetypeId === 'aerial_drone'));
    assert.ok(rockSpec.sections.some((s) => s.environmentKitId === 'industrial_city'));
    assert.ok(rockSpec.sections.some((s) => s.colorThemeId === 'CRIMSON_FURY' || s.colorThemeId === 'VOLTAGE_ORANGE'));

    // 2. Electronic synth track (120 BPM, zero lyrics)
    const synthManifest: AudioAnalysisManifest = {
      ...demoAudioManifest,
      metadata: {
        ...demoAudioManifest.metadata,
        tempoBpm: 120,
        tempoConfidence: 0.88
      },
      lyrics: []
    };
    const synthSpec = buildDeterministicStorySpec(synthManifest, 'synth-film');
    assert.equal(synthSpec.overallMood, 'Futuristic Cybernetic Odyssey');
    assert.ok(synthSpec.cast.some((c) => c.archetypeId === 'quadruped_beast'));
    assert.ok(synthSpec.sections.some((s) => s.environmentKitId === 'synth_grid'));
    assert.ok(synthSpec.sections.some((s) => s.colorThemeId === 'CYBERPUNK_CYAN' || s.colorThemeId === 'SUNSET_GOLD'));

    // Verify rock and synth specs are completely distinct films
    assert.notEqual(rockSpec.overallMood, synthSpec.overallMood);
    assert.notEqual(rockSpec.cast[0].archetypeId, synthSpec.cast[0].archetypeId);
  });

  await t.test('snapShotBoundariesToBeats aligns cuts to musical beats within tolerance', () => {
    const beatGrid = {
      tempoBpm: 120,
      tempoConfidence: 0.95,
      framesPerBeat: 15,
      framesPerBar: 60,
      beatFrameIndices: [0, 15, 30, 45, 60, 75, 90, 105, 120]
    };

    // Candidate cut at frame 29 is within 1 frame of beat 30 (tolerance 0.2 * 15 = 3 frames)
    // Candidate cut at frame 50 is 5 frames away from beat 45 and 10 from 60 (outside tolerance)
    const rawCuts = [29, 50, 74];
    const { snappedFrames, diagnostics } = snapShotBoundariesToBeats(rawCuts, beatGrid, 0.2);

    assert.equal(snappedFrames[0], 30, 'Frame 29 must snap to beat 30');
    assert.equal(snappedFrames[1], 50, 'Frame 50 outside tolerance must be preserved');
    assert.equal(snappedFrames[2], 75, 'Frame 74 must snap to beat 75');
    assert.equal(diagnostics.length, 1);
    assert.ok(diagnostics[0].includes('CUT_OFF_BEAT'));
  });

  await t.test('compileStorySpecToStoryboard compiles contiguous acts and shots obeying all contract invariants', () => {
    const spec = buildDeterministicStorySpec(demoAudioManifest, 'compiled-spec');
    const storyboard = compileStorySpecToStoryboard(spec, demoAudioManifest);

    assert.equal(storyboard.totalFrames, demoAudioManifest.metadata.totalFrames);
    assert.equal(storyboard.acts.length, 3);
    assert.ok(storyboard.shots.length >= 3);

    // Contiguity check: shot i ends where shot i+1 starts, shot 0 starts at 0, last ends at totalFrames
    assert.equal(storyboard.shots[0].frameRange.startFrameInclusive, 0);
    for (let i = 0; i < storyboard.shots.length - 1; i++) {
      assert.equal(
        storyboard.shots[i].frameRange.endFrameExclusive,
        storyboard.shots[i + 1].frameRange.startFrameInclusive,
        `Contiguity gap or overlap between shot ${i} and ${i + 1}`
      );
    }
    assert.equal(
      storyboard.shots[storyboard.shots.length - 1].frameRange.endFrameExclusive,
      demoAudioManifest.metadata.totalFrames
    );

    // Build rigs and test validation
    const rigs = new Map();
    for (const castItem of spec.cast) {
      const rig = ArchetypeFactory.build({
        instanceId: castItem.instanceId,
        spec: castItem
      });
      rigs.set(rig.id, rig);
    }

    const renderConfig = createRenderConfig({
      width: 1920,
      height: 1080,
      fps: 30,
      pixelFormat: 'rgba',
      totalFrames: demoAudioManifest.metadata.totalFrames
    });

    const report = validateProjectContracts(demoAudioManifest, storyboard, renderConfig, rigs);
    assert.equal(report.isValid, true, `Project validation failed: ${report.errors.map((e) => e.message).join('; ')}`);
  });

  await t.test('solveChoreography generates valid tracks and satisfies anti-moonwalk invariants', () => {
    const spec = buildDeterministicStorySpec(demoAudioManifest, 'choreo-spec');
    const storyboard = compileStorySpecToStoryboard(spec, demoAudioManifest);
    const rigs = new Map();
    for (const castItem of spec.cast) {
      const rig = ArchetypeFactory.build({
        instanceId: castItem.instanceId,
        spec: castItem
      });
      rigs.set(rig.id, rig);
    }

    const choreo = solveChoreography(spec, storyboard, rigs);
    assert.ok(choreo.tracks.length > 0);

    const choreoReport = validateChoreography(choreo, storyboard, rigs);
    assert.equal(choreoReport.isValid, true, `Choreography validation failed: ${choreoReport.errors.map((e) => e.message).join('; ')}`);
  });

  await t.test('StudioAgentOrchestrator executes orchestrateWithSpec cleanly end-to-end', async () => {
    const mockProvider = new DeterministicMockLlmProvider();
    const orchestrator = new StudioAgentOrchestrator(mockProvider);

    const result = await orchestrator.orchestrateWithSpec({
      projectId: 'e2e-spec-orchestration',
      audioManifest: demoAudioManifest
    });

    assert.equal(result.projectValidation.isValid, true);
    assert.equal(result.choreographyValidation.isValid, true);
    assert.ok(result.storyboard.shots.length >= 3);
    assert.ok(result.rigs.size >= 1);
    assert.ok(result.choreography.tracks.length >= 3);

    // Verify environment resolver for shots
    const env0 = result.getEnvironmentForShot(result.storyboard.shots[0].id);
    assert.ok(env0.polygons && env0.polygons.length > 0);
  });
});
