import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  CANONICAL_RIG_IDS,
  ChoreographerAgent,
  DeterministicMockLlmProvider,
  DirectorAgent,
  LlmJsonParseError,
  LlmProviderError,
  OpenAiCompatibleProvider,
  OrchestrationValidationError,
  RigAgent,
  StudioAgentOrchestrator,
  buildDeterministicChoreography,
  buildDeterministicDirectorStoryboard,
  buildDeterministicRigCatalog,
  extractJsonFromLlmResponse
} from '../src/agents/index.js';
import { demoAudioManifest, DemoAudioFeatureReader } from '../src/demo/phase2-cinema/index.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import { samplePoseTrack } from '../src/engine/rigging/deformer.js';
import { validateProjectContracts, validateChoreography } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';

const demoReader = new DemoAudioFeatureReader();
const getDemoAudioFeature = (f: number) => demoReader.getFrameFeature(f);

test('Phase 4 Agents & Orchestration Suite', async (t) => {
  await t.test('extractJsonFromLlmResponse handles plain JSON, BOM, markdown fences, and prose', () => {
    const schema = z.object({ ok: z.boolean(), count: z.number().int() }).strict();

    // 1. Plain JSON
    const p1 = extractJsonFromLlmResponse('{"ok":true,"count":42}');
    assert.deepEqual(schema.parse(p1), { ok: true, count: 42 });

    // 2. UTF-8 BOM + Markdown ```json fence + conversational prose
    const rawWithFence =
      '\uFEFFSure! Here is the structured contract output:\n```json\n{\n  "ok": true,\n  "count": 7\n}\n```\nLet me know if you need adjustments.';
    const p2 = extractJsonFromLlmResponse(rawWithFence);
    assert.deepEqual(schema.parse(p2), { ok: true, count: 7 });

    // 3. Generic ``` fence without language tag
    const rawGenericFence = '```\n{"ok": false, "count": 0}\n```';
    const p3 = extractJsonFromLlmResponse(rawGenericFence);
    assert.deepEqual(schema.parse(p3), { ok: false, count: 0 });

    // 4. Outermost braces surrounded by prose without fence
    const rawProseBraces = 'Output payload: {"ok": true, "count": 99} -- end of transmission.';
    const p4 = extractJsonFromLlmResponse(rawProseBraces);
    assert.deepEqual(schema.parse(p4), { ok: true, count: 99 });

    // 5. Empty or malformed input throws LlmJsonParseError
    assert.throws(() => extractJsonFromLlmResponse('   \uFEFF  '), LlmJsonParseError);
    assert.throws(
      () => extractJsonFromLlmResponse('```json\n{"ok": true, BROKEN}\n```'),
      LlmJsonParseError
    );
  });

  await t.test('OpenAiCompatibleProvider enforces HTTPS/localhost security and parses mocked fetch', async () => {
    // Rejects plaintext HTTP on remote host
    assert.throws(
      () =>
        new OpenAiCompatibleProvider({
          baseUrl: 'http://example.com/v1',
          apiKey: 'test-token'
        }),
      LlmProviderError
    );

    // Rejects remote HTTPS when API key is missing
    const savedLlmKey = process.env.LLM_API_KEY;
    const savedOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      assert.throws(
        () =>
          new OpenAiCompatibleProvider({
            baseUrl: 'https://api.openai.com/v1'
          }),
        LlmProviderError
      );
    } finally {
      if (savedLlmKey !== undefined) process.env.LLM_API_KEY = savedLlmKey;
      if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
    }

    // Allows localhost HTTP (e.g. Ollama) with custom fetchImpl
    const schema = z.object({ status: z.string() }).strict();
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '```json\n{"status": "verified-local"}\n```'
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    });

    const result = await provider.generateStructuredJson('Test prompt', schema, {
      systemPrompt: 'System prompt'
    });
    assert.deepEqual(result, { status: 'verified-local' });
  });

  await t.test('Director, Rig, and Choreographer agents enforce continuity, emitter separation, and anti-moonwalk invariants', async () => {
    const provider = new DeterministicMockLlmProvider();
    const director = new DirectorAgent(provider);
    const rigAgent = new RigAgent(provider);
    const choreographer = new ChoreographerAgent(provider);

    const storyboard = await director.generateStoryboard({
      audioManifest: demoAudioManifest,
      getAudioFeatureAtFrame: getDemoAudioFeature
    });

    // Storyboard has 3 acts and 4 contiguous shots covering [0, 180)
    assert.equal(storyboard.acts.length, 3);
    assert.equal(storyboard.shots.length, 4);
    assert.equal(storyboard.shots[0].frameRange.startFrameInclusive, 0);
    assert.equal(
      storyboard.shots[storyboard.shots.length - 1].frameRange.endFrameExclusive,
      demoAudioManifest.metadata.totalFrames
    );

    // Every shot (including Shot 3 Close-Up) retains skyline, factories, and chimney smoke continuity
    for (const shot of storyboard.shots) {
      assert.ok(
        shot.activeRigIds.includes(CANONICAL_RIG_IDS.SKYLINE),
        `Shot ${shot.id} must retain ${CANONICAL_RIG_IDS.SKYLINE}`
      );
      assert.ok(
        shot.activeRigIds.includes(CANONICAL_RIG_IDS.FACTORIES),
        `Shot ${shot.id} must retain ${CANONICAL_RIG_IDS.FACTORIES}`
      );
      assert.ok(
        shot.activeRigIds.includes(CANONICAL_RIG_IDS.SMOKE_CHIMNEY),
        `Shot ${shot.id} must retain ${CANONICAL_RIG_IDS.SMOKE_CHIMNEY}`
      );
    }

    const rigs = await rigAgent.generateRigs({
      storyboard,
      audioManifest: demoAudioManifest
    });

    // Separate particle emitters exist for stationary chimney vs kinetic runner trail
    assert.ok(rigs.has(CANONICAL_RIG_IDS.SMOKE_CHIMNEY));
    assert.ok(rigs.has(CANONICAL_RIG_IDS.RUNNER_AURA));

    const runner = rigs.get(CANONICAL_RIG_IDS.RUNNER);
    assert.ok(runner);
    assert.equal(runner.facingDirection, 'right');

    // Verify knee joints bend backward (<= 0 deg) for right-facing character
    const legLowerL = runner.skeleton?.joints.find((j) => j.id === 'leg_l_lower');
    const legLowerR = runner.skeleton?.joints.find((j) => j.id === 'leg_r_lower');
    assert.ok(legLowerL?.constraintsDeg && legLowerL.constraintsDeg[1] <= 0);
    assert.ok(legLowerR?.constraintsDeg && legLowerR.constraintsDeg[1] <= 0);

    const choreography = await choreographer.generateChoreography({
      storyboard,
      rigs,
      audioManifest: demoAudioManifest
    });

    // Verify chimney smoke stays stationary at [-150, 220, -380] across all shots
    const chimneyTracks = choreography.tracks.filter(
      (tr) => tr.rigId === CANONICAL_RIG_IDS.SMOKE_CHIMNEY
    );
    assert.equal(chimneyTracks.length, storyboard.shots.length);
    for (const tr of chimneyTracks) {
      for (const kf of tr.transform.keyframes) {
        assert.deepEqual(kf.position, [-150, 220, -380]);
      }
    }
  });

  await t.test('StudioAgentOrchestrator self-heals intentional errors across Director, Rig, and Choreographer stages', async () => {
    const seenPrompts: Array<{ role: string; attempt: number; prompt: string }> = [];

    const faultyOnFirstAttemptProvider = new DeterministicMockLlmProvider({
      interceptor: (prompt, options) => {
        const role = options.agentRole ?? 'unknown';
        const attempt = options.attempt ?? 1;
        seenPrompts.push({ role, attempt, prompt });

        if (role === 'director' && attempt === 1) {
          // Inject a timeline gap between shot-0 and shot-1
          const brokenStoryboard = buildDeterministicDirectorStoryboard({
            audioManifest: demoAudioManifest
          });
          brokenStoryboard.shots[0].frameRange.endFrameExclusive = 40; // Gap [40..45)
          return brokenStoryboard;
        }

        if (role === 'rig' && attempt === 1) {
          // Inject inverted forward-bending knee constraints on right-facing runner (Moonwalk bug)
          const brokenCatalog = buildDeterministicRigCatalog();
          const runner = brokenCatalog.rigs.find((r) => r.id === CANONICAL_RIG_IDS.RUNNER)!;
          const knee = runner.skeleton!.joints.find((j) => j.id === 'leg_l_lower')!;
          knee.constraintsDeg = [0, 130];
          return brokenCatalog;
        }

        if (role === 'choreographer' && attempt === 1) {
          // Inject backward -X translation on right-facing runner (Moonwalk translation bug)
          const storyboard = buildDeterministicDirectorStoryboard({
            audioManifest: demoAudioManifest
          });
          const catalog = buildDeterministicRigCatalog();
          const rigMap = new Map(catalog.rigs.map((r) => [r.id, r]));
          const brokenChoreo = buildDeterministicChoreography({
            storyboard,
            rigs: rigMap,
            audioManifest: demoAudioManifest
          });
          const runnerTrack = brokenChoreo.tracks.find(
            (tr) => tr.shotId === 'shot-0' && tr.rigId === CANONICAL_RIG_IDS.RUNNER
          )!;
          runnerTrack.transform.keyframes = [
            {
              frame: 0,
              position: [100, 75, -60],
              rotationZDegrees: 0,
              scale: [1.35, 1.35],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: 44,
              position: [-50, 75, -60],
              rotationZDegrees: 0,
              scale: [1.35, 1.35],
              opacity: 1,
              easing: 'linear'
            } // Moves -X while facing right (+X)!
          ];
          return brokenChoreo;
        }

        // On attempt >= 2, fall through to default valid deterministic output
        return undefined;
      }
    });

    const orchestrator = new StudioAgentOrchestrator(faultyOnFirstAttemptProvider);
    const result = await orchestrator.orchestrate({
      audioManifest: demoAudioManifest,
      getAudioFeatureAtFrame: getDemoAudioFeature,
      maxRetries: 3
    });

    assert.equal(result.projectValidation.isValid, true);
    assert.equal(result.choreographyValidation.isValid, true);

    // Each of the 3 agents failed on attempt 1 and succeeded on attempt 2 (total 6 attempts)
    assert.equal(result.attempts.length, 6);

    const directorAttempt2 = result.attempts.find(
      (a) => a.agentRole === 'director' && a.attempt === 2
    );
    assert.ok(directorAttempt2);
    assert.ok(directorAttempt2.repairedErrorCodes.includes('SHOT_TIMELINE_GAP'));

    const rigAttempt2 = result.attempts.find((a) => a.agentRole === 'rig' && a.attempt === 2);
    assert.ok(rigAttempt2);
    assert.ok(rigAttempt2.repairedErrorCodes.includes('RIG_KNEE_BEND_INVERTED'));

    const choreoAttempt2 = result.attempts.find(
      (a) => a.agentRole === 'choreographer' && a.attempt === 2
    );
    assert.ok(choreoAttempt2);
    assert.ok(choreoAttempt2.repairedErrorCodes.includes('TRACK_FACING_DIRECTION_MISMATCH'));

    // Verify repair prompt contained [SELF-HEALING REPAIR DIAGNOSTICS]
    const directorRetryPrompt = seenPrompts.find(
      (p) => p.role === 'director' && p.attempt === 2
    );
    assert.ok(directorRetryPrompt?.prompt.includes('[SELF-HEALING REPAIR DIAGNOSTICS]'));
    assert.ok(directorRetryPrompt?.prompt.includes('SHOT_TIMELINE_GAP'));
  });

  await t.test('StudioAgentOrchestrator throws OrchestrationValidationError when maxRetries is exhausted', async () => {
    const alwaysBrokenProvider = new DeterministicMockLlmProvider({
      interceptor: (_prompt, options) => {
        if (options.agentRole === 'director') {
          const broken = buildDeterministicDirectorStoryboard({
            audioManifest: demoAudioManifest
          });
          broken.shots[0].frameRange.endFrameExclusive = 10; // Persistent gap
          return broken;
        }
        return undefined;
      }
    });

    const orchestrator = new StudioAgentOrchestrator(alwaysBrokenProvider);
    await assert.rejects(
      async () =>
        orchestrator.orchestrate({
          audioManifest: demoAudioManifest,
          maxRetries: 2
        }),
      (err: unknown) => {
        assert.ok(err instanceof OrchestrationValidationError);
        assert.equal(err.agentRole, 'director');
        assert.equal(err.attempts.length, 3); // 1 initial + 2 retries
        assert.ok(err.errors.some((e) => e.code === 'SHOT_TIMELINE_GAP'));
        return true;
      }
    );
  });

  await t.test('End-to-End Orchestration renders valid SVG frames across all 4 shots including Shot 3 Close-Up backdrop', async () => {
    const orchestrator = new StudioAgentOrchestrator(new DeterministicMockLlmProvider());
    const result = await orchestrator.orchestrate({
      audioManifest: demoAudioManifest,
      getAudioFeatureAtFrame: getDemoAudioFeature
    });

    const stateBuilder = new FrameStateBuilder({
      storyboard: result.storyboard,
      audioManifest: demoAudioManifest,
      rigs: result.rigs,
      choreography: result.choreography,
      getAudioFeatureAtFrame: getDemoAudioFeature
    });
    const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });
    const onsetFrames = demoAudioManifest.beatEvents.map((b) => b.frameIndex);

    for (const sampleFrame of [0, 60, 110, 150]) {
      const frameState = stateBuilder.buildFrameState(sampleFrame);
      const env = result.getEnvironmentForShot(frameState.shotId);
      const rendered = compositor.renderFrame(
        frameState,
        result.rigs,
        env,
        onsetFrames,
        getDemoAudioFeature
      );

      assert.ok(rendered.svg.startsWith('<svg'));
      assert.ok(rendered.svg.endsWith('</svg>'));
      assert.ok(rendered.stats.drawablesCount > 20);
    }

    // Specifically verify Shot 3 (frame 150) has active background entities in frameState
    const shot3State = stateBuilder.buildFrameState(150);
    assert.equal(shot3State.shotId, 'shot-3');
    const activeRigIdsInShot3 = shot3State.entities.map((e) => e.rigId);
    assert.ok(activeRigIdsInShot3.includes(CANONICAL_RIG_IDS.SKYLINE));
    assert.ok(activeRigIdsInShot3.includes(CANONICAL_RIG_IDS.FACTORIES));
    assert.ok(activeRigIdsInShot3.includes(CANONICAL_RIG_IDS.SMOKE_CHIMNEY));
    assert.ok(activeRigIdsInShot3.includes(CANONICAL_RIG_IDS.RUNNER));
  });

  await t.test('Periodic Hermite spline continuity, stride phase preservation across shots, and FG_PIPES fade-out', async () => {
    const catalog = buildDeterministicRigCatalog();
    const runnerRig = catalog.rigs.find((r) => r.id === CANONICAL_RIG_IDS.RUNNER)!;
    assert.ok(runnerRig.poseInterpolation);

    // 1. Verify periodic Hermite spline has no tangent explosion across [0, 6]
    // Keyframe 0 has leg_l_upper = 48, Keyframe 6 has leg_l_upper = -10.
    // Previously, broken dt0 = 1 caused leg_l_upper to overshoot beyond +70 deg at frame 2.
    for (let f = 0; f <= 24; f += 0.5) {
      const sample = samplePoseTrack(runnerRig, f, 0);
      const legLUpper = sample.jointAngles.leg_l_upper ?? 0;
      const legLLower = sample.jointAngles.leg_l_lower ?? 0;
      assert.ok(
        legLUpper >= -50 && legLUpper <= 50,
        `leg_l_upper at frame ${f} was ${legLUpper} (expected within [-50, 50] without spline overshoot)`
      );
      assert.ok(
        legLLower >= -125 && legLLower <= 5,
        `leg_l_lower at frame ${f} was ${legLLower} (expected within [-125, 5])`
      );
    }

    // Verify smooth loop wrap continuity between f = 23.8 and f = 0.2
    const nearEnd = samplePoseTrack(runnerRig, 23.8, 0);
    const nearStart = samplePoseTrack(runnerRig, 0.2, 0);
    const diffUpper = Math.abs(
      (nearEnd.jointAngles.leg_l_upper ?? 0) - (nearStart.jointAngles.leg_l_upper ?? 0)
    );
    assert.ok(diffUpper < 6, `Expected C1 loop continuity across boundary, got delta=${diffUpper}`);

    // 2. Verify ChoreographerAgent preserves stride phase across shot cuts (non-zero startPoseFrame)
    const storyboard = buildDeterministicDirectorStoryboard({ audioManifest: demoAudioManifest });
    const rigsMap = new Map(catalog.rigs.map((r) => [r.id, r]));
    const choreo = buildDeterministicChoreography({
      storyboard,
      rigs: rigsMap,
      audioManifest: demoAudioManifest
    });

    const runnerTracks = choreo.tracks.filter((tr) => tr.rigId === CANONICAL_RIG_IDS.RUNNER);
    assert.equal(runnerTracks.length, 4);
    assert.equal(runnerTracks[0].pose?.startPoseFrame, 0);
    // Shot 0 is 45 frames * 1.45 timeScale = 65.25 -> 65.25 % 24 = 17.25
    assert.ok((runnerTracks[1].pose?.startPoseFrame ?? 0) > 0);

    // 3. Verify FG_PIPES stays active in shot-2 and fades out smoothly to opacity 0
    const fgShot2Track = choreo.tracks.find(
      (tr) => tr.shotId === 'shot-2' && tr.rigId === CANONICAL_RIG_IDS.FG_PIPES
    );
    assert.ok(fgShot2Track, 'Expected FG_PIPES track in shot-2 for smooth exit transition');
    assert.equal(fgShot2Track.transform.keyframes[0].opacity, 0.85);
    assert.equal(
      fgShot2Track.transform.keyframes[fgShot2Track.transform.keyframes.length - 1].opacity,
      0
    );
  });

  await t.test('Embeds valid JSON Schema draft-07 into Director, Rig, and Choreographer system prompts', () => {
    const provider = new DeterministicMockLlmProvider();
    const director = new DirectorAgent(provider);
    const rigAgent = new RigAgent(provider);
    const choreographer = new ChoreographerAgent(provider);

    const dirPrompt = director.buildSystemPrompt();
    assert.ok(dirPrompt.includes('JSON Schema Contract (draft-07):'));
    const dirSchemaStr = dirPrompt.split('JSON Schema Contract (draft-07):\n')[1]?.split('\nReturn ONLY valid JSON.')[0];
    assert.ok(dirSchemaStr);
    const dirParsed = JSON.parse(dirSchemaStr) as Record<string, unknown>;
    assert.equal(dirParsed.type, 'object');
    assert.ok(dirParsed.properties);

    const rigPrompt = rigAgent.buildSystemPrompt();
    assert.ok(rigPrompt.includes('JSON Schema Contract (draft-07):'));
    assert.ok(rigPrompt.includes('PART_DETACHED_FROM_JOINT_PIVOT'));
    assert.ok(rigPrompt.includes('FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE'));
    const rigSchemaStr = rigPrompt.split('JSON Schema Contract (draft-07):\n')[1]?.split('\nReturn ONLY valid JSON.')[0];
    assert.ok(rigSchemaStr);
    const rigParsed = JSON.parse(rigSchemaStr) as Record<string, unknown>;
    assert.equal(rigParsed.type, 'object');
    assert.ok(rigParsed.properties);

    const choreoPrompt = choreographer.buildSystemPrompt();
    assert.ok(choreoPrompt.includes('JSON Schema Contract (draft-07):'));
    assert.ok(choreoPrompt.includes('FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE'));
    const choreoSchemaStr = choreoPrompt.split('JSON Schema Contract (draft-07):\n')[1]?.split('\nReturn ONLY valid JSON.')[0];
    assert.ok(choreoSchemaStr);
    const choreoParsed = JSON.parse(choreoSchemaStr) as Record<string, unknown>;
    assert.equal(choreoParsed.type, 'object');
    assert.ok(choreoParsed.properties);
  });

  await t.test('Preserves and forwards previousDraft in self-healing retries for both schema and invariant failures', async () => {
    const capturedPrompts: Array<{ role: string; attempt: number; prompt: string }> = [];

    const interceptorProvider = new DeterministicMockLlmProvider({
      interceptor: (prompt, options) => {
        const role = options.agentRole ?? 'unknown';
        const attempt = options.attempt ?? 1;
        capturedPrompts.push({ role, attempt, prompt });

        // Attempt 1: return a payload with missing required field 'fps' to trigger Zod schema error
        if (role === 'director' && attempt === 1) {
          const raw = buildDeterministicDirectorStoryboard({ audioManifest: demoAudioManifest });
          const broken = { ...raw, fps: undefined, customInvalidMarker: 'BROKEN_DIRECTOR_ATTEMPT_1' };
          return broken;
        }

        return undefined;
      }
    });

    const orchestrator = new StudioAgentOrchestrator(interceptorProvider);
    const result = await orchestrator.orchestrate({
      audioManifest: demoAudioManifest,
      getAudioFeatureAtFrame: getDemoAudioFeature,
      maxRetries: 2
    });

    assert.equal(result.projectValidation.isValid, true);

    const directorAttempt2Prompt = capturedPrompts.find(
      (p) => p.role === 'director' && p.attempt === 2
    );
    assert.ok(directorAttempt2Prompt, 'Expected director attempt 2 prompt to be recorded');
    assert.ok(
      directorAttempt2Prompt.prompt.includes('[PREVIOUS FAILED JSON DRAFT]'),
      'Expected retry prompt to contain [PREVIOUS FAILED JSON DRAFT]'
    );
    assert.ok(
      directorAttempt2Prompt.prompt.includes('BROKEN_DIRECTOR_ATTEMPT_1'),
      'Expected retry prompt to embed the failed candidate draft'
    );
    assert.ok(
      directorAttempt2Prompt.prompt.includes('[SELF-HEALING REPAIR DIAGNOSTICS]'),
      'Expected retry prompt to contain [SELF-HEALING REPAIR DIAGNOSTICS]'
    );
  });

  await t.test('Phase 4.5 Visual Polish: verifies zero double-offset, safe fg-pipe depth z=140, and neck/abdomen connectors', () => {
    const catalog = buildDeterministicRigCatalog();
    const runner = catalog.rigs.find((r) => r.id === CANONICAL_RIG_IDS.RUNNER)!;
    const fgPipes = catalog.rigs.find((r) => r.id === CANONICAL_RIG_IDS.FG_PIPES)!;

    // 1. Foreground pipe safe depth z = 140
    assert.equal(fgPipes.baseTransform.position[2], 140);

    // 2. Coat wing & hair ribbon set localOffset2D: [0, 0]
    const coatWing = runner.parts.find((p) => p.id === 'coat_wing')!;
    assert.deepEqual(coatWing.localOffset2D, [0, 0]);

    const hairRibbon = runner.parts.find((p) => p.id === 'hair_ribbon')!;
    assert.deepEqual(hairRibbon.localOffset2D, [0, 0]);

    // 3. Abdomen and neck connectors exist and bridge the gaps
    const abdomen = runner.parts.find((p) => p.id === 'abdomen_core')!;
    assert.ok(abdomen, 'abdomen_core must exist');
    assert.equal(abdomen.jointId, 'torso');
    assert.deepEqual(abdomen.localOffset2D, [0, -6]);

    const neck = runner.parts.find((p) => p.id === 'neck_collar')!;
    assert.ok(neck, 'neck_collar must exist');
    assert.equal(neck.jointId, 'torso');
    assert.deepEqual(neck.localOffset2D, [2, 20]);

    // 4. All parts in runner satisfy the PART_DETACHED_FROM_JOINT_PIVOT invariant
    const storyboard = buildDeterministicDirectorStoryboard({ audioManifest: demoAudioManifest });
    const rigsMap = new Map(catalog.rigs.map((r) => [r.id, r]));
    const choreo = buildDeterministicChoreography({
      storyboard,
      rigs: rigsMap,
      audioManifest: demoAudioManifest
    });

    const projectReport = validateProjectContracts(
      demoAudioManifest,
      storyboard,
      createRenderConfig({
        width: 1920,
        height: 1080,
        fps: 30,
        pixelFormat: 'rgba',
        totalFrames: demoAudioManifest.metadata.totalFrames
      }),
      rigsMap
    );
    assert.equal(
      projectReport.errors.some((e) => e.code === 'PART_DETACHED_FROM_JOINT_PIVOT'),
      false
    );
    assert.equal(
      projectReport.errors.some((e) => e.code === 'FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE'),
      false
    );

    const choreoReport = validateChoreography(choreo, storyboard, rigsMap);
    assert.equal(
      choreoReport.errors.some((e) => e.code === 'FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE'),
      false
    );
  });
});

