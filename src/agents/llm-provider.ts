import { ZodError, type z } from 'zod';
import type {
  ChoreographerAgentInput,
  DirectorAgentInput,
  LlmOptions,
  LlmProvider,
  RigAgentInput
} from './types.js';
import { buildDeterministicDirectorStoryboard } from './director-agent.js';
import { buildDeterministicRigCatalog } from './rig-agent.js';
import { buildDeterministicChoreography } from './choreographer-agent.js';

export class LlmJsonParseError extends Error {
  public readonly rawSnippet: string;
  public readonly rawDraft: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = 'LlmJsonParseError';
    this.rawSnippet = rawResponse.slice(0, 240);
    this.rawDraft = rawResponse.slice(0, 12_000);
  }
}

export class LlmSchemaValidationError extends ZodError {
  public readonly rawDraft: string;

  constructor(issues: z.ZodIssue[], rawDraft: string) {
    super(issues);
    this.name = 'LlmSchemaValidationError';
    this.rawDraft = rawDraft.slice(0, 12_000);
  }
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
  readonly fetchImpl?: typeof fetch;
}

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
  private readonly fetchImpl: typeof fetch;

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
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;

    if (!isLocalhost && (!this.apiKey || this.apiKey.trim().length === 0)) {
      throw new LlmProviderError(
        'Missing LLM API key for remote OpenAI-compatible provider. Set LLM_API_KEY or OPENAI_API_KEY in environment, or use --mock for offline deterministic mode.'
      );
    }
  }

  public async generateStructuredJson<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options: LlmOptions = {}
  ): Promise<T> {
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.1,
          ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new LlmProviderError(
          `LLM endpoint returned HTTP ${response.status} (${response.statusText}).`,
          response.status
        );
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = body.choices?.[0]?.message?.content;
      if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
        throw new LlmProviderError('LLM response payload did not contain a valid message content string.');
      }

      const extracted = extractJsonFromLlmResponse(rawContent);
      return parseWithSchemaDraftRetention(schema, extracted);
    } finally {
      clearTimeout(timer);
    }
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

  public async generateStructuredJson<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options: LlmOptions = {}
  ): Promise<T> {
    this.callCount++;

    if (this.interceptor) {
      const intercepted = this.interceptor(prompt, options);
      if (intercepted !== undefined) {
        const rawText =
          typeof intercepted === 'string' ? intercepted : JSON.stringify(intercepted, null, 2);
        const extracted = extractJsonFromLlmResponse(rawText);
        return parseWithSchemaDraftRetention(schema, extracted);
      }
    }

    let payload: unknown;
    const role = options.agentRole;
    const ctx = options.context ?? {};

    if (role === 'director') {
      const directorInput = ctx.directorInput as DirectorAgentInput | undefined;
      if (!directorInput) {
        throw new LlmProviderError('DeterministicMockLlmProvider requires context.directorInput for director role.');
      }
      payload = buildDeterministicDirectorStoryboard(directorInput);
    } else if (role === 'rig') {
      const _rigInput = ctx.rigInput as RigAgentInput | undefined;
      payload = buildDeterministicRigCatalog();
    } else if (role === 'choreographer') {
      const choreographerInput = ctx.choreographerInput as ChoreographerAgentInput | undefined;
      if (!choreographerInput) {
        throw new LlmProviderError(
          'DeterministicMockLlmProvider requires context.choreographerInput for choreographer role.'
        );
      }
      payload = buildDeterministicChoreography(choreographerInput);
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
    return parseWithSchemaDraftRetention(schema, extracted);
  }
}
