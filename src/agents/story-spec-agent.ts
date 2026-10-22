import { z } from 'zod';
import type { AudioAnalysisManifest } from '../schemas/audio.contract.js';
import {
  StorySpecContractSchema,
  type StorySpecContract,
  type CastSpecItem,
  type SectionStagingSpec,
  type GenreProfile,
  type EmotionalTone
} from '../schemas/story-spec.contract.js';
import type { LlmCallMetadata, LlmProvider } from './types.js';
import { formatRepairFeedbackPrompt } from './repair-helper.js';
import type { ValidationErrorItem } from '../schemas/invariants.js';
import { analyzeSectionLyrics, extractLyricKeywords } from '../engine/audio/lyric-profile.js';
import { classifyGenreProfile } from '../engine/audio/genre-classifier.js';

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
  readonly noLyricsInPrompt?: boolean;
}

/**
 * Deterministically synthesizes a StorySpecContract conditioned directly on the
 * audio manifest features (multi-factor genre classifier, tempo, spectral bands, lyrics).
 */
export function buildDeterministicStorySpec(
  manifest: AudioAnalysisManifest,
  projectId = 'autonomous-cinema'
): StorySpecContract {
  const { durationSeconds, totalFrames } = manifest.metadata;
  const rawSections = manifest.sections ?? [];
  const lyricCount = manifest.lyrics.length;

  // 1. Multi-factor Genre Classification
  const genreResult = classifyGenreProfile(manifest);
  const genre: GenreProfile = genreResult.genre;

  // 2. Global Lyric Themes & Tone
  const allLyricText = manifest.lyrics.map((l) => l.text).join(' ');
  const globalLyricAnalysis = analyzeSectionLyrics(allLyricText);
  const rawThemes = extractLyricKeywords(allLyricText, 6);
  const themes =
    rawThemes.length > 0
      ? rawThemes
      : genre === 'rock_metal'
        ? ['rebellion', 'survival', 'velocity']
        : genre === 'electronic_synth'
          ? ['transcendence', 'cybernetics', 'speed']
          : genre === 'pop_dance'
            ? ['celebration', 'radiance', 'connection']
            : genre === 'ballad_acoustic'
              ? ['memory', 'solitude', 'healing']
              : ['journey', 'discovery'];

  // 3. Determine Cast Archetypes
  let cast: CastSpecItem[];
  if (genre === 'rock_metal') {
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
  } else if (genre === 'electronic_synth') {
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
  } else if (genre === 'pop_dance') {
    cast = [
      {
        instanceId: 'lead_runner',
        archetypeId: 'biped_runner',
        scale: 1.0,
        paletteOverrides: { primary: '#ffe600', accent: '#00f0ff' },
        accessories: ['hazard_coat']
      },
      {
        instanceId: 'patrol_drone',
        archetypeId: 'aerial_drone',
        scale: 0.9,
        paletteOverrides: { primary: '#00f0ff', accent: '#ff007f' },
        accessories: ['searchlight']
      }
    ];
  } else {
    // ballad_acoustic or neutral
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

  // 4. Synthesize or partition >= 3 contiguous section spans
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
    const working: CleanSectionSpan[] = rawSections.map((s) => ({
      id: s.id,
      startFrame: s.startFrame,
      endFrame: s.endFrame,
      relativeEnergy: s.relativeEnergy,
      hasVocals: s.hasVocals,
      dominantBand: s.dominantBand
    }));

    // Ensure array never exceeds 32 items by merging shortest adjacent spans
    while (working.length > 32) {
      let minSpanIdx = 0;
      let minSpanFrames = Infinity;
      for (let i = 0; i < working.length - 1; i++) {
        const span = working[i].endFrame - working[i].startFrame;
        if (span < minSpanFrames) {
          minSpanFrames = span;
          minSpanIdx = i;
        }
      }
      const next = working[minSpanIdx + 1];
      working[minSpanIdx].endFrame = next.endFrame;
      working[minSpanIdx].relativeEnergy = (working[minSpanIdx].relativeEnergy + next.relativeEnergy) / 2;
      working[minSpanIdx].hasVocals = working[minSpanIdx].hasVocals || next.hasVocals;
      working.splice(minSpanIdx + 1, 1);
    }

    sections.push(...working);
  } else {
    // Partition totalFrames into 3 contiguous spans
    const b1 = Math.max(1, Math.floor(totalFrames * 0.25));
    const b2 = Math.max(b1 + 1, Math.floor(totalFrames * 0.75));
    sections.push(
      {
        id: 'sec-1',
        startFrame: 0,
        endFrame: b1,
        relativeEnergy: genre === 'ballad_acoustic' ? 0.25 : 0.35,
        hasVocals: false,
        dominantBand: 'lowMid'
      },
      {
        id: 'sec-2',
        startFrame: b1,
        endFrame: b2,
        relativeEnergy: genre === 'rock_metal' ? 0.90 : genre === 'pop_dance' ? 0.78 : 0.65,
        hasVocals: lyricCount > 0,
        dominantBand: 'presence'
      },
      {
        id: 'sec-3',
        startFrame: b2,
        endFrame: totalFrames,
        relativeEnergy: genre === 'ballad_acoustic' ? 0.30 : 0.45,
        hasVocals: false,
        dominantBand: 'bass'
      }
    );
  }

  // 5. Staging and Dynamic Acting
  const sectionSpecs: SectionStagingSpec[] = [];
  const numSections = sections.length;

  for (let i = 0; i < numSections; i++) {
    const sec = sections[i];
    const energy = sec.relativeEnergy;
    const isFirst = i === 0;
    const isLast = i === numSections - 1;
    const isSoloClimax = !isFirst && !isLast && (energy >= 0.75 && !sec.hasVocals || i === Math.floor(numSections * 0.65));
    const isChorus = !isFirst && !isLast && !isSoloClimax && (sec.hasVocals || energy >= 0.68);

    // Section-level lyric analysis
    const sectionLyrics = manifest.lyrics.filter(
      (l) =>
        l.frameRange.startFrameInclusive >= sec.startFrame &&
        l.frameRange.startFrameInclusive < sec.endFrame
    );
    const secText = sectionLyrics.map((l) => l.text).join(' ');
    const secLyricAnalysis = analyzeSectionLyrics(secText, globalLyricAnalysis.emotionalTone);
    const emotionalTone: EmotionalTone = secLyricAnalysis.emotionalTone;
    const lyricMotifs = secLyricAnalysis.lyricMotifs;

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
      narrativeIntent = `Act I: Suspenseful Awakening & Staging (${emotionalTone})`;
    } else if (isLast) {
      bipedPreset = 'exhausted_walk';
      narrativeIntent = `Act III: Deceleration & Resolution (${emotionalTone})`;
    } else if (isSoloClimax) {
      bipedPreset = 'combat_clash';
      narrativeIntent = `Virtuosic Climax & Combat Encounter (${emotionalTone})`;
    } else if (isChorus) {
      bipedPreset = i % 2 === 0 ? 'defiant_scream' : 'evade_leap';
      narrativeIntent = `Chorus Hook (${bipedPreset === 'defiant_scream' ? 'Defiant Scream' : 'Dynamic Leap'}, ${emotionalTone})`;
    } else {
      bipedPreset = 'sprint_frenzy';
      narrativeIntent = `Driving Progression & Kinetic Traversal (${emotionalTone})`;
    }

    // Dynamic Biome & Color
    let kitId: 'industrial_city' | 'orbital_station' | 'neon_chasm' | 'synth_grid';
    let colorTheme: 'CYBERPUNK_CYAN' | 'VOLTAGE_ORANGE' | 'SUNSET_GOLD' | 'CRIMSON_FURY' | 'MIDNIGHT_VOID';

    if (genre === 'rock_metal') {
      kitId = isSoloClimax ? 'neon_chasm' : isChorus ? 'orbital_station' : 'industrial_city';
      colorTheme = isSoloClimax ? 'CRIMSON_FURY' : isChorus ? 'VOLTAGE_ORANGE' : isFirst ? 'CYBERPUNK_CYAN' : 'MIDNIGHT_VOID';
    } else if (genre === 'electronic_synth') {
      kitId = i % 2 === 0 ? 'synth_grid' : 'orbital_station';
      colorTheme = energy > 0.7 ? 'SUNSET_GOLD' : 'CYBERPUNK_CYAN';
    } else if (genre === 'pop_dance') {
      kitId = i % 2 === 0 ? 'neon_chasm' : 'synth_grid';
      colorTheme = energy > 0.65 ? 'SUNSET_GOLD' : isChorus ? 'VOLTAGE_ORANGE' : 'CYBERPUNK_CYAN';
    } else if (genre === 'ballad_acoustic') {
      kitId = 'orbital_station';
      colorTheme = emotionalTone === 'melancholic' ? 'MIDNIGHT_VOID' : 'CYBERPUNK_CYAN';
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

    // Directives with C0 continuity across boundaries
    const castDirectives = cast.map((c, cIdx) => {
      let motionPreset: any = bipedPreset;
      if (c.archetypeId === 'aerial_drone') {
        motionPreset = isSoloClimax ? 'dive' : 'hover';
      } else if (c.archetypeId === 'quadruped_beast') {
        motionPreset = isFirst ? 'stalk' : isSoloClashOrLeap(bipedPreset) ? 'pounce' : 'gallop';
      }

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

    const cameraIntensity =
      genre === 'ballad_acoustic'
        ? Number(Math.max(0.2, Math.min(0.6, energy * 0.7)).toFixed(2))
        : Number(energy.toFixed(2));

    sectionSpecs.push({
      sectionId: sec.id,
      startFrame: sec.startFrame,
      endFrame: sec.endFrame,
      narrativeIntent,
      emotionalTone,
      lyricMotifs,
      environmentKitId: kitId,
      kitParams,
      colorThemeId: colorTheme,
      cameraIntensity,
      castDirectives
    });
  }

  const moodMap: Record<GenreProfile, string> = {
    rock_metal: 'High-Octane Kinetic Action',
    electronic_synth: 'Futuristic Cybernetic Odyssey',
    pop_dance: 'Euphoric Neon Rhythm',
    ballad_acoustic: 'Atmospheric Meditative Nocturne',
    neutral: 'Cinematic Visual Exploration'
  };

  return {
    projectId,
    title: `Autonomous Song Film (${durationSeconds.toFixed(1)}s, ${genreResult.metrics.tempoBpm} BPM)`,
    overallMood: moodMap[genre],
    themes,
    genreProfile: genre,
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
    const noLyrics =
      input.noLyricsInPrompt ||
      process.argv.includes('--no-lyrics-in-prompt') ||
      process.env.ANIMATION_STUDIO_NO_LYRICS === '1';

    // Format lyrics per section with token budget clamp (<= 1500 tokens / ~6000 chars)
    let lyricsContext = '';
    if (!noLyrics && input.audioManifest.lyrics.length > 0) {
      const lines: string[] = [];
      let charBudget = 6000;
      for (const line of input.audioManifest.lyrics) {
        const item = `[f:${line.frameRange.startFrameInclusive}] "${line.text}"`;
        if (charBudget - item.length < 0) break;
        lines.push(item);
        charBudget -= item.length;
      }
      lyricsContext = `Lyrics Timeline:\n${lines.join('\n')}`;
    } else if (noLyrics && input.audioManifest.lyrics.length > 0) {
      lyricsContext = `Lyrics Timestamps: ${input.audioManifest.lyrics.map((l) => l.frameRange.startFrameInclusive).join(', ')}`;
    }

    const promptParts = [
      `Generate a StorySpecContract for project "${input.projectId ?? 'autonomous-film'}".`,
      `Song Duration: ${input.audioManifest.metadata.durationSeconds}s, Total Frames: ${input.audioManifest.metadata.totalFrames}, Tempo: ${input.audioManifest.metadata.tempoBpm ?? input.audioManifest.beatGrid?.tempoBpm ?? 'unknown'} BPM.`,
      `Sections: ${JSON.stringify(input.audioManifest.sections ?? [])}`,
      `Lyrics Count: ${input.audioManifest.lyrics.length}`
    ];

    if (lyricsContext) {
      promptParts.push(lyricsContext);
    }

    const prompt = promptParts.join('\n');

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

