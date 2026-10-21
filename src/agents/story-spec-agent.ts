import { z } from 'zod';
import type { AudioAnalysisManifest } from '../schemas/audio.contract.js';
import {
  StorySpecContractSchema,
  type StorySpecContract,
  type CastSpecItem,
  type SectionStagingSpec
} from '../schemas/story-spec.contract.js';
import type { LlmCallMetadata, LlmProvider } from './types.js';
import { formatRepairFeedbackPrompt } from './repair-helper.js';
import type { ValidationErrorItem } from '../schemas/invariants.js';

export const STORY_SPEC_JSON_SCHEMA = JSON.stringify(
  z.toJSONSchema(StorySpecContractSchema, { target: 'draft-07' })
);

export interface StorySpecAgentInput {
  readonly projectId?: string;
  readonly audioManifest: AudioAnalysisManifest;
  readonly repairErrors?: readonly ValidationErrorItem[];
  readonly previousDraft?: string;
  readonly attempt?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly onAttemptComplete?: (meta: LlmCallMetadata) => void;
}

/**
 * Deterministically synthesizes a StorySpecContract conditioned directly on the
 * audio manifest features (tempo, energy novelty, dominant spectral bands, lyrics).
 * High-energy rock/metal -> industrial_city / neon_chasm with biped_runner + aerial_drone.
 * Electronic / synth -> synth_grid / orbital_station with quadruped_beast.
 * Ambient / quiet -> orbital_station with aerial_drone and MIDNIGHT_VOID.
 */
export function buildDeterministicStorySpec(
  manifest: AudioAnalysisManifest,
  projectId = 'autonomous-cinema'
): StorySpecContract {
  const { durationSeconds } = manifest.metadata;
  const tempo = manifest.metadata.tempoBpm ?? manifest.beatGrid?.tempoBpm ?? 120;
  const sections = manifest.sections ?? [];
  const lyricCount = manifest.lyrics.length;

  // Classify song acoustic profile
  const isHighEnergy = tempo >= 140 || lyricCount > 30;
  const isElectronic = !isHighEnergy && tempo >= 110;

  // 1. Determine Cast Archetypes
  let cast: CastSpecItem[];
  if (isHighEnergy) {
    cast = [
      {
        instanceId: 'lead_runner',
        archetypeId: 'biped_runner',
        scale: 1.0,
        paletteOverrides: { primary: '#ff7700', accent: '#ffe600' },
        accessories: ['hazard_coat']
      },
      {
        instanceId: 'enforcer_drone',
        archetypeId: 'aerial_drone',
        scale: 1.1,
        paletteOverrides: { primary: '#ff1744', accent: '#00f0ff' },
        accessories: ['scanner_turret']
      }
    ];
  } else if (isElectronic) {
    cast = [
      {
        instanceId: 'cyber_hound',
        archetypeId: 'quadruped_beast',
        scale: 1.0,
        paletteOverrides: { primary: '#00f0ff', accent: '#ff0055' },
        accessories: ['sensor_crest']
      },
      {
        instanceId: 'patrol_drone',
        archetypeId: 'aerial_drone',
        scale: 0.9,
        paletteOverrides: { primary: '#7c4dff', accent: '#00e5ff' },
        accessories: ['searchlight']
      }
    ];
  } else {
    cast = [
      {
        instanceId: 'solo_runner',
        archetypeId: 'biped_runner',
        scale: 1.0,
        paletteOverrides: { primary: '#7c4dff', accent: '#00e5ff' },
        accessories: ['stealth_visor']
      }
    ];
  }

  // 2. Determine Section Staging
  const numSections = sections.length >= 3 ? sections.length : 4;
  const sectionSpecs: SectionStagingSpec[] = [];

  for (let i = 0; i < numSections; i++) {
    const sec = sections[i];
    const energy = sec?.relativeEnergy ?? (i === 1 || i === 2 ? 0.85 : 0.4);

    let kitId: 'industrial_city' | 'orbital_station' | 'neon_chasm' | 'synth_grid';
    let colorTheme: 'CYBERPUNK_CYAN' | 'VOLTAGE_ORANGE' | 'SUNSET_GOLD' | 'CRIMSON_FURY' | 'MIDNIGHT_VOID';

    if (isHighEnergy) {
      kitId = i % 2 === 0 ? 'industrial_city' : 'neon_chasm';
      colorTheme = energy > 0.7 ? 'CRIMSON_FURY' : 'VOLTAGE_ORANGE';
    } else if (isElectronic) {
      kitId = i % 2 === 0 ? 'synth_grid' : 'orbital_station';
      colorTheme = energy > 0.7 ? 'SUNSET_GOLD' : 'CYBERPUNK_CYAN';
    } else {
      kitId = 'orbital_station';
      colorTheme = 'MIDNIGHT_VOID';
    }

    let kitParams: Record<string, string | number | boolean>;
    if (kitId === 'industrial_city') {
      kitParams = { rooftopDensity: 0.6, hvacVisible: true, overheadGantry: false, streetlamps: true };
    } else if (kitId === 'orbital_station') {
      kitParams = { portalCount: 4, hazardStripes: true, conduitGlow: true };
    } else if (kitId === 'neon_chasm') {
      kitParams = { pylonCount: 2, stayCableDensity: 0.7, abyssDepth: 500 };
    } else {
      kitParams = { gridSpacing: 40, horizonSun: true, wireframeMountains: true };
    }

    sectionSpecs.push({
      sectionId: sec?.id ?? `sec_${i + 1}`,
      narrativeIntent: `Musical section ${i + 1} (${energy > 0.7 ? 'Peak Intensity' : 'Building Momentum'})`,
      environmentKitId: kitId,
      kitParams,
      colorThemeId: colorTheme,
      cameraIntensity: Number(energy.toFixed(2)),
      castDirectives: cast.map((c, cIdx) => ({
        instanceId: c.instanceId,
        motionPreset: c.archetypeId === 'aerial_drone' ? 'hover' : 'sprint',
        waypoints: [
          {
            frameProgress: 0,
            stagePosNorm: [-0.6 + cIdx * 0.4, 0, 0]
          },
          {
            frameProgress: 1,
            stagePosNorm: [0.6 + cIdx * 0.4, 0, 0]
          }
        ]
      }))
    });
  }

  return {
    projectId,
    title: `Autonomous Song Film (${durationSeconds.toFixed(1)}s, ${tempo} BPM)`,
    overallMood: isHighEnergy ? 'High-Octane Kinetic Action' : isElectronic ? 'Futuristic Cybernetic Odyssey' : 'Atmospheric Meditative Nocturne',
    cast,
    sections: sectionSpecs
  };
}

