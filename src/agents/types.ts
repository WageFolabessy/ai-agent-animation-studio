import type { z } from 'zod';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../schemas/audio.contract.js';
import type { DirectorStoryboardContract } from '../schemas/storyboard.contract.js';
import type { AssetRigContract } from '../schemas/rig.contract.js';
import type { ChoreographyContract } from '../schemas/choreography.contract.js';
import type { ValidationErrorItem, ValidationReport } from '../schemas/invariants.js';
import type { SceneEnvironment } from '../engine/compositor/scene-compositor.js';
import type { CanonicalGenreName } from '../engine/director/genre-directing-matrix.js';

export type StudioAgentRole = 'story_spec' | 'director' | 'rig' | 'choreographer';

export type LlmJsonMode = 'auto' | 'json_schema' | 'json_object' | 'plain';

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface LlmCallMetadata {
  readonly latencyMs: number;
  readonly tokenUsage?: TokenUsage;
  readonly finishReason?: string;
  readonly networkRetryCount?: number;
}

export interface LlmOptions {
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly jsonMode?: LlmJsonMode;
  readonly schemaName?: string;
  readonly agentRole?: StudioAgentRole;
  readonly attempt?: number;
  readonly repairErrors?: readonly ValidationErrorItem[];
  readonly previousDraft?: string;
  readonly context?: Record<string, unknown>;
  readonly onAttemptComplete?: (meta: LlmCallMetadata) => void;
}

export interface LlmExecutionResult<T> {
  readonly data: T;
  readonly latencyMs: number;
  readonly tokenUsage?: TokenUsage;
  readonly finishReason?: string;
  readonly networkRetryCount: number;
}

export interface LlmEndpointDescription {
  readonly provider: string;
  readonly modelId: string;
  readonly host: string;
  readonly isLocal: boolean;
}

/**
 * Provider-agnostic interface for structured JSON generation from an LLM.
 */
export interface LlmProvider {
  readonly name: string;
  describeEndpoint(): LlmEndpointDescription;
  generateStructuredJson<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: LlmOptions
  ): Promise<T>;
  generateStructuredJsonWithMeta?<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: LlmOptions
  ): Promise<LlmExecutionResult<T>>;
}

export interface AcousticSummary {
  readonly durationSeconds: number;
  readonly fps: number;
  readonly totalFrames: number;
  readonly estimatedBpm: number | 'unknown';
  readonly tempoConfidence?: number;
  readonly beatCount: number;
  readonly beatGridSummary?: {
    readonly framesPerBeat: number;
    readonly framesPerBar: number;
    readonly totalBeats: number;
  };
  readonly sectionsSummary?: Array<{
    readonly id: string;
    readonly startFrame: number;
    readonly endFrame: number;
    readonly relativeEnergy: number;
    readonly dominantBand: string;
  }>;
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
  readonly previousDraft?: string;
  readonly attempt?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly onAttemptComplete?: (meta: LlmCallMetadata) => void;
}

export interface RigAgentInput {
  readonly storyboard: DirectorStoryboardContract;
  readonly audioManifest: AudioAnalysisManifest;
  readonly repairErrors?: readonly ValidationErrorItem[];
  readonly previousDraft?: string;
  readonly attempt?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly onAttemptComplete?: (meta: LlmCallMetadata) => void;
}

export interface ChoreographerAgentInput {
  readonly storyboard: DirectorStoryboardContract;
  readonly rigs: Map<string, AssetRigContract>;
  readonly audioManifest: AudioAnalysisManifest;
  readonly repairErrors?: readonly ValidationErrorItem[];
  readonly previousDraft?: string;
  readonly attempt?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly onAttemptComplete?: (meta: LlmCallMetadata) => void;
}

export interface AgentAttemptLog {
  readonly agentRole: StudioAgentRole;
  readonly attempt: number;
  readonly repairedErrorCodes: readonly string[];
  readonly durationMs: number;
  readonly latencyMs?: number;
  readonly tokenUsage?: TokenUsage;
  readonly finishReason?: string;
  readonly retryCount?: number;
  readonly retryClass?: 'none' | 'transient_network' | 'schema_repair' | 'invariant_repair';
}

export interface OrchestrationOptions {
  readonly projectId?: string;
  readonly audioManifest: AudioAnalysisManifest;
  readonly getAudioFeatureAtFrame?: (frameIndex: number) => AudioFrameFeature;
  readonly width?: number;
  readonly height?: number;
  readonly maxRetries?: number;
  readonly useSpecPipeline?: boolean;
  readonly storySpec?: any;
  readonly noLyricsInPrompt?: boolean;
  readonly stagingMode?: 'runner' | 'theatrical';
  readonly genreOverride?: CanonicalGenreName;
}

export interface OrchestrationResult {
  readonly storyboard: DirectorStoryboardContract;
  readonly rigs: Map<string, AssetRigContract>;
  readonly choreography: ChoreographyContract;
  readonly storySpec?: any;
  readonly getEnvironmentForShot: (shotId: string) => SceneEnvironment;
  readonly projectValidation: ValidationReport;
  readonly choreographyValidation: ValidationReport;
  readonly attempts: readonly AgentAttemptLog[];
}
