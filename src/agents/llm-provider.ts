import { performance } from 'node:perf_hooks';
import { ZodError, z } from 'zod';
import type {
  LlmCallMetadata,
  LlmEndpointDescription,
  LlmExecutionResult,
  LlmJsonMode,
  LlmOptions,
  LlmProvider,
  TokenUsage
} from './types.js';
import { buildDeterministicStorySpec, type StorySpecAgentInput } from './story-spec-agent.js';

// =============================================================================
// Error Taxonomy (Transient vs. Fatal vs. Truncation vs. Contract Schema)
// =============================================================================

export class LlmProviderError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'LlmProviderError';
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
  }
}

/**
 * Fatal unrecoverable HTTP or configuration errors (e.g. 400 Bad Request,
 * 401 Unauthorized, 403 Forbidden, 404 Model Not Found).
 * Must fail immediately without exhausting retry loops.
 */
export class LlmFatalError extends LlmProviderError {
  public readonly isFatal = true;

  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = 'LlmFatalError';
  }
}

/**
 * Transient errors eligible for exponential backoff and jittered retry
 * (e.g. 429 Rate Limit, 500/502/503/504 Server Errors, AbortError, Network Drops).
 */
export class LlmTransientError extends LlmProviderError {
  public readonly attempts: number;
  public readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    attempts: number,
    statusCode?: number,
    retryAfterSeconds?: number
  ) {
    super(message, statusCode);
    this.name = 'LlmTransientError';
    this.attempts = attempts;
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
}

/**
 * Generation cut off because it reached the token ceiling (finish_reason === "length").
 * Never feed a truncated draft back as a previous draft to avoid compounding corruption.
 */
export class LlmOutputTruncatedError extends LlmProviderError {
  public readonly truncatedSnippet?: string;

  constructor(message: string, rawSnippet?: string) {
    super(message);
    this.name = 'LlmOutputTruncatedError';
    if (rawSnippet) {
      this.truncatedSnippet = rawSnippet.slice(0, 240);
    }
  }
}

export class LlmJsonParseError extends LlmProviderError {
  public readonly rawSnippet: string;
  public readonly rawDraft: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = 'LlmJsonParseError';
    this.rawSnippet = rawResponse.slice(0, 240);
    this.rawDraft = rawResponse;
  }
}

export class LlmSchemaValidationError extends ZodError {
  public readonly rawDraft: string;

  constructor(issues: z.ZodIssue[], rawDraft: string) {
    super(issues);
    this.name = 'LlmSchemaValidationError';
    this.rawDraft = rawDraft;
  }
}

// =============================================================================
// Security, Backoff, and Jitter Helpers
// =============================================================================

/**
 * Redacts API keys and Bearer authorization tokens from error messages and logs.
 */
export function sanitizeSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let result = text;
  for (const s of secrets) {
    if (s && s.length >= 4) {
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), '[REDACTED]');
    }
  }
  result = result.replace(/Bearer\s+[A-Za-z0-9._\-~+/]+=*/g, 'Bearer [REDACTED]');
  return result;
}

/**
 * Parses the HTTP Retry-After header as either an integer number of seconds
 * or an HTTP-date format (RFC 7231).
 */
export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;

  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }

  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    const diff = (parsedDate - Date.now()) / 1000;
    return Math.max(0, diff);
  }

  return undefined;
}

/**
 * Calculates exponential backoff with full jitter and Retry-After honoring:
 * t_backoff(a) = min(t_max, t_base * 2^(a - 1))
 * delay(a) = U(0, t_backoff(a))
 * finalDelay = max(delay(a), Retry-After)
 */
export function computeBackoffDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  tBaseSec = 1.0,
  tMaxSec = 30.0,
  randomFloat = Math.random()
): number {
  const tBackoff = Math.min(tMaxSec, tBaseSec * Math.pow(2, attempt - 1));
  const jitteredDelay = randomFloat * tBackoff;

  const retryAfterSec = parseRetryAfter(retryAfterHeader);
  if (retryAfterSec !== undefined) {
    return Math.max(jitteredDelay, retryAfterSec);
  }
  return jitteredDelay;
}

