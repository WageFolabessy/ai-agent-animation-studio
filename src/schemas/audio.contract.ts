import { z } from 'zod';
import { FiniteNumberSchema, FrameRangeSchema } from './primitives.schema.js';

export const AudioBandEnergySchema = z.object({
  subBass: z.number().finite().min(0).max(1),
  bass: z.number().finite().min(0).max(1),
  lowMid: z.number().finite().min(0).max(1),
  mid: z.number().finite().min(0).max(1),
  highMid: z.number().finite().min(0).max(1),
  presence: z.number().finite().min(0).max(1),
  brilliance: z.number().finite().min(0).max(1)
}).strict();
export type AudioBandEnergy = z.infer<typeof AudioBandEnergySchema>;

export const AudioFrameFeatureSchema = z.object({
  frameIndex: z.number().int().min(0),
  timestamp: FiniteNumberSchema.min(0),
  rms: z.number().finite().min(0).max(1),
  rmsRelativeGlobal: z.number().finite().min(0).max(1),
  rmsRelativeLocal: z.number().finite().min(0).max(1),
  localWindowFrames: z.number().int().positive(),
  spectralFlux: FiniteNumberSchema.min(0),
  onsetStrength: FiniteNumberSchema.min(0),
  isOnset: z.boolean(),
  pitchEstimatedHz: FiniteNumberSchema.positive().optional(),
  bands: AudioBandEnergySchema
}).strict();
export type AudioFrameFeature = z.infer<typeof AudioFrameFeatureSchema>;

export const LyricLineSchema = z.object({
  id: z.string().min(1),
  frameRange: FrameRangeSchema,
  startTimeSeconds: FiniteNumberSchema.min(0),
  endTimeSeconds: FiniteNumberSchema.min(0),
  text: z.string().min(1),
  emphasis: z.number().finite().min(0).max(1)
}).strict().refine((data) => data.endTimeSeconds > data.startTimeSeconds, {
  message: 'Lyric endTimeSeconds must be strictly greater than startTimeSeconds'
});
export type LyricLine = z.infer<typeof LyricLineSchema>;

export const BeatEventSchema = z.object({
  frameIndex: z.number().int().min(0),
  timestamp: FiniteNumberSchema.min(0),
  confidence: z.number().finite().min(0).max(1)
}).strict();
export type BeatEvent = z.infer<typeof BeatEventSchema>;

/**
 * SERIALIZABLE MANIFEST: Structure output produced by audio signal analysis.
 * Avoids keeping a large object graph on the V8 heap; frame-level features
 * are stored separately in columnar or binary storage.
 */
export const AudioAnalysisManifestSchema = z.object({
  metadata: z.object({
    audioFilePath: z.string().min(1),
    sampleRate: z.literal(44100).or(z.literal(48000)),
    durationSeconds: FiniteNumberSchema.positive(),
    fps: z.union([z.literal(30), z.literal(60)]),
    totalFrames: z.number().int().positive(),
    tempoBpm: FiniteNumberSchema.positive().optional(),
    tempoConfidence: z.number().finite().min(0).max(1).optional()
  }).strict(),
  normalization: z.object({
    globalRmsMax: FiniteNumberSchema.positive(),
    localWindowFrames: z.number().int().positive()
  }).strict(),
  lyrics: z.array(LyricLineSchema),
  beatEvents: z.array(BeatEventSchema).default([]),
  storageReference: z.object({
    type: z.enum(['memory_columnar', 'external_binary']),
    columnLayoutVersion: z.literal(1)
  }).strict()
}).strict();
export type AudioAnalysisManifest = z.infer<typeof AudioAnalysisManifestSchema>;

/**
 * RUNTIME READER ADAPTER: Retrieves frame feature at index `f` in O(1)
 * without requiring the entire array of objects to reside in the V8 heap.
 */
export interface AudioFeatureReader {
  readonly totalFrames: number;
  getFrameFeature(frameIndex: number): AudioFrameFeature;
}

