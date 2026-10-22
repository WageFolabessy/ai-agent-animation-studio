import type { FrameStateContract, ActiveEntityState } from '../../schemas/frame.contract.js';
import type { AudioFrameFeature } from '../../schemas/audio.contract.js';
import type { AssetRigContract, RigPart, RigPaint } from '../../schemas/rig.contract.js';
import type { Vec2, Vec3 } from '../../schemas/primitives.schema.js';
import { BUNDLED_FONT_FAMILY } from '../../config/fonts.js';
import { SvgBuilder, type PathCommand } from './svg-builder.js';
import { computeCameraBasis, worldToCameraSpace, type CameraBasis } from '../camera/camera-3d.js';
import {
  clipAndProjectPolygon,
  clipAndProjectCameraLine,
  clipAndProjectCameraPolygon,
  projectCameraPointToScreen
} from '../camera/clipping.js';
import {
  sortDrawables,
  splitLargeLine,
  splitLargePolygon,
  type DepthTier,
  type SortablePrimitive,
  type CameraSpacePolygon,
  type CameraSpaceLine
} from './depth-sort.js';
import { computeLightingPulse, registerKeyLightGradient } from './lighting.js';
import {
  computeSkeletonFK,
  applyAffine2D,
  createBillboardContext,
  projectBillboardPoint,
  transformPlanarPointToWorld,
  type Affine2D,
  type BillboardProjectionContext
} from '../rigging/kinematics.js';
import { blendMorphTargets, flattenCubicBezier } from '../rigging/morpher.js';
import { evaluateParticleEmitter } from '../effects/particle-emitter.js';
import { shadeHexColor } from '../math/color.js';

export interface EnvironmentPolygon {
  vertices: Vec3[]; // Counter-Clockwise (CCW) viewed from outside
  fill: string;
  opacity?: number;
  tier?: DepthTier;
  layerPass?: number;
  isTwoSided?: boolean;
}

export interface EnvironmentLine {
  p0: Vec3;
  p1: Vec3;
  stroke: string;
  strokeWidth?: number;
  opacity?: number;
  tier?: DepthTier;
  layerPass?: number;
}

export interface SceneEnvironment {
  polygons?: EnvironmentPolygon[];
  lines?: EnvironmentLine[];
}

export interface SceneBudgetStats {
  drawablesCount: number;
  gradientShapesCount: number;
  particlesCount: number;
  filtersCount: number;
}

export interface CompositorOutput {
  svg: string;
  stats: SceneBudgetStats;
}

function resolveRigPaint(
  paint: RigPaint | undefined,
  palette: FrameStateContract['palette'],
  lit: boolean,
  builder: SvgBuilder,
  gradientCache: Map<string, string>
): { fillAttr: string; isGradient: boolean } {
  if (!paint) {
    return { fillAttr: 'none', isGradient: false };
  }

  let baseHex: string;
  if (paint.kind === 'solid') {
    baseHex = paint.color;
  } else {
    const roleColor = palette[paint.role];
    baseHex = shadeHexColor(roleColor, paint.shade);
  }

  if (lit) {
    let gradId = gradientCache.get(baseHex);
    if (!gradId) {
      gradId = `lit_grad_${gradientCache.size}`;
      registerKeyLightGradient(builder, gradId, baseHex, palette);
      gradientCache.set(baseHex, gradId);
    }
    return { fillAttr: `url(#${gradId})`, isGradient: true };
  }

  return { fillAttr: baseHex, isGradient: false };
}

