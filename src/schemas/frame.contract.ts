import { z } from 'zod';
import { FiniteNumberSchema, Vec2Schema, Vec3Schema, CameraTransformSchema } from './primitives.schema.js';
import { ColorLightingPaletteSchema } from './storyboard.contract.js';
import { AudioFrameFeatureSchema } from './audio.contract.js';
import { PrecipitationSpecSchema } from './story-beat.contract.js';

export const ActiveEntityStateSchema = z.object({
  rigId: z.string().min(1),
  worldPosition: Vec3Schema,
  worldRotationZDegrees: z.number().finite().min(-360).max(360),
  scale: Vec2Schema,
  jointAngles: z.record(z.string(), z.number().finite()).default({}),
  jointOffsets: z.record(z.string(), Vec2Schema).default({}),
  morphWeights: z.record(z.string(), z.number().finite().min(0).max(1)).default({}),
  opacity: z.number().finite().min(0).max(1).default(1),
  isAttached: z.boolean().optional(),
  socketAttachment: z
    .object({
      ownerRigId: z.string(),
      socketId: z.string()
    })
    .strict()
    .optional()
}).strict();
export type ActiveEntityState = z.infer<typeof ActiveEntityStateSchema>;

export const ActiveLyricStateSchema = z.object({
  lineId: z.string().min(1),
  text: z.string().min(1),
  progress: z.number().finite().min(0).max(1),
  emphasis: z.number().finite().min(0).max(1)
}).strict();
export type ActiveLyricState = z.infer<typeof ActiveLyricStateSchema>;

export const FrameStateContractSchema = z.object({
  frameIndex: z.number().int().min(0),
  timeSeconds: FiniteNumberSchema.min(0),
  shotId: z.string().min(1),
  camera: CameraTransformSchema,
  palette: ColorLightingPaletteSchema,
  audio: AudioFrameFeatureSchema,
  lyric: ActiveLyricStateSchema.nullable(),
  entities: z.array(ActiveEntityStateSchema),
  transitionOverlayOpacity: z.number().finite().min(0).max(1).optional(),
  precipitation: PrecipitationSpecSchema.optional()
}).strict();
export type FrameStateContract = z.infer<typeof FrameStateContractSchema>;
