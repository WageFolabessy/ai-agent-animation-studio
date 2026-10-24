import { z } from 'zod';
import { TheatricalSetIdSchema, SceneTransitionTypeSchema } from './stage.contract.js';

export const StagingModeSchema = z.enum(['runner', 'theatrical']);
export type StagingMode = z.infer<typeof StagingModeSchema>;

export const CastRoleSchema = z.enum([
  'PROTAGONIST',
  'PARTNER',
  'ANTAGONIST',
  'BACKGROUND_CHORUS'
]);
export type CastRole = z.infer<typeof CastRoleSchema>;

export const InteractionBehaviorSchema = z.enum([
  'SOLO',
  'FACE_TO_FACE',
  'PARALLEL_WALK',
  'DUET_PERFORMANCE',
  'PURSUIT_AND_CONFRONTATION'
]);
export type InteractionBehavior = z.infer<typeof InteractionBehaviorSchema>;

export const StageWaypointSchema = z
  .object({
    frameProgress: z.number().finite().min(0).max(1),
    stagePosNorm: z.tuple([
      z.number().finite().min(-1.5).max(1.5), // X: -1.0 left edge, +1.0 right edge
      z.number().finite().min(-1.0).max(1.0), // Y: elevation
      z.number().finite().min(-1.0).max(3.0) // Z: depth layer
    ])
  })
  .strict();
export type StageWaypoint = z.infer<typeof StageWaypointSchema>;

export const CastSpecItemSchema = z
  .object({
    instanceId: z.string().min(1),
    archetypeId: z.enum([
      'biped_runner',
      'biped_frontal',
      'biped_three_quarters',
      'quadruped_beast',
      'aerial_drone',
      'hero_silhouette',
      'companion_silhouette'
    ]),
    role: CastRoleSchema.optional(),
    viewAngle: z.enum(['front', 'three_quarter', 'profile']).optional(),
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
    motionPreset: z.enum([
      'stalk_crouch',
      'sprint_frenzy',
      'evade_leap',
      'defiant_scream',
      'combat_clash',
      'exhausted_walk',
      'sprint',
      'stride',
      'hover',
      'stalk',
      'evade',
      'idle',
      'dive',
      'gallop',
      'pounce',
      'pop_vocal_sway',
      'stage_spin',
      'rhythmic_step',
      'crowd_cheer',
      'acoustic_strum',
      'rain_umbrella_walk',
      'bench_contemplation',
      'gazing_out_window',
      'slow_waltz',
      'headbang_riff',
      'collapse_to_knees'
    ]),
    waypoints: z.array(StageWaypointSchema).min(1)
  })
  .strict();
export type CastDirective = z.infer<typeof CastDirectiveSchema>;

export const EmotionalToneSchema = z.enum([
  'defiant',
  'melancholic',
  'tender',
  'euphoric',
  'menacing',
  'reflective',
  'chaotic'
]);
export type EmotionalTone = z.infer<typeof EmotionalToneSchema>;

export const GenreProfileSchema = z.enum([
  'rock_metal',
  'pop_dance',
  'ballad_acoustic',
  'electronic_synth',
  'neutral'
]);
export type GenreProfile = z.infer<typeof GenreProfileSchema>;

export const SectionStagingSpecSchema = z
  .object({
    sectionId: z.string().min(1),
    startFrame: z.number().int().min(0),
    endFrame: z.number().int().positive(),
    narrativeIntent: z.string().min(1),
    emotionalTone: EmotionalToneSchema.default('reflective'),
    lyricMotifs: z.array(z.string()).max(5).default([]),
    detectedLanguage: z.string().optional(),
    stagingMode: StagingModeSchema.optional(),
    theatricalSetId: TheatricalSetIdSchema.optional(),
    transitionIn: SceneTransitionTypeSchema.optional(),
    interactionBehavior: InteractionBehaviorSchema.optional(),
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
  .strict()
  .refine((data) => data.endFrame > data.startFrame, {
    message: 'endFrame must be strictly greater than startFrame'
  });
export type SectionStagingSpec = z.infer<typeof SectionStagingSpecSchema>;

export const StorySpecContractSchema = z
  .object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    overallMood: z.string().min(1),
    themes: z.array(z.string()).min(1).max(8).default(['escape']),
    genreProfile: GenreProfileSchema.default('neutral'),
    detectedLanguage: z.string().optional(),
    cast: z.array(CastSpecItemSchema).min(1).max(4),
    sections: z.array(SectionStagingSpecSchema).min(3).max(32)
  })
  .strict();
export type StorySpecContract = z.infer<typeof StorySpecContractSchema>;
