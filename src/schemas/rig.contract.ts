import { z } from 'zod';
import { FiniteNumberSchema, Vec2Schema, Vec3Schema } from './primitives.schema.js';

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

export const GeometryBindingSchema = z.object({
  jointId: z.string().min(1),
  svgElementId: z.string().min(1),
  bindOffset2D: Vec2Schema.optional(),
  weight: z.number().finite().min(0).max(1).optional()
}).strict();
export type GeometryBinding = z.infer<typeof GeometryBindingSchema>;

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
  interpolationMode: z.enum(['linear', 'cubic_spline', 'step']).default('linear')
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

export const AssetRigContractSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: AssetRigTypeEnum,
  viewAngle: RigViewAngleEnum.optional(),
  parallaxDepthZ: FiniteNumberSchema,
  baseTransform: z.object({
    position: Vec3Schema,
    rotationZDegrees: z.number().finite().min(-360).max(360),
    scale: Vec2Schema
  }).strict(),
  skeleton: z.object({
    rootJointId: z.string().min(1),
    joints: z.array(PlanarJointSchema).min(1)
  }).strict().optional(),
  geometryBindings: z.array(GeometryBindingSchema).optional(),
  poseInterpolation: PoseInterpolationContractSchema.optional(),
  morphTopology: z.object({
    baseSegments: z.array(NormalizedCubicBezierSegmentSchema).min(1),
    targets: z.array(NormalizedMorphTargetSchema)
  }).strict().optional(),
  svgAsset: z.object({
    idNamespace: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    viewBox: SvgViewBoxSchema
  }).strict()
}).strict();
export type AssetRigContract = z.infer<typeof AssetRigContractSchema>;