function parseWithSchemaDraftRetention<T>(schema: z.ZodType<T>, extracted: unknown): T {
  try {
    return schema.parse(extracted);
  } catch (err) {
    if (err instanceof ZodError) {
      let serialized = '';
      try {
        serialized = JSON.stringify(extracted, null, 2);
      } catch {
        serialized = String(extracted);
      }
      throw new LlmSchemaValidationError(err.issues, serialized);
    }
    throw err;
  }
}

/**
 * Safely extracts and parses a JSON payload from raw LLM text output.
 * Handles:
 * - UTF-8 BOM (\uFEFF)
 * - Markdown fenced code blocks (```json ... ``` or ``` ... ```)
 * - Leading and trailing conversational prose surrounding a JSON object/array
 */
export function extractJsonFromLlmResponse(raw: string): unknown {
  const withoutBom = raw.replace(/^\uFEFF/, '').trim();
  if (withoutBom.length === 0) {
    throw new LlmJsonParseError('LLM response is empty after stripping BOM and whitespace.', raw);
  }

  // 1. Check for markdown fenced block ```json ... ``` or ``` ... ```
  const fenceRegex = /```(?:json|JSON)?\s*([\s\S]*?)```/;
  const fenceMatch = fenceRegex.exec(withoutBom);
  if (fenceMatch && fenceMatch[1] !== undefined) {
    const fencedBody = fenceMatch[1].trim();
    try {
      return JSON.parse(fencedBody);
    } catch (err) {
      throw new LlmJsonParseError(
        `Failed to parse JSON inside markdown code fence: ${(err as Error).message}`,
        raw
      );
    }
  }

  // 2. Try direct JSON.parse
  try {
    return JSON.parse(withoutBom);
  } catch {
    // Fall through to outermost brace/bracket extraction
  }

  // 3. Locate outermost JSON object {...} or array [...]
  const firstBrace = withoutBom.indexOf('{');
  const lastBrace = withoutBom.lastIndexOf('}');
  const firstBracket = withoutBom.indexOf('[');
  const lastBracket = withoutBom.lastIndexOf(']');

  let candidate: string | undefined;
  if (
    firstBrace !== -1 &&
    lastBrace > firstBrace &&
    (firstBracket === -1 || firstBrace < firstBracket)
  ) {
    candidate = withoutBom.slice(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidate = withoutBom.slice(firstBracket, lastBracket + 1);
  }

  if (candidate !== undefined) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      throw new LlmJsonParseError(
        `Failed to parse extracted JSON block from LLM response: ${(err as Error).message}`,
        raw
      );
    }
  }

  throw new LlmJsonParseError('No valid JSON object or array found in LLM response.', raw);
}

