import { z } from 'zod';
import { Vec3Schema, HexColorSchema, FrameRangeSchema, CameraTransformSchema } from './primitives.schema.js';

export const CameraFramingEnum = z.enum([
  'EXTREME_WIDE', 'WIDE', 'MEDIUM', 'CLOSE_UP', 'EXTREME_CLOSE_UP'
]);
export type CameraFraming = z.infer<typeof CameraFramingEnum>;

export const CameraMovementEnum = z.enum([
  'STATIC', 'PAN', 'TILT', 'DOLLY', 'TRACKING', 'ORBIT', 'CRANE'
]);
export type CameraMovement = z.infer<typeof CameraMovementEnum>;

export const CameraViewpointEnum = z.enum([
  'OBJECTIVE_THIRD_PERSON', 'POV_FIRST_PERSON', 'OVER_THE_SHOULDER', 'LOW_ANGLE', 'HIGH_ANGLE'
]);
export type CameraViewpoint = z.infer<typeof CameraViewpointEnum>;

export const CameraEasingEnum = z.enum([
  'linear', 'easeInQuad', 'easeOutQuad', 'easeInOutCubic', 'easeInOutSine', 'springImpulse'
]);
export type CameraEasing = z.infer<typeof CameraEasingEnum>;

export const ColorLightingPaletteSchema = z.object({
  background: HexColorSchema,
  primary: HexColorSchema,
  secondary: HexColorSchema,
  accent: HexColorSchema,
  ambientLightColor: HexColorSchema,
  ambientIntensity: z.number().finite().min(0).max(1),
  keyLightDirection: Vec3Schema,
  audioReactiveGain: z.number().finite().min(0).max(5)
}).strict();
export type ColorLightingPalette = z.infer<typeof ColorLightingPaletteSchema>;

export const CinematicShotSchema = z.object({
  id: z.string().min(1),
  shotIndex: z.number().int().min(0),
  actNumber: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  frameRange: FrameRangeSchema,
  framing: CameraFramingEnum,
  movement: CameraMovementEnum,
  viewpoint: CameraViewpointEnum,
  cameraStart: CameraTransformSchema,
  cameraEnd: CameraTransformSchema,
  cameraEasing: CameraEasingEnum,
  depthOfFieldBlur: z.object({
    focalDistance: z.number().finite().positive(),
    apertureBlurFactor: z.number().finite().min(0).max(50)
  }).strict().optional(),
  palette: ColorLightingPaletteSchema,
  narrativeAction: z.string().min(1),
  activeRigIds: z.array(z.string().min(1)).min(1)
}).strict().refine(
  (shot) => shot.cameraStart.projectionMode === shot.cameraEnd.projectionMode,
  { message: 'Camera projectionMode must match between start and end' }
);
export type CinematicShot = z.infer<typeof CinematicShotSchema>;

export const StoryboardActSchema = z.object({
  actNumber: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().min(1),
  narrativeArc: z.string().min(1),
  frameRange: FrameRangeSchema
}).strict();
export type StoryboardAct = z.infer<typeof StoryboardActSchema>;

export const DirectorStoryboardContractSchema = z.object({
  projectId: z.string().min(1),
  resolution: z.object({ width: z.literal(1920), height: z.literal(1080) }).strict(),
  fps: z.union([z.literal(30), z.literal(60)]),
  totalFrames: z.number().int().positive(),
  acts: z.tuple([StoryboardActSchema, StoryboardActSchema, StoryboardActSchema]),
  shots: z.array(CinematicShotSchema).min(1)
}).strict();
export type DirectorStoryboardContract = z.infer<typeof DirectorStoryboardContractSchema>;
