import type { CameraMovement } from '../../schemas/storyboard.contract.js';
import type {
  GenreProfile,
  InteractionBehavior,
  CastDirective
} from '../../schemas/story-spec.contract.js';
import type { TheatricalSetId } from '../../schemas/stage.contract.js';
import type { NarrativePropId } from '../../schemas/prop.contract.js';

export type CanonicalGenreName =
  | 'POP'
  | 'BALLAD'
  | 'ROCK'
  | 'METAL'
  | 'ELECTRONIC'
  | 'ACOUSTIC';

export type ColorThemeId =
  | 'CYBERPUNK_CYAN'
  | 'VOLTAGE_ORANGE'
  | 'SUNSET_GOLD'
  | 'CRIMSON_FURY'
  | 'MIDNIGHT_VOID';

export interface GenreDirectingProfile {
  readonly genreName: CanonicalGenreName;
  readonly genreProfile: GenreProfile;
  readonly colorHarmonies: readonly ColorThemeId[];
  readonly cameraPacing: {
    readonly minShotDurationSeconds: number;
    readonly maxShotDurationSeconds: number;
    readonly allowedMovements: readonly CameraMovement[];
    readonly traumaShakeMultiplier: number;
  };
  readonly lightingStyle: {
    readonly ambientFloorBrightness: number;
    readonly pulseDecayRate: number;
    readonly spotlightFocus: boolean;
  };
  readonly preferredSets: readonly TheatricalSetId[];
  readonly defaultProps: readonly NarrativePropId[];
  readonly actingPresets: {
    readonly act1: CastDirective['motionPreset'];
    readonly act2: CastDirective['motionPreset'];
    readonly act3: CastDirective['motionPreset'];
    readonly chorus: CastDirective['motionPreset'];
  };
  readonly interactionArc: {
    readonly act1: InteractionBehavior;
    readonly act2: InteractionBehavior;
    readonly act3: InteractionBehavior;
  };
}

/**
 * Universal Genre-Aware Directing Matrix (Pillar 5 of Theatrical Narrative Architecture).
 * Coordinates color harmonies, camera pacing, lighting styles, theatrical sets,
 * narrative props, and 3-Act interpersonal blocking across all musical genres.
 */
