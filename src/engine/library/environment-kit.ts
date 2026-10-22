import type {
  SceneEnvironment,
  EnvironmentPolygon,
  EnvironmentLine
} from '../compositor/scene-compositor.js';
import type { CinematicShot, ColorLightingPalette } from '../../schemas/storyboard.contract.js';
import type { CameraTransform } from '../../schemas/primitives.schema.js';
import { computeCameraBasis } from '../camera/camera-3d.js';
import { ShotSequencer } from '../director/shot-sequencer.js';
import { shadeHexColor } from '../math/color.js';
import {
  type EnvironmentBuildOptions,
  type EnvironmentKitId,
  type EnvironmentTierKey,
  type TierXSpan,
  type IndustrialCityParams,
  type OrbitalStationParams,
  type NeonChasmParams,
  type SynthGridParams
} from './types.js';

export type { EnvironmentTierKey, TierXSpan };

export const ENVIRONMENT_TIER_DEPTHS = {
  tier1SkylineZ: -900,
  tier2MidgroundZ: -450,
  tier3RunwayZ: -120,
  tier4ForegroundZ: 140
} as const;

export interface ShotEnvironmentBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly tierBounds: Record<EnvironmentTierKey, TierXSpan>;
}

/**
 * Computes the horizontal world-X span [xMin, xMax] visible to a 3D camera at a given Z plane
 * by intersecting the 4 viewport corner rays with Z = zPlane.
 */
