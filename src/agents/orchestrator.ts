import { performance } from 'node:perf_hooks';
import { ZodError } from 'zod';
import { createRenderConfig } from '../config/render-config.js';
import {
  validateChoreography,
  validateProjectContracts,
  type ValidationErrorItem,
  type ValidationReport
} from '../schemas/invariants.js';
import type { DirectorStoryboardContract } from '../schemas/storyboard.contract.js';
import type { AssetRigContract } from '../schemas/rig.contract.js';
import type { ChoreographyContract } from '../schemas/choreography.contract.js';
import type { SceneEnvironment } from '../engine/compositor/scene-compositor.js';
import { StorySpecAgent } from './story-spec-agent.js';
import type { StorySpecContract, SectionStagingSpec } from '../schemas/story-spec.contract.js';
import { compileStorySpecToStoryboard } from '../engine/director/shot-planner.js';
import { solveChoreography } from '../engine/director/choreography-solver.js';
import { TrajectorySolver } from '../engine/director/trajectory-solver.js';
import { ArchetypeFactory } from '../engine/library/archetype-factory.js';
import { EnvironmentKit, computeShotEnvironmentBounds } from '../engine/library/environment-kit.js';
import {
  LlmFatalError,
  LlmJsonParseError,
  LlmOutputTruncatedError,
  LlmSchemaValidationError,
  LlmTransientError
} from './llm-provider.js';
import type {
  AgentAttemptLog,
  LlmCallMetadata,
  LlmProvider,
  OrchestrationOptions,
  OrchestrationResult,
  StudioAgentRole
} from './types.js';

function extractDraftFromException(err: unknown): string | undefined {
  if (err instanceof LlmOutputTruncatedError) {
    return undefined; // NEVER feed truncated draft back to prevent corrupted state
  }
  if (err instanceof LlmSchemaValidationError) {
    return err.rawDraft;
  }
  if (err instanceof LlmJsonParseError) {
    return err.rawDraft || err.rawSnippet;
  }
  return undefined;
}

export class OrchestrationValidationError extends Error {
  public readonly agentRole: StudioAgentRole;
  public readonly errors: readonly ValidationErrorItem[];
  public readonly attempts: readonly AgentAttemptLog[];

  constructor(
    agentRole: StudioAgentRole,
    errors: readonly ValidationErrorItem[],
    attempts: readonly AgentAttemptLog[]
  ) {
    const summary = errors.map((e) => `[${e.code}] ${e.path}: ${e.message}`).join('; ');
    super(
      `Agent "${agentRole}" failed contract validation after ${attempts.filter((a) => a.agentRole === agentRole).length} attempts: ${summary}`
    );
    this.name = 'OrchestrationValidationError';
    this.agentRole = agentRole;
    this.errors = errors;
    this.attempts = attempts;
  }
}

function convertExceptionToValidationErrors(
  err: unknown,
  agentRole: StudioAgentRole
): ValidationErrorItem[] {
  if (err instanceof LlmFatalError || err instanceof LlmTransientError) {
    // Unrecoverable HTTP or exhausted network errors must abort immediately
    throw err;
  }
  if (err instanceof LlmOutputTruncatedError) {
    return [
      {
        code: 'LLM_OUTPUT_TRUNCATED',
        path: agentRole,
        severity: 'fatal' as const,
        message: err.message
      }
    ];
  }
  if (err instanceof ZodError) {
    return err.issues.map((issue) => ({
      code: 'ZOD_SCHEMA_INVALID',
      path: issue.path.join('.') || agentRole,
      severity: 'fatal' as const,
      message: issue.message
    }));
  }
  if (err instanceof LlmJsonParseError) {
    return [
      {
        code: 'LLM_JSON_PARSE_ERROR',
        path: agentRole,
        severity: 'fatal' as const,
        message: err.message
      }
    ];
  }
  throw err;
}

interface StageExecutionParams<T> {
  readonly role: StudioAgentRole;
  readonly execute: (
    attempt: number,
    repairErrors: ValidationErrorItem[],
    previousDraft?: string,
    onComplete?: (meta: LlmCallMetadata) => void
  ) => Promise<T>;
  readonly validate: (candidate: T) => ValidationErrorItem[];
  readonly serializeDraft: (candidate: T) => string;
  readonly initialRepairErrors?: ValidationErrorItem[];
  readonly initialPreviousDraft?: string;
  readonly maxAttempts: number;
}

/**
 * Multi-Agent Studio Orchestrator executing the pipeline with
 * automated invariant validation, self-healing repair retries, and 1-stage backtracking.
 */
export class StudioAgentOrchestrator {
  private readonly storySpecAgent: StorySpecAgent;

  constructor(provider: LlmProvider) {
    this.storySpecAgent = new StorySpecAgent(provider);
  }

