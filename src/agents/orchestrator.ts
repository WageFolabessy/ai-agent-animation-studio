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
import {
  DirectorAgent,
  getOrchestratedEnvironment
} from './director-agent.js';
import { RigAgent } from './rig-agent.js';
import { ChoreographerAgent } from './choreographer-agent.js';
import { StorySpecAgent } from './story-spec-agent.js';
import type { StorySpecContract, SectionStagingSpec } from '../schemas/story-spec.contract.js';
import { compileStorySpecToStoryboard } from '../engine/director/shot-planner.js';
import { solveChoreography } from '../engine/director/choreography-solver.js';
import { ArchetypeFactory } from '../engine/library/archetype-factory.js';
import { EnvironmentKit } from '../engine/library/environment-kit.js';
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
  private readonly directorAgent: DirectorAgent;
  private readonly rigAgent: RigAgent;
  private readonly choreographerAgent: ChoreographerAgent;
  private readonly storySpecAgent: StorySpecAgent;

  constructor(provider: LlmProvider) {
    this.directorAgent = new DirectorAgent(provider);
    this.rigAgent = new RigAgent(provider);
    this.choreographerAgent = new ChoreographerAgent(provider);
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

  public async orchestrate(options: OrchestrationOptions): Promise<OrchestrationResult> {
    // If declarative spec-then-compile pipeline is requested:
    if (options.useSpecPipeline) {
      return this.orchestrateWithSpec(options);
    }

    const width = (options.width ?? 1920) as 1920;
    const height = (options.height ?? 1080) as 1080;
    const maxRetries = options.maxRetries ?? 3;
    const maxAttempts = maxRetries + 1;

    const renderConfig = createRenderConfig({
      width,
      height,
      fps: options.audioManifest.metadata.fps === 60 ? 60 : 30,
      pixelFormat: 'rgba',
      totalFrames: options.audioManifest.metadata.totalFrames
    });

    const attempts: AgentAttemptLog[] = [];

    // =========================================================================
    // Stage 1: Director Agent
    // =========================================================================
    const storyboard = await this.runStage<DirectorStoryboardContract>(
      {
        role: 'director',
        maxAttempts,
        execute: (attempt, errors, draft, onComplete) =>
          this.directorAgent.generateStoryboard({
            ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
            audioManifest: options.audioManifest,
            ...(options.getAudioFeatureAtFrame !== undefined
              ? { getAudioFeatureAtFrame: options.getAudioFeatureAtFrame }
              : {}),
            width,
            height,
            attempt,
            repairErrors: errors,
            previousDraft: draft,
            onAttemptComplete: onComplete
          }),
        validate: (candidate) => {
          const report = validateProjectContracts(
            options.audioManifest,
            candidate,
            renderConfig,
            new Map()
          );
          return report.errors.filter(
            (e) => (e.severity === 'fatal' || e.severity === 'error') && e.code !== 'RIG_NOT_FOUND'
          );
        },
        serializeDraft: (c) => JSON.stringify(c, null, 2)
      },
      attempts
    );

    // =========================================================================
    // Stage 2: Rig Agent
    // =========================================================================
    let projectValidationReport: ValidationReport | undefined;
    let rigs = await this.runStage<Map<string, AssetRigContract>>(
      {
        role: 'rig',
        maxAttempts,
        execute: (attempt, errors, draft, onComplete) =>
          this.rigAgent.generateRigs({
            storyboard,
            audioManifest: options.audioManifest,
            attempt,
            repairErrors: errors,
            previousDraft: draft,
            onAttemptComplete: onComplete
          }),
        validate: (candidateRigs) => {
          const report = validateProjectContracts(
            options.audioManifest,
            storyboard,
            renderConfig,
            candidateRigs
          );
          projectValidationReport = report;
          return report.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error');
        },
        serializeDraft: (candidateRigs) =>
          JSON.stringify({ rigs: Array.from(candidateRigs.values()) }, null, 2)
      },
      attempts
    );

    // =========================================================================
    // Stage 3: Choreographer Agent (with 1-stage backtracking if unresolvable)
    // =========================================================================
    let choreographyValidationReport: ValidationReport | undefined;
    let choreography: ChoreographyContract;

    try {
      choreography = await this.runStage<ChoreographyContract>(
        {
          role: 'choreographer',
          maxAttempts,
          execute: (attempt, errors, draft, onComplete) =>
            this.choreographerAgent.generateChoreography({
              storyboard,
              rigs,
              audioManifest: options.audioManifest,
              attempt,
              repairErrors: errors,
              previousDraft: draft,
              onAttemptComplete: onComplete
            }),
          validate: (candidateChoreo) => {
            const report = validateChoreography(candidateChoreo, storyboard, rigs);
            choreographyValidationReport = report;
            return report.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error');
          },
          serializeDraft: (c) => JSON.stringify(c, null, 2)
        },
        attempts
      );
    } catch (choreoErr) {
      if (choreoErr instanceof OrchestrationValidationError && maxAttempts > 1) {
        // 1-Stage Backtracking: Re-run Rig stage with choreography constraint feedback
        rigs = await this.runStage<Map<string, AssetRigContract>>(
          {
            role: 'rig',
            maxAttempts: 2,
            initialRepairErrors: [...choreoErr.errors],
            execute: (attempt, errors, draft, onComplete) =>
              this.rigAgent.generateRigs({
                storyboard,
                audioManifest: options.audioManifest,
                attempt,
                repairErrors: errors,
                previousDraft: draft,
                onAttemptComplete: onComplete
              }),
            validate: (candidateRigs) => {
              const report = validateProjectContracts(
                options.audioManifest,
                storyboard,
                renderConfig,
                candidateRigs
              );
              projectValidationReport = report;
              return report.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error');
            },
            serializeDraft: (candidateRigs) =>
              JSON.stringify({ rigs: Array.from(candidateRigs.values()) }, null, 2)
          },
          attempts
        );

        // Re-attempt Stage 3 with healed rigs
        choreography = await this.runStage<ChoreographyContract>(
          {
            role: 'choreographer',
            maxAttempts: 2,
            execute: (attempt, errors, draft, onComplete) =>
              this.choreographerAgent.generateChoreography({
                storyboard,
                rigs,
                audioManifest: options.audioManifest,
                attempt,
                repairErrors: errors,
                previousDraft: draft,
                onAttemptComplete: onComplete
              }),
            validate: (candidateChoreo) => {
              const report = validateChoreography(candidateChoreo, storyboard, rigs);
              choreographyValidationReport = report;
              return report.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error');
            },
            serializeDraft: (c) => JSON.stringify(c, null, 2)
          },
          attempts
        );
      } else {
        throw choreoErr;
      }
    }

    const shotMap = new Map(storyboard.shots.map((s) => [s.id, s]));
    const getEnvironmentForShot = (shotId: string): SceneEnvironment => {
      const shot = shotMap.get(shotId);
      const centerX = shot
        ? (shot.cameraStart.position[0] + shot.cameraEnd.position[0]) / 2
        : 0;
      const zone = shot?.environmentZone ?? 'ROOFTOP';
      const palette = shot?.palette;
      return getOrchestratedEnvironment(shotId, centerX, zone, palette);
    };

    return {
      storyboard,
      rigs,
      choreography,
      getEnvironmentForShot,
      projectValidation: projectValidationReport ?? { isValid: true, errors: [] },
      choreographyValidation: choreographyValidationReport ?? { isValid: true, errors: [] },
      attempts
    };
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
              attempt,
              repairErrors: errors,
              previousDraft: draft,
              onAttemptComplete: onComplete
            }),
          validate: (candidateSpec) => {
            try {
              const sb = compileStorySpecToStoryboard(candidateSpec, options.audioManifest);
              const rMap = new Map<string, AssetRigContract>();
              for (const castItem of candidateSpec.cast) {
                const rig = ArchetypeFactory.build({
                  instanceId: castItem.instanceId,
                  spec: castItem,
                  fps: options.audioManifest.metadata.fps === 60 ? 60 : 30
                });
                rMap.set(rig.id, rig);
              }
              const choreo = solveChoreography(candidateSpec, sb, rMap);

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
      compiledStoryboard = compileStorySpecToStoryboard(storySpec, options.audioManifest);
      compiledRigs = new Map<string, AssetRigContract>();
      for (const castItem of storySpec.cast) {
        const rig = ArchetypeFactory.build({
          instanceId: castItem.instanceId,
          spec: castItem,
          fps: options.audioManifest.metadata.fps === 60 ? 60 : 30
        });
        compiledRigs.set(rig.id, rig);
      }
      compiledChoreography = solveChoreography(storySpec, compiledStoryboard, compiledRigs);
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

    // 4. Exact Section-Aligned Environment Resolver (Finding 1 fixed)
    const shotMap = new Map(compiledStoryboard.shots.map((s) => [s.id, s]));

    const getEnvironmentForShot = (shotId: string): SceneEnvironment => {
      const shot = shotMap.get(shotId);
      const centerX = shot
        ? (shot.cameraStart.position[0] + shot.cameraEnd.position[0]) / 2
        : 0;
      const startFrame = shot?.frameRange.startFrameInclusive ?? 0;
      const section = storySpec.sections.find(
        (s: SectionStagingSpec) => startFrame >= s.startFrame && startFrame < s.endFrame
      ) ?? storySpec.sections[storySpec.sections.length - 1];
      const xMin = shot ? Math.min(shot.cameraStart.position[0], shot.cameraEnd.position[0]) - 600 : centerX - 600;
      const xMax = shot ? Math.max(shot.cameraStart.position[0], shot.cameraEnd.position[0]) + 900 : centerX + 900;
      return EnvironmentKit.build({ section, shotId, centerX, framing: shot?.framing, xMin, xMax });
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