export interface OpenAiCompatibleProviderConfig {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly stream?: boolean;
  readonly maxNetworkRetries?: number;
  readonly jsonMode?: LlmJsonMode;
  readonly fetchImpl?: typeof fetch;
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Note on JSON Schema Contract Limits:
 * While Zod models can be exported to JSON Schema draft-07 via `z.toJSONSchema()`,
 * runtime refinements (`.refine()`, `.superRefine()`) and transformation functions
 * are JavaScript runtime logic and cannot be represented in a static JSON Schema document.
 * Consequently, schema validation via `json_schema` mode guarantees structural shape and
 * basic primitive types, but domain-specific contract invariants (e.g. frame continuity,
 * joint angle limits, emitter depth separation) must still be enforced via post-generation
 * invariant validators in `invariants.ts`.
 */

/**
 * Provider-agnostic HTTP client for OpenAI-compatible Chat Completions endpoints
 * (OpenAI, Gemini OpenAI-compatible API, Ollama on localhost, Groq, etc.).
 * Enforces HTTPS for remote hosts and never hardcodes or logs API keys.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  public readonly name = 'openai-compatible';
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly stream: boolean;
  private readonly maxNetworkRetries: number;
  private readonly jsonMode?: LlmJsonMode;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(config: OpenAiCompatibleProviderConfig = {}) {
    const rawBaseUrl = (
      config.baseUrl ??
      process.env.LLM_BASE_URL ??
      'https://api.openai.com/v1'
    ).replace(/\/+$/, '');

    const parsedUrl = new URL(rawBaseUrl);
    const isLocalhost =
      parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost';
    if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLocalhost)) {
      throw new LlmProviderError(
        `Insecure LLM endpoint protocol "${parsedUrl.protocol}" for host "${parsedUrl.hostname}". Only https: or localhost http: is permitted.`
      );
    }

    this.baseUrl = rawBaseUrl;
    this.apiKey = config.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    this.model = config.model ?? process.env.LLM_MODEL ?? 'gpt-4o-mini';
    this.timeoutMs = config.timeoutMs ?? (process.env.LLM_TIMEOUT_MS ? Number(process.env.LLM_TIMEOUT_MS) : 60_000);
    this.idleTimeoutMs = config.idleTimeoutMs ?? (process.env.LLM_IDLE_TIMEOUT_MS ? Number(process.env.LLM_IDLE_TIMEOUT_MS) : 30_000);
    this.stream = config.stream ?? (process.env.LLM_STREAM === 'true');
    this.maxNetworkRetries = config.maxNetworkRetries ?? 3;
    this.jsonMode = config.jsonMode ?? (process.env.LLM_JSON_MODE as LlmJsonMode | undefined);
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.sleepImpl = config.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    if (!isLocalhost && (!this.apiKey || this.apiKey.trim().length === 0)) {
      throw new LlmProviderError(
        'Missing LLM API key for remote OpenAI-compatible provider. Set LLM_API_KEY or OPENAI_API_KEY in environment, or use --mock for offline deterministic mode.'
      );
    }
  }

  private sanitize(message: string): string {
    return sanitizeSecrets(message, [this.apiKey]);
  }

  public describeEndpoint(): LlmEndpointDescription {
    try {
      const parsed = new URL(this.baseUrl);
      const host = parsed.hostname;
      const isLocal =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        /localhost/.test(host);
      return {
        provider: this.name,
        modelId: this.model,
        host,
        isLocal
      };
    } catch {
      return {
        provider: this.name,
        modelId: this.model,
        host: 'unknown',
        isLocal: false
      };
    }
  }

  public async generateStructuredJson<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options: LlmOptions = {}
  ): Promise<T> {
    const result = await this.generateStructuredJsonWithMeta(prompt, schema, options);
    return result.data;
  }

  public async generateStructuredJsonWithMeta<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options: LlmOptions = {}
  ): Promise<LlmExecutionResult<T>> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const requestedJsonMode: LlmJsonMode =
      options.jsonMode ??
      this.jsonMode ??
      (process.env.LLM_JSON_MODE as LlmJsonMode | undefined) ??
      'json_object';

    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 4096
    };

    if (requestedJsonMode === 'json_schema') {
      requestBody.response_format = {
        type: 'json_schema',
        json_schema: {
          name: options.schemaName ?? 'ContractPayload',
          strict: true,
          schema: z.toJSONSchema(schema, { target: 'draft-07' })
        }
      };
    } else if (requestedJsonMode === 'json_object') {
      requestBody.response_format = { type: 'json_object' };
    }
    // 'plain' mode: response_format is intentionally omitted

    if (this.stream) {
      requestBody.stream = true;
      requestBody.stream_options = { include_usage: true };
    }

    const maxAttempts = this.maxNetworkRetries + 1;
    let networkRetryCount = 0;
    const t0 = performance.now();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const effectiveTimeout = options.timeoutMs ?? this.timeoutMs;
      const timer = setTimeout(() => controller.abort(), effectiveTimeout);

      try {
        let response: Response;
        try {
          response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });
        } catch (fetchErr) {
          const isAbort = (fetchErr as Error)?.name === 'AbortError';
          const sanitizedErr = this.sanitize((fetchErr as Error)?.message ?? String(fetchErr));

          if (attempt < maxAttempts) {
            networkRetryCount++;
            const delaySec = computeBackoffDelay(attempt, null);
            await this.sleepImpl(Math.round(delaySec * 1000));
            continue;
          }
          throw new LlmTransientError(
            `LLM request failed after ${attempt} attempts (${isAbort ? 'Timeout' : 'Network Error'}): ${sanitizedErr}`,
            attempt
          );
        }

        // =====================================================================
        // Process Response Status
        // =====================================================================
        if (!response.ok) {
          let detail = '';
          try {
            detail = await response.text();
          } catch {
            detail = response.statusText;
          }
          const sanitizedDetail = this.sanitize(detail);

          // Fatal errors: 400..499 except 429
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            let actionAdvice = '';
            if (response.status === 401) {
              actionAdvice = 'Invalid API key. Please check LLM_API_KEY or OPENAI_API_KEY.';
            } else if (response.status === 403) {
              actionAdvice = 'Access forbidden. Check your API key permissions or model access.';
            } else if (response.status === 404) {
              actionAdvice = `Model "${this.model}" or endpoint not found at "${this.baseUrl}".`;
            } else if (response.status === 400) {
              actionAdvice = 'Check prompt formatting or JSON mode compatibility.';
            }
            const message = `LLM Fatal Error HTTP ${response.status} (${response.statusText}): ${sanitizedDetail}${actionAdvice ? ` [Action: ${actionAdvice}]` : ''}`;
            throw new LlmFatalError(message, response.status);
          }

          // Transient errors: 429 or 500..599
          const retryAfterHeader = response.headers.get('retry-after');
          const parsedRetry = parseRetryAfter(retryAfterHeader);

          if (attempt < maxAttempts) {
            networkRetryCount++;
            const delaySec = computeBackoffDelay(attempt, retryAfterHeader);
            await this.sleepImpl(Math.round(delaySec * 1000));
            continue;
          }

          throw new LlmTransientError(
            `LLM transient error HTTP ${response.status} (${response.statusText}) after ${attempt} attempts: ${sanitizedDetail}`,
            attempt,
            response.status,
            parsedRetry
          );
        }

        // =====================================================================
        // Read & Parse Successful 200 Payload
        // =====================================================================
        let rawContent = '';
        let finishReason: string | undefined;
        let tokenUsage: TokenUsage | undefined;

        if (this.stream && response.body && typeof (response.body as any).getReader === 'function') {
          const sseResult = await this.readSseStream(response, controller.signal);
          rawContent = sseResult.rawContent;
          finishReason = sseResult.finishReason;
          tokenUsage = sseResult.usage;
        } else {
          const body = (await response.json()) as {
            choices?: Array<{
              message?: { content?: string };
              finish_reason?: string;
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
          };

          const choice = body.choices?.[0];
          rawContent = choice?.message?.content ?? '';
          finishReason = choice?.finish_reason;
          if (body.usage) {
            tokenUsage = {
              promptTokens: body.usage.prompt_tokens ?? 0,
              completionTokens: body.usage.completion_tokens ?? 0,
              totalTokens: body.usage.total_tokens ?? 0
            };
          }
        }

        if (finishReason === 'length') {
          throw new LlmOutputTruncatedError(
            `LLM generation was truncated because it reached max_tokens (${options.maxTokens ?? 4096}).`,
            rawContent
          );
        }

        if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
          throw new LlmProviderError(
            'LLM response payload did not contain a valid message content string.'
          );
        }

        const extracted = extractJsonFromLlmResponse(rawContent);
        const data = parseWithSchemaDraftRetention(schema, extracted);
        const latencyMs = Number((performance.now() - t0).toFixed(2));

        const meta: LlmCallMetadata = {
          latencyMs,
          tokenUsage,
          finishReason,
          networkRetryCount
        };
        options.onAttemptComplete?.(meta);

        return {
          data,
          latencyMs,
          tokenUsage,
          finishReason,
          networkRetryCount
        };
      } finally {
        clearTimeout(timer);
      }
    }

    throw new LlmTransientError(
      `LLM request exhausted maxNetworkRetries (${this.maxNetworkRetries})`,
      maxAttempts
    );
  }

  private async readSseStream(
    response: Response,
    signal: AbortSignal
  ): Promise<{ rawContent: string; finishReason?: string; usage?: TokenUsage }> {
    if (!response.body) {
      throw new LlmProviderError('Response body is null in streaming mode.');
    }

    let rawContent = '';
    let finishReason: string | undefined;
    let usage: TokenUsage | undefined;

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        reader
          .cancel(new DOMException('SSE stream idle timeout exceeded.', 'AbortError'))
          .catch(() => {});
      }, this.idleTimeoutMs);
    };

    resetIdleTimer();

    try {
      while (true) {
        if (signal.aborted) {
          throw new DOMException('Request aborted.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;

        resetIdleTimer();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') {
              rawContent += delta;
            }
            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason;
            }
            if (parsed.usage) {
              usage = {
                promptTokens: parsed.usage.prompt_tokens ?? 0,
                completionTokens: parsed.usage.completion_tokens ?? 0,
                totalTokens: parsed.usage.total_tokens ?? 0
              };
            }
          } catch {
            // ignore non-json SSE lines
          }
        }
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      reader.releaseLock();
    }

    return { rawContent, finishReason, usage };
  }
}

export type MockResponseInterceptor = (
  prompt: string,
  options: LlmOptions
) => string | unknown | undefined;

export interface DeterministicMockProviderOptions {
  readonly interceptor?: MockResponseInterceptor;
  readonly wrapInMarkdownFence?: boolean;
}

/**
 * 100% offline, deterministic Mock LLM Provider for CI, unit tests, and benchmark gates.
 * Synthesizes schema-valid JSON responses for Director, Rig, and Choreographer agents
 * and passes every response through `extractJsonFromLlmResponse` + `schema.parse`.
 */
export class DeterministicMockLlmProvider implements LlmProvider {
  public readonly name = 'deterministic-mock';
  private readonly interceptor?: MockResponseInterceptor;
  private readonly wrapInMarkdownFence: boolean;
  private callCount = 0;

