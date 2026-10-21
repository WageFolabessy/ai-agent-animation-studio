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
  const { durationSeconds, totalFrames } = manifest.metadata;
  const tempo = manifest.metadata.tempoBpm ?? manifest.beatGrid?.tempoBpm ?? 120;
  const rawSections = manifest.sections ?? [];
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
        instanceId: 'cyber_beast',
        archetypeId: 'quadruped_beast',
        scale: 1.0,
        paletteOverrides: { primary: '#00f0ff', accent: '#ff0055' },
        accessories: ['sensor_crest']
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

  // 2. Synthesize or partition >= 3 contiguous section spans (Safeguard 1)
  interface CleanSectionSpan {
    id: string;
    startFrame: number;
    endFrame: number;
    relativeEnergy: number;
    hasVocals: boolean;
    dominantBand: string;
  }

  const sections: CleanSectionSpan[] = [];
  if (rawSections.length >= 3) {
    for (const s of rawSections) {
      sections.push({
        id: s.id,
        startFrame: s.startFrame,
        endFrame: s.endFrame,
        relativeEnergy: s.relativeEnergy,
        hasVocals: s.hasVocals,
        dominantBand: s.dominantBand
      });
    }
  } else {
    // Partition totalFrames into 3 contiguous spans
    const b1 = Math.max(1, Math.floor(totalFrames * 0.25));
    const b2 = Math.max(b1 + 1, Math.floor(totalFrames * 0.75));
    sections.push(
      {
        id: 'sec-1',
        startFrame: 0,
        endFrame: b1,
        relativeEnergy: 0.35,
        hasVocals: false,
        dominantBand: 'lowMid'
      },
      {
        id: 'sec-2',
        startFrame: b1,
        endFrame: b2,
        relativeEnergy: isHighEnergy ? 0.88 : 0.65,
        hasVocals: lyricCount > 0,
        dominantBand: 'presence'
      },
      {
        id: 'sec-3',
        startFrame: b2,
        endFrame: totalFrames,
        relativeEnergy: 0.45,
        hasVocals: false,
        dominantBand: 'bass'
      }
    );
  }

  // 3. Staging and Dynamic Acting
  const sectionSpecs: SectionStagingSpec[] = [];
  const numSections = sections.length;

  for (let i = 0; i < numSections; i++) {
    const sec = sections[i];
    const energy = sec.relativeEnergy;
    const isFirst = i === 0;
    const isLast = i === numSections - 1;
    const isSoloClimax = !isFirst && !isLast && (energy >= 0.75 && !sec.hasVocals || i === Math.floor(numSections * 0.65));
    const isChorus = !isFirst && !isLast && !isSoloClimax && (sec.hasVocals || energy >= 0.68);

    // Dynamic Biped Motion Preset
    let bipedPreset:
      | 'stalk_crouch'
      | 'sprint_frenzy'
      | 'evade_leap'
      | 'defiant_scream'
      | 'combat_clash'
      | 'exhausted_walk';
    let narrativeIntent: string;

    if (isFirst) {
      bipedPreset = 'stalk_crouch';
      narrativeIntent = `Act I: Suspenseful Infiltration & Awakening (${energy > 0.5 ? 'Alert' : 'Stealth'})`;
    } else if (isLast) {
      bipedPreset = 'exhausted_walk';
      narrativeIntent = `Act III: Deceleration & Exhausted Resolution (${sec.id})`;
    } else if (isSoloClimax) {
      bipedPreset = 'combat_clash';
      narrativeIntent = `Virtuosic Climax & Combat Clash (${sec.dominantBand} Peak)`;
    } else if (isChorus) {
      bipedPreset = i % 2 === 0 ? 'defiant_scream' : 'evade_leap';
      narrativeIntent = `Chorus Hook (${bipedPreset === 'defiant_scream' ? 'Defiant Scream' : 'Acrobatic Leap'})`;
    } else {
      bipedPreset = 'sprint_frenzy';
      narrativeIntent = `Driving Progression & Kinetic Sprint (${sec.id})`;
    }

    // Dynamic Biome & Color
    let kitId: 'industrial_city' | 'orbital_station' | 'neon_chasm' | 'synth_grid';
    let colorTheme: 'CYBERPUNK_CYAN' | 'VOLTAGE_ORANGE' | 'SUNSET_GOLD' | 'CRIMSON_FURY' | 'MIDNIGHT_VOID';

    if (isHighEnergy) {
      kitId = isSoloClimax ? 'neon_chasm' : isChorus ? 'orbital_station' : 'industrial_city';
      colorTheme = isSoloClimax ? 'CRIMSON_FURY' : isChorus ? 'VOLTAGE_ORANGE' : isFirst ? 'CYBERPUNK_CYAN' : 'MIDNIGHT_VOID';
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

    // Directives with C0 continuity across boundaries (Safeguard 2)
    const castDirectives = cast.map((c, cIdx) => {
      let motionPreset: any = bipedPreset;
      if (c.archetypeId === 'aerial_drone') {
        motionPreset = isSoloClimax ? 'dive' : 'hover';
      } else if (c.archetypeId === 'quadruped_beast') {
        motionPreset = isFirst ? 'stalk' : isSoloClashOrLeap(bipedPreset) ? 'pounce' : 'gallop';
      }

      // Continuous lateral stage offset
      const stageOffsetX = cIdx === 0 ? 0 : cIdx === 1 ? -0.3 : 0.3;
      const stageOffsetY = c.archetypeId === 'aerial_drone' ? 0.6 : 0;

      return {
        instanceId: c.instanceId,
        motionPreset,
        waypoints: [
          {
            frameProgress: 0,
            stagePosNorm: [stageOffsetX, stageOffsetY, 0] as [number, number, number]
          },
          {
            frameProgress: 1,
            stagePosNorm: [stageOffsetX, stageOffsetY, 0] as [number, number, number]
          }
        ]
      };
    });

    sectionSpecs.push({
      sectionId: sec.id,
      startFrame: sec.startFrame,
      endFrame: sec.endFrame,
      narrativeIntent,
      environmentKitId: kitId,
      kitParams,
      colorThemeId: colorTheme,
      cameraIntensity: Number(energy.toFixed(2)),
      castDirectives
    });
  }

  return {
    projectId,
    title: `Autonomous Song Film (${durationSeconds.toFixed(1)}s, ${tempo} BPM)`,
    overallMood: isHighEnergy
      ? 'High-Octane Kinetic Action'
      : isElectronic
        ? 'Futuristic Cybernetic Odyssey'
        : 'Atmospheric Meditative Nocturne',
    cast,
    sections: sectionSpecs
  };
}

function isSoloClashOrLeap(preset: string): boolean {
  return preset === 'combat_clash' || preset === 'evade_leap';
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
