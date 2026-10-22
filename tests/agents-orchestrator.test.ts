import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  DeterministicMockLlmProvider,
  LlmJsonParseError,
  LlmProviderError,
  OpenAiCompatibleProvider,
  OrchestrationValidationError,
  StudioAgentOrchestrator,
  StorySpecAgent,
  extractJsonFromLlmResponse,
  buildDeterministicStorySpec
} from '../src/agents/index.js';
import { demoAudioManifest, DemoAudioFeatureReader } from '../src/demo/phase2-cinema/index.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';

const demoReader = new DemoAudioFeatureReader();
const getDemoAudioFeature = (f: number) => demoReader.getFrameFeature(f);

test('Agents & Orchestration Suite', async (t) => {
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

  await t.test('StudioAgentOrchestrator throws OrchestrationValidationError when maxRetries is exhausted', async () => {
    const alwaysBrokenProvider = new DeterministicMockLlmProvider({
      interceptor: () => ({
        projectId: 'broken-spec',
        title: 'Broken',
        overallMood: 'Defiant',
        cast: [], // Invalid empty cast triggers Zod schema error
        sections: []
      })
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
        assert.equal(err.agentRole, 'story_spec');
        assert.equal(err.attempts.length, 3); // 1 initial + 2 retries
        return true;
      }
    );
  });

  await t.test('End-to-End Orchestration renders valid SVG frames across shots with Spec-Then-Compile pipeline', async () => {
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

    for (const sampleFrame of [0, 45, 90, 135]) {
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
      assert.ok(rendered.stats.drawablesCount > 10);
    }
  });

  await t.test('Embeds valid JSON Schema draft-07 into StorySpecAgent system prompts', () => {
    const provider = new DeterministicMockLlmProvider();
    const storySpecAgent = new StorySpecAgent(provider);

    const prompt = storySpecAgent.buildSystemPrompt();
    assert.ok(prompt.includes('JSON Schema Contract (draft-07):'));
    const schemaStr = prompt
      .split('JSON Schema Contract (draft-07):\n')[1]
      ?.split('\nReturn ONLY valid JSON.')[0];
    assert.ok(schemaStr);
    const parsed = JSON.parse(schemaStr) as Record<string, unknown>;
    assert.equal(parsed.type, 'object');
    assert.ok(parsed.properties);
  });

  await t.test('Preserves and forwards previousDraft in self-healing retries for both schema and invariant failures', async () => {
    const capturedPrompts: Array<{ role: string; attempt: number; prompt: string }> = [];

    const interceptorProvider = new DeterministicMockLlmProvider({
      interceptor: (prompt, options) => {
        const role = options.agentRole ?? 'unknown';
        const attempt = options.attempt ?? 1;
        capturedPrompts.push({ role, attempt, prompt });

        // Attempt 1: return payload with missing required field 'title' to trigger Zod schema error
        if (role === 'story_spec' && attempt === 1) {
          const raw = buildDeterministicStorySpec(demoAudioManifest);
          const broken = { ...raw, title: undefined, customInvalidMarker: 'BROKEN_SPEC_ATTEMPT_1' };
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

    const specAttempt2Prompt = capturedPrompts.find(
      (p) => p.role === 'story_spec' && p.attempt === 2
    );
    assert.ok(specAttempt2Prompt, 'Expected story_spec attempt 2 prompt to be recorded');
    assert.ok(
      specAttempt2Prompt.prompt.includes('[PREVIOUS FAILED JSON DRAFT]'),
      'Expected retry prompt to contain [PREVIOUS FAILED JSON DRAFT]'
    );
    assert.ok(
      specAttempt2Prompt.prompt.includes('BROKEN_SPEC_ATTEMPT_1'),
      'Expected retry prompt to embed the failed candidate draft'
    );
    assert.ok(
      specAttempt2Prompt.prompt.includes('[SELF-HEALING REPAIR DIAGNOSTICS]'),
      'Expected retry prompt to contain [SELF-HEALING REPAIR DIAGNOSTICS]'
    );
  });
});
