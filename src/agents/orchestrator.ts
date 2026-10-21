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
import { LlmJsonParseError, LlmSchemaValidationError } from './llm-provider.js';
import type {
  AgentAttemptLog,
  LlmProvider,
  OrchestrationOptions,
  OrchestrationResult,
  StudioAgentRole
} from './types.js';

function extractDraftFromException(err: unknown): string | undefined {
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

/**
 * Multi-Agent Studio Orchestrator executing the sequential pipeline:
 * Audio Intelligence -> Director Agent -> Rig Agent -> Choreographer Agent
 * with automated invariant validation and self-healing repair retries at each stage.
 */
export class StudioAgentOrchestrator {
  private readonly directorAgent: DirectorAgent;
  private readonly rigAgent: RigAgent;
  private readonly choreographerAgent: ChoreographerAgent;

  constructor(provider: LlmProvider) {
    this.directorAgent = new DirectorAgent(provider);
    this.rigAgent = new RigAgent(provider);
    this.choreographerAgent = new ChoreographerAgent(provider);
  }

  public async orchestrate(options: OrchestrationOptions): Promise<OrchestrationResult> {
    const width = 1920 as const;
    const height = 1080 as const;
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
    // Stage 1: Director Agent (Storyboard Synthesis + Timeline/Act Validation)
    // =========================================================================
    let storyboard: DirectorStoryboardContract | undefined;
    let directorRepairErrors: ValidationErrorItem[] = [];
    let directorPreviousDraft: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t0 = performance.now();
      const repairedCodes = directorRepairErrors.map((e) => e.code);

      try {
        const candidate = await this.directorAgent.generateStoryboard({
          ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
          audioManifest: options.audioManifest,
          ...(options.getAudioFeatureAtFrame !== undefined
            ? { getAudioFeatureAtFrame: options.getAudioFeatureAtFrame }
            : {}),
          width,
          height,
          attempt,
          repairErrors: directorRepairErrors,
          previousDraft: directorPreviousDraft
        });

        // Validate storyboard-level invariants (ignoring RIG_NOT_FOUND until Stage 2)
        const prelimReport = validateProjectContracts(
          options.audioManifest,
          candidate,
          renderConfig,
          new Map()
        );
        const storyboardBlockingErrors = prelimReport.errors.filter(
          (e) =>
            (e.severity === 'fatal' || e.severity === 'error') && e.code !== 'RIG_NOT_FOUND'
        );

        attempts.push({
          agentRole: 'director',
          attempt,
          repairedErrorCodes: repairedCodes,
          durationMs: Number((performance.now() - t0).toFixed(2))
        });

        if (storyboardBlockingErrors.length === 0) {
          storyboard = candidate;
          break;
        }

        directorRepairErrors = storyboardBlockingErrors;
        directorPreviousDraft = JSON.stringify(candidate, null, 2);
      } catch (err) {
        const schemaErrors = convertExceptionToValidationErrors(err, 'director');
        attempts.push({
          agentRole: 'director',
          attempt,
          repairedErrorCodes: repairedCodes,
          durationMs: Number((performance.now() - t0).toFixed(2))
        });
        directorRepairErrors = schemaErrors;
        directorPreviousDraft = extractDraftFromException(err);
      }

      if (attempt === maxAttempts) {
        throw new OrchestrationValidationError('director', directorRepairErrors, attempts);
      }
    }

    if (!storyboard) {
      throw new OrchestrationValidationError('director', directorRepairErrors, attempts);
    }

    // =========================================================================
    // Stage 2: Rig Agent (Asset & Character Rig Synthesis + Project Invariants)
    // =========================================================================
    let rigs: Map<string, AssetRigContract> | undefined;
    let projectValidation: ValidationReport | undefined;
    let rigRepairErrors: ValidationErrorItem[] = [];
    let rigPreviousDraft: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t0 = performance.now();
      const repairedCodes = rigRepairErrors.map((e) => e.code);

      try {
        const candidateRigs = await this.rigAgent.generateRigs({
          storyboard,
          audioManifest: options.audioManifest,
          attempt,
          repairErrors: rigRepairErrors,
          previousDraft: rigPreviousDraft
        });

        const report = validateProjectContracts(
          options.audioManifest,
          storyboard,
          renderConfig,
          candidateRigs
        );
        const blockingErrors = report.errors.filter(
          (e) => e.severity === 'fatal' || e.severity === 'error'
        );

        attempts.push({
          agentRole: 'rig',
          attempt,
          repairedErrorCodes: repairedCodes,
          durationMs: Number((performance.now() - t0).toFixed(2))
        });

        if (blockingErrors.length === 0) {
          rigs = candidateRigs;
          projectValidation = report;
          break;
        }

        rigRepairErrors = blockingErrors;
        rigPreviousDraft = JSON.stringify({ rigs: Array.from(candidateRigs.values()) }, null, 2);
      } catch (err) {
        const schemaErrors = convertExceptionToValidationErrors(err, 'rig');
        attempts.push({
          agentRole: 'rig',
          attempt,
          repairedErrorCodes: repairedCodes,
          durationMs: Number((performance.now() - t0).toFixed(2))
        });
        rigRepairErrors = schemaErrors;
        rigPreviousDraft = extractDraftFromException(err);
      }

      if (attempt === maxAttempts) {
        throw new OrchestrationValidationError('rig', rigRepairErrors, attempts);
      }
    }

    if (!rigs || !projectValidation) {
      throw new OrchestrationValidationError('rig', rigRepairErrors, attempts);
    }

    // =========================================================================
    // Stage 3: Choreographer Agent (Motion & Audio-Reactive Morph Synthesis)
    // =========================================================================
    let choreography: ChoreographyContract | undefined;
    let choreographyValidation: ValidationReport | undefined;
    let choreoRepairErrors: ValidationErrorItem[] = [];
    let choreoPreviousDraft: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t0 = performance.now();
      const repairedCodes = choreoRepairErrors.map((e) => e.code);

      try {
        const candidateChoreo = await this.choreographerAgent.generateChoreography({
          storyboard,
          rigs,
          audioManifest: options.audioManifest,
          attempt,
          repairErrors: choreoRepairErrors,
          previousDraft: choreoPreviousDraft
        });

        const report = validateChoreography(candidateChoreo, storyboard, rigs);
        const blockingErrors = report.errors.filter(
          (e) => e.severity === 'fatal' || e.severity === 'error'
        );

        attempts.push({
          agentRole: 'choreographer',
          attempt,
          repairedErrorCodes: repairedCodes,
          durationMs: Number((performance.now() - t0).toFixed(2))
        });

        if (blockingErrors.length === 0) {
          choreography = candidateChoreo;
          choreographyValidation = report;
          break;
        }

        choreoRepairErrors = blockingErrors;
        choreoPreviousDraft = JSON.stringify(candidateChoreo, null, 2);
      } catch (err) {
        const schemaErrors = convertExceptionToValidationErrors(err, 'choreographer');
        attempts.push({
          agentRole: 'choreographer',
          attempt,
          repairedErrorCodes: repairedCodes,
          durationMs: Number((performance.now() - t0).toFixed(2))
        });
        choreoRepairErrors = schemaErrors;
        choreoPreviousDraft = extractDraftFromException(err);
      }

      if (attempt === maxAttempts) {
        throw new OrchestrationValidationError('choreographer', choreoRepairErrors, attempts);
      }
    }

    if (!choreography || !choreographyValidation) {
      throw new OrchestrationValidationError('choreographer', choreoRepairErrors, attempts);
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
      projectValidation,
      choreographyValidation,
      attempts
    };
  }
}
