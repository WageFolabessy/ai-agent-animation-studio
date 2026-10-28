import type { StoryBeatContract } from '../schemas/story-beat.contract.js';
import type { StorySpecContract } from '../schemas/story-spec.contract.js';

export const STAGE1_DURATION_SEC = 35;
export const STAGE1_FPS: 30 = 30;
export const STAGE1_TOTAL_FRAMES = STAGE1_DURATION_SEC * STAGE1_FPS; // 1050 frames

export const STAGE1_RAW_LRC = `
[00:00.00] Di tengah lorong malam hening merenung
[00:07.00] Meraih secangkir hangat di atas meja
[00:14.00] Seketika langkah berbalik menatap bayang
[00:21.00] Melangkah membawa asa melintasi ruang
[00:28.00] Menunjuk cakrawala fajar yang menjelang
`.trim();

export const STAGE1_STORY_BEAT_CONTRACT: StoryBeatContract = {
  projectId: 'stage1_solo_acting',
  songDurationSec: STAGE1_DURATION_SEC,
  fps: STAGE1_FPS,
  sliceFrameRange: { startFrame: 0, endFrame: STAGE1_TOTAL_FRAMES },
  cast: [
    {
      instanceId: 'protagonist_lead',
      role: 'PROTAGONIST',
      archetypeId: 'hero_silhouette',
      palette: { primary: '#0a1128', accent: '#00f0ff' }
    }
  ],
  beats: [
    {
      beatId: 'beat_01_walk',
      startFrame: 0,
      endFrame: 210,
      lyricSnippet: 'Di tengah lorong malam hening merenung',
      emotionalTone: 'reflective',
      narrativeSubtext: 'Lead approaches the study desk with measured pace',
      presentCharacters: ['protagonist_lead'],
      set: {
        kitId: 'ARCHITECTURAL_INTERIOR',
        variantId: 'moody_night',
        landmarkProps: ['desk', 'coffee_cup'],
        landmarkPlacements: {
          coffee_cup: [0, 63, 0]
        },
        atmosphericDensity: 0.5
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'walk_to',
          speedNorm: 1.0,
          intensityNorm: 0.7
        }
      ],
      camera: {
        framing: 'WIDE',
        movement: 'DOLLY',
        focalCharacterId: 'protagonist_lead',
        lookRoom: 'right',
        dutchAngleDeg: 0
      }
    },
    {
      beatId: 'beat_02_reach_grasp',
      startFrame: 210,
      endFrame: 420,
      lyricSnippet: 'Meraih secangkir hangat di atas meja',
      emotionalTone: 'melancholic',
      narrativeSubtext: 'Reaching arm with analytical IK and grasping coffee cup',
      presentCharacters: ['protagonist_lead'],
      set: {
        kitId: 'ARCHITECTURAL_INTERIOR',
        variantId: 'moody_night',
        landmarkProps: ['desk', 'coffee_cup'],
        landmarkPlacements: {
          coffee_cup: [0, 63, 0]
        },
        atmosphericDensity: 0.5
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'reach_and_grasp',
          speedNorm: 0.9,
          intensityNorm: 0.8,
          associatedPropId: 'coffee_cup'
        }
      ],
      camera: {
        framing: 'CLOSE_UP',
        movement: 'STATIC',
        focalCharacterId: 'protagonist_lead',
        lookRoom: 'center',
        dutchAngleDeg: 0
      }
    },
    {
      beatId: 'beat_03_snap_turn',
      startFrame: 420,
      endFrame: 630,
      lyricSnippet: 'Seketika langkah berbalik menatap bayang',
      emotionalTone: 'defiant',
      narrativeSubtext: 'Cut-paper snap turnaround with locked foot contact',
      presentCharacters: ['protagonist_lead'],
      set: {
        kitId: 'ARCHITECTURAL_INTERIOR',
        variantId: 'dramatic_twilight',
        landmarkProps: ['desk', 'coffee_cup'],
        landmarkPlacements: {
          coffee_cup: [0, 63, 0]
        },
        atmosphericDensity: 0.6
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'stop_and_turn',
          speedNorm: 1.1,
          intensityNorm: 0.9
        }
      ],
      camera: {
        framing: 'MEDIUM',
        movement: 'PAN',
        focalCharacterId: 'protagonist_lead',
        lookRoom: 'left',
        dutchAngleDeg: 4
      }
    },
    {
      beatId: 'beat_04_carry_put_down',
      startFrame: 630,
      endFrame: 840,
      lyricSnippet: 'Melangkah membawa asa melintasi ruang',
      emotionalTone: 'reflective',
      narrativeSubtext: 'Carrying cup and setting it down safely onto stage surface',
      presentCharacters: ['protagonist_lead'],
      set: {
        kitId: 'ARCHITECTURAL_INTERIOR',
        variantId: 'dramatic_twilight',
        landmarkProps: ['desk', 'coffee_cup'],
        landmarkPlacements: {
          coffee_cup: [0, 63, 0]
        },
        atmosphericDensity: 0.5
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'carry_put_down',
          speedNorm: 1.0,
          intensityNorm: 0.7
        }
      ],
      camera: {
        framing: 'WIDE',
        movement: 'STATIC',
        focalCharacterId: 'protagonist_lead',
        lookRoom: 'center',
        dutchAngleDeg: 0
      }
    },
    {
      beatId: 'beat_05_gesture_point',
      startFrame: 840,
      endFrame: 1050,
      lyricSnippet: 'Menunjuk cakrawala fajar yang menjelang',
      emotionalTone: 'euphoric',
      narrativeSubtext: 'Pointing toward rising horizon in architectural hall',
      presentCharacters: ['protagonist_lead'],
      set: {
        kitId: 'ARCHITECTURAL_INTERIOR',
        variantId: 'clean_minimal',
        landmarkProps: ['desk'],
        atmosphericDensity: 0.4
      },
      actions: [
        {
          instanceId: 'protagonist_lead',
          verb: 'gesture_point',
          speedNorm: 1.0,
          intensityNorm: 0.85
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

export const STAGE1_SYNTHETIC_STORY_SPEC: StorySpecContract = {
  projectId: 'stage1_solo_acting',
  title: 'Stage 1: Solo Acting & Desk Prop Contact',
  overallMood: 'cyber_noir_theatrical',
  themes: ['isolation', 'discovery'],
  genreProfile: 'neutral',
  cast: [
    {
      instanceId: 'protagonist_lead',
      role: 'PROTAGONIST',
      archetypeId: 'hero_silhouette',
      paletteOverrides: { primary: '#0a1128', accent: '#00f0ff' },
      accessories: ['coffee_cup'],
      scale: 1.0
    }
  ],
  sections: STAGE1_STORY_BEAT_CONTRACT.beats.map((b) => ({
    sectionId: b.beatId,
    startFrame: b.startFrame,
    endFrame: b.endFrame,
    narrativeIntent: b.narrativeSubtext,
    emotionalTone: b.emotionalTone,
    stagingMode: 'theatrical' as const,
    theatricalSetId: b.set.kitId,
    interactionBehavior: 'SOLO' as const,
    environmentKitId: 'industrial_city' as const,
    kitParams: {},
    colorThemeId: 'CYBERPUNK_CYAN' as const,
    cameraIntensity: 0.5,
    lyricMotifs: [],
    castDirectives: [
      {
        instanceId: 'protagonist_lead',
        motionPreset: 'pop_vocal_sway' as const,
        waypoints: [{ frameProgress: 0, stagePosNorm: [0, 0, 0] as [number, number, number] }]
      }
    ]
  }))
};

export const STAGE1_RENDER_OPTIONS = {
  width: 1920,
  height: 1080,
  crf: 18,
  preset: 'ultrafast' as const,
  threads: 3,
  chunkFrames: 350,
  resume: false,
  stagingMode: 'theatrical' as const,
  fps: STAGE1_FPS
};
