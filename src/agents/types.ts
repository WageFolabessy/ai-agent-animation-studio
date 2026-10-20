import type { z } from 'zod';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../schemas/audio.contract.js';
import type { DirectorStoryboardContract } from '../schemas/storyboard.contract.js';
import type { AssetRigContract } from '../schemas/rig.contract.js';
import type { ChoreographyContract } from '../schemas/choreography.contract.js';
import type { ValidationErrorItem, ValidationReport } from '../schemas/invariants.js';
import type { SceneEnvironment } from '../engine/compositor/scene-compositor.js';

export type StudioAgentRole = 'director' | 'rig' | 'choreographer';

export interface LlmOptions {
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly agentRole?: StudioAgentRole;
  readonly attempt?: number;
  readonly repairErrors?: readonly ValidationErrorItem[];
  readonly context?: Record<string, unknown>;
}

/**
 * Provider-agnostic interface for structured JSON generation from an LLM.
 */
export interface LlmProvider {
  readonly name: string;
  generateStructuredJson<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: LlmOptions
  ): Promise<T>;
}

export interface AcousticSummary {
  readonly durationSeconds: number;
  readonly fps: number;
  readonly totalFrames: number;
  readonly estimatedBpm: number;
  readonly beatCount: number;
  readonly peakOnsetFrames: readonly number[];
  readonly lyricCount: number;
  readonly meanRms: number;
  readonly peakRms: number;
  readonly dominantBands: {
    readonly subBassAvg: number;
    readonly bassAvg: number;
    readonly lowMidAvg: number;
    readonly midAvg: number;
    readonly highMidAvg: number;
    readonly presenceAvg: number;
    readonly brillianceAvg: number;
  };
}

export interface DirectorAgentInput {
  readonly projectId?: string;
  readonly audioManifest: AudioAnalysisManifest;
  readonly getAudioFeatureAtFrame?: (frameIndex: number) => AudioFrameFeature;
  readonly width?: number;
  readonly height?: number;
  readonly repairErrors?: readonly ValidationErrorItem[];
  readonly attempt?: number;
}

export interface RigAgentInput {
  readonly storyboard: DirectorStoryboardContract;
  readonly audioManifest: AudioAnalysisManifest;
  readonly repairErrors?: readonly ValidationErrorItem[];
  readonly attempt?: number;
}

export interface ChoreographerAgentInput {
  readonly storyboard: DirectorStoryboardContract;
  readonly rigs: Map<string, AssetRigContract>;
  readonly audioManifest: AudioAnalysisManifest;
  readonly repairErrors?: readonly ValidationErrorItem[];
  readonly attempt?: number;
}

export interface AgentAttemptLog {
  readonly agentRole: StudioAgentRole;
  readonly attempt: number;
  readonly repairedErrorCodes: readonly string[];
  readonly durationMs: number;
}

export interface OrchestrationOptions {
  readonly projectId?: string;
  readonly audioManifest: AudioAnalysisManifest;
  readonly getAudioFeatureAtFrame?: (frameIndex: number) => AudioFrameFeature;
  readonly width?: number;
  readonly height?: number;
  readonly maxRetries?: number;
}

export interface OrchestrationResult {
  readonly storyboard: DirectorStoryboardContract;
  readonly rigs: Map<string, AssetRigContract>;
  readonly choreography: ChoreographyContract;
  readonly getEnvironmentForShot: (shotId: string) => SceneEnvironment;
  readonly projectValidation: ValidationReport;
  readonly choreographyValidation: ValidationReport;
  readonly attempts: readonly AgentAttemptLog[];
}
