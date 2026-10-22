import { z } from 'zod';
import { FiniteNumberSchema, HexColorSchema, Vec2Schema, Vec3Schema } from './primitives.schema.js';
import { RigSocketSchema } from './prop.contract.js';

export const AssetRigTypeEnum = z.enum([
  'character', 'parallax_background', 'parallax_midground', 'parallax_foreground', 'prop', 'particle_emitter'
]);
export type AssetRigType = z.infer<typeof AssetRigTypeEnum>;

export const PlanarJointSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  localOffset2D: Vec2Schema,
  length: FiniteNumberSchema.min(0),
  rotationZDegrees: z.number().finite().min(-360).max(360),
  constraintsDeg: z.tuple([z.number().finite(), z.number().finite()]).refine(
    ([min, max]) => min <= max,
    { message: 'Joint constraint min must be less than or equal to max' }
  ).optional()
}).strict();
export type PlanarJoint = z.infer<typeof PlanarJointSchema>;

export const NormalizedCubicBezierSegmentSchema = z.object({
  p0: Vec2Schema,
  p1: Vec2Schema,
  p2: Vec2Schema,
  p3: Vec2Schema
}).strict();
export type NormalizedCubicBezierSegment = z.infer<typeof NormalizedCubicBezierSegmentSchema>;

export const NormalizedMorphTargetSchema = z.object({
  name: z.string().min(1),
  segments: z.array(NormalizedCubicBezierSegmentSchema).min(1)
}).strict();
export type NormalizedMorphTarget = z.infer<typeof NormalizedMorphTargetSchema>;

export const RigViewAngleEnum = z.enum(['front', 'three_quarter', 'profile']);
export type RigViewAngle = z.infer<typeof RigViewAngleEnum>;

export const RigPaintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: HexColorSchema }).strict(),
  z.object({
    kind: z.literal('palette'),
    role: z.enum(['background', 'primary', 'secondary', 'accent']),
    shade: z.number().finite().min(-1).max(1).default(0)
  }).strict()
]);
export type RigPaint = z.infer<typeof RigPaintSchema>;

export const RigShapeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('path'),
    segments: z.array(NormalizedCubicBezierSegmentSchema).min(1),
    closed: z.boolean().default(true)
  }).strict(),
  z.object({ kind: z.literal('polygon'), points: z.array(Vec2Schema).min(3) }).strict(),
  z.object({ kind: z.literal('ellipse'), radius: Vec2Schema }).strict(),
  z.object({
    kind: z.literal('rect'),
    size: Vec2Schema,
    rx: FiniteNumberSchema.min(0).optional(),
    ry: FiniteNumberSchema.min(0).optional()
  }).strict(),
  z.object({ kind: z.literal('morph') }).strict()
]);
export type RigShape = z.infer<typeof RigShapeSchema>;

export const RigPartSchema = z.object({
  id: z.string().min(1),
  jointId: z.string().min(1).nullable(),
  localOffset2D: Vec2Schema.default([0, 0]),
  shape: RigShapeSchema,
  style: z.object({
    fill: RigPaintSchema.optional(),
    stroke: z.object({
      paint: RigPaintSchema,
      width: z.number().finite().positive()
    }).strict().optional(),
    opacity: z.number().finite().min(0).max(1).default(1),
    lit: z.boolean().default(true)
  }).strict()
}).strict();
export type RigPart = z.infer<typeof RigPartSchema>;

export const ParticleEmitterSchema = z.object({
  seed: z.number().int().min(0),
  maxParticles: z.number().int().min(1).max(400),
  ratePerSecond: z.number().finite().min(0),
  lifetimeFrames: z.number().int().min(4).max(240),
  spawn: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('point') }).strict(),
    z.object({ kind: z.literal('rect'), size: Vec2Schema }).strict(),
    z.object({ kind: z.literal('disc'), radius: z.number().finite().positive() }).strict()
  ]),
  velocity: z.object({
    angleDegrees: z.number().finite(),
    spreadDegrees: z.number().finite().min(0).max(360),
    speedMin: z.number().finite().min(0),
    speedMax: z.number().finite().min(0)
  }).strict(),
  gravity: Vec2Schema,
  radiusRange: z.tuple([z.number().finite().positive(), z.number().finite().positive()]),
  paintRole: z.enum(['primary', 'secondary', 'accent']),
  baseOpacity: z.number().finite().min(0).max(1),
  audio: z.object({
    onsetBurstCount: z.number().int().min(0).max(60),
    rateBand: z.enum(['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance']).nullable(),
    rateGain: z.number().finite().min(0)
  }).strict().optional()
}).strict();
export type ParticleEmitter = z.infer<typeof ParticleEmitterSchema>;