  constructor(options: DeterministicMockProviderOptions = {}) {
    if (options.interceptor !== undefined) {
      this.interceptor = options.interceptor;
    }
    this.wrapInMarkdownFence = options.wrapInMarkdownFence ?? true;
  }

  public getCallCount(): number {
    return this.callCount;
  }

  public describeEndpoint(): LlmEndpointDescription {
    return {
      provider: this.name,
      modelId: 'mock-deterministic',
      host: 'localhost',
      isLocal: true
    };
  }

  public async generateStructuredJson<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options: LlmOptions = {}
  ): Promise<T> {
    const res = await this.generateStructuredJsonWithMeta(prompt, schema, options);
    return res.data;
  }

  public async generateStructuredJsonWithMeta<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options: LlmOptions = {}
  ): Promise<LlmExecutionResult<T>> {
    this.callCount++;

    if (this.interceptor) {
      const intercepted = this.interceptor(prompt, options);
      if (intercepted !== undefined) {
        const rawText =
          typeof intercepted === 'string' ? intercepted : JSON.stringify(intercepted, null, 2);
        const extracted = extractJsonFromLlmResponse(rawText);
        const data = parseWithSchemaDraftRetention(schema, extracted);
        const meta: LlmCallMetadata = {
          latencyMs: 1,
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: 'stop',
          networkRetryCount: 0
        };
        options.onAttemptComplete?.(meta);
        return {
          data,
          latencyMs: 1,
          tokenUsage: meta.tokenUsage,
          finishReason: 'stop',
          networkRetryCount: 0
        };
      }
    }

    let payload: unknown;
    const role = options.agentRole;
    const ctx = options.context ?? {};

    if (role === 'story_spec') {
      const storyInput = ctx.storySpecInput as StorySpecAgentInput | undefined;
      if (!storyInput) {
        throw new LlmProviderError(
          'DeterministicMockLlmProvider requires context.storySpecInput for story_spec role.'
        );
      }
      payload = buildDeterministicStorySpec(storyInput.audioManifest, storyInput.projectId);
    } else {
      throw new LlmProviderError(
        `DeterministicMockLlmProvider received unsupported agentRole "${String(role)}" without an interceptor.`
      );
    }

    const serialized = JSON.stringify(payload, null, 2);
    const rawResponse = this.wrapInMarkdownFence
      ? `\uFEFFHere is the validated contract payload:\n\`\`\`json\n${serialized}\n\`\`\`\n`
      : serialized;

    const extracted = extractJsonFromLlmResponse(rawResponse);
    const data = parseWithSchemaDraftRetention(schema, extracted);

    const meta: LlmCallMetadata = {
      latencyMs: 1,
      tokenUsage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
      finishReason: 'stop',
      networkRetryCount: 0
    };
    options.onAttemptComplete?.(meta);

    return {
      data,
      latencyMs: 1,
      tokenUsage: meta.tokenUsage,
      finishReason: 'stop',
      networkRetryCount: 0
    };
  }
}
