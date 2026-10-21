import { z } from 'zod';

export const StageWaypointSchema = z
  .object({
    frameProgress: z.number().finite().min(0).max(1),
    stagePosNorm: z.tuple([
      z.number().finite().min(-1.5).max(1.5), // X: -1.0 left edge, +1.0 right edge
      z.number().finite().min(-1.0).max(1.0), // Y: elevation
      z.number().finite().min(0.0).max(3.0) // Z: depth layer
    ])
  })
  .strict();
export type StageWaypoint = z.infer<typeof StageWaypointSchema>;

export const CastSpecItemSchema = z
  .object({
    instanceId: z.string().min(1),
    archetypeId: z.enum(['biped_runner', 'quadruped_beast', 'aerial_drone']),
    scale: z.number().finite().min(0.2).max(3.0).default(1.0),
    paletteOverrides: z
      .object({
        primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
      })
      .strict()
      .optional(),
    accessories: z.array(z.string()).default([])
  })
  .strict();
export type CastSpecItem = z.infer<typeof CastSpecItemSchema>;

export const CastDirectiveSchema = z
  .object({
    instanceId: z.string().min(1),
    motionPreset: z.enum(['sprint', 'stride', 'hover', 'stalk', 'evade', 'idle']),
    waypoints: z.array(StageWaypointSchema).min(1)
  })
  .strict();
export type CastDirective = z.infer<typeof CastDirectiveSchema>;

export const SectionStagingSpecSchema = z
  .object({
    sectionId: z.string().min(1),
    narrativeIntent: z.string().min(1),
    environmentKitId: z.enum(['industrial_city', 'orbital_station', 'neon_chasm', 'synth_grid']),
    kitParams: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    colorThemeId: z.enum([
      'CYBERPUNK_CYAN',
      'VOLTAGE_ORANGE',
      'SUNSET_GOLD',
      'CRIMSON_FURY',
      'MIDNIGHT_VOID'
    ]),
    cameraIntensity: z.number().finite().min(0).max(1),
    castDirectives: z.array(CastDirectiveSchema)
  })
  .strict();
export type SectionStagingSpec = z.infer<typeof SectionStagingSpecSchema>;

export const StorySpecContractSchema = z
  .object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    overallMood: z.string().min(1),
    cast: z.array(CastSpecItemSchema).min(1).max(4),
    sections: z.array(SectionStagingSpecSchema).min(3).max(12)
  })
  .strict();
export type StorySpecContract = z.infer<typeof StorySpecContractSchema>;