function buildRoundedRectPoints(
  w: number,
  h: number,
  rxRaw?: number,
  ryRaw?: number
): Vec2[] {
  const rx = Math.min(w / 2, Math.max(0, rxRaw ?? ryRaw ?? 0));
  const ry = Math.min(h / 2, Math.max(0, ryRaw ?? rxRaw ?? 0));
  if (rx <= 1e-4 || ry <= 1e-4) {
    return [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2]
    ];
  }

  const pts: Vec2[] = [];
  const corners: Array<{ cx: number; cy: number; startAngle: number }> = [
    { cx: w / 2 - rx, cy: h / 2 - ry, startAngle: 0 },
    { cx: -w / 2 + rx, cy: h / 2 - ry, startAngle: Math.PI / 2 },
    { cx: -w / 2 + rx, cy: -h / 2 + ry, startAngle: Math.PI },
    { cx: w / 2 - rx, cy: -h / 2 + ry, startAngle: (3 * Math.PI) / 2 }
  ];

  const stepsPerCorner = 3;
  for (const corner of corners) {
    for (let s = 0; s <= stepsPerCorner; s++) {
      const theta = corner.startAngle + (s / stepsPerCorner) * (Math.PI / 2);
      pts.push([corner.cx + rx * Math.cos(theta), corner.cy + ry * Math.sin(theta)]);
    }
  }
  return pts;
}

function getTierForRig(rig: AssetRigContract): DepthTier {
  switch (rig.type) {
    case 'parallax_background':
      return 1;
    case 'parallax_midground':
      return 2;
    case 'character':
    case 'prop':
      return 3;
    case 'parallax_foreground':
      return 4;
    case 'particle_emitter':
      return 5;
  }
}

/**
 * Composite rendering engine implementing strict Painter's Algorithm sorting,
 * analytical lighting pulses, isolated edge rendering, and scene budget tracking.
 */
export class SceneCompositor {
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;

  constructor(options: { width?: number; height?: number; fps?: number } = {}) {
    this.width = options.width ?? 1920;
    this.height = options.height ?? 1080;
    this.fps = options.fps ?? 30;
  }