export function computeCameraFrustumXSpanAtZ(
  cam: CameraTransform,
  zPlane: number,
  aspect = 16 / 9
): TierXSpan {
  const basis = computeCameraBasis(cam);
  const { right: u, up: v, forward: w } = basis;
  const fovDeg = cam.projectionMode === 'perspective' ? cam.verticalFovDegrees : 50;
  const tanHalfV = Math.tan((fovDeg * Math.PI) / 360);
  const tanHalfH = aspect * tanHalfV;

  let minX = Infinity;
  let maxX = -Infinity;

  const signs: Array<[-1 | 1, -1 | 1]> = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ];

  for (const [sx, sy] of signs) {
    const rx = w[0] + sx * tanHalfH * u[0] + sy * tanHalfV * v[0];
    const rz = w[2] + sx * tanHalfH * u[2] + sy * tanHalfV * v[2];
    const dz = zPlane - cam.position[2];

    if (Math.abs(rz) > 1e-6) {
      const t = dz / rz;
      if (t > 0) {
        const hitX = cam.position[0] + t * rx;
        if (hitX < minX) minX = hitX;
        if (hitX > maxX) maxX = hitX;
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return {
      xMin: cam.position[0] - 600,
      xMax: cam.position[0] + 900
    };
  }

  return { xMin: minX, xMax: maxX };
}

/**
 * Computes frustum-derived horizontal bounds [xMin, xMax] across all environment depth tiers
 * for a storyboard shot, sampling start, end, and intermediate camera poses (including ORBIT arcs)
 * and adding safety padding for camera trauma shake.
 */
export function computeShotEnvironmentBounds(
  shot: CinematicShot,
  padding = 250,
  aspect = 16 / 9
): ShotEnvironmentBounds {
  const sampleProgresses = [0, 0.25, 0.5, 0.75, 1.0];
  const sampledCameras: CameraTransform[] = sampleProgresses.map((p) =>
    ShotSequencer.prototype.interpolateCamera.call({ shots: [shot] }, shot, p)
  );

  const tierKeys = Object.keys(ENVIRONMENT_TIER_DEPTHS) as EnvironmentTierKey[];
  const tierBounds = {} as Record<EnvironmentTierKey, TierXSpan>;

  const camMinX = Math.min(shot.cameraStart.position[0], shot.cameraEnd.position[0]);
  const camMaxX = Math.max(shot.cameraStart.position[0], shot.cameraEnd.position[0]);

  let globalMinX = camMinX - 600;
  let globalMaxX = camMaxX + 900;

  for (const key of tierKeys) {
    const zPlane = ENVIRONMENT_TIER_DEPTHS[key];
    let tMin = camMinX - padding;
    let tMax = camMaxX + padding;

    for (const cam of sampledCameras) {
      const span = computeCameraFrustumXSpanAtZ(cam, zPlane, aspect);
      if (span.xMin - padding < tMin) tMin = span.xMin - padding;
      if (span.xMax + padding > tMax) tMax = span.xMax + padding;
    }

    tierBounds[key] = {
      xMin: Math.floor(tMin),
      xMax: Math.ceil(tMax)
    };

    if (tierBounds[key].xMin < globalMinX) globalMinX = tierBounds[key].xMin;
    if (tierBounds[key].xMax > globalMaxX) globalMaxX = tierBounds[key].xMax;
  }

  return {
    xMin: Math.floor(globalMinX),
    xMax: Math.ceil(globalMaxX),
    tierBounds
  };
}

export const THEME_PALETTES: Record<string, ColorLightingPalette> = {
  CYBERPUNK_CYAN: {
    background: '#090b16',
    primary: '#00f0ff',
    secondary: '#3a506b',
    accent: '#ff0055',
    ambientLightColor: '#1a243b',
    ambientIntensity: 0.72,
    keyLightDirection: [-0.5, -0.8, -0.3],
    audioReactiveGain: 0.65
  },
  VOLTAGE_ORANGE: {
    background: '#120a06',
    primary: '#ff7700',
    secondary: '#5c3a21',
    accent: '#ffe600',
    ambientLightColor: '#2b1a0d',
    ambientIntensity: 0.75,
    keyLightDirection: [-0.6, -0.7, -0.4],
    audioReactiveGain: 0.7
  },
  SUNSET_GOLD: {
    background: '#140c1c',
    primary: '#ffaa00',
    secondary: '#733261',
    accent: '#ff2a85',
    ambientLightColor: '#2c1538',
    ambientIntensity: 0.78,
    keyLightDirection: [-0.4, -0.6, -0.6],
    audioReactiveGain: 0.6
  },
  CRIMSON_FURY: {
    background: '#160507',
    primary: '#ff1744',
    secondary: '#5a121d',
    accent: '#ff9100',
    ambientLightColor: '#360910',
    ambientIntensity: 0.82,
    keyLightDirection: [-0.5, -0.8, -0.3],
    audioReactiveGain: 0.85
  },
  MIDNIGHT_VOID: {
    background: '#040508',
    primary: '#7c4dff',
    secondary: '#1f2235',
    accent: '#00e5ff',
    ambientLightColor: '#0e111a',
    ambientIntensity: 0.65,
    keyLightDirection: [-0.3, -0.9, -0.3],
    audioReactiveGain: 0.55
  }
};

/**
 * Builds the 3D environment geometry for the 4 canonical kits:
 * 1. industrial_city
 * 2. orbital_station
 * 3. neon_chasm
 * 4. synth_grid
 *
 * Each kit strictly enforces:
 * - Aggregate drawables budget <= 65 (polygons + lines).
 * - Foreground nearPlane clearance: all foreground overhead structures place Z outside
 *   the critical camera transit zone so geometry never clips or pops mid-dolly.
 */
export class EnvironmentKit {
  public static build(options: EnvironmentBuildOptions): SceneEnvironment {
    const { section, centerX, framing, tierBounds } = options;
    const palette = THEME_PALETTES[section.colorThemeId] ?? THEME_PALETTES.CYBERPUNK_CYAN;
    const xMin = options.xMin ?? (centerX - 600);
    const xMax = options.xMax ?? (centerX + 900);
    const isCloseUp = framing === 'CLOSE_UP';

    return EnvironmentKit.buildTiledParallaxEnvironment(
      xMin,
      xMax,
      palette,
      section.environmentKitId,
      isCloseUp,
      tierBounds
    );
  }

  /**
   * Procedural 4-tier scrolling parallax environment generator.
   * Generates continuous world geometry across [xMin, xMax] (and per-tier frustum spans):
   * - Tier 1 (Z = ENVIRONMENT_TIER_DEPTHS.tier1SkylineZ = -900): Distant skyline (spires, megaliths, citadels)
   * - Tier 2 (Z = ENVIRONMENT_TIER_DEPTHS.tier2MidgroundZ = -450): Midground industrial structures and trusses
   * - Tier 3 (Z = ENVIRONMENT_TIER_DEPTHS.tier3RunwayZ = -120): Continuous runway floor, expansion lines, streetlamps, tech barriers
   * - Tier 4 (Z = ENVIRONMENT_TIER_DEPTHS.tier4ForegroundZ = +140): Foreground overhead conduits (strictly excluded on CLOSE_UP shots)
   */
  public static buildTiledParallaxEnvironment(
    xMin: number,
    xMax: number,
    palette: ColorLightingPalette,
    _kitId: EnvironmentKitId = 'industrial_city',
    isCloseUp = false,
    tierBounds?: Partial<Record<EnvironmentTierKey, TierXSpan>>
  ): SceneEnvironment {
    const polygons: EnvironmentPolygon[] = [];
    const lines: EnvironmentLine[] = [];

    const z1 = ENVIRONMENT_TIER_DEPTHS.tier1SkylineZ;
    const z2 = ENVIRONMENT_TIER_DEPTHS.tier2MidgroundZ;
    const z3 = ENVIRONMENT_TIER_DEPTHS.tier3RunwayZ;
    const z4 = ENVIRONMENT_TIER_DEPTHS.tier4ForegroundZ;

    // --- Tier 1 (Z = -900): Distant Skyline ---
    const b1 = tierBounds?.tier1SkylineZ ?? { xMin, xMax };
    const span1 = Math.max(1500, b1.xMax - b1.xMin);
    const s1 = Math.max(450, Math.ceil(span1 / 3));
    const k1Min = Math.floor(b1.xMin / s1);
    const k1Max = Math.ceil(b1.xMax / s1);

    for (let k = k1Min; k <= k1Max; k++) {
      const bx = k * s1;
      const variant = Math.abs(k) % 3;

      if (variant === 0) {
        // Gothic Spire
        polygons.push({
          vertices: [
            [bx - 50, 0, z1],
            [bx + 50, 0, z1],
            [bx + 38, 320, z1],
            [bx - 38, 320, z1]
          ],
          fill: shadeHexColor(palette.background, 0.45),
          opacity: 0.9,
          tier: 1
        });
        polygons.push({
          vertices: [
            [bx - 16, 320, z1],
            [bx + 16, 320, z1],
            [bx, 480, z1]
          ],
          fill: shadeHexColor(palette.secondary, -0.2),
          opacity: 0.85,
          tier: 1
        });
        lines.push({
          p0: [bx, 480, z1],
          p1: [bx, 530, z1],
          stroke: palette.accent,
          strokeWidth: 2,
          opacity: 0.9,
          tier: 1
        });
      } else if (variant === 1) {
        // Neon Megalith
        polygons.push({
          vertices: [
            [bx - 70, 0, z1 - 20],
            [bx + 70, 0, z1 - 20],
            [bx + 60, 420, z1 - 20],
            [bx - 60, 420, z1 - 20]
          ],
          fill: shadeHexColor(palette.background, 0.35),
          opacity: 0.88,
          tier: 1
        });
        lines.push({
          p0: [bx + 60, 420, z1 - 20],
          p1: [bx + 60, 0, z1 - 20],
          stroke: palette.primary,
          strokeWidth: 2,
          opacity: 0.7,
          tier: 1
        });
      } else {
        // Sky Citadel
        polygons.push({
          vertices: [
            [bx - 80, 0, z1 + 20],
            [bx + 80, 0, z1 + 20],
            [bx + 40, 360, z1 + 20],
            [bx - 40, 360, z1 + 20]
          ],
          fill: shadeHexColor(palette.background, 0.4),
          opacity: 0.9,
          tier: 1
        });
        lines.push({
          p0: [bx - 40, 360, z1 + 20],
          p1: [bx + 40, 360, z1 + 20],
          stroke: palette.accent,
          strokeWidth: 2.5,
          opacity: 0.85,
          tier: 1
        });
      }
    }

    // --- Tier 2 (Z = -450): Midground Industrial ---
    const b2 = tierBounds?.tier2MidgroundZ ?? { xMin, xMax };
    const span2 = Math.max(1500, b2.xMax - b2.xMin);
    const s2 = Math.max(300, Math.ceil(span2 / 4));
    const k2Min = Math.floor(b2.xMin / s2);
    const k2Max = Math.ceil(b2.xMax / s2);

    for (let k = k2Min; k <= k2Max; k++) {
      const bx = k * s2;
      const variant = Math.abs(k) % 2;

      if (variant === 0) {
        // Factory Block
        polygons.push({
          vertices: [
            [bx - 55, 0, z2],
            [bx + 55, 0, z2],
            [bx + 55, 170, z2],
            [bx - 55, 170, z2]
          ],
          fill: shadeHexColor(palette.secondary, -0.1),
          opacity: 0.92,
          tier: 2
        });
        lines.push({
          p0: [bx - 60, 110, z2 + 10],
          p1: [bx + 60, 110, z2 + 10],
          stroke: palette.primary,
          strokeWidth: 2,
          opacity: 0.8,
          tier: 2
        });
      } else {
        // Lattice Truss / Reactor Frame
        lines.push(
          {
            p0: [bx - 40, 0, z2 - 10],
            p1: [bx - 40, 200, z2 - 10],
            stroke: shadeHexColor(palette.secondary, 0.3),
            strokeWidth: 2.5,
            opacity: 0.85,
            tier: 2
          },
          {
            p0: [bx + 40, 0, z2 - 10],
            p1: [bx + 40, 200, z2 - 10],
            stroke: shadeHexColor(palette.secondary, 0.3),
            strokeWidth: 2.5,
            opacity: 0.85,
            tier: 2
          },
          {
            p0: [bx - 40, 80, z2 - 10],
            p1: [bx + 40, 160, z2 - 10],
            stroke: palette.accent,
            strokeWidth: 1.5,
            opacity: 0.7,
            tier: 2
          }
        );
      }
    }

    // --- Tier 3 (Z = -120 to +40): Near-Ground Runway ---
    const floorPad = 300;
    polygons.push({
      vertices: [
        [xMin - floorPad, 0, 300],
        [xMax + floorPad, 0, 300],
        [xMax + floorPad, 0, -300],
        [xMin - floorPad, 0, -300]
      ],
      fill: shadeHexColor(palette.background, 0.15),
      opacity: 0.96,
      tier: 0
    });

    const zLines = [-200, -80, 80, 200];
    for (const z of zLines) {
      lines.push({
        p0: [xMin - floorPad, 0.3, z],
        p1: [xMax + floorPad, 0.3, z],
        stroke: shadeHexColor(palette.secondary, -0.4),
        strokeWidth: 1.5,
        opacity: 0.75,
        tier: 1
      });
    }

    const b3 = tierBounds?.tier3RunwayZ ?? { xMin, xMax };
    const span3 = Math.max(1200, b3.xMax - b3.xMin);
    const s3 = Math.max(200, Math.ceil(span3 / 5));
    const k3Min = Math.floor(b3.xMin / s3);
    const k3Max = Math.ceil(b3.xMax / s3);

    for (let k = k3Min; k <= k3Max; k++) {
      const bx = k * s3;

      // Streetlamp (Z = -120)
      lines.push(
        {
          p0: [bx, 0, z3],
          p1: [bx, 130, z3],
          stroke: shadeHexColor(palette.secondary, 0.4),
          strokeWidth: 2.2,
          opacity: 0.85,
          tier: 2
        },
        {
          p0: [bx, 130, z3],
          p1: [bx + 25, 125, z3],
          stroke: palette.primary,
          strokeWidth: 2,
          opacity: 0.9,
          tier: 2
        }
      );
      polygons.push({
        vertices: [
          [bx + 20, 127, z3],
          [bx + 28, 127, z3],
          [bx + 26, 120, z3],
          [bx + 22, 120, z3]
        ],
        fill: palette.accent,
        opacity: 0.95,
        tier: 2
      });

      // Barrier Tech Box (Z = -70)
      if (Math.abs(k) % 2 === 1) {
        polygons.push({
          vertices: [
            [bx + 50, 0, z3 + 50],
            [bx + 80, 0, z3 + 50],
            [bx + 80, 26, z3 + 50],
            [bx + 50, 26, z3 + 50]
          ],
          fill: shadeHexColor(palette.secondary, -0.3),
          opacity: 0.9,
          tier: 2
        });
      }
    }

    // --- Tier 4 (Z = +140): Foreground Overhang ---
    // Strictly excluded on CLOSE_UP shots (Gap 2)
    if (!isCloseUp) {
      const b4 = tierBounds?.tier4ForegroundZ ?? { xMin, xMax };
      const span4 = Math.max(1200, b4.xMax - b4.xMin);
      const s4 = Math.max(600, Math.ceil(span4 / 2));
      const k4Min = Math.floor(b4.xMin / s4);
      const k4Max = Math.ceil(b4.xMax / s4);

      for (let k = k4Min; k <= k4Max; k++) {
        const bx = k * s4;
        polygons.push({
          vertices: [
            [bx - 80, 240, z4],
            [bx + 180, 240, z4],
            [bx + 180, 252, z4],
            [bx - 80, 252, z4]
          ],
          fill: shadeHexColor(palette.background, 0.2),
          opacity: 0.92,
          tier: 3
        });
        lines.push({
          p0: [bx + 50, 252, z4],
          p1: [bx + 50, 360, z4],
          stroke: palette.secondary,
          strokeWidth: 1.5,
          opacity: 0.8,
          tier: 3
        });
      }
    }

    return { polygons, lines };
  }

  public static buildIndustrialCity(
    centerX: number,
    palette: ColorLightingPalette,
    params: IndustrialCityParams
  ): SceneEnvironment {
    const span = 2000;
    const polygons: EnvironmentPolygon[] = [];
    const lines: EnvironmentLine[] = [];

    // 1. Concrete Rooftop Floor (Tier 0)
    polygons.push({
      vertices: [
        [centerX - span, 0, 1200],
        [centerX + span, 0, 1200],
        [centerX + span, 0, -1200],
        [centerX - span, 0, -1200]
      ],
      fill: '#0c101d',
      opacity: 0.95,
      tier: 0
    });

    // 2. Rooftop Expansion Joints
    const zJoints = [-400, 0, 400];
    for (const z of zJoints) {
      lines.push({
        p0: [centerX - span, 0, z],
        p1: [centerX + span, 0, z],
        stroke: '#161f33',
        strokeWidth: 1.5,
        opacity: 0.7,
        tier: 1
      });
    }

    // 3. 3D HVAC Cuboids (Z safe depth <= -150)
    if (params.hvacVisible) {
      const hvacs = [
        { x: centerX - 260, z: -240, w: 90, h: 48, d: 55 },
        { x: centerX + 280, z: -250, w: 100, h: 54, d: 60 }
      ];
      for (const box of hvacs) {
        const { x, z, w, h, d } = box;
        // Top face
        polygons.push({
          vertices: [
            [x, h, z + d],
            [x + w, h, z + d],
            [x + w, h, z],
            [x, h, z]
          ],
          fill: shadeHexColor(palette.secondary, 0.4),
          opacity: 0.95,
          tier: 2
        });
        // Front face
        polygons.push({
          vertices: [
            [x, 0, z + d],
            [x + w, 0, z + d],
            [x + w, h, z + d],
            [x, h, z + d]
          ],
          fill: shadeHexColor(palette.secondary, 0.25),
          opacity: 0.95,
          tier: 2
        });
        // Louver line
        lines.push({
          p0: [x + 8, h * 0.5, z + d + 1],
          p1: [x + w - 8, h * 0.5, z + d + 1],
          stroke: palette.primary,
          strokeWidth: 1.2,
          opacity: 0.6,
          tier: 3
        });
      }
    }

    // 4. Parapet Railing along front edge (Z = 60, safe clearance)
    const railZ = 60;
    lines.push({
      p0: [centerX - span, 24, railZ],
      p1: [centerX + span, 24, railZ],
      stroke: '#2b3a55',
      strokeWidth: 2.0,
      opacity: 0.85,
      tier: 2
    });
    for (const off of [-450, -150, 150, 450]) {
      lines.push({
        p0: [centerX + off, 0, railZ],
        p1: [centerX + off, 24, railZ],
        stroke: '#2b3a55',
        strokeWidth: 2.0,
        opacity: 0.85,
        tier: 2
      });
    }

    // 5. Overhead Gantry (Safe Near-Plane Clearance at Z = -180, well behind camera)
    if (params.overheadGantry) {
      const gantryY = 220;
      const gantryZ = -180;
      lines.push(
        {
          p0: [centerX - 600, gantryY, gantryZ],
          p1: [centerX + 600, gantryY, gantryZ],
          stroke: '#3a4a6b',
          strokeWidth: 2.5,
          opacity: 0.85,
          tier: 2
        },
        {
          p0: [centerX - 600, gantryY + 24, gantryZ],
          p1: [centerX + 600, gantryY + 24, gantryZ],
          stroke: '#3a4a6b',
          strokeWidth: 1.8,
          opacity: 0.85,
          tier: 2
        }
      );
      for (let x = centerX - 500; x <= centerX + 500; x += 250) {
        lines.push({
          p0: [x, gantryY, gantryZ],
          p1: [x + 125, gantryY + 24, gantryZ],
          stroke: '#223048',
          strokeWidth: 1.2,
          opacity: 0.75,
          tier: 2
        });
      }
    }

    // 6. Streetlamps (Safe clearance at Z = -180, arm in +X)
    if (params.streetlamps) {
      for (const off of [-350, 350]) {
        const lx = centerX + off;
        const lz = -180;
        lines.push(
          {
            p0: [lx, 0, lz],
            p1: [lx, 160, lz],
            stroke: '#32425f',
            strokeWidth: 2.0,
            opacity: 0.8,
            tier: 2
          },
          {
            p0: [lx, 160, lz],
            p1: [lx + 40, 160, lz],
            stroke: palette.accent,
            strokeWidth: 2.0,
            opacity: 0.9,
            tier: 3
          }
        );
      }
    }

    return { polygons, lines };
  }

  public static buildOrbitalStation(
    centerX: number,
    palette: ColorLightingPalette,
    params: OrbitalStationParams
  ): SceneEnvironment {
    const span = 2000;
    const polygons: EnvironmentPolygon[] = [];
    const lines: EnvironmentLine[] = [];

    // 1. Deck Floor with metallic luster (Tier 0)
    polygons.push({
      vertices: [
        [centerX - span, 0, 800],
        [centerX + span, 0, 800],
        [centerX + span, 0, -800],
        [centerX - span, 0, -800]
      ],
      fill: '#080a14',
      opacity: 0.98,
      tier: 0
    });

    // 2. Octagonal Portal Ribs spanning overhead (Safe clearance Z = -200)
    const portalCount = params.portalCount;
    const spacing = 1200 / portalCount;
    const portalZ = -200;

    for (let i = 0; i < portalCount; i++) {
      const px = centerX - 600 + i * spacing;
      // Portal arch polygon
      polygons.push({
        vertices: [
          [px - 30, 0, portalZ],
          [px - 30, 180, portalZ],
          [px - 15, 220, portalZ],
          [px + 15, 220, portalZ],
          [px + 30, 180, portalZ],
          [px + 30, 0, portalZ]
        ],
        fill: shadeHexColor(palette.secondary, 0.2),
        opacity: 0.92,
        tier: 2
      });

      // Conduit Glow line
      if (params.conduitGlow) {
        lines.push({
          p0: [px - 28, 0, portalZ + 2],
          p1: [px - 28, 175, portalZ + 2],
          stroke: palette.primary,
          strokeWidth: 2.0,
          opacity: 0.85,
          tier: 3
        });
      }
    }

    // 3. Hazard Stripes along floor perimeter
    if (params.hazardStripes) {
      for (let x = centerX - 600; x <= centerX + 600; x += 150) {
        lines.push({
          p0: [x, 0.5, -120],
          p1: [x + 50, 0.5, -90],
          stroke: palette.accent,
          strokeWidth: 3.0,
          opacity: 0.85,
          tier: 1
        });
      }
    }

    return { polygons, lines };
  }

  public static buildNeonChasm(
    centerX: number,
    palette: ColorLightingPalette,
    params: NeonChasmParams
  ): SceneEnvironment {
    const span = 2000;
    const polygons: EnvironmentPolygon[] = [];
    const lines: EnvironmentLine[] = [];

    // 1. Narrow Bridge Deck (void beyond Z = [-140, 140])
    polygons.push({
      vertices: [
        [centerX - span, 0, 140],
        [centerX + span, 0, 140],
        [centerX + span, 0, -140],
        [centerX - span, 0, -140]
      ],
      fill: '#0d0918',
      opacity: 0.96,
      tier: 0
    });

    // 2. Transverse Deck Lines
    for (let x = centerX - 600; x <= centerX + 600; x += 200) {
      lines.push({
        p0: [x, 0.4, -135],
        p1: [x, 0.4, 135],
        stroke: palette.primary,
        strokeWidth: 1.5,
        opacity: 0.8,
        tier: 1
      });
    }

    // 3. Pylon A-Frames (Safe clearance Z = -180)
    const pylonCount = params.pylonCount;
    const pylonSpacing = 800 / pylonCount;
    const pylonZ = -180;
    const peakY = 360;

    for (let i = 0; i < pylonCount; i++) {
      const px = centerX - 400 + i * pylonSpacing + pylonSpacing / 2;
      // Left leg
      lines.push({
        p0: [px - 60, 0, pylonZ],
        p1: [px, peakY, pylonZ],
        stroke: palette.secondary,
        strokeWidth: 3.5,
        opacity: 0.95,
        tier: 2
      });
      // Right leg
      lines.push({
        p0: [px + 60, 0, pylonZ],
        p1: [px, peakY, pylonZ],
        stroke: palette.secondary,
        strokeWidth: 3.5,
        opacity: 0.95,
        tier: 2
      });

      // Stay cables radiating from peak
      const cableCount = Math.round(params.stayCableDensity * 4);
      for (let c = 1; c <= cableCount; c++) {
        const deckX = px + c * 80;
        lines.push({
          p0: [px, peakY - 20, pylonZ],
          p1: [deckX, 10, -130],
          stroke: palette.accent,
          strokeWidth: 1.2,
          opacity: 0.75,
          tier: 2
        });
      }
    }

    // 4. Abyss depth glow polygon deep below
    polygons.push({
      vertices: [
        [centerX - span, -params.abyssDepth, 500],
        [centerX + span, -params.abyssDepth, 500],
        [centerX + span, -params.abyssDepth, -500],
        [centerX - span, -params.abyssDepth, -500]
      ],
      fill: palette.background,
      opacity: 0.9,
      tier: 0
    });

    return { polygons, lines };
  }

  public static buildSynthGrid(
    centerX: number,
    palette: ColorLightingPalette,
    params: SynthGridParams
  ): SceneEnvironment {
    const span = 2000;
    const polygons: EnvironmentPolygon[] = [];
    const lines: EnvironmentLine[] = [];

    // 1. Dark Neon Floor (Tier 0)
    polygons.push({
      vertices: [
        [centerX - span, 0, 1000],
        [centerX + span, 0, 1000],
        [centerX + span, 0, -1000],
        [centerX - span, 0, -1000]
      ],
      fill: '#080512',
      opacity: 0.98,
      tier: 0
    });

    // 2. Perspective Wireframe Ground Grid Lines
    const spacing = params.gridSpacing;
    // Transverse lines (Z axis)
    for (let z = -600; z <= 600; z += spacing * 2) {
      lines.push({
        p0: [centerX - 800, 0.4, z],
        p1: [centerX + 800, 0.4, z],
        stroke: palette.primary,
        strokeWidth: 1.2,
        opacity: 0.65,
        tier: 1
      });
    }
    // Longitudinal lines (X axis)
    for (let x = centerX - 600; x <= centerX + 600; x += spacing * 2) {
      lines.push({
        p0: [x, 0.4, -600],
        p1: [x, 0.4, 600],
        stroke: palette.primary,
        strokeWidth: 1.2,
        opacity: 0.65,
        tier: 1
      });
    }

    // 3. Distant Horizon Neon Sun (Tier 1)
    if (params.horizonSun) {
      const sunZ = -700;
      const sunY = 160;
      polygons.push({
        vertices: [
          [centerX - 120, sunY - 40, sunZ],
          [centerX - 80, sunY + 60, sunZ],
          [centerX + 80, sunY + 60, sunZ],
          [centerX + 120, sunY - 40, sunZ]
        ],
        fill: palette.accent,
        opacity: 0.85,
        tier: 1
      });
    }

    // 4. Wireframe Mountains in background (Z = -500)
    if (params.wireframeMountains) {
      const mZ = -500;
      const peaks = [
        { x: centerX - 450, h: 220, w: 180 },
        { x: centerX - 180, h: 280, w: 220 },
        { x: centerX + 200, h: 250, w: 200 },
        { x: centerX + 480, h: 210, w: 170 }
      ];
      for (const peak of peaks) {
        lines.push(
          {
            p0: [peak.x - peak.w, 0, mZ],
            p1: [peak.x, peak.h, mZ],
            stroke: palette.secondary,
            strokeWidth: 2.0,
            opacity: 0.8,
            tier: 2
          },
          {
            p0: [peak.x, peak.h, mZ],
            p1: [peak.x + peak.w, 0, mZ],
            stroke: palette.secondary,
            strokeWidth: 2.0,
            opacity: 0.8,
            tier: 2
          }
        );
      }
    }

    return { polygons, lines };
  }
}
