import { z } from 'zod';

export const TheatricalSetIdSchema = z.enum([
  'INTERIOR_ROOM',
  'RAINY_STREET',
  'PARK_BENCH',
  'CONCERT_STAGE',
  'GOTHIC_CATHEDRAL'
]);
export type TheatricalSetId = z.infer<typeof TheatricalSetIdSchema>;

export const SceneTransitionTypeSchema = z.enum([
  'CUT',
  'CROSS_FADE',
  'CAMERA_PAN'
]);
export type SceneTransitionType = z.infer<typeof SceneTransitionTypeSchema>;

export const StageCoordinateBoundsSchema = z
  .object({
    xRange: z
      .tuple([z.number().finite(), z.number().finite()])
      .default([-100, 100])
      .refine(([min, max]) => min < max, {
        message: 'Stage xRange min must be strictly less than max'
      }),
    yRange: z
      .tuple([z.number().finite(), z.number().finite()])
      .default([0, 150])
      .refine(([min, max]) => min < max, {
        message: 'Stage yRange min must be strictly less than max'
      }),
    zRange: z
      .tuple([z.number().finite(), z.number().finite()])
      .default([-100, 300])
      .refine(([min, max]) => min < max, {
        message: 'Stage zRange min must be strictly less than max'
      })
  })
  .strict();
export type StageCoordinateBounds = z.infer<typeof StageCoordinateBoundsSchema>;

export const DEFAULT_STAGE_BOUNDS: StageCoordinateBounds = {
  xRange: [-100, 100],
  yRange: [0, 150],
  zRange: [-100, 300]
};

export const ShotTransitionSpecSchema = z
  .object({
    type: SceneTransitionTypeSchema,
    durationFrames: z.number().int().min(0).max(60).default(0)
  })
  .strict();
export type ShotTransitionSpec = z.infer<typeof ShotTransitionSpecSchema>;

export const SetStageContractSchema = z
  .object({
    setId: TheatricalSetIdSchema,
    bounds: StageCoordinateBoundsSchema.default(DEFAULT_STAGE_BOUNDS),
    floorY: z.number().finite().default(0),
    transitionIn: SceneTransitionTypeSchema.default('CUT'),
    transitionDurationFrames: z.number().int().min(0).max(60).default(0)
  })
  .strict();
export type SetStageContract = z.infer<typeof SetStageContractSchema>;