export const SecondaryMotionSchema = z.object({
  jointId: z.string().min(1),
  spring: z.object({
    zeta: z.number().min(0.05).max(2),
    omega: z.number().positive().max(60)
  }).strict(),
  drive: z.enum(['audio.onsetStrength', 'audio.bands.bass', 'audio.rms']),
  gainDegrees: z.number().finite(),
  maxDeflectionDeg: z.number().finite().positive().max(90).optional()
}).strict();
export type SecondaryMotion = z.infer<typeof SecondaryMotionSchema>;

export const JointPoseTransformSchema = z.object({
  jointId: z.string().min(1),
  rotationZDegrees: z.number().finite().min(-360).max(360),
  localOffset2D: Vec2Schema.optional()
}).strict();
export type JointPoseTransform = z.infer<typeof JointPoseTransformSchema>;

export const PoseKeyframeSchema = z.object({
  frame: z.number().int().min(0),
  jointTransforms: z.array(JointPoseTransformSchema).min(1),
  easing: z.enum(['linear', 'ease_in', 'ease_out', 'ease_in_out']).optional()
}).strict();
export type PoseKeyframe = z.infer<typeof PoseKeyframeSchema>;

export const PoseInterpolationContractSchema = z.object({
  keyframes: z.array(PoseKeyframeSchema).min(1),
  interpolationMode: z.enum(['linear', 'cubic_spline', 'step']).default('linear'),
  loopFrames: z.number().int().min(2).optional(),
  strideLengthUnits: FiniteNumberSchema.positive().optional(),
  contactFrames: z.number().int().min(0).optional()
}).strict();
export type PoseInterpolationContract = z.infer<typeof PoseInterpolationContractSchema>;

export const SvgViewBoxSchema = z.string().trim().superRefine((val, ctx) => {
  const parts = val.trim().split(/[\s,]+/);
  if (parts.length !== 4) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `SVG viewBox must have exactly 4 numbers [min-x, min-y, width, height], received ${parts.length}`
    });
    return;
  }

  const [minXStr, minYStr, widthStr, heightStr] = parts;
  const numRegex = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

  if (!numRegex.test(minXStr) || !numRegex.test(minYStr) || !numRegex.test(widthStr) || !numRegex.test(heightStr)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'SVG viewBox contains non-numeric values'
    });
    return;
  }

  const minX = Number(minXStr);
  const minY = Number(minYStr);
  const width = Number(widthStr);
  const height = Number(heightStr);

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(width) || !Number.isFinite(height)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'SVG viewBox contains NaN or infinite values'
    });
    return;
  }

  if (width <= 0 || height <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `SVG viewBox width and height must be strictly positive (> 0), received width: ${width}, height: ${height}`
    });
  }
});
export type SvgViewBox = z.infer<typeof SvgViewBoxSchema>;

export const RigFacingDirectionEnum = z.enum(['left', 'right', 'front']);
export type RigFacingDirection = z.infer<typeof RigFacingDirectionEnum>;

export const AssetRigContractSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: AssetRigTypeEnum,
  viewAngle: RigViewAngleEnum.optional(),
  facingDirection: RigFacingDirectionEnum.optional(),
  renderMode: z.enum(['planar', 'billboard']).optional(),
  baseTransform: z.object({
    position: Vec3Schema,
    rotationZDegrees: z.number().finite().min(-360).max(360),
    scale: Vec2Schema
  }).strict(),
  skeleton: z.object({
    rootJointId: z.string().min(1),
    joints: z.array(PlanarJointSchema).min(1)
  }).strict().optional(),
  sockets: z.array(RigSocketSchema).optional(),
  parts: z.array(RigPartSchema).default([]),
  emitter: ParticleEmitterSchema.optional(),
  secondaryMotion: z.array(SecondaryMotionSchema).default([]),
  poseInterpolation: PoseInterpolationContractSchema.optional(),
  poseClips: z.record(z.string(), PoseInterpolationContractSchema).optional(),
  morphTopology: z.object({
    baseSegments: z.array(NormalizedCubicBezierSegmentSchema).min(1),
    targets: z.array(NormalizedMorphTargetSchema)
  }).strict().optional(),
  svgAsset: z.object({
    idNamespace: z.string().regex(/^[a-zA-Z0-9_-]+$/)
  }).strict()
}).strict();
export type AssetRigContract = z.infer<typeof AssetRigContractSchema>;