export const GENRE_DIRECTING_MATRIX: Record<CanonicalGenreName, GenreDirectingProfile> = {
  POP: {
    genreName: 'POP',
    genreProfile: 'pop_dance',
    colorHarmonies: ['SUNSET_GOLD', 'CYBERPUNK_CYAN', 'VOLTAGE_ORANGE'],
    cameraPacing: {
      minShotDurationSeconds: 3.0,
      maxShotDurationSeconds: 7.5,
      allowedMovements: ['CRANE', 'DOLLY', 'TRACKING', 'ORBIT'],
      traumaShakeMultiplier: 0.15
    },
    lightingStyle: {
      ambientFloorBrightness: 0.82,
      pulseDecayRate: 6.5,
      spotlightFocus: true
    },
    preferredSets: ['CONCERT_STAGE', 'RAINY_STREET', 'INTERIOR_ROOM'],
    defaultProps: ['microphone', 'crown'],
    actingPresets: {
      act1: 'pop_vocal_sway',
      act2: 'rhythmic_step',
      act3: 'stage_spin',
      chorus: 'crowd_cheer'
    },
    interactionArc: {
      act1: 'SOLO',
      act2: 'DUET_PERFORMANCE',
      act3: 'DUET_PERFORMANCE'
    }
  },
  BALLAD: {
    genreName: 'BALLAD',
    genreProfile: 'ballad_acoustic',
    colorHarmonies: ['MIDNIGHT_VOID', 'SUNSET_GOLD', 'CYBERPUNK_CYAN'],
    cameraPacing: {
      minShotDurationSeconds: 5.5,
      maxShotDurationSeconds: 11.5,
      allowedMovements: ['DOLLY', 'CRANE', 'TRACKING'],
      traumaShakeMultiplier: 0.1
    },
    lightingStyle: {
      ambientFloorBrightness: 0.65,
      pulseDecayRate: 3.2,
      spotlightFocus: true
    },
    preferredSets: ['INTERIOR_ROOM', 'PARK_BENCH', 'RAINY_STREET'],
    defaultProps: ['umbrella', 'rose', 'coffee_cup'],
    actingPresets: {
      act1: 'gazing_out_window',
      act2: 'bench_contemplation',
      act3: 'slow_waltz',
      chorus: 'rain_umbrella_walk'
    },
    interactionArc: {
      act1: 'SOLO',
      act2: 'FACE_TO_FACE',
      act3: 'PARALLEL_WALK'
    }
  },
  ACOUSTIC: {
    genreName: 'ACOUSTIC',
    genreProfile: 'ballad_acoustic',
    colorHarmonies: ['SUNSET_GOLD', 'MIDNIGHT_VOID', 'VOLTAGE_ORANGE'],
    cameraPacing: {
      minShotDurationSeconds: 5.0,
      maxShotDurationSeconds: 10.5,
      allowedMovements: ['DOLLY', 'CRANE', 'TRACKING'],
      traumaShakeMultiplier: 0.12
    },
    lightingStyle: {
      ambientFloorBrightness: 0.72,
      pulseDecayRate: 3.8,
      spotlightFocus: true
    },
    preferredSets: ['PARK_BENCH', 'INTERIOR_ROOM', 'CONCERT_STAGE'],
    defaultProps: ['acoustic_guitar', 'coffee_cup', 'fedora_hat'],
    actingPresets: {
      act1: 'acoustic_strum',
      act2: 'bench_contemplation',
      act3: 'acoustic_strum',
      chorus: 'pop_vocal_sway'
    },
    interactionArc: {
      act1: 'SOLO',
      act2: 'DUET_PERFORMANCE',
      act3: 'FACE_TO_FACE'
    }
  },
  ROCK: {
    genreName: 'ROCK',
    genreProfile: 'rock_metal',
    colorHarmonies: ['VOLTAGE_ORANGE', 'CRIMSON_FURY', 'CYBERPUNK_CYAN'],
    cameraPacing: {
      minShotDurationSeconds: 2.5,
      maxShotDurationSeconds: 6.5,
      allowedMovements: ['TRACKING', 'DOLLY', 'ORBIT', 'CRANE'],
      traumaShakeMultiplier: 0.85
    },
    lightingStyle: {
      ambientFloorBrightness: 0.75,
      pulseDecayRate: 8.5,
      spotlightFocus: true
    },
    preferredSets: ['RAINY_STREET', 'CONCERT_STAGE', 'GOTHIC_CATHEDRAL'],
    defaultProps: ['electric_guitar', 'microphone'],
    actingPresets: {
      act1: 'stalk_crouch',
      act2: 'headbang_riff',
      act3: 'combat_clash',
      chorus: 'defiant_scream'
    },
    interactionArc: {
      act1: 'SOLO',
      act2: 'FACE_TO_FACE',
      act3: 'PURSUIT_AND_CONFRONTATION'
    }
  },
  METAL: {
    genreName: 'METAL',
    genreProfile: 'rock_metal',
    colorHarmonies: ['CRIMSON_FURY', 'MIDNIGHT_VOID', 'VOLTAGE_ORANGE'],
    cameraPacing: {
      minShotDurationSeconds: 2.5,
      maxShotDurationSeconds: 5.5,
      allowedMovements: ['TRACKING', 'ORBIT', 'DOLLY', 'CRANE'],
      traumaShakeMultiplier: 1.0
    },
    lightingStyle: {
      ambientFloorBrightness: 0.68,
      pulseDecayRate: 10.0,
      spotlightFocus: true
    },
    preferredSets: ['GOTHIC_CATHEDRAL', 'RAINY_STREET', 'CONCERT_STAGE'],
    defaultProps: ['electric_guitar', 'crown', 'rose'],
    actingPresets: {
      act1: 'stalk_crouch',
      act2: 'headbang_riff',
      act3: 'collapse_to_knees',
      chorus: 'defiant_scream'
    },
    interactionArc: {
      act1: 'SOLO',
      act2: 'PURSUIT_AND_CONFRONTATION',
      act3: 'FACE_TO_FACE'
    }
  },
  ELECTRONIC: {
    genreName: 'ELECTRONIC',
    genreProfile: 'electronic_synth',
    colorHarmonies: ['CYBERPUNK_CYAN', 'SUNSET_GOLD', 'MIDNIGHT_VOID'],
    cameraPacing: {
      minShotDurationSeconds: 3.0,
      maxShotDurationSeconds: 7.0,
      allowedMovements: ['DOLLY', 'ORBIT', 'TRACKING', 'CRANE'],
      traumaShakeMultiplier: 0.55
    },
    lightingStyle: {
      ambientFloorBrightness: 0.74,
      pulseDecayRate: 9.0,
      spotlightFocus: false
    },
    preferredSets: ['CONCERT_STAGE', 'RAINY_STREET', 'GOTHIC_CATHEDRAL'],
    defaultProps: ['microphone'],
    actingPresets: {
      act1: 'rhythmic_step',
      act2: 'stage_spin',
      act3: 'evade_leap',
      chorus: 'crowd_cheer'
    },
    interactionArc: {
      act1: 'SOLO',
      act2: 'PARALLEL_WALK',
      act3: 'DUET_PERFORMANCE'
    }
  }
};

export function getGenreDirectingProfile(
  genreOrProfile: CanonicalGenreName | GenreProfile
): GenreDirectingProfile {
  if (genreOrProfile in GENRE_DIRECTING_MATRIX) {
    return GENRE_DIRECTING_MATRIX[genreOrProfile as CanonicalGenreName];
  }

  switch (genreOrProfile) {
    case 'pop_dance':
      return GENRE_DIRECTING_MATRIX.POP;
    case 'ballad_acoustic':
      return GENRE_DIRECTING_MATRIX.BALLAD;
    case 'rock_metal':
      return GENRE_DIRECTING_MATRIX.METAL;
    case 'electronic_synth':
      return GENRE_DIRECTING_MATRIX.ELECTRONIC;
    case 'neutral':
    default:
      return GENRE_DIRECTING_MATRIX.ACOUSTIC;
  }
}