  /**
   * Generic unified stage runner handling attempt timing, error diagnostics,
   * schema/invariant repair feedback, and attempt log observability.
   */
  private async runStage<T>(
    params: StageExecutionParams<T>,
    attempts: AgentAttemptLog[]
  ): Promise<T> {
    let repairErrors: ValidationErrorItem[] = [...(params.initialRepairErrors ?? [])];
    let previousDraft: string | undefined = params.initialPreviousDraft;

    for (let attempt = 1; attempt <= params.maxAttempts; attempt++) {
      const t0 = performance.now();
      const repairedCodes = repairErrors.map((e) => e.code);
      let lastMeta: LlmCallMetadata | undefined;

      try {
        const candidate = await params.execute(
          attempt,
          repairErrors,
          previousDraft,
          (meta) => {
            lastMeta = meta;
          }
        );

        const blockingErrors = params.validate(candidate);

        attempts.push({
          agentRole: params.role,
          attempt,
          repairedErrorCodes: repairedCodes,
          durationMs: Number((performance.now() - t0).toFixed(2)),
          latencyMs: lastMeta?.latencyMs,
          tokenUsage: lastMeta?.tokenUsage,
          finishReason: lastMeta?.finishReason,
          retryCount: lastMeta?.networkRetryCount,
          retryClass: repairedCodes.length > 0 ? 'invariant_repair' : 'none'
        });

        if (blockingErrors.length === 0) {
          return candidate;
        }

        repairErrors = blockingErrors;
        previousDraft = params.serializeDraft(candidate);
      } catch (err) {
        const schemaErrors = convertExceptionToValidationErrors(err, params.role);
        attempts.push({
          agentRole: params.role,
          attempt,
          repairedErrorCodes: repairedCodes,
          durationMs: Number((performance.now() - t0).toFixed(2)),
          latencyMs: lastMeta?.latencyMs,
          tokenUsage: lastMeta?.tokenUsage,
          finishReason: lastMeta?.finishReason,
          retryCount: lastMeta?.networkRetryCount,
          retryClass: 'schema_repair'
        });
        repairErrors = schemaErrors;
        previousDraft = extractDraftFromException(err);
      }

      if (attempt === params.maxAttempts) {
        throw new OrchestrationValidationError(params.role, repairErrors, attempts);
      }
    }

    throw new OrchestrationValidationError(params.role, repairErrors, attempts);
  }

  /**
   * Canonical studio orchestrator entrypoint defaulting to Spec-Then-Compile pipeline.
   */
  public async orchestrate(options: OrchestrationOptions): Promise<OrchestrationResult> {
    return this.orchestrateWithSpec(options);
  }

