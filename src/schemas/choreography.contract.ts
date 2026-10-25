import { z } from 'zod';
import { Vec2Schema, Vec3Schema } from './primitives.schema.js';
import { CameraEasingEnum } from './storyboard.contract.js';
import { RigSocketSlotSchema } from './prop.contract.js';

export const PropAttachmentSpanSchema = z.object({
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().positive(),
  ownerRigId: z.string().min(1),
  socketId: RigSocketSlotSchema
}).strict().refine(s => s.endFrame > s.startFrame, {
  message: 'endFrame must be strictly greater than startFrame'
});
export type PropAttachmentSpan = z.infer<typeof PropAttachmentSpanSchema>;

export const EntityTrackKeyframeSchema = z.object({
  frame: z.number().int().min(0),
  position: Vec3Schema,
  rotationZDegrees: z.number().finite(),
  scale: Vec2Schema,
  opacity: z.number().finite().min(0).max(1),
  easing: CameraEasingEnum.default('linear')
}).strict();
export type EntityTrackKeyframe = z.infer<typeof EntityTrackKeyframeSchema>;

export const MorphBindingSchema = z.object({
  target: z.string().min(1),
  source: z.enum([
    'constant',
    'audio.rms',
    'audio.onsetStrength',
    'audio.bands.bass',
    'audio.bands.mid',
    'audio.bands.presence'
  ]),
  gain: z.number().finite(),
  bias: z.number().finite(),
  spring: z.object({
    zeta: z.number().min(0.05).max(2),
    omega: z.number().positive().max(60)
  }).strict().optional()
}).strict();
export type MorphBinding = z.infer<typeof MorphBindingSchema>;

export const MorphKeyframeItemSchema = z.object({
  frame: z.number().int().min(0),
  weight: z.number().finite().min(0).max(1)
}).strict();
export type MorphKeyframeItem = z.infer<typeof MorphKeyframeItemSchema>;

export const CHOREOGRAPHY_CONTRACT_VERSION = 2 as const;

export const IkTargetSchema = z.object({
  hand: z.enum(['hand_l', 'hand_r']),
  targetWorld: Vec3Schema,
  weight: z.number().finite().min(0).max(1).default(1.0),
  startFrame: z.number().int().min(0).optional(),
  endFrame: z.number().int().positive().optional(),
  frame: z.number().int().min(0).optional()
}).strict();
export type IkTarget = z.infer<typeof IkTargetSchema>;

export const GazeTargetSchema = z.object({
  targetWorld: Vec3Schema,
  weight: z.number().finite().min(0).max(1).default(1.0),
  startFrame: z.number().int().min(0).optional(),
  endFrame: z.number().int().positive().optional(),
  frame: z.number().int().min(0).optional()
}).strict();
export type GazeTarget = z.infer<typeof GazeTargetSchema>;

export const PoseSegmentSchema = z.object({
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().positive(),
  clipId: z.string(),
  timeScale: z.number().finite().min(0).default(1),
  startPoseFrame: z.number().finite().min(0).default(0)
}).strict().refine((s) => s.endFrame > s.startFrame, {
  message: 'endFrame must be strictly greater than startFrame'
});
export type PoseSegment = z.infer<typeof PoseSegmentSchema>;

export const EntityTrackSchema = z.object({
  rigId: z.string().min(1),
  shotId: z.string().min(1),
  transform: z.object({
    keyframes: z.array(EntityTrackKeyframeSchema).min(1)
  }).strict(),
  pose: z.object({
    timeScale: z.number().finite().min(0).default(1),
    startPoseFrame: z.number().finite().min(0).default(0),
    clipId: z.string().optional(),
    segments: z.array(PoseSegmentSchema).optional()
  }).strict().optional(),
  morphKeyframes: z.record(z.string(), z.array(MorphKeyframeItemSchema)).optional().default({}),
  morphBindings: z.array(MorphBindingSchema).optional().default([]),
  attachmentSpans: z.array(PropAttachmentSpanSchema).optional(),
  ikTargets: z.array(IkTargetSchema).optional(),
  gazeTargets: z.array(GazeTargetSchema).optional()
}).strict();
export type EntityTrack = z.infer<typeof EntityTrackSchema>;

export const ChoreographyContractSchema = z.object({
  version: z.number().int().min(1).optional(),
  projectId: z.string().min(1),
  tracks: z.array(EntityTrackSchema)
}).strict();
export type ChoreographyContract = z.infer<typeof ChoreographyContractSchema>;
