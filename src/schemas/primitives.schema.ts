import { z } from 'zod';

export const FiniteNumberSchema = z.number().finite();

export const Vec2Schema = z.tuple([FiniteNumberSchema, FiniteNumberSchema]);
export type Vec2 = z.infer<typeof Vec2Schema>;

export const Vec3Schema = z.tuple([FiniteNumberSchema, FiniteNumberSchema, FiniteNumberSchema]);
export type Vec3 = z.infer<typeof Vec3Schema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, {
  message: 'Color must be a valid 6-character hex string (e.g., #RRGGBB)'
});
export type HexColor = z.infer<typeof HexColorSchema>;

export const FrameRangeSchema = z.object({
  startFrameInclusive: z.number().int().min(0),
  endFrameExclusive: z.number().int().min(0)
}).strict().refine((data) => data.endFrameExclusive > data.startFrameInclusive, {
  message: 'endFrameExclusive must be strictly greater than startFrameInclusive'
});
export type FrameRange = z.infer<typeof FrameRangeSchema>;

export function getDurationFrames(range: FrameRange): number {
  return range.endFrameExclusive - range.startFrameInclusive;
}

const BaseCameraParams = {
  position: Vec3Schema,
  target: Vec3Schema,
  up: Vec3Schema.default([0, 1, 0]),
  nearPlane: z.number().finite().min(0.01).max(10).default(0.1),
  farPlane: z.number().finite().min(10).max(10000).default(1000),
  rollDegrees: z.number().finite().min(-180).max(180).default(0)
};

export const PerspectiveCameraSchema = z.object({
  projectionMode: z.literal('perspective'),
  ...BaseCameraParams,
  verticalFovDegrees: z.number().finite().min(10).max(150).default(60)
}).strict();

export const OrthographicCameraSchema = z.object({
  projectionMode: z.literal('orthographic'),
  ...BaseCameraParams,
  orthographicHeight: z.number().finite().positive()
}).strict();

export const CameraTransformSchema = z.discriminatedUnion('projectionMode', [
  PerspectiveCameraSchema,
  OrthographicCameraSchema
]).refine((cam) => {
  const dx = cam.target[0] - cam.position[0];
  const dy = cam.target[1] - cam.position[1];
  const dz = cam.target[2] - cam.position[2];
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq < 1e-6) return false;

  const upLenSq = cam.up[0] * cam.up[0] + cam.up[1] * cam.up[1] + cam.up[2] * cam.up[2];
  if (upLenSq < 1e-6) return false;

  const dist = Math.sqrt(distSq);
  const vx = dx / dist;
  const vy = dy / dist;
  const vz = dz / dist;

  const upLen = Math.sqrt(upLenSq);
  const ux = cam.up[0] / upLen;
  const uy = cam.up[1] / upLen;
  const uz = cam.up[2] / upLen;

  const cx = vy * uz - vz * uy;
  const cy = vz * ux - vx * uz;
  const cz = vx * uy - vy * ux;
  const crossLenSq = cx * cx + cy * cy + cz * cz;

  return crossLenSq > 1e-4;
}, {
  message: 'Camera position/target must not be identical, up vector must be non-zero, and up must not be collinear with view direction'
}).refine((cam) => cam.farPlane > cam.nearPlane, {
  message: 'farPlane must be strictly greater than nearPlane'
});
export type CameraTransform = z.infer<typeof CameraTransformSchema>;