  /**
   * High-Efficiency "Spec-Then-Compile" Pipeline:
   * 1. Synthesize compact declarative StorySpecContract with self-healing retry loop (LLM ~1,100 output tokens)
   * 2. Compile Storyboard, Rigs, Choreography, and Environments deterministically (Zero LLM tokens)
   * 3. Strictly enforce all project and choreography contract invariants before rendering
   */
  public async orchestrateWithSpec(options: OrchestrationOptions): Promise<OrchestrationResult> {
    const width = (options.width ?? 1920) as 1920;
    const height = (options.height ?? 1080) as 1080;
    const maxRetries = options.maxRetries ?? 3;
    const maxAttempts = maxRetries + 1;
    const attempts: AgentAttemptLog[] = [];

    const renderConfig = createRenderConfig({
      width,
      height,
      fps: options.audioManifest.metadata.fps === 60 ? 60 : 30,
      pixelFormat: 'rgba',
      totalFrames: options.audioManifest.metadata.totalFrames
    });

    let compiledStoryboard: DirectorStoryboardContract | undefined;
    let compiledRigs: Map<string, AssetRigContract> | undefined;
    let compiledChoreography: ChoreographyContract | undefined;
    let projectValidationReport: ValidationReport | undefined;
    let choreographyValidationReport: ValidationReport | undefined;

    // 1. Obtain StorySpecContract via self-healing runStage
    let storySpec = options.storySpec;
    if (!storySpec) {
      storySpec = await this.runStage<StorySpecContract>(
        {
          role: 'story_spec',
          maxAttempts,
          execute: (attempt, errors, draft, onComplete) =>
            this.storySpecAgent.generateStorySpec({
              projectId: options.projectId,
              audioManifest: options.audioManifest,
              stagingMode: options.stagingMode,
              attempt,
              repairErrors: errors,
              previousDraft: draft,
              onAttemptComplete: onComplete,
              noLyricsInPrompt: options.noLyricsInPrompt
            }),
          validate: (candidateSpec) => {
            try {
              const solver = new TrajectorySolver();
              const sb = compileStorySpecToStoryboard(candidateSpec, options.audioManifest, solver);
              const rMap = new Map<string, AssetRigContract>();
              for (const castItem of candidateSpec.cast) {
                const rig = ArchetypeFactory.build({
                  instanceId: castItem.instanceId,
                  spec: castItem,
                  fps: options.audioManifest.metadata.fps === 60 ? 60 : 30
                });
                rMap.set(rig.id, rig);
              }
              const choreo = solveChoreography(
                candidateSpec,
                sb,
                rMap,
                undefined,
                solver,
                options.audioManifest.lyrics
              );

              const projRep = validateProjectContracts(
                options.audioManifest,
                sb,
                renderConfig,
                rMap
              );
              const choreoRep = validateChoreography(choreo, sb, rMap);

              compiledStoryboard = sb;
              compiledRigs = rMap;
              compiledChoreography = choreo;
              projectValidationReport = projRep;
              choreographyValidationReport = choreoRep;

              const fatalErrors = [
                ...projRep.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error'),
                ...choreoRep.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error')
              ];
              return fatalErrors;
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              return [
                {
                  path: 'spec',
                  code: 'COMPILATION_ERROR',
                  message: `StorySpec compilation failed: ${errMsg}`,
                  severity: 'fatal'
                }
              ];
            }
          },
          serializeDraft: (spec) => JSON.stringify(spec, null, 2)
        },
        attempts
      );
    }

    // 2. Fallback compilation if spec was provided directly in options
    if (!compiledStoryboard || !compiledRigs || !compiledChoreography) {
      const solver = new TrajectorySolver();
      compiledStoryboard = compileStorySpecToStoryboard(storySpec, options.audioManifest, solver);
      compiledRigs = new Map<string, AssetRigContract>();
      for (const castItem of storySpec.cast) {
        const rig = ArchetypeFactory.build({
          instanceId: castItem.instanceId,
          spec: castItem,
          fps: options.audioManifest.metadata.fps === 60 ? 60 : 30
        });
        compiledRigs.set(rig.id, rig);
      }
      compiledChoreography = solveChoreography(
        storySpec,
        compiledStoryboard,
        compiledRigs,
        undefined,
        solver,
        options.audioManifest.lyrics
      );
      projectValidationReport = validateProjectContracts(
        options.audioManifest,
        compiledStoryboard,
        renderConfig,
        compiledRigs
      );
      choreographyValidationReport = validateChoreography(
        compiledChoreography,
        compiledStoryboard,
        compiledRigs
      );
      attempts.push({
        agentRole: 'story_spec',
        attempt: 1,
        repairedErrorCodes: [],
        durationMs: 0,
        retryClass: 'none'
      });
    }

    // 3. Strict Invariant Enforcement
    if (
      !projectValidationReport ||
      !choreographyValidationReport ||
      !projectValidationReport.isValid ||
      !choreographyValidationReport.isValid
    ) {
      const allErrors = [
        ...(projectValidationReport?.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error') ?? []),
        ...(choreographyValidationReport?.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error') ?? [])
      ];
      throw new OrchestrationValidationError('story_spec', allErrors, attempts);
    }

    // 4. Exact Section-Aligned & Frustum-Bounded Environment Resolver (Memoized per shot)
    const shotMap = new Map(compiledStoryboard.shots.map((s) => [s.id, s]));
    const envCache = new Map<string, SceneEnvironment>();

    const getEnvironmentForShot = (shotId: string): SceneEnvironment => {
      const cached = envCache.get(shotId);
      if (cached) return cached;

      const shot = shotMap.get(shotId);
      const centerX = shot
        ? (shot.cameraStart.position[0] + shot.cameraEnd.position[0]) / 2
        : 0;
      const startFrame = shot?.frameRange.startFrameInclusive ?? 0;
      const section = storySpec.sections.find(
        (s: SectionStagingSpec) => startFrame >= s.startFrame && startFrame < s.endFrame
      ) ?? storySpec.sections[storySpec.sections.length - 1];

      const bounds = shot ? computeShotEnvironmentBounds(shot) : undefined;
      const xMin = bounds ? bounds.xMin : centerX - 600;
      const xMax = bounds ? bounds.xMax : centerX + 900;

      const env = EnvironmentKit.build({
        section,
        shotId,
        centerX,
        framing: shot?.framing,
        xMin,
        xMax,
        tierBounds: bounds?.tierBounds
      });
      envCache.set(shotId, env);
      return env;
    };

    return {
      storyboard: compiledStoryboard,
      rigs: compiledRigs,
      choreography: compiledChoreography,
      storySpec,
      getEnvironmentForShot,
      projectValidation: projectValidationReport,
      choreographyValidation: choreographyValidationReport,
      attempts
    };
  }
}
