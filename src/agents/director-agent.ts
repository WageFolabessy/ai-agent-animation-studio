import { z } from 'zod';
import {
  DirectorStoryboardContractSchema,
  type DirectorStoryboardContract,
  type EnvironmentZoneType,
  type ColorLightingPalette
} from '../schemas/storyboard.contract.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../schemas/audio.contract.js';
import type { AcousticSummary, DirectorAgentInput, LlmProvider } from './types.js';
import type { SceneEnvironment } from '../engine/compositor/scene-compositor.js';
import { generateFullSongStoryboard } from '../engine/director/macro-planner.js';
import { buildDynamicEnvironment } from '../engine/director/environment-generator.js';

export const CANONICAL_RIG_IDS = {
  SKYLINE: 'rig-skyline',
  FACTORIES: 'rig-factories',
  SMOKE_CHIMNEY: 'rig-smoke-chimney',
  RUNNER: 'rig-runner',
  RUNNER_AURA: 'rig-runner-aura',
  FG_PIPES: 'rig-fg-pipes',
  PURSUIT_DRONE: 'rig-pursuit-drone',
  HIGHWAY_GANTRY: 'rig-highway-gantry',
  NEON_BILLBOARD: 'rig-neon-billboard',
  BRIDGE_PYLON: 'rig-bridge-pylon',
  REACTOR_CORE: 'rig-reactor-core'
} as const;

/**
 * Returns a compact JSON Schema (draft-07) string for embedding into agent system prompts.
 */
export function formatContractJsonSchema(schema: z.ZodType): string {
  return JSON.stringify(z.toJSONSchema(schema, { target: 'draft-07' }));
}

export const DIRECTOR_STORYBOARD_JSON_SCHEMA = formatContractJsonSchema(
  DirectorStoryboardContractSchema
);

/**
 * Summarizes frame-level acoustic features, beat events, and lyric timeline
 * into a compact prompt payload for the Director Agent.
 */
export function summarizeAudioManifest(
  manifest: AudioAnalysisManifest,
  getAudioFeatureAtFrame?: (frameIndex: number) => AudioFrameFeature
): AcousticSummary {
  const { durationSeconds, fps, totalFrames } = manifest.metadata;
  const beats = manifest.beatEvents;

  const estimatedBpm: number | 'unknown' =
    manifest.metadata.tempoBpm !== undefined
      ? Math.round(manifest.metadata.tempoBpm)
      : 'unknown';

  const beatGridSummary = manifest.beatGrid
    ? {
        framesPerBeat: manifest.beatGrid.framesPerBeat,
        framesPerBar: manifest.beatGrid.framesPerBar,
        totalBeats: manifest.beatGrid.beatFrameIndices.length
      }
    : undefined;

  const sectionsSummary = manifest.sections
    ? manifest.sections.map((s) => ({
        id: s.id,
        startFrame: s.startFrame,
        endFrame: s.endFrame,
        relativeEnergy: s.relativeEnergy,
        dominantBand: s.dominantBand
      }))
    : undefined;

  const sortedBeats = [...beats].sort((a, b) => b.confidence - a.confidence);
  const peakOnsetFrames = sortedBeats
    .slice(0, 8)
    .map((b) => b.frameIndex)
    .sort((a, b) => a - b);

  let sumRms = 0;
  let peakRms = 0;
  let subBassSum = 0;
  let bassSum = 0;
  let lowMidSum = 0;
  let midSum = 0;
  let highMidSum = 0;
  let presenceSum = 0;
  let brillianceSum = 0;
  let sampledFrames = 0;

  if (getAudioFeatureAtFrame && totalFrames > 0) {
    for (let f = 0; f < totalFrames; f++) {
      const feat = getAudioFeatureAtFrame(f);
      sumRms += feat.rms;
      if (feat.rms > peakRms) peakRms = feat.rms;
      subBassSum += feat.bands.subBass;
      bassSum += feat.bands.bass;
      lowMidSum += feat.bands.lowMid;
      midSum += feat.bands.mid;
      highMidSum += feat.bands.highMid;
      presenceSum += feat.bands.presence;
      brillianceSum += feat.bands.brilliance;
      sampledFrames++;
    }
  }

  const denom = Math.max(1, sampledFrames);
  return {
    durationSeconds,
    fps,
    totalFrames,
    estimatedBpm,
    ...(manifest.metadata.tempoConfidence !== undefined
      ? { tempoConfidence: manifest.metadata.tempoConfidence }
      : {}),
    beatCount: beats.length,
    ...(beatGridSummary !== undefined ? { beatGridSummary } : {}),
    ...(sectionsSummary !== undefined ? { sectionsSummary } : {}),
    peakOnsetFrames,
    lyricCount: manifest.lyrics.length,
    meanRms: Number((sumRms / denom).toFixed(4)),
    peakRms: Number(peakRms.toFixed(4)),
    dominantBands: {
      subBassAvg: Number((subBassSum / denom).toFixed(4)),
      bassAvg: Number((bassSum / denom).toFixed(4)),
      lowMidAvg: Number((lowMidSum / denom).toFixed(4)),
      midAvg: Number((midSum / denom).toFixed(4)),
      highMidAvg: Number((highMidSum / denom).toFixed(4)),
      presenceAvg: Number((presenceSum / denom).toFixed(4)),
      brillianceAvg: Number((brillianceSum / denom).toFixed(4))
    }
  };
}

