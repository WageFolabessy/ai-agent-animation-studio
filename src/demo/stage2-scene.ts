import type { StoryBeatContract } from '../schemas/story-beat.contract.js';
import type { StorySpecContract } from '../schemas/story-spec.contract.js';

export const STAGE2_DURATION_SEC = 35;
export const STAGE2_FPS: 30 = 30;
export const STAGE2_TOTAL_FRAMES = STAGE2_DURATION_SEC * STAGE2_FPS; // 1050 frames

export const STAGE2_RAW_LRC = `
[00:00.00] Di dalam aula temaram melangkah bertaut
[00:07.00] Bertemu tatap bayang di balik tiang megah
[00:14.00] Pelukan sesaat lalu terhempas berjarak
[00:21.00] Berlari keluar menembus dingin lampu kota
[00:28.00] Menatap menara langit menjulang menanti fajar
`.trim();

export const STAGE2_STORY_BEAT_CONTRACT: StoryBeatContract = {
  projectId: 'stage2_two_characters',
  songDurationSec: STAGE2_DURATION_SEC,
  fps: STAGE2_FPS,
  sliceFrameRange: { startFrame: 0, endFrame: STAGE2_TOTAL_FRAMES },
  cast: [
    {
      instanceId: 'protagonist_lead',
      role: 'PROTAGONIST',
      archetypeId: 'hero_silhouette',
      palette: { primary: '#0a1128', accent: '#00f0ff' } // Cool cyber-noir
    },
    {
      instanceId: 'narrative_partner',
      role: 'PARTNER',
      archetypeId: 'companion_silhouette',
      palette: { primary: '#3d1c06', accent: '#ff9100' } // Warm industrial copper
    }
  ],
  beats: [
    {
      beatId: 'beat_01_interior_approach',
      startFrame: 0,
      endFrame: 210,
      lyricSnippet: 'Di dalam aula temaram melangkah bertaut',
      emotionalTone: 'reflective',
      narrativeSubtext: 'Lead and companion approach inside the vaulted interior hall',
      presentCharacters: ['protagonist_lead', 'narrative_partner'],
      set: {
        kitId: 'ARCHITECTURAL_INTERIOR',
        variantId: 'moody_night',
        landmarkProps: ['desk', 'coffee_cup'],
        landmarkPlacements: {
          coffee_cup: [-56, 63, 0]
        },
        atmosphericDensity: 0.5
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'carry_put_down',
          speedNorm: 1.0,
          intensityNorm: 0.7,
          associatedPropId: 'coffee_cup',
          target: { kind: 'position', pos: [-56, 63, 0] }
        },
        {
          instanceId: 'narrative_partner',
          verb: 'walk_to',
          speedNorm: 1.0,
          intensityNorm: 0.7,
          target: { kind: 'position', pos: [38, 0, 0] }
        }
      ],
      camera: {
        framing: 'WIDE',
        movement: 'DOLLY',
        focalCharacterId: 'protagonist_lead',
        lookRoom: 'center',
        dutchAngleDeg: 0
      }
    },
    {
      beatId: 'beat_02_interior_confront',
      startFrame: 210,
      endFrame: 420,
      lyricSnippet: 'Bertemu tatap bayang di balik tiang megah',
      emotionalTone: 'melancholic',
      narrativeSubtext: 'Tense confrontation across the desk surface',
      presentCharacters: ['protagonist_lead', 'narrative_partner'],
      set: {
        kitId: 'ARCHITECTURAL_INTERIOR',
        variantId: 'dramatic_twilight',
        landmarkProps: ['desk', 'coffee_cup'],
        landmarkPlacements: {
          coffee_cup: [-56, 63, 0]
        },
        atmosphericDensity: 0.6
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'walk_to',
          speedNorm: 1.0,
          intensityNorm: 0.8,
          target: { kind: 'position', pos: [-32, 0, 0] }
        },
        {
          instanceId: 'narrative_partner',
          verb: 'look_at',
          speedNorm: 1.0,
          intensityNorm: 0.8
        }
      ],
      camera: {
        framing: 'MEDIUM',
        movement: 'STATIC',
        focalCharacterId: 'protagonist_lead',
        lookRoom: 'right',
        dutchAngleDeg: 0
      }
    },
    {
      beatId: 'beat_03_embrace_push',
      startFrame: 420,
      endFrame: 630,
      lyricSnippet: 'Pelukan sesaat lalu terhempas berjarak',
      emotionalTone: 'defiant',
      narrativeSubtext: 'Bilateral embrace and dramatic push-away recoil with guaranteed clearance',
      presentCharacters: ['protagonist_lead', 'narrative_partner'],
      set: {
        kitId: 'ARCHITECTURAL_INTERIOR',
        variantId: 'dramatic_twilight',
        landmarkProps: [],
        atmosphericDensity: 0.6
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'embrace_push_away',
          speedNorm: 1.1,
          intensityNorm: 0.95
        },
        {
          instanceId: 'narrative_partner',
          verb: 'embrace_push_away',
          speedNorm: 1.1,
          intensityNorm: 0.95
        }
      ],
      camera: {
        framing: 'MEDIUM',
        movement: 'PAN',
        focalCharacterId: 'protagonist_lead',
        lookRoom: 'center',
        dutchAngleDeg: 3
      }
    },
    {
      beatId: 'beat_04_exterior_run',
      startFrame: 630,
      endFrame: 840,
      lyricSnippet: 'Berlari keluar menembus dingin lampu kota',
      emotionalTone: 'chaotic',
      narrativeSubtext: 'Characters transition outdoors onto the rainy urban street overlook',
      presentCharacters: ['protagonist_lead', 'narrative_partner'],
      set: {
        kitId: 'EXTERIOR_URBAN_VISTA',
        variantId: 'storm_overcast',
        landmarkProps: ['umbrella'],
        landmarkPlacements: {
          umbrella: [-30, 24, 0]
        },
        atmosphericDensity: 0.7
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'run_to',
          speedNorm: 1.0,
          intensityNorm: 0.9,
          target: { kind: 'position', pos: [65, 0, 0] }
        },
        {
          instanceId: 'narrative_partner',
          verb: 'walk_to',
          speedNorm: 1.0,
          intensityNorm: 0.7,
          associatedPropId: 'umbrella',
          target: { kind: 'position', pos: [9, 0, 0] }
        }
      ],
      camera: {
        framing: 'WIDE',
        movement: 'STATIC',
        focalCharacterId: 'protagonist_lead',
        lookRoom: 'right',
        dutchAngleDeg: -2
      }
    },
    {
      beatId: 'beat_05_exterior_outlook',
      startFrame: 840,
      endFrame: 1050,
      lyricSnippet: 'Menatap menara langit menjulang menanti fajar',
      emotionalTone: 'euphoric',
      narrativeSubtext: 'Pointing together towards the towering skyline towers as dawn approaches',
      presentCharacters: ['protagonist_lead', 'narrative_partner'],
      set: {
        kitId: 'EXTERIOR_URBAN_VISTA',
        variantId: 'clean_minimal',
        landmarkProps: ['umbrella'],
        landmarkPlacements: {
          umbrella: [-30, 24, 0]
        },
        atmosphericDensity: 0.4
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'gesture_point',
          speedNorm: 1.0,
          intensityNorm: 0.85,
          target: { kind: 'position', pos: [65, 0, 0] }
        },
        {
          instanceId: 'narrative_partner',
          verb: 'look_at',
          speedNorm: 1.0,
          intensityNorm: 0.75,
          associatedPropId: 'umbrella',
          target: { kind: 'position', pos: [9, 0, 0] }
        }
      ],
      camera: {
        framing: 'CLOSE_UP',
        movement: 'STATIC',
        focalCharacterId: 'protagonist_lead',
        lookRoom: 'right',
        dutchAngleDeg: 0
      }
    }
  ],
  unfulfilledRequests: []
};

