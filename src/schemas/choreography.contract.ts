import { z } from 'zod';
import { Vec2Schema, Vec3Schema } from './primitives.schema.js';
import { CameraEasingEnum } from './storyboard.contract.js';

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

export const EntityTrackSchema = z.object({
  rigId: z.string().min(1),
  shotId: z.string().min(1),
  transform: z.object({
    keyframes: z.array(EntityTrackKeyframeSchema).min(1)
  }).strict(),
  pose: z.object({
    timeScale: z.number().finite().min(0).default(1),
    startPoseFrame: z.number().finite().min(0).default(0)
  }).strict().optional(),
  morphKeyframes: z.record(z.string(), z.array(MorphKeyframeItemSchema)).optional().default({}),
  morphBindings: z.array(MorphBindingSchema).optional().default([])
}).strict();
export type EntityTrack = z.infer<typeof EntityTrackSchema>;

export const ChoreographyContractSchema = z.object({
  projectId: z.string().min(1),
  tracks: z.array(EntityTrackSchema)
}).strict();
export type ChoreographyContract = z.infer<typeof ChoreographyContractSchema>;
