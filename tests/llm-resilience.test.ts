import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  OpenAiCompatibleProvider,
  LlmFatalError,
  LlmTransientError,
  LlmOutputTruncatedError,
  computeBackoffDelay,
  parseRetryAfter,
  sanitizeSecrets
} from '../src/agents/llm-provider.js';
import {
  formatRepairFeedbackPrompt
} from '../src/agents/repair-helper.js';

test('LLM Resilience & Production Provider Suite', async (t) => {
  const TestContractSchema = z
    .object({
      title: z.string(),
      count: z.number().int().min(1)
    })
    .strict();

  await t.test('computeBackoffDelay and parseRetryAfter mathematical invariants', () => {
    // 1. parseRetryAfter handles integer seconds
    assert.equal(parseRetryAfter('120'), 120);
    assert.equal(parseRetryAfter('0'), 0);
    assert.equal(parseRetryAfter(''), undefined);
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter('invalid'), undefined);

    // 2. parseRetryAfter handles future HTTP-dates
    const futureDate = new Date(Date.now() + 15_000).toUTCString();
    const parsedDiff = parseRetryAfter(futureDate);
    assert.ok(parsedDiff !== undefined && parsedDiff >= 13 && parsedDiff <= 17);

    // 3. computeBackoffDelay adheres to t_backoff(a) = min(t_max, t_base * 2^(a - 1))
    // With fixed randomFloat = 0.5:
    // a = 1: t_backoff = 1.0s -> delay = 0.5s
    assert.equal(computeBackoffDelay(1, null, 1.0, 30.0, 0.5), 0.5);
    // a = 2: t_backoff = 2.0s -> delay = 1.0s
    assert.equal(computeBackoffDelay(2, null, 1.0, 30.0, 0.5), 1.0);
    // a = 3: t_backoff = 4.0s -> delay = 2.0s
    assert.equal(computeBackoffDelay(3, null, 1.0, 30.0, 0.5), 2.0);
    // a = 6: t_backoff = min(30, 32) = 30.0s -> delay = 15.0s
    assert.equal(computeBackoffDelay(6, null, 1.0, 30.0, 0.5), 15.0);

    // 4. Honoring Retry-After: max(delay, retryAfter)
    const withRetryAfter = computeBackoffDelay(1, '8', 1.0, 30.0, 0.5);
    assert.equal(withRetryAfter, 8.0);
  });

  await t.test('Transient 429 with Retry-After header retries and succeeds', async () => {
    let callCount = 0;
    const sleptMs: number[] = [];

    const fakeFetch: typeof fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Rate limited. Please slow down.', {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Retry-After': '3' }
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"title":"Test Resilience","count":42}' } }],
          usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:8080/v1',
      maxNetworkRetries: 3,
      fetchImpl: fakeFetch,
      sleepImpl: async (ms) => {
        sleptMs.push(ms);
      }
    });

    const result = await provider.generateStructuredJsonWithMeta(
      'Generate test contract',
      TestContractSchema
    );

    assert.equal(callCount, 2);
    assert.equal(sleptMs.length, 1);
    assert.ok(sleptMs[0] >= 3000, `Expected sleep >= 3000ms from Retry-After, got ${sleptMs[0]}`);
    assert.equal(result.data.title, 'Test Resilience');
    assert.equal(result.data.count, 42);
    assert.equal(result.networkRetryCount, 1);
    assert.equal(result.tokenUsage?.totalTokens, 75);
  });

  await t.test('Transient 500 error exhausts retries and throws LlmTransientError', async () => {
    let callCount = 0;
    const sleptMs: number[] = [];

    const fakeFetch: typeof fetch = async () => {
      callCount++;
      return new Response('Internal Server Crash', {
        status: 500,
        statusText: 'Internal Server Error'
      });
    };

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:8080/v1',
      maxNetworkRetries: 2,
      fetchImpl: fakeFetch,
      sleepImpl: async (ms) => {
        sleptMs.push(ms);
      }
    });

    await assert.rejects(
      async () => {
        await provider.generateStructuredJson('Generate test contract', TestContractSchema);
      },
      (err: unknown) => {
        assert.ok(err instanceof LlmTransientError);
        assert.equal(err.statusCode, 500);
        assert.equal(err.attempts, 3);
        assert.ok(err.message.includes('Internal Server Crash'));
        return true;
      }
    );

    assert.equal(callCount, 3);
    assert.equal(sleptMs.length, 2);
  });

  await t.test('Fatal 401/403/400 errors fail immediately without retrying', async () => {
    let callCount = 0;
    const sleptMs: number[] = [];

    const fakeFetch: typeof fetch = async () => {
      callCount++;
      return new Response('Unauthorized: Invalid API Key', {
        status: 401,
        statusText: 'Unauthorized'
      });
    };

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:8080/v1',
      maxNetworkRetries: 3,
      fetchImpl: fakeFetch,
      sleepImpl: async (ms) => {
        sleptMs.push(ms);
      }
    });

    await assert.rejects(
      async () => {
        await provider.generateStructuredJson('Generate test contract', TestContractSchema);
      },
      (err: unknown) => {
        assert.ok(err instanceof LlmFatalError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.isFatal, true);
        assert.ok(err.message.includes('Invalid API key'));
        return true;
      }
    );

    assert.equal(callCount, 1, 'Fatal errors must fail immediately on attempt 1 without retry');
    assert.equal(sleptMs.length, 0);
  });

  await t.test('AbortError / Network Timeout is retried as transient', async () => {
    let callCount = 0;
    const sleptMs: number[] = [];

    const fakeFetch: typeof fetch = async () => {
      callCount++;
      if (callCount === 1) {
        throw new DOMException('The operation was aborted due to timeout', 'AbortError');
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"title":"Recovered","count":10}' } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:8080/v1',
      maxNetworkRetries: 2,
      fetchImpl: fakeFetch,
      sleepImpl: async (ms) => {
        sleptMs.push(ms);
      }
    });

    const res = await provider.generateStructuredJson(
      'Generate test contract',
      TestContractSchema
    );
    assert.equal(callCount, 2);
    assert.equal(sleptMs.length, 1);
    assert.equal(res.title, 'Recovered');
    assert.equal(res.count, 10);
  });

  await t.test('Truncation detection: finish_reason === "length" throws LlmOutputTruncatedError', async () => {
    const fakeFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: '{"title":"TruncatedPayload","cou' },
              finish_reason: 'length'
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:8080/v1',
      fetchImpl: fakeFetch
    });

    await assert.rejects(
      async () => {
        await provider.generateStructuredJson('Generate', TestContractSchema);
      },
      (err: unknown) => {
        assert.ok(err instanceof LlmOutputTruncatedError);
        assert.ok(err.message.includes('truncated'));
        assert.equal(err.truncatedSnippet, '{"title":"TruncatedPayload","cou');
        return true;
      }
    );

    // Verify formatRepairFeedbackPrompt handles LLM_OUTPUT_TRUNCATED without broken draft
    const repairPrompt = formatRepairFeedbackPrompt(
      [
        {
          code: 'LLM_OUTPUT_TRUNCATED',
          path: 'root',
          severity: 'fatal',
          message: 'Output exceeded max_tokens'
        }
      ],
      '{"title":"TruncatedPayload","cou'
    );

    assert.ok(repairPrompt.includes('exceeded the maximum token limit'));
    assert.ok(!repairPrompt.includes('TruncatedPayload'), 'Never embed truncated draft');
  });

  await t.test('JSON mode negotiation supports json_schema, json_object, and plain', async () => {
    let capturedBody: any;

    const fakeFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"title":"Negotiation","count":5}' } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    // 1. json_schema mode
    const schemaProvider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:8080/v1',
      jsonMode: 'json_schema',
      fetchImpl: fakeFetch
    });
    await schemaProvider.generateStructuredJson('Prompt', TestContractSchema, {
      schemaName: 'CustomTestSchema'
    });
    assert.equal(capturedBody.response_format?.type, 'json_schema');
    assert.equal(capturedBody.response_format?.json_schema?.name, 'CustomTestSchema');
    assert.equal(capturedBody.response_format?.json_schema?.strict, true);

    // 2. json_object mode
    const objProvider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:8080/v1',
      jsonMode: 'json_object',
      fetchImpl: fakeFetch
    });
    await objProvider.generateStructuredJson('Prompt', TestContractSchema);
    assert.deepEqual(capturedBody.response_format, { type: 'json_object' });

    // 3. plain mode (no response_format)
    const plainProvider = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:8080/v1',
      jsonMode: 'plain',
      fetchImpl: fakeFetch
    });
    await plainProvider.generateStructuredJson('Prompt', TestContractSchema);
    assert.equal(capturedBody.response_format, undefined);
  });

  await t.test('Secret redaction: API tokens never leak in errors or messages', async () => {
    const sensitiveKey = 'sk-live-super-secret-production-token-998877';

    const fakeFetch: typeof fetch = async (_url, init) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      // Echo the Authorization header in an error body as an upstream server might
      return new Response(`Error: Invalid credential ${auth} for endpoint`, {
        status: 401,
        statusText: 'Unauthorized'
      });
    };

    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: sensitiveKey,
      fetchImpl: fakeFetch
    });

    await assert.rejects(
      async () => {
        await provider.generateStructuredJson('Prompt', TestContractSchema);
      },
      (err: unknown) => {
        assert.ok(err instanceof LlmFatalError);
        assert.ok(!err.message.includes(sensitiveKey), 'Secret API key must not appear in error message');
        assert.ok(err.message.includes('[REDACTED]'), 'Secret must be masked with [REDACTED]');
        return true;
      }
    );

    // Also verify sanitizeSecrets helper
    const sanitized = sanitizeSecrets(
      `Debug: token is ${sensitiveKey} and header is Bearer ${sensitiveKey}`,
      [sensitiveKey]
    );
    assert.ok(!sanitized.includes(sensitiveKey));
    assert.ok(sanitized.includes('[REDACTED]'));
  });

  await t.test('Targeted repair prompts extract offending subtrees within budget for large drafts', () => {
    // Generate a simulated large draft (> 15,000 characters)
    const largeObject = {
      projectId: 'large-production-film',
      shots: Array.from({ length: 80 }, (_, i) => ({
        shotId: `shot_${i.toString().padStart(2, '0')}`,
        camera: {
          fov: i === 5 ? 150 : 60, // Shot 5 has an invalid FOV error
          easing: 'linear'
        },
        description: `This is a lengthy description for shot ${i} providing rich atmospheric visual context and keyframe choreography metadata for testing.`
      }))
    };
    const serializedLarge = JSON.stringify(largeObject, null, 2);
    assert.ok(serializedLarge.length > 12_000, 'Draft must exceed 12,000 characters');

    const prompt = formatRepairFeedbackPrompt(
      [
        {
          code: 'CAMERA_FOV_EXCEEDS_MAX',
          path: 'shots[5].camera.fov',
          severity: 'fatal',
          message: 'Value 150 exceeds max allowed FOV 120.'
        }
      ],
      serializedLarge
    );

    // 1. Must include targeted offending context
    assert.ok(prompt.includes('Targeted offending subtrees extracted from previous draft'));
    assert.ok(prompt.includes('shots[5].camera'));
    assert.ok(prompt.includes('"fov": 150'));

    // 2. Must NOT dump the full 15,000+ char draft
    assert.ok(prompt.length < 5000, `Repair prompt must stay under budget, was ${prompt.length} chars`);

    // 3. Must preserve clean markdown code fences without broken syntax
    assert.ok(prompt.includes('```json'));
    assert.ok(prompt.includes('[SELF-HEALING REPAIR DIAGNOSTICS]'));
  });

  await t.test('Live smoke test (opt-in via LLM_LIVE_TEST=1)', async (subtest) => {
    if (process.env.LLM_LIVE_TEST !== '1') {
      subtest.skip('Skipped live LLM test (set LLM_LIVE_TEST=1 to execute)');
      return;
    }

    const liveProvider = new OpenAiCompatibleProvider();
    const result = await liveProvider.generateStructuredJson(
      'Respond with valid JSON: { "title": "Live Test", "count": 1 }',
      TestContractSchema
    );
    assert.equal(typeof result.title, 'string');
    assert.equal(typeof result.count, 'number');
  });
});