  public renderFrame(
    frameState: FrameStateContract,
    rigs: Map<string, AssetRigContract>,
    environment: SceneEnvironment = {},
    onsetFrames: readonly number[] = [],
    getAudioFeatureAtFrame?: (f: number) => AudioFrameFeature
  ): CompositorOutput {
    const builder = new SvgBuilder({
      width: this.width,
      height: this.height
    });

    const stats: SceneBudgetStats = {
      drawablesCount: 0,
      gradientShapesCount: 0,
      particlesCount: 0,
      filtersCount: 0
    };

    const gradientCache = new Map<string, string>();
    const basis = computeCameraBasis(frameState.camera);
    const camera = frameState.camera;

    const fallbackAudioLookup = (f: number): AudioFrameFeature => {
      if (f === frameState.frameIndex) {
        return frameState.audio;
      }
      return {
        ...frameState.audio,
        frameIndex: f,
        timestamp: f / this.fps,
        onsetStrength: 0,
        isOnset: false
      };
    };

    // 1. Setup backdrop gradient and audio-reactive glow
    const pulseResult = computeLightingPulse(
      frameState.frameIndex,
      this.fps,
      frameState.palette,
      getAudioFeatureAtFrame ?? fallbackAudioLookup,
      onsetFrames
    );

    builder.addLinearGradient('backdrop_linear', {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 1,
      stops: [
        { offset: 0, color: pulseResult.backdropTop },
        { offset: 1, color: pulseResult.backdropBottom }
      ]
    });

    builder.addRect(0, 0, this.width, this.height, 'url(#backdrop_linear)');
    stats.gradientShapesCount++;

    // Optional audio glow halo behind characters
    if (pulseResult.haloOpacity > 0.02) {
      builder.addRadialGradient('audio_halo', {
        cx: 0.5,
        cy: 0.5,
        r: 0.5,
        stops: [
          { offset: 0, color: frameState.palette.accent, opacity: pulseResult.haloOpacity },
          { offset: 1, color: frameState.palette.accent, opacity: 0 }
        ]
      });
      // Center halo
      builder.addCircle(
        this.width / 2,
        this.height / 2 + 50,
        pulseResult.haloRadius,
        'url(#audio_halo)'
      );
      stats.gradientShapesCount++;
    }

    // 2. Collect sortable primitives
    const sortables: SortablePrimitive[] = [];
    let submitIndex = 0;

    const minEntityFeetY =
      frameState.entities.length > 0
        ? Math.min(...frameState.entities.map((e) => e.worldPosition[1]))
        : 0;

    // 2a. Environment polygons (3D world meshes)
    if (environment.polygons) {
      for (const poly of environment.polygons) {
        if (poly.vertices.length < 3) continue;

        // Backface culling in world space: normal = edge1 x edge2 (CCW outward winding)
        if (!poly.isTwoSided) {
          const w0 = poly.vertices[0];
          const w1 = poly.vertices[1];
          const w2 = poly.vertices[2];

          const e1: Vec3 = [w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]];
          const e2: Vec3 = [w2[0] - w0[0], w2[1] - w0[1], w2[2] - w0[2]];

          const normX = e1[1] * e2[2] - e1[2] * e2[1];
          const normY = e1[2] * e2[0] - e1[0] * e2[2];
          const normZ = e1[0] * e2[1] - e1[1] * e2[0];

          const toCamX = camera.position[0] - w0[0];
          const toCamY = camera.position[1] - w0[1];
          const toCamZ = camera.position[2] - w0[2];

          const dot = normX * toCamX + normY * toCamY + normZ * toCamZ;
          if (dot <= 0) {
            continue; // Culled back face
          }
        }

        // Camera space conversion
        const camVerts = poly.vertices.map((v) => worldToCameraSpace(v, camera, basis));
        const polyTier = poly.tier ?? 2;

        let polyLayerPass = poly.layerPass;
        if (polyLayerPass === undefined) {
          if (polyTier === 0) {
            polyLayerPass = 0;
          } else {
            const w0 = poly.vertices[0];
            const w1 = poly.vertices[1];
            const w2 = poly.vertices[2];
            const e1: Vec3 = [w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]];
            const e2: Vec3 = [w2[0] - w0[0], w2[1] - w0[1], w2[2] - w0[2]];
            const normY = e1[2] * e2[0] - e1[0] * e2[2];
            const len = Math.hypot(
              e1[1] * e2[2] - e1[2] * e2[1],
              normY,
              e1[0] * e2[1] - e1[1] * e2[0]
            );
            const ny = len > 1e-6 ? normY / len : 0;
            const maxY = Math.max(...poly.vertices.map((v) => v[1]));
            if (Math.abs(ny) > 0.9 && maxY <= minEntityFeetY + 5.0) {
              polyLayerPass = 0;
            } else {
              polyLayerPass = 1;
            }
          }
        }

        const polyItem: CameraSpacePolygon = {
          kind: 'env_polygon',
          vertices: camVerts,
          depthKey: polyTier === 0 ? camera.farPlane : 0,
          tier: polyTier,
          layerPass: polyLayerPass,
          index: submitIndex++,
          fill: poly.fill,
          opacity: poly.opacity ?? 1,
          worldVertices: poly.vertices
        };

        if (polyTier === 0) {
          // Backdrop / ground-floor plane: keep as a single continuous polygon Behind scene objects & surface grid lines
          sortables.push(polyItem);
        } else {
          const pieces = splitLargePolygon(polyItem, camera.nearPlane, camera.farPlane);
          for (const p of pieces) {
            sortables.push(p);
          }
        }
      }
    }

    // 2b. Environment lines (isolated edge rendering)
    if (environment.lines) {
      for (const line of environment.lines) {
        const p0Cam = worldToCameraSpace(line.p0, camera, basis);
        const p1Cam = worldToCameraSpace(line.p1, camera, basis);

        let lineLayerPass = line.layerPass;
        if (lineLayerPass === undefined) {
          if (
            line.tier === 0 ||
            (line.p0[1] <= minEntityFeetY + 5.0 &&
              line.p1[1] <= minEntityFeetY + 5.0 &&
              (line.tier ?? 2) <= 2)
          ) {
            lineLayerPass = 0;
          } else {
            lineLayerPass = 1;
          }
        }

        const lineItem: CameraSpaceLine = {
          kind: 'env_line',
          p0: p0Cam,
          p1: p1Cam,
          depthKey: 0,
          tier: line.tier ?? 2,
          layerPass: lineLayerPass,
          index: submitIndex++,
          stroke: line.stroke,
          strokeWidth: line.strokeWidth ?? 1,
          opacity: line.opacity ?? 1,
          p0World: line.p0,
          p1World: line.p1
        };

        const pieces = splitLargeLine(lineItem, camera.nearPlane, camera.farPlane);
        for (const p of pieces) {
          sortables.push(p);
        }
      }
    }

    // 2c. Entities (rigs and particle emitters)
    for (const entity of frameState.entities) {
      const rig = rigs.get(entity.rigId);
      if (!rig || entity.opacity <= 0.01) continue;

      // Handle particle emitter
      if (rig.type === 'particle_emitter' && rig.emitter) {
        const particles = evaluateParticleEmitter(
          rig.emitter,
          frameState.frameIndex,
          this.fps,
          onsetFrames
        );

        for (const pt of particles) {
          // pt.position is local to entity -> transform to world
          const worldPt: Vec3 = [
            entity.worldPosition[0] + pt.position[0],
            entity.worldPosition[1] + pt.position[1],
            entity.worldPosition[2]
          ];
          const camPt = worldToCameraSpace(worldPt, camera, basis);
          if (camPt[2] < camera.nearPlane || camPt[2] > camera.farPlane) continue;

          const screenCenter = projectCameraPointToScreen(camPt, camera, this.width, this.height);
          const r = pt.radius;
          const particleOpacity = pt.opacity * entity.opacity;
          if (particleOpacity <= 0.01) continue;

          // Cull off-screen particles to prevent resvg zero-intersection opacity panics
          if (
            screenCenter.x + r < -32 ||
            screenCenter.x - r > this.width + 32 ||
            screenCenter.y + r < -32 ||
            screenCenter.y - r > this.height + 32
          ) {
            continue;
          }

          sortables.push({
            kind: 'particle',
            depthKey: camPt[2],
            tier: 5,
            layerPass: 1,
            index: submitIndex++,
            screenCenter,
            radius: r,
            fill: frameState.palette[rig.emitter.paintRole],
            opacity: particleOpacity
          });
        }
        continue;
      }

      // Handle characters / props / parallax layers
      const renderMode = rig.renderMode ?? (rig.type.startsWith('parallax_') ? 'planar' : 'billboard');
      const tier = getTierForRig(rig);

      // Evaluate FK if skeleton present
      let fkTransforms = new Map<string, Affine2D>();
      if (rig.skeleton) {
        fkTransforms = computeSkeletonFK(
          rig.skeleton,
          entity.jointAngles,
          entity.jointOffsets
        );
      }

      if (renderMode === 'billboard') {
        const ctx = createBillboardContext(
          entity.worldPosition,
          entity.worldRotationZDegrees,
          entity.scale,
          camera,
          basis,
          this.width,
          this.height
        );
        if (!ctx) continue;

        sortables.push({
          kind: 'billboard_entity',
          depthKey: ctx.depthZ,
          tier,
          layerPass: 1,
          index: submitIndex++,
          rig,
          entity,
          fkTransforms,
          ctx
        });
      } else {
        // Planar rig
        const camPoint = worldToCameraSpace(entity.worldPosition, camera, basis);
        if (camPoint[2] < camera.nearPlane || camPoint[2] > camera.farPlane) continue;

        sortables.push({
          kind: 'planar_entity',
          depthKey: camPoint[2],
          tier,
          layerPass: 1,
          index: submitIndex++,
          rig,
          entity,
          fkTransforms
        });
      }
    }

    // 3. Strict Back-to-Front Sorting (Painter's Algorithm)
    sortDrawables(sortables);

    // 4. Emit sorted primitives into SvgBuilder
    for (const item of sortables) {
      switch (item.kind) {
        case 'env_polygon': {
          const camVerts = item.vertices as Vec3[];
          const clipped = clipAndProjectCameraPolygon(camVerts, camera, this.width, this.height);
          if (clipped && clipped.vertices.length >= 3) {
            stats.drawablesCount++;
            const pts = clipped.vertices.map((v) => [v.x, v.y] as [number, number]);
            // Add a 1px same-color seam stroke on split or opaque 3D faces to eliminate subpixel anti-aliasing seams without shared-stroke clashing
            const useSeamStroke = Boolean(item.wasSplit) || (item.opacity as number) >= 1;
            const stroke = useSeamStroke ? (item.fill as string) : undefined;
            const strokeWidth = useSeamStroke ? 1 : 0;
            builder.addPolygon(pts, item.fill as string, stroke, strokeWidth, item.opacity as number);
          }
          break;
        }

        case 'env_line': {
          const p0 = item.p0 as Vec3;
          const p1 = item.p1 as Vec3;
          const clipped = clipAndProjectCameraLine(p0, p1, camera, this.width, this.height);
          if (clipped) {
            stats.drawablesCount++;
            builder.addLine(
              clipped.p0.x,
              clipped.p0.y,
              clipped.p1.x,
              clipped.p1.y,
              item.stroke as string,
              item.strokeWidth as number,
              item.opacity as number
            );
          }
          break;
        }

        case 'particle': {
          const screenCenter = item.screenCenter as { x: number; y: number };
          const r = item.radius as number;
          const op = item.opacity as number;
          if (op <= 0.01) break;
          if (
            screenCenter.x + r < 0 ||
            screenCenter.x - r > this.width ||
            screenCenter.y + r < 0 ||
            screenCenter.y - r > this.height
          ) {
            break;
          }
          stats.drawablesCount++;
          stats.particlesCount++;
          builder.addCircle(
            screenCenter.x,
            screenCenter.y,
            r,
            item.fill as string,
            op
          );
          break;
        }

        case 'billboard_entity': {
          const rig = item.rig as AssetRigContract;
          const entity = item.entity as ActiveEntityState;
          const fk = item.fkTransforms as Map<string, Affine2D>;
          const ctx = item.ctx as BillboardProjectionContext;

          for (const part of rig.parts) {
            this.emitBillboardPart(
              part,
              rig,
              entity,
              fk,
              ctx,
              builder,
              frameState.palette,
              gradientCache,
              stats
            );
          }
          break;
        }

        case 'planar_entity': {
          const rig = item.rig as AssetRigContract;
          const entity = item.entity as ActiveEntityState;
          const fk = item.fkTransforms as Map<string, Affine2D>;

          for (const part of rig.parts) {
            this.emitPlanarPart(
              part,
              rig,
              entity,
              fk,
              camera,
              basis,
              builder,
              frameState.palette,
              gradientCache,
              stats
            );
          }
          break;
        }
      }
    }

    // 5. Screen-space overlays (Theatrical Cross-Fade & Lyric Caption) — appended after all depth-sorted drawables
    if (
      frameState.transitionOverlayOpacity !== undefined &&
      frameState.transitionOverlayOpacity > 0.01
    ) {
      stats.drawablesCount++;
      builder.addRect(
        0,
        0,
        this.width,
        this.height,
        frameState.palette.background,
        Math.min(1, frameState.transitionOverlayOpacity)
      );
    }

    if (
      frameState.lyric &&
      frameState.lyric.text.trim().length > 0 &&
      frameState.lyric.progress >= 0 &&
      frameState.lyric.progress < 1
    ) {
      const lyric = frameState.lyric;
      const len = lyric.text.length;
      const fontSize = Math.min(
        52 * (1 + 0.12 * lyric.emphasis),
        Math.floor((0.9 * this.width) / (0.6 * Math.max(1, len)))
      );

      // Fade over first and last 10%
      let alpha = 1.0;
      if (lyric.progress < 0.1) {
        alpha = lyric.progress / 0.1;
      } else if (lyric.progress > 0.9) {
        alpha = (1 - lyric.progress) / 0.1;
      }

      if (alpha > 0.05) {
        const textY = this.height - 84;
        const boxW = Math.min(this.width - 120, Math.max(360, Math.ceil(len * fontSize * 0.62 + 64)));
        const boxH = Math.ceil(fontSize * 1.45);
        const boxX = (this.width - boxW) / 2;
        const boxY = textY - Math.ceil(fontSize * 0.92);

        builder.addGroup({ opacity: alpha }, (b) => {
          // Semi-transparent dark backing plate for high-contrast lyric legibility
          b.addRect(boxX, boxY, boxW, boxH, '#060814', 0.78);
          stats.drawablesCount++;
          // Single crisp foreground lyric text without dark ghost shadow duplicate
          b.addText(
            lyric.text,
            this.width / 2,
            textY,
            fontSize,
            frameState.palette.primary,
            BUNDLED_FONT_FAMILY,
            'middle'
          );
        });
      }
    }

    const svg = builder.build();
    return { svg, stats };
  }

  private emitBillboardPart(
    part: RigPart,
    rig: AssetRigContract,
    entity: ActiveEntityState,
    fk: Map<string, Affine2D>,
    ctx: BillboardProjectionContext,
    builder: SvgBuilder,
    palette: FrameStateContract['palette'],
    gradientCache: Map<string, string>,
    stats: SceneBudgetStats
  ): void {
    const opacity = part.style.opacity * entity.opacity;
    if (opacity <= 0.01) return;

    const fillInfo = resolveRigPaint(
      part.style.fill,
      palette,
      part.style.lit,
      builder,
      gradientCache
    );
    if (fillInfo.isGradient) stats.gradientShapesCount++;

    let strokeColor = 'none';
    let strokeWidth = 0;
    if (part.style.stroke) {
      const strokeInfo = resolveRigPaint(
        part.style.stroke.paint,
        palette,
        false,
        builder,
        gradientCache
      );
      strokeColor = strokeInfo.fillAttr;
      strokeWidth = part.style.stroke.width * ctx.scaleFactor;
      if (strokeInfo.isGradient) stats.gradientShapesCount++;
    }

    const jointTransform = part.jointId ? fk.get(part.jointId) : undefined;
    const transformPoint = (p: Vec2): [number, number] => {
      const localP: Vec2 = [p[0] + part.localOffset2D[0], p[1] + part.localOffset2D[1]];
      const world2dP = jointTransform ? applyAffine2D(jointTransform, localP) : localP;
      return projectBillboardPoint(world2dP, ctx);
    };

    const isOffScreen = (pts: [number, number][], margin = 32): boolean => {
      if (pts.length === 0) return true;
      let allLeft = true;
      let allRight = true;
      let allTop = true;
      let allBottom = true;
      for (const [x, y] of pts) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
        if (x >= -margin) allLeft = false;
        if (x <= this.width + margin) allRight = false;
        if (y >= -margin) allTop = false;
        if (y <= this.height + margin) allBottom = false;
      }
      return allLeft || allRight || allTop || allBottom;
    };

    const optionalStroke = strokeColor !== 'none' ? strokeColor : undefined;
    const strokeMargin = Math.max(32, strokeWidth * 2);

    switch (part.shape.kind) {
      case 'rect': {
        const [w, h] = part.shape.size;
        const localPts = buildRoundedRectPoints(w, h, part.shape.rx, part.shape.ry);
        const pts: [number, number][] = localPts.map((pt) => transformPoint(pt));
        if (isOffScreen(pts, strokeMargin)) return;
        stats.drawablesCount++;
        builder.addPolygon(pts, fillInfo.fillAttr, optionalStroke, strokeWidth, opacity);
        break;
      }

      case 'ellipse': {
        const [rxLocal, ryRaw] = part.shape.radius;
        const blinkWeight = part.id.includes('eye')
          ? Math.max(0, Math.min(1, entity.morphWeights.blink ?? 0))
          : 0;
        const ryLocal = ryRaw * (1 - 0.85 * blinkWeight);
        if (
          Math.abs(rxLocal - ryLocal) < 1e-4 &&
          Math.abs(Math.abs(ctx.entityScale[0]) - Math.abs(ctx.entityScale[1])) < 1e-4 &&
          !optionalStroke
        ) {
          const center = transformPoint([0, 0]);
          const rScreen = rxLocal * ctx.scaleFactor * Math.abs(ctx.entityScale[0]);
          if (
            center[0] + rScreen < -strokeMargin ||
            center[0] - rScreen > this.width + strokeMargin ||
            center[1] + rScreen < -strokeMargin ||
            center[1] - rScreen > this.height + strokeMargin
          ) {
            return;
          }
          stats.drawablesCount++;
          builder.addCircle(center[0], center[1], rScreen, fillInfo.fillAttr, opacity);
        } else {
          const steps = 12;
          const pts: [number, number][] = [];
          for (let i = 0; i < steps; i++) {
            const angle = (i * Math.PI * 2) / steps;
            pts.push(transformPoint([rxLocal * Math.cos(angle), ryLocal * Math.sin(angle)]));
          }
          if (isOffScreen(pts, strokeMargin)) return;
          stats.drawablesCount++;
          builder.addPolygon(pts, fillInfo.fillAttr, optionalStroke, strokeWidth, opacity);
        }
        break;
      }

      case 'polygon': {
        const pts = part.shape.points.map((p) => transformPoint(p));
        if (isOffScreen(pts, strokeMargin)) return;
        stats.drawablesCount++;
        builder.addPolygon(pts, fillInfo.fillAttr, optionalStroke, strokeWidth, opacity);
        break;
      }

      case 'path': {
        const transformedPoints: [number, number][] = [];
        const transformedCommands: PathCommand[] = part.shape.segments.flatMap((seg, idx) => {
          const p0 = transformPoint(seg.p0);
          const p1 = transformPoint(seg.p1);
          const p2 = transformPoint(seg.p2);
          const p3 = transformPoint(seg.p3);
          transformedPoints.push(p0, p1, p2, p3);
          const cmds: PathCommand[] = [];
          if (idx === 0) {
            cmds.push({ cmd: 'M', x: p0[0], y: p0[1] });
          }
          cmds.push({ cmd: 'C', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], x: p3[0], y: p3[1] });
          return cmds;
        });
        if (isOffScreen(transformedPoints, strokeMargin)) return;
        if (part.shape.closed) {
          transformedCommands.push({ cmd: 'Z' });
        }
        stats.drawablesCount++;
        builder.addPath(transformedCommands, {
          fill: fillInfo.fillAttr !== 'none' ? fillInfo.fillAttr : undefined,
          stroke:
            optionalStroke !== undefined
              ? { paint: optionalStroke, width: strokeWidth, lineJoin: 'round', lineCap: 'round' }
              : undefined,
          opacity
        });
        break;
      }

      case 'morph': {
        if (!rig.morphTopology) break;
        const blended = blendMorphTargets(
          rig.morphTopology.baseSegments,
          rig.morphTopology.targets,
          entity.morphWeights,
          true
        );

        const transformedPoints: [number, number][] = [];
        const transformedCommands: PathCommand[] = blended.segments.flatMap((seg, idx) => {
          const p0 = transformPoint(seg.p0);
          const p1 = transformPoint(seg.p1);
          const p2 = transformPoint(seg.p2);
          const p3 = transformPoint(seg.p3);
          transformedPoints.push(p0, p1, p2, p3);
          const cmds: PathCommand[] = [];
          if (idx === 0) {
            cmds.push({ cmd: 'M', x: p0[0], y: p0[1] });
          }
          cmds.push({ cmd: 'C', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], x: p3[0], y: p3[1] });
          return cmds;
        });
        if (isOffScreen(transformedPoints, strokeMargin)) return;
        transformedCommands.push({ cmd: 'Z' });

        stats.drawablesCount++;
        builder.addPath(transformedCommands, {
          fill: fillInfo.fillAttr !== 'none' ? fillInfo.fillAttr : undefined,
          stroke:
            optionalStroke !== undefined
              ? { paint: optionalStroke, width: strokeWidth, lineJoin: 'round', lineCap: 'round' }
              : undefined,
          opacity
        });
        break;
      }
    }
  }

  private emitPlanarPart(
    part: RigPart,
    rig: AssetRigContract,
    entity: ActiveEntityState,
    fk: Map<string, Affine2D>,
    camera: FrameStateContract['camera'],
    basis: CameraBasis,
    builder: SvgBuilder,
    palette: FrameStateContract['palette'],
    gradientCache: Map<string, string>,
    stats: SceneBudgetStats
  ): void {
    const opacity = part.style.opacity * entity.opacity;
    if (opacity <= 0.01) return;

    const fillInfo = resolveRigPaint(
      part.style.fill,
      palette,
      part.style.lit,
      builder,
      gradientCache
    );
    if (fillInfo.isGradient) stats.gradientShapesCount++;

    const jointTransform = part.jointId ? fk.get(part.jointId) : undefined;
    const transformPointToWorld = (p: Vec2): Vec3 => {
      const localP: Vec2 = [p[0] + part.localOffset2D[0], p[1] + part.localOffset2D[1]];
      const rig2dP = jointTransform ? applyAffine2D(jointTransform, localP) : localP;
      return transformPlanarPointToWorld(
        rig2dP,
        entity.worldPosition,
        entity.worldRotationZDegrees,
        entity.scale
      );
    };

    let worldPolygon: Vec3[] = [];

    switch (part.shape.kind) {
      case 'rect': {
        const [w, h] = part.shape.size;
        const localPts = buildRoundedRectPoints(w, h, part.shape.rx, part.shape.ry);
        worldPolygon = localPts.map((pt) => transformPointToWorld(pt));
        break;
      }
      case 'polygon': {
        worldPolygon = part.shape.points.map((p) => transformPointToWorld(p));
        break;
      }
      case 'path': {
        // Flatten cubic Bezier segments into world polygon
        worldPolygon = part.shape.segments.flatMap((seg) => {
          const samples = flattenCubicBezier(seg.p0, seg.p1, seg.p2, seg.p3, 4);
          return samples.map((pt) => transformPointToWorld(pt));
        });
        break;
      }
      case 'morph': {
        if (!rig.morphTopology) return;
        const blended = blendMorphTargets(
          rig.morphTopology.baseSegments,
          rig.morphTopology.targets,
          entity.morphWeights,
          true
        );
        worldPolygon = blended.segments.flatMap((seg) => {
          const samples = flattenCubicBezier(seg.p0, seg.p1, seg.p2, seg.p3, 4);
          return samples.map((pt) => transformPointToWorld(pt));
        });
        break;
      }
      case 'ellipse': {
        const [rx, ryRaw] = part.shape.radius;
        const blinkWeight = part.id.includes('eye')
          ? Math.max(0, Math.min(1, entity.morphWeights.blink ?? 0))
          : 0;
        const ry = ryRaw * (1 - 0.85 * blinkWeight);
        const steps = 12;
        worldPolygon = [];
        for (let i = 0; i < steps; i++) {
          const angle = (i * Math.PI * 2) / steps;
          worldPolygon.push(transformPointToWorld([rx * Math.cos(angle), ry * Math.sin(angle)]));
        }
        break;
      }
    }

    if (worldPolygon.length >= 3) {
      const clipped = clipAndProjectPolygon(
        worldPolygon,
        camera,
        basis,
        this.width,
        this.height
      );
      if (clipped && clipped.vertices.length >= 3) {
        stats.drawablesCount++;
        const pts = clipped.vertices.map((v) => [v.x, v.y] as [number, number]);
        builder.addPolygon(pts, fillInfo.fillAttr, undefined, 0, opacity);
      }
    }
  }
}
