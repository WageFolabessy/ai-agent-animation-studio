/**
 * Physical, framing, timing, and rigging constants for the procedural verb engine.
 * Exported constants block with documentation comments for each parameter.
 */
export const VERB_CONSTANTS = {
  /** Resolution dimensions for 1080p canvas. */
  CANVAS_WIDTH: 1920,
  CANVAS_HEIGHT: 1080,

  /** Standard animation frame rates supported by the director. */
  FPS_30: 30,
  FPS_60: 60,

  /** Number of canonical narrative acts in a production. */
  CANONICAL_ACT_COUNT: 3,

  /** Decimal precision for rounded frame and scale values. */
  PRECISION_DECIMALS: 4,

  /** Minimum gait timeScale clamp for physics-based contact locking. */
  MIN_GAIT_TIME_SCALE: 0.6,
  /** Maximum gait timeScale clamp for physics-based contact locking. */
  MAX_GAIT_TIME_SCALE: 1.6,

  /** Walk clip loop length in frames. */
  WALK_LOOP_FRAMES: 36,
  /** Walk nominal stride length in world units. */
  WALK_STRIDE_LENGTH: 15.0,

  /** Run clip loop length in frames. */
  RUN_LOOP_FRAMES: 18,
  /** Run nominal stride length in world units. */
  RUN_STRIDE_LENGTH: 23.0,

  /** Idle clip loop length in frames. */
  IDLE_LOOP_FRAMES: 30,
  /** Pop vocal sway clip loop length in frames. */
  POP_SWAY_LOOP_FRAMES: 24,

  /** Minimum length of a beat in frames (hard duration lower bound). */
  MIN_BEAT_LENGTH_FRAMES: 12,

  /** Default upper arm bone length if skeleton is missing. */
  DEFAULT_UPPER_ARM_LENGTH: 18,
  /** Default lower arm bone length if skeleton is missing. */
  DEFAULT_LOWER_ARM_LENGTH: 16,
  /** Default shoulder joint X offset from torso if skeleton is missing. */
  DEFAULT_SHOULDER_OFFSET_X: 6,
  /** Default shoulder joint Y offset from torso if skeleton is missing. */
  DEFAULT_SHOULDER_OFFSET_Y: 15,
  /** Default torso joint Y offset from pelvis if skeleton is missing. */
  DEFAULT_TORSO_OFFSET_Y: 18,

  /** Base scale factors for hero silhouette. */
  HERO_SCALE_X: 1.35,
  HERO_SCALE_Y: 1.45,

  /** Base scale factors for companion silhouette. */
  COMPANION_SCALE_X: 1.6,
  COMPANION_SCALE_Y: 1.15,

  /** Default base Y floor placement for protagonist hero rig. */
  HERO_BASE_Y: 75,
  /** Default base Y floor placement for companion partner rig. */
  COMPANION_BASE_Y: 65,

  /** Default action intensity norm. */
  DEFAULT_INTENSITY_NORM: 0.7,
  /** Speed norm for recoil push step. */
  RECOIL_SPEED_NORM: 1.1,

  /** Default approach clearance distance to a prop. */
  PROP_APPROACH_CLEARANCE: 22,
  /** Default character-to-character clearance distance. */
  CHARACTER_INTERACTION_CLEARANCE: 26,
  /** Recoil push separation delta distance. */
  RECOIL_SEPARATION_DISTANCE: 28,

  /** Simulation traversal staging positions and thresholds. */
  SIM_HERO_INITIAL_X: -95,
  SIM_COMPANION_INITIAL_X: -125,
  SIM_TWO_CHAR_LEFT_X: -92,
  SIM_TWO_CHAR_RIGHT_X: 88,
  SIM_DEEP_ROOM_THRESHOLD: -60,
  SIM_DEEP_ROOM_FORWARD_LEFT: 35,
  SIM_DEEP_ROOM_FORWARD_RIGHT: 65,
  SIM_CROSS_ROOM_POS_A: -34,
  SIM_CROSS_ROOM_POS_B: 34,
  SIM_DEFAULT_STEP_DISTANCE: 46,
  SIM_RETREAT_STEP_DISTANCE: 23,
  SIM_WALL_THRESHOLD: -50,
  SIM_WALL_TARGET_X: 50,
  SIM_TRAVERSE_DISTANCE_THRESHOLD: 40,
  SIM_TRAVERSE_FRAMES_THRESHOLD: 200,

  /** Forward lean angle in degrees for sprint locomotion. */
  RUN_FORWARD_TILT_DEG: 14,
  /** Turn step tilt angle in degrees. */
  TURN_TILT_DEG: 12,

  /** Camera framing distance map across standard focal lengths. */
  FRAMING_DISTANCE_MAP: {
    EXTREME_WIDE: 360,
    WIDE: 260,
    MEDIUM: 180,
    CLOSE_UP: 125,
    EXTREME_CLOSE_UP: 85
  },

  /** Default camera vertical field of view in degrees. */
  DEFAULT_CAMERA_FOV: 50,
  /** Default camera far clipping plane. */
  DEFAULT_FAR_PLANE: 2000,
  /** Default fallback camera distance Z. */
  DEFAULT_FALLBACK_CAM_DIST_Z: 200,

  /** Camera framing target Y and headroom offsets. */
  CAM_PAN_DELTA_X: 30,
  CAM_LOOK_ROOM_OFFSET: 18,
  CAM_TWO_SHOT_OFFSET_Y: 10,
  CAM_WIDE_TARGET_Y: 95,
  CAM_MEDIUM_TARGET_Y: 105,
  CAM_CLOSE_UP_REACH_DIST_Z: 135,
  CAM_CLOSE_UP_REACH_FOCAL_X: -10,
  CAM_CLOSE_UP_REACH_TARGET_Y: 88,
  CAM_CLOSE_UP_REACH_CAM_Y: 98,
  CAM_CLOSE_UP_OVERHEAD_DIST_Z: 142,
  CAM_CLOSE_UP_OVERHEAD_TARGET_Y: 127,
  CAM_CLOSE_UP_OVERHEAD_CAM_Y: 135,
  CAM_CLOSE_UP_BASE_TARGET_Y: 117,
  CAM_CLOSE_UP_BASE_CAM_Y: 127,
  CAM_EXTREME_CLOSE_UP_OVERHEAD_TARGET_Y: 115,
  CAM_EXTREME_CLOSE_UP_BASE_TARGET_Y: 103,
  CAM_HEADROOM_TARGET_Y: 80,

  /** Transition default frames. */
  TRANSITION_CROSS_FADE_FRAMES: 6,
  TRANSITION_DEFAULT_DIP_FRAMES: 10,
  TRANSITION_DEFAULT_DISSOLVE_FRAMES: 10,

  /** Tolerances for invisible cuts detection in compile report. */
  CAMERA_FRAMING_INVISIBLE_CUT_TOLERANCE: 15,
  CAMERA_ANGLE_INVISIBLE_CUT_TOLERANCE_DEG: 4.0,
  HALF_CIRCLE_DEG: 180,
  FULL_CIRCLE_DEG: 360,

  /** Timing fractions for narrative action sub-phases. */
  TURN_TIMING_RATIO: 0.25,
  POINT_ANTICIPATION_RATIO: 0.25,
  REACH_ANTICIPATION_RATIO: 0.2,
  GRASP_CONTACT_RATIO: 0.5,
  CARRY_RELEASE_RATIO: 0.7381,
  DEFAULT_EARLY_ARRIVAL_RATIO: 0.7857,
  EMBRACE_CONTACT_RATIO: 0.4286,
  EMBRACE_THRUST_RATIO: 0.5,
  EMBRACE_CONTACT_WEIGHT: 0.8,
  SIT_CONTACT_RATIO: 0.35,
  SIT_STAND_TRANSITION_RATIO: 0.75,
  FALL_DROP_RATIO: 0.3,
  BLINK_INTERVAL_RATIO: 0.4,

  /** Turn scale progression steps for in-place yaw flip. */
  TURN_SCALE_STEP_1: 0.7,
  TURN_SCALE_STEP_2: 0.35,
  TURN_SCALE_Y_STEP_1: 0.98,
  TURN_SCALE_Y_STEP_2: 0.96,
  TURN_FRAME_OFFSET_5: 5,

  /** Sit posture squash scale. */
  SIT_SQUASH_SCALE_Y: 0.85,

  /** Gaze and pointing directional reach factors. */
  DEG_TO_RAD: Math.PI / 180,
  POINT_EXTEND_X_FACTOR: 0.9,
  POINT_EXTEND_Y_FACTOR: 0.32,
  GAZE_DEFAULT_LOOK_DISTANCE: 100,

  /** Overhead prop hold socket local X displacement. */
  OVERHEAD_PROP_OFFSET_X: 4,
  /** Overhead prop hold socket local Y displacement above head. */
  OVERHEAD_PROP_OFFSET_Y: 8
} as const;

export type ValidFps = typeof VERB_CONSTANTS.FPS_30 | typeof VERB_CONSTANTS.FPS_60;
export type CanonicalActNumber = 1 | 2 | typeof VERB_CONSTANTS.CANONICAL_ACT_COUNT;