export class StorySpecAgent {
  private readonly provider: LlmProvider;

  constructor(provider: LlmProvider) {
    this.provider = provider;
  }

  public buildSystemPrompt(): string {
    return [
      'You are the lead Executive Story Specification Agent for an autonomous animation studio.',
      'Your task is to generate a compact, declarative StorySpecContract JSON payload.',
      'The specification defines the thematic mood, cast archetype assignments, and section staging kits.',
      'JSON Schema Contract (draft-07):',
      STORY_SPEC_JSON_SCHEMA,
      'Return ONLY valid JSON.'
    ].join('\n');
  }

  public async generateStorySpec(input: StorySpecAgentInput): Promise<StorySpecContract> {
    // If mock provider is used or offline, DeterministicMockLlmProvider handles via context or fallback
    const prompt = [
      `Generate a StorySpecContract for project "${input.projectId ?? 'autonomous-film'}".`,
      `Song Duration: ${input.audioManifest.metadata.durationSeconds}s, Total Frames: ${input.audioManifest.metadata.totalFrames}, Tempo: ${input.audioManifest.metadata.tempoBpm ?? input.audioManifest.beatGrid?.tempoBpm ?? 'unknown'} BPM.`,
      `Sections: ${JSON.stringify(input.audioManifest.sections ?? [])}`,
      `Lyrics Count: ${input.audioManifest.lyrics.length}`
    ].join('\n');

    const repairSection = formatRepairFeedbackPrompt(
      input.repairErrors ?? [],
      input.previousDraft
    );

    return this.provider.generateStructuredJson(
      `${prompt}${repairSection}`,
      StorySpecContractSchema,
      {
        systemPrompt: this.buildSystemPrompt(),
        temperature: 0.1,
        maxTokens: input.maxTokens ?? 2048,
        timeoutMs: input.timeoutMs,
        schemaName: 'StorySpecContract',
        agentRole: 'story_spec',
        attempt: input.attempt ?? 1,
        repairErrors: input.repairErrors ?? [],
        previousDraft: input.previousDraft,
        onAttemptComplete: input.onAttemptComplete,
        context: {
          storySpecInput: input
        }
      }
    );
  }
}