export const STAGE2_SYNTHETIC_STORY_SPEC: StorySpecContract = {
  projectId: 'stage2_two_characters',
  title: 'Stage 2: Bilateral Interaction & Contrasting Sets',
  overallMood: 'cyber_noir_theatrical',
  themes: ['conflict', 'connection', 'urban_journey'],
  genreProfile: 'neutral',
  cast: [
    {
      instanceId: 'protagonist_lead',
      role: 'PROTAGONIST',
      archetypeId: 'hero_silhouette',
      paletteOverrides: { primary: '#0a1128', accent: '#00f0ff' },
      accessories: ['coffee_cup'],
      scale: 1.0
    },
    {
      instanceId: 'narrative_partner',
      role: 'PARTNER',
      archetypeId: 'companion_silhouette',
      paletteOverrides: { primary: '#3d1c06', accent: '#ff9100' },
      accessories: ['umbrella'],
      scale: 1.0
    }
  ],
  sections: STAGE2_STORY_BEAT_CONTRACT.beats.map((b) => ({
    sectionId: b.beatId,
    startFrame: b.startFrame,
    endFrame: b.endFrame,
    narrativeIntent: b.narrativeSubtext,
    emotionalTone: b.emotionalTone,
    stagingMode: 'theatrical' as const,
    theatricalSetId: b.set.kitId,
    interactionBehavior:
      b.beatId === 'beat_02_interior_confront' || b.beatId === 'beat_03_embrace_push'
        ? ('FACE_TO_FACE' as const)
        : b.beatId === 'beat_04_exterior_run'
          ? ('PARALLEL_WALK' as const)
          : ('DUET_PERFORMANCE' as const),
    environmentKitId: 'industrial_city' as const,
    kitParams: { sideTableCenterX: -56 },
    colorThemeId: 'CYBERPUNK_CYAN' as const,
    cameraIntensity: 0.6,
    lyricMotifs: [],
    castDirectives: [
      {
        instanceId: 'protagonist_lead',
        motionPreset: 'pop_vocal_sway' as const,
        waypoints: [{ frameProgress: 0, stagePosNorm: [0, 0, 0] as [number, number, number] }]
      },
      {
        instanceId: 'narrative_partner',
        motionPreset: 'pop_vocal_sway' as const,
        waypoints: [{ frameProgress: 0, stagePosNorm: [0, 0, 0] as [number, number, number] }]
      }
    ]
  }))
};

export const STAGE2_RENDER_OPTIONS = {
  width: 1920,
  height: 1080,
  crf: 18,
  preset: 'superfast' as const,
  threads: 2,
  chunkFrames: 210,
  resume: false,
  stagingMode: 'theatrical' as const,
  fps: STAGE2_FPS
};
