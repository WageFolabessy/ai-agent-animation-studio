import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { LlmProvider } from '../src/agents/types.js';
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
import { TrajectorySolver } from '../src/engine/director/trajectory-solver.js';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import { DeterministicMockLlmProvider } from '../src/agents/llm-provider.js';
import { StudioAgentOrchestrator } from '../src/agents/orchestrator.js';
import { demoAudioManifest } from '../src/demo/phase2-cinema/index.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';
import { validateProjectContracts, validateChoreography } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';
import {
  createSyntheticRockManifest,
  createSyntheticElectronicManifest,
  createSyntheticPopDanceManifest,
  createSyntheticBalladManifest,
  createSyntheticInstrumentalManifest,
  createSyntheticAudioManifest
} from './helpers/manifest-factory.js';
import { classifyGenreProfile } from '../src/engine/audio/genre-classifier.js';

test('StorySpec Contract & Spec-Then-Compile Pipeline Suite', async (t) => {
  await t.test('StorySpecContractSchema validation accepts valid spec and rejects malformed spec', () => {
    const validSpec: StorySpecContract = {
      projectId: 'test-song-spec',
      title: 'Neon Odyssey',
      overallMood: 'High-Octane Kinetic Action',
      themes: ['cyberpunk', 'velocity'],
      genreProfile: 'rock_metal',
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
          startFrame: 0,
          endFrame: 100,
          narrativeIntent: 'High-speed urban traversal',
          emotionalTone: 'defiant',
          lyricMotifs: ['velocity'],
          environmentKitId: 'industrial_city',
          kitParams: { rooftopDensity: 0.6 },
          colorThemeId: 'VOLTAGE_ORANGE',
          cameraIntensity: 0.8,
          castDirectives: [
            {
              instanceId: 'hero',
              motionPreset: 'sprint_frenzy',
              waypoints: [
                { frameProgress: 0, stagePosNorm: [-0.5, 0, 0] },
                { frameProgress: 1, stagePosNorm: [0.5, 0, 0] }
              ]
            }
          ]
        },
        {
          sectionId: 'sec_02',
          startFrame: 100,
          endFrame: 200,
          narrativeIntent: 'Abyss crossing encounter',
          emotionalTone: 'chaotic',
          lyricMotifs: ['fire', 'shadow'],
          environmentKitId: 'neon_chasm',
          kitParams: { abyssDepth: 600 },
          colorThemeId: 'CRIMSON_FURY',
          cameraIntensity: 0.95,
          castDirectives: [
            {
              instanceId: 'hero',
              motionPreset: 'defiant_scream',
              waypoints: [
                { frameProgress: 0, stagePosNorm: [-0.5, 0, 0] },
                { frameProgress: 1, stagePosNorm: [0.5, 0, 0] }
              ]
            }
          ]
        },
        {
          sectionId: 'sec_03',
          startFrame: 200,
          endFrame: 300,
          narrativeIntent: 'Grid horizon sprint',
          emotionalTone: 'reflective',
          lyricMotifs: ['horizon'],
          environmentKitId: 'synth_grid',
          kitParams: { gridSpacing: 40 },
          colorThemeId: 'SUNSET_GOLD',
          cameraIntensity: 0.7,
          castDirectives: [
            {
              instanceId: 'hero',
              motionPreset: 'stalk_crouch',
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
    // Rejects endFrame <= startFrame
    assert.throws(() =>
      StorySpecContractSchema.parse({
        ...validSpec,
        sections: [
          { ...validSpec.sections[0], startFrame: 100, endFrame: 50 },
          validSpec.sections[1],
          validSpec.sections[2]
        ]
      })
    );
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
    const solver = new TrajectorySolver();
    const storyboard = compileStorySpecToStoryboard(spec, demoAudioManifest, solver);
    const rigs = new Map();
    for (const castItem of spec.cast) {
      const rig = ArchetypeFactory.build({
        instanceId: castItem.instanceId,
        spec: castItem
      });
      rigs.set(rig.id, rig);
    }

    const choreo = solveChoreography(spec, storyboard, rigs, undefined, solver);
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

  await t.test('Full-song compilation exercises at least 5 distinct clipIds (zero dead-code presets)', () => {
    // High-energy manifest with 6 sections
    const multiSectionManifest: AudioAnalysisManifest = {
      ...demoAudioManifest,
      metadata: {
        ...demoAudioManifest.metadata,
        tempoBpm: 174,
        tempoConfidence: 0.95
      },
      sections: [
        { id: 'sec-1', startFrame: 0, endFrame: 300, relativeEnergy: 0.3, hasVocals: false, dominantBand: 'mid' },
        { id: 'sec-2', startFrame: 300, endFrame: 600, relativeEnergy: 0.6, hasVocals: false, dominantBand: 'bass' },
        { id: 'sec-3', startFrame: 600, endFrame: 1000, relativeEnergy: 0.85, hasVocals: true, dominantBand: 'presence' },
        { id: 'sec-4', startFrame: 1000, endFrame: 1400, relativeEnergy: 0.92, hasVocals: false, dominantBand: 'brilliance' },
        { id: 'sec-5', startFrame: 1400, endFrame: 1800, relativeEnergy: 0.88, hasVocals: true, dominantBand: 'presence' },
        { id: 'sec-6', startFrame: 1800, endFrame: 2100, relativeEnergy: 0.25, hasVocals: false, dominantBand: 'mid' }
      ]
    };

    const spec = buildDeterministicStorySpec(multiSectionManifest, 'preset-verification');
    const solver = new TrajectorySolver();
    const storyboard = compileStorySpecToStoryboard(spec, multiSectionManifest, solver);
    const rigs = new Map();
    for (const castItem of spec.cast) {
      const rig = ArchetypeFactory.build({ instanceId: castItem.instanceId, spec: castItem });
      rigs.set(rig.id, rig);
    }
    const choreo = solveChoreography(spec, storyboard, rigs, undefined, solver);

    const bipedTracks = choreo.tracks.filter((tr) => tr.rigId === 'lead_runner');
    const clipIds = new Set(bipedTracks.map((tr) => tr.pose?.clipId).filter(Boolean));

    assert.ok(
      clipIds.size >= 5,
      `Expected at least 5 distinct clipIds across song, got ${clipIds.size}: [${Array.from(clipIds).join(', ')}]`
    );
  });

  await t.test('StudioAgentOrchestrator self-heals StorySpec failures across retry attempts', async () => {
    let callCount = 0;
    const interceptor = (_prompt: string, _options: any) => {
      callCount++;
      if (callCount === 1) {
        // Return an invalid spec (fewer than 3 sections)
        return {
          projectId: 'invalid-spec',
          title: 'Invalid',
          overallMood: 'Bad',
          cast: [
            {
              instanceId: 'hero',
              archetypeId: 'biped_runner',
              scale: 1.0,
              accessories: []
            }
          ],
          sections: [
            {
              sectionId: 'sec-1',
              startFrame: 0,
              endFrame: 100,
              narrativeIntent: 'Single section',
              environmentKitId: 'industrial_city',
              kitParams: {},
              colorThemeId: 'CYBERPUNK_CYAN',
              cameraIntensity: 0.5,
              castDirectives: [
                {
                  instanceId: 'hero',
                  motionPreset: 'stalk_crouch',
                  waypoints: [{ frameProgress: 0, stagePosNorm: [0, 0, 0] }]
                }
              ]
            }
          ]
        };
      }
      // On attempt 2, let mock provider generate valid spec
      return undefined;
    };

    const mockProvider = new DeterministicMockLlmProvider({ interceptor });
    const orchestrator = new StudioAgentOrchestrator(mockProvider);

    const result = await orchestrator.orchestrateWithSpec({
      projectId: 'self-healing-spec-test',
      audioManifest: demoAudioManifest
    });

    assert.equal(result.projectValidation.isValid, true);
    assert.equal(result.choreographyValidation.isValid, true);
    assert.equal(result.attempts.length, 2, 'Must log 2 attempts');
    assert.equal(result.attempts[0].retryClass, 'schema_repair');
    assert.equal(result.attempts[1].attempt, 2);
  });

  await t.test(
    'Multi-factor genre classifier and lyric conditioning across 5 distinct track profiles',
    () => {
      // 1. Rock Metal (174 BPM, dense onsets, defiant lyrics)
      const rockManifest = createSyntheticRockManifest();
      const rockClass = classifyGenreProfile(rockManifest);
      assert.equal(rockClass.genre, 'rock_metal');
      const rockSpec = buildDeterministicStorySpec(rockManifest, 'rock-film');
      assert.equal(rockSpec.genreProfile, 'rock_metal');
      assert.equal(rockSpec.overallMood, 'High-Octane Kinetic Action');
      assert.ok(rockSpec.sections.some((s) => s.emotionalTone === 'defiant' || s.emotionalTone === 'chaotic'));
      assert.ok(rockSpec.sections.some((s) => s.colorThemeId === 'CRIMSON_FURY' || s.colorThemeId === 'VOLTAGE_ORANGE'));
      assert.ok(rockSpec.sections.some((s) => s.cameraIntensity >= 0.8));

      // 2. Pop Dance (124 BPM, euphoric vocals)
      const popManifest = createSyntheticPopDanceManifest();
      const popClass = classifyGenreProfile(popManifest);
      assert.equal(popClass.genre, 'pop_dance');
      const popSpec = buildDeterministicStorySpec(popManifest, 'pop-film');
      assert.equal(popSpec.genreProfile, 'pop_dance');
      assert.equal(popSpec.overallMood, 'Euphoric Neon Rhythm');
      assert.ok(popSpec.sections.some((s) => s.emotionalTone === 'euphoric'));
      assert.ok(popSpec.sections.some((s) => s.colorThemeId === 'SUNSET_GOLD' || s.colorThemeId === 'CYBERPUNK_CYAN'));

      // 3. Electronic Synth (110 BPM, bass heavy)
      const elecManifest = createSyntheticElectronicManifest();
      const elecClass = classifyGenreProfile(elecManifest);
      assert.equal(elecClass.genre, 'electronic_synth');
      const elecSpec = buildDeterministicStorySpec(elecManifest, 'elec-film');
      assert.equal(elecSpec.genreProfile, 'electronic_synth');
      assert.equal(elecSpec.overallMood, 'Futuristic Cybernetic Odyssey');
      assert.ok(elecSpec.cast.some((c) => c.archetypeId === 'quadruped_beast'));
      assert.ok(elecSpec.sections.some((s) => s.environmentKitId === 'synth_grid'));

      // 4. Ballad Acoustic (74 BPM, melancholic/reflective)
      const balladManifest = createSyntheticBalladManifest();
      const balladClass = classifyGenreProfile(balladManifest);
      assert.equal(balladClass.genre, 'ballad_acoustic');
      const balladSpec = buildDeterministicStorySpec(balladManifest, 'ballad-film');
      assert.equal(balladSpec.genreProfile, 'ballad_acoustic');
      assert.equal(balladSpec.overallMood, 'Atmospheric Meditative Nocturne');
      assert.ok(balladSpec.sections.some((s) => s.emotionalTone === 'melancholic' || s.emotionalTone === 'reflective'));
      assert.ok(balladSpec.sections.every((s) => s.cameraIntensity <= 0.6));

      // 5. Instrumental (130 BPM, zero lyrics)
      const instManifest = createSyntheticInstrumentalManifest();
      const instClass = classifyGenreProfile(instManifest);
      assert.equal(instClass.genre, 'electronic_synth');
      const instSpec = buildDeterministicStorySpec(instManifest, 'inst-film');
      assert.equal(instSpec.genreProfile, 'electronic_synth');
      assert.equal(instSpec.overallMood, 'Futuristic Cybernetic Odyssey');

      // Verify all genres produce distinct profiles
      const moods = new Set([rockSpec.overallMood, popSpec.overallMood, elecSpec.overallMood, balladSpec.overallMood]);
      assert.equal(moods.size, 4, 'All 4 vocal genres must produce distinct overall moods');
    }
  );

  await t.test(
    'Act partitioning across section counts up to 32 never emits SHOT_OUTSIDE_ACT_BOUNDARY',
    () => {
      const testCounts = [3, 4, 7, 12, 18, 32];

      for (const count of testCounts) {
        const totalFrames = 2400;
        const span = Math.floor(totalFrames / count);
        const sections = [];
        for (let i = 0; i < count; i++) {
          const sStart = i * span;
          const sEnd = i === count - 1 ? totalFrames : (i + 1) * span;
          sections.push({
            id: `sec-${i + 1}`,
            startFrame: sStart,
            endFrame: sEnd,
            relativeEnergy: 0.5 + 0.4 * Math.sin(i),
            hasVocals: i % 2 === 1,
            dominantBand: (i % 3 === 0 ? 'presence' : i % 3 === 1 ? 'bass' : 'mid') as any
          });
        }

        const manifest = createSyntheticAudioManifest({
          totalFrames,
          sections
        });

        const spec = buildDeterministicStorySpec(manifest, `partition-test-${count}`);
        assert.equal(spec.sections.length, count);

        const storyboard = compileStorySpecToStoryboard(spec, manifest);
        const config = createRenderConfig({
          pixelFormat: 'rgba',
          width: 1920,
          height: 1080,
          fps: 30,
          totalFrames
        });

        const validation = validateProjectContracts(
          manifest,
          storyboard,
          config,
          new Map()
        );

        const actErrors = validation.errors.filter((e) => e.code === 'SHOT_OUTSIDE_ACT_BOUNDARY');
        assert.equal(
          actErrors.length,
          0,
          `Section count ${count} produced ${actErrors.length} SHOT_OUTSIDE_ACT_BOUNDARY errors: ${actErrors.map((e) => e.message).join('; ')}`
        );
      }
    }
  );

  await t.test(
    'Lyric text removal: noLyricsInPrompt: true omits all lyric text lines from LLM prompts',
    async () => {
      const rockManifest = createSyntheticRockManifest();
      let capturedPrompt = '';

      const mockProvider = new DeterministicMockLlmProvider({
        interceptor: (prompt) => {
          capturedPrompt = prompt;
          return undefined; // Fall back to buildDeterministicStorySpec
        }
      });

      const agent = new StorySpecAgent(mockProvider);

      // Default: lyrics included
      await agent.generateStorySpec({ audioManifest: rockManifest });
      assert.ok(capturedPrompt.includes('Lyrics Timeline:'));
      assert.ok(capturedPrompt.includes('Thunder in the city'));

      // Opt-out via noLyricsInPrompt input flag
      capturedPrompt = '';
      await agent.generateStorySpec({ audioManifest: rockManifest, noLyricsInPrompt: true });
      assert.ok(!capturedPrompt.includes('Thunder in the city'));
      assert.ok(capturedPrompt.includes('Lyrics Timestamps:'));
    }
  );

  await t.test(
    'Notice test: prints single notice when remote host is configured and lyrics present; omitted for local or opt-out',
    async () => {
      class FakeRemoteProvider implements LlmProvider {
        public readonly name = 'fake-remote';
        describeEndpoint() {
          return {
            provider: 'fake-remote',
            modelId: 'remote-model',
            host: 'api.remote-llm.com',
            isLocal: false
          };
        }
        async generateStructuredJson<T>(_prompt: string, _schema: any, options: any): Promise<T> {
          return buildDeterministicStorySpec(
            (options.context?.audioManifest as any) ?? createSyntheticRockManifest()
          ) as any;
        }
      }

      const rockManifest = createSyntheticRockManifest();
      const originalLog = console.log;
      let capturedLog = '';
      console.log = (...args: unknown[]) => {
        capturedLog += args.join(' ') + '\n';
      };

      try {
        StorySpecAgent.resetNoticeFlag();
        const remoteProvider = new FakeRemoteProvider();
        const agent = new StorySpecAgent(remoteProvider);

        // 1. Notice printed for remote host with lyrics
        await agent.generateStorySpec({ audioManifest: rockManifest });
        assert.ok(
          capturedLog.includes(
            '[story-spec] Notice: lyric text is being sent to api.remote-llm.com (fake-remote/remote-model). Use --no-lyrics-in-prompt to omit lyrics from LLM prompts.'
          ),
          `Notice must be printed for remote endpoint (got: ${capturedLog})`
        );

        // 2. Calling a second time in same session prints at most once
        capturedLog = '';
        await agent.generateStorySpec({ audioManifest: rockManifest });
        assert.equal(capturedLog, '', 'Notice must be printed at most once per session');

        // 3. When noLyricsInPrompt is true, notice is never printed
        StorySpecAgent.resetNoticeFlag();
        capturedLog = '';
        await agent.generateStorySpec({ audioManifest: rockManifest, noLyricsInPrompt: true });
        assert.equal(capturedLog, '', 'Notice must not be printed when noLyricsInPrompt is true');

        // 4. When provider isLocal is true (e.g. DeterministicMockLlmProvider), notice is never printed
        StorySpecAgent.resetNoticeFlag();
        capturedLog = '';
        const localAgent = new StorySpecAgent(new DeterministicMockLlmProvider());
        await localAgent.generateStorySpec({ audioManifest: rockManifest });
        assert.equal(capturedLog, '', 'Notice must not be printed for local provider');
      } finally {
        console.log = originalLog;
      }
    }
  );

  await t.test(
    'Static AST check: src/agents/story-spec-agent.ts and src/agents/orchestrator.ts contain zero references to process.argv or process.env',
    () => {
      const filesToCheck = [
        path.join(process.cwd(), 'src/agents/story-spec-agent.ts'),
        path.join(process.cwd(), 'src/agents/orchestrator.ts')
      ];

      for (const filePath of filesToCheck) {
        assert.ok(fs.existsSync(filePath), `File ${filePath} must exist`);
        const code = fs.readFileSync(filePath, 'utf8');
        const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);

        function visit(node: ts.Node) {
          if (ts.isPropertyAccessExpression(node)) {
            const expr = node.expression;
            const prop = node.name.text;
            if (ts.isIdentifier(expr) && expr.text === 'process' && (prop === 'argv' || prop === 'env')) {
              assert.fail(
                `Forbidden access: process.${prop} found in ${path.basename(filePath)} at position ${node.getStart()}`
              );
            }
          }
          ts.forEachChild(node, visit);
        }

        visit(sourceFile);
      }
    }
  );

  await t.test(
    'Scoped TrajectorySolver instances isolate leadArchetypeId and motion plans across independent compilations',
    () => {
      const rockManifest = createSyntheticRockManifest({ totalFrames: 900 });
      const elecManifest = createSyntheticElectronicManifest({ totalFrames: 900 });

      const rockSpec = buildDeterministicStorySpec(rockManifest, 'iso-rock');
      const elecSpec = buildDeterministicStorySpec(elecManifest, 'iso-elec');

      const rockSolver = new TrajectorySolver();
      const elecSolver = new TrajectorySolver();

      compileStorySpecToStoryboard(rockSpec, rockManifest, rockSolver);
      compileStorySpecToStoryboard(elecSpec, elecManifest, elecSolver);

      assert.equal(rockSolver.getLeadArchetype(), 'biped_runner');
      assert.equal(elecSolver.getLeadArchetype(), 'quadruped_beast');
      assert.equal(rockSolver.computeWorldPos(100)[1], 75);
      assert.equal(elecSolver.computeWorldPos(100)[1], 50);
    }
  );
});
