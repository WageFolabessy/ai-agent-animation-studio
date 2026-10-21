import { z } from 'zod';
import type { AssetRigContract } from '../../schemas/rig.contract.js';
import type { SceneEnvironment } from '../compositor/scene-compositor.js';
import type { CastSpecItem, SectionStagingSpec } from '../../schemas/story-spec.contract.js';

export const IndustrialCityParamsSchema = z
  .object({
    rooftopDensity: z.number().min(0).max(1).default(0.5),
    hvacVisible: z.boolean().default(true),
    overheadGantry: z.boolean().default(false),
    streetlamps: z.boolean().default(true)
  })
  .strict();
export type IndustrialCityParams = z.infer<typeof IndustrialCityParamsSchema>;

export const OrbitalStationParamsSchema = z
  .object({
    portalCount: z.number().int().min(2).max(6).default(4),
    hazardStripes: z.boolean().default(true),
    conduitGlow: z.boolean().default(true)
  })
  .strict();
export type OrbitalStationParams = z.infer<typeof OrbitalStationParamsSchema>;

export const NeonChasmParamsSchema = z
  .object({
    pylonCount: z.number().int().min(1).max(4).default(2),
    stayCableDensity: z.number().min(0).max(1).default(0.7),
    abyssDepth: z.number().min(100).max(1000).default(500)
  })
  .strict();
export type NeonChasmParams = z.infer<typeof NeonChasmParamsSchema>;

export const SynthGridParamsSchema = z
  .object({
    gridSpacing: z.number().min(20).max(100).default(40),
    horizonSun: z.boolean().default(true),
    wireframeMountains: z.boolean().default(true)
  })
  .strict();
export type SynthGridParams = z.infer<typeof SynthGridParamsSchema>;

export type EnvironmentKitId =
  | 'industrial_city'
  | 'orbital_station'
  | 'neon_chasm'
  | 'synth_grid';

export type CharacterArchetypeId =
  | 'biped_runner'
  | 'quadruped_beast'
  | 'aerial_drone';

export interface ArchetypeBuildOptions {
  readonly instanceId: string;
  readonly spec: CastSpecItem;
  readonly fps?: 30 | 60;
}

import type { CameraFraming } from '../../schemas/storyboard.contract.js';

export interface EnvironmentBuildOptions {
  readonly section: SectionStagingSpec;
  readonly shotId: string;
  readonly centerX: number;
  readonly framing?: CameraFraming;
  readonly xMin?: number;
  readonly xMax?: number;
}
