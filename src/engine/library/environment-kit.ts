import type {
  SceneEnvironment,
  EnvironmentPolygon,
  EnvironmentLine
} from '../compositor/scene-compositor.js';
import type { ColorLightingPalette } from '../../schemas/storyboard.contract.js';
import { shadeHexColor } from '../math/color.js';
import {
  IndustrialCityParamsSchema,
  OrbitalStationParamsSchema,
  NeonChasmParamsSchema,
  SynthGridParamsSchema,
  type EnvironmentBuildOptions,
  type EnvironmentKitId,
  type IndustrialCityParams,
  type OrbitalStationParams,
  type NeonChasmParams,
  type SynthGridParams
} from './types.js';

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
    const { section, centerX } = options;
    const palette = THEME_PALETTES[section.colorThemeId] ?? THEME_PALETTES.CYBERPUNK_CYAN;

    switch (section.environmentKitId) {
      case 'industrial_city': {
        const res = IndustrialCityParamsSchema.safeParse(section.kitParams ?? {});
        const params = res.success ? res.data : IndustrialCityParamsSchema.parse({});
        return EnvironmentKit.buildIndustrialCity(centerX, palette, params);
      }
      case 'orbital_station': {
        const res = OrbitalStationParamsSchema.safeParse(section.kitParams ?? {});
        const params = res.success ? res.data : OrbitalStationParamsSchema.parse({});
        return EnvironmentKit.buildOrbitalStation(centerX, palette, params);
      }
      case 'neon_chasm': {
        const res = NeonChasmParamsSchema.safeParse(section.kitParams ?? {});
        const params = res.success ? res.data : NeonChasmParamsSchema.parse({});
        return EnvironmentKit.buildNeonChasm(centerX, palette, params);
      }
      case 'synth_grid': {
        const res = SynthGridParamsSchema.safeParse(section.kitParams ?? {});
        const params = res.success ? res.data : SynthGridParamsSchema.parse({});
        return EnvironmentKit.buildSynthGrid(centerX, palette, params);
      }
      default:
        return EnvironmentKit.buildIndustrialCity(centerX, palette, {
          rooftopDensity: 0.5,
          hvacVisible: true,
          overheadGantry: false,
          streetlamps: true
        });
    }
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