export { formatRepairFeedbackPrompt } from './repair-helper.js';
import { formatRepairFeedbackPrompt } from './repair-helper.js';

/**
 * Synthesizes a deterministic, schema-compliant DirectorStoryboardContract
 * conditioned on the AudioAnalysisManifest. Used by DeterministicMockLlmProvider
 * and as a reference specification for the Director Agent.
 */
export function buildDeterministicDirectorStoryboard(
  input: DirectorAgentInput
): DirectorStoryboardContract {
  const { audioManifest } = input;
  const totalFrames = audioManifest.metadata.totalFrames;
  const fps: 30 | 60 = audioManifest.metadata.fps === 60 ? 60 : 30;
  const projectId = input.projectId ?? 'phase4-agent-orchestrated-cinema';

  // For full-song timelines (> 300 frames), invoke the macro song planner
  if (totalFrames > 300) {
    return generateFullSongStoryboard({
      audioManifest,
      projectId,
      ...(input.getAudioFeatureAtFrame !== undefined
        ? { getAudioFeatureAtFrame: input.getAudioFeatureAtFrame }
        : {})
    });
  }

  // Divide [0, totalFrames) into 3 contiguous acts and 4 contiguous shots
  const act1End = Math.max(1, Math.floor(totalFrames * 0.25));
  const shot1End = Math.max(act1End + 1, Math.floor(totalFrames * 0.5));
  const act2End = Math.max(shot1End + 1, Math.floor(totalFrames * 0.75));

  return {
    projectId,
    resolution: { width: 1920, height: 1080 },
    fps,
    totalFrames,
    acts: [
      {
        actNumber: 1,
        title: 'Act I: Industrial Awakening',
        narrativeArc:
          'Establishing the neon-lit industrial horizon as chimney smoke rises and the cybernetic runner launches forward.',
        frameRange: {
          startFrameInclusive: 0,
          endFrameExclusive: act1End
        }
      },
      {
        actNumber: 2,
        title: 'Act II: Velocity & Kinetic Drive',
        narrativeArc:
          'High-speed tracking and sweeping orbital cinematography synchronized with heavy bass and vocal onsets.',
        frameRange: {
          startFrameInclusive: act1End,
          endFrameExclusive: act2End
        }
      },
      {
        actNumber: 3,
        title: 'Act III: Cybernetic Convergence',
        narrativeArc:
          'Dramatic dolly close-up into the runner expressive face and visor with full industrial city continuity behind.',
        frameRange: {
          startFrameInclusive: act2End,
          endFrameExclusive: totalFrames
        }
      }
    ],
    shots: [
      {
        id: 'shot-0',
        shotIndex: 0,
        actNumber: 1,
        frameRange: {
          startFrameInclusive: 0,
          endFrameExclusive: act1End
        },
        framing: 'EXTREME_WIDE',
        movement: 'DOLLY',
        viewpoint: 'LOW_ANGLE',
        cameraStart: {
          projectionMode: 'perspective',
          position: [-140, 175, 420],
          target: [-40, 95, -100],
          up: [0, 1, 0],
          verticalFovDegrees: 55,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: 0
        },
        cameraEnd: {
          projectionMode: 'perspective',
          position: [-75, 138, 255],
          target: [30, 88, -60],
          up: [0, 1, 0],
          verticalFovDegrees: 50,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: -1.5
        },
        cameraEasing: 'easeInOutCubic',
        palette: {
          background: '#090b16',
          primary: '#00f0ff',
          secondary: '#3a506b',
          accent: '#ff0055',
          ambientLightColor: '#1a243b',
          ambientIntensity: 0.72,
          keyLightDirection: [-0.5, -0.8, -0.3],
          audioReactiveGain: 0.65
        },
        narrativeAction:
          'Extreme wide dolly in across the industrial skyline and smokestacks as the runner accelerates rightward (+X).',
        activeRigIds: [
          CANONICAL_RIG_IDS.SKYLINE,
          CANONICAL_RIG_IDS.FACTORIES,
          CANONICAL_RIG_IDS.SMOKE_CHIMNEY,
          CANONICAL_RIG_IDS.RUNNER,
          CANONICAL_RIG_IDS.RUNNER_AURA,
          CANONICAL_RIG_IDS.FG_PIPES
        ]
      },
      {
        id: 'shot-1',
        shotIndex: 1,
        actNumber: 2,
        frameRange: {
          startFrameInclusive: act1End,
          endFrameExclusive: shot1End
        },
        framing: 'MEDIUM',
        movement: 'TRACKING',
        viewpoint: 'OBJECTIVE_THIRD_PERSON',
        cameraStart: {
          projectionMode: 'perspective',
          position: [20, 115, 260],
          target: [20, 95, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 45,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: -2
        },
        cameraEnd: {
          projectionMode: 'perspective',
          position: [160, 112, 250],
          target: [160, 95, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 45,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: 2
        },
        cameraEasing: 'linear',
        palette: {
          background: '#0c091a',
          primary: '#00ffcc',
          secondary: '#4a306d',
          accent: '#ff2a85',
          ambientLightColor: '#22183b',
          ambientIntensity: 0.78,
          keyLightDirection: [-0.3, -0.7, -0.5],
          audioReactiveGain: 0.8
        },
        narrativeAction:
          'Lateral tracking shot matching the runner forward (+X) sprint stride with foreground pipe parallax and trailing cyber-aura.',
        activeRigIds: [
          CANONICAL_RIG_IDS.SKYLINE,
          CANONICAL_RIG_IDS.FACTORIES,
          CANONICAL_RIG_IDS.SMOKE_CHIMNEY,
          CANONICAL_RIG_IDS.RUNNER,
          CANONICAL_RIG_IDS.RUNNER_AURA,
          CANONICAL_RIG_IDS.FG_PIPES
        ]
      },
      {
        id: 'shot-2',
        shotIndex: 2,
        actNumber: 2,
        frameRange: {
          startFrameInclusive: shot1End,
          endFrameExclusive: act2End
        },
        framing: 'WIDE',
        movement: 'ORBIT',
        viewpoint: 'OVER_THE_SHOULDER',
        cameraStart: {
          projectionMode: 'perspective',
          position: [130, 135, 240],
          target: [185, 95, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 52,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: 3
        },
        cameraEnd: {
          projectionMode: 'perspective',
          position: [320, 148, 220],
          target: [285, 95, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 52,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: -3.5
        },
        cameraEasing: 'easeInOutSine',
        palette: {
          background: '#12081c',
          primary: '#ffbe0b',
          secondary: '#3a0ca3',
          accent: '#f72585',
          ambientLightColor: '#2b0f4c',
          ambientIntensity: 0.82,
          keyLightDirection: [0.4, -0.8, -0.4],
          audioReactiveGain: 0.9
        },
        narrativeAction:
          'Dynamic orbital sweep around the sprinting runner while the factory chimney continues venting stationary industrial smoke in the midground.',
        activeRigIds: [
          CANONICAL_RIG_IDS.SKYLINE,
          CANONICAL_RIG_IDS.FACTORIES,
          CANONICAL_RIG_IDS.SMOKE_CHIMNEY,
          CANONICAL_RIG_IDS.RUNNER,
          CANONICAL_RIG_IDS.RUNNER_AURA,
          CANONICAL_RIG_IDS.FG_PIPES
        ]
      },
      {
        id: 'shot-3',
        shotIndex: 3,
        actNumber: 3,
        frameRange: {
          startFrameInclusive: act2End,
          endFrameExclusive: totalFrames
        },
        framing: 'CLOSE_UP',
        movement: 'DOLLY',
        viewpoint: 'POV_FIRST_PERSON',
        cameraStart: {
          projectionMode: 'perspective',
          position: [295, 134, 95],
          target: [295, 132, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 35,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: -1.5
        },
        cameraEnd: {
          projectionMode: 'perspective',
          position: [315, 136, 70],
          target: [315, 134, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 30,
          nearPlane: 1,
          farPlane: 3000,
          rollDegrees: 0
        },
        cameraEasing: 'easeOutQuad',
        palette: {
          background: '#080c1a',
          primary: '#00f5d4',
          secondary: '#7b2cbf',
          accent: '#ff007f',
          ambientLightColor: '#19223c',
          ambientIntensity: 0.88,
          keyLightDirection: [0.0, -0.5, -0.8],
          audioReactiveGain: 0.72
        },
        narrativeAction:
          'Intense close-up dolly tracking the runner expressive facial morphs and glowing visor with persistent industrial skyline and factory backdrop continuity.',
        activeRigIds: [
          CANONICAL_RIG_IDS.SKYLINE,
          CANONICAL_RIG_IDS.FACTORIES,
          CANONICAL_RIG_IDS.SMOKE_CHIMNEY,
          CANONICAL_RIG_IDS.RUNNER
        ]
      }
    ]
  };
}

/**
 * Provides continuous 3D ground plane and perspective grid environment across all shots,
 * using a localized ground grid in close-up shots to keep drawable counts low while
 * preserving the horizon floor.
 */
export function getOrchestratedEnvironment(
  shotId: string,
  centerX = 0,
  zone: EnvironmentZoneType = 'ROOFTOP',
  palette?: ColorLightingPalette
): SceneEnvironment {
  // Preserve dedicated close-up environment for Phase 4 backwards compatibility
  if (shotId === 'shot-3' && Math.abs(centerX) < 400 && zone === 'ROOFTOP') {
    return {
      polygons: [
        {
          vertices: [
            [-400, 0, 300],
            [700, 0, 300],
            [700, 0, -500],
            [-400, 0, -500]
          ],
          fill: '#0c101d',
          opacity: 0.95,
          tier: 0
        }
      ],
      lines: [
        { p0: [-400, 0, 0], p1: [700, 0, 0], stroke: '#1b2438', strokeWidth: 1.5, opacity: 0.8, tier: 2 },
        { p0: [300, 0, -500], p1: [300, 0, 300], stroke: '#1b2438', strokeWidth: 1.5, opacity: 0.8, tier: 2 }
      ]
    };
  }

  const effectivePalette: ColorLightingPalette = palette ?? {
    background: '#090b16',
    primary: '#00f0ff',
    secondary: '#3a506b',
    accent: '#ff0055',
    ambientLightColor: '#1a243b',
    ambientIntensity: 0.72,
    keyLightDirection: [-0.5, -0.8, -0.3],
    audioReactiveGain: 0.65
  };

  return buildDynamicEnvironment({
    shotId,
    centerX,
    zone,
    palette: effectivePalette
  });
}

/**
 * Director Agent: Translates offline audio intelligence and lyric timing into
 * a validated DirectorStoryboardContract with 3 acts, contiguous shots, and
 * full background continuity.
 */
export class DirectorAgent {
  private readonly provider: LlmProvider;

  constructor(provider: LlmProvider) {
    this.provider = provider;
  }

  public buildSystemPrompt(): string {
    return [
      'You are the Principal Director Agent for an AI 2.5D Animation Studio.',
      'Your task is to generate a strictly valid JSON object conforming to DirectorStoryboardContractSchema.',
      'Invariants to enforce:',
      '1. acts must have actNumber [1, 2, 3] contiguously covering [0, totalFrames).',
      '2. shots must have sequential shotIndex (0, 1, ...), unique id, and contiguously cover [0, totalFrames) with zero gaps or overlaps.',
      '3. Each shot must lie strictly within its referenced actNumber frameRange.',
      '4. Maintain background rig continuity ("rig-skyline", "rig-factories", "rig-smoke-chimney") across ALL shots including CLOSE_UP shots so the industrial horizon never disappears into a black void.',
      '5. Separate stationary factory smoke ("rig-smoke-chimney") from the character kinetic trail ("rig-runner-aura").',
      'JSON Schema Contract (draft-07):',
      DIRECTOR_STORYBOARD_JSON_SCHEMA,
      'Return ONLY valid JSON.'
    ].join('\n');
  }

  public buildUserPrompt(input: DirectorAgentInput): string {
    const summary = summarizeAudioManifest(input.audioManifest, input.getAudioFeatureAtFrame);
    const lyricsPreview = input.audioManifest.lyrics.map((l) => ({
      id: l.id,
      text: l.text,
      frames: [l.frameRange.startFrameInclusive, l.frameRange.endFrameExclusive],
      emphasis: l.emphasis
    }));

    const basePrompt = [
      `Generate a DirectorStoryboardContract for project "${input.projectId ?? 'phase4-agent-orchestrated-cinema'}".`,
      `Target resolution: 1920x1080, fps: ${summary.fps}, totalFrames: ${summary.totalFrames}.`,
      `Acoustic Summary: ${JSON.stringify(summary)}`,
      `Aligned Lyrics: ${JSON.stringify(lyricsPreview)}`,
      `Available Canonical Rigs: ${JSON.stringify(Object.values(CANONICAL_RIG_IDS))}`
    ].join('\n');

    const repairSection = formatRepairFeedbackPrompt(
      input.repairErrors ?? [],
      input.previousDraft
    );
    return `${basePrompt}${repairSection}`;
  }

  public async generateStoryboard(input: DirectorAgentInput): Promise<DirectorStoryboardContract> {
    const prompt = this.buildUserPrompt(input);
    return this.provider.generateStructuredJson(prompt, DirectorStoryboardContractSchema, {
      systemPrompt: this.buildSystemPrompt(),
      temperature: 0.1,
      maxTokens: input.maxTokens ?? 4096,
      timeoutMs: input.timeoutMs,
      schemaName: 'DirectorStoryboardContract',
      agentRole: 'director',
      attempt: input.attempt ?? 1,
      repairErrors: input.repairErrors ?? [],
      previousDraft: input.previousDraft,
      onAttemptComplete: input.onAttemptComplete,
      context: {
        directorInput: input
      }
    });
  }
}
