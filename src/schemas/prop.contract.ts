import { z } from 'zod';
import { Vec2Schema } from './primitives.schema.js';

export const NarrativePropIdSchema = z.enum([
  'microphone',
  'umbrella',
  'coffee_cup',
  'rose',
  'acoustic_guitar',
  'electric_guitar',
  'crown',
  'fedora_hat'
]);
export type NarrativePropId = z.infer<typeof NarrativePropIdSchema>;

export const RigSocketSlotSchema = z.enum(['hand_r', 'hand_l', 'head', 'torso']);
export type RigSocketSlot = z.infer<typeof RigSocketSlotSchema>;

export const RigSocketSchema = z
  .object({
    id: RigSocketSlotSchema,
    jointId: z.string().min(1),
    localOffset2D: Vec2Schema,
    rotationOffsetDeg: z.number().finite().default(0)
  })
  .strict();
export type RigSocket = z.infer<typeof RigSocketSchema>;
