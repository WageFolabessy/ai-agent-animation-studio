import type {
  SceneEnvironment,
  EnvironmentPolygon,
  EnvironmentLine
} from '../compositor/scene-compositor.js';
import type { ColorLightingPalette } from '../../schemas/storyboard.contract.js';
import type { TheatricalSetId } from '../../schemas/stage.contract.js';
import { shadeHexColor } from '../math/color.js';
import {
  ENVIRONMENT_TIER_DEPTHS,
  type EnvironmentTierKey,
  type TierXSpan
} from './environment-kit.js';

export interface StageEnvironmentBuildOptions {
  readonly setId: TheatricalSetId;
  readonly centerX: number;
  readonly palette: ColorLightingPalette;
  readonly isCloseUp?: boolean;
  readonly xMin?: number;
  readonly xMax?: number;
  readonly tierBounds?: Partial<Record<EnvironmentTierKey, TierXSpan>>;
  readonly kitParams?: Record<string, string | number | boolean>;
}

/**
 * Generates discrete 2.5D theatrical vector sets (Pillar 1 of Theatrical Narrative Architecture):
 * - INTERIOR_ROOM: Intimate room with moonlit window pane, study desk, floor lamp, and timber floor.
 * - RAINY_STREET: Wet asphalt floor with specular reflections, brick facade, neon sign, and vintage streetlamp light cone.
 * - PARK_BENCH: Slatted vector park bench, autumn tree silhouettes, hills, and wrought-iron lantern.
 * - CONCERT_STAGE: Elevated stage deck, spotlight truss towers, amp stacks, mic stand, and foreground crowd silhouette.
 * - GOTHIC_CATHEDRAL: Pointed stained-glass rose window, ribbed gothic colonnade arches, stone altar, and vaulted ceiling.
 *
 * Strictly enforces:
 * - Aggregate drawables (polygons + lines) <= 60 (well within the <= 65 compositor budget).
 * - Full horizontal frustum coverage across all 4 depth tiers.
 * - Foreground near-plane safety (Z = +140, omitted on CLOSE_UP).
 */
export class StageEnvironmentGenerator {
  public static buildSet(options: StageEnvironmentBuildOptions): SceneEnvironment {
    const { setId, centerX, palette, isCloseUp = false, tierBounds } = options;
    const xMin = options.xMin ?? centerX - 600;
    const xMax = options.xMax ?? centerX + 900;

    const polygons: EnvironmentPolygon[] = [];
    const lines: EnvironmentLine[] = [];

    const z1 = ENVIRONMENT_TIER_DEPTHS.tier1SkylineZ; // -900
    const z2 = ENVIRONMENT_TIER_DEPTHS.tier2MidgroundZ; // -450
    const z3 = ENVIRONMENT_TIER_DEPTHS.tier3RunwayZ; // -120
    const z4 = ENVIRONMENT_TIER_DEPTHS.tier4ForegroundZ; // +140

    // --- Tier 1 (Z = -900): Distant Backdrop / Skyline / Window ---
    const b1 = tierBounds?.tier1SkylineZ ?? { xMin, xMax };
    const span1 = Math.max(1500, b1.xMax - b1.xMin);
    const s1 = Math.max(450, Math.ceil(span1 / 3));
    const k1Min = Math.floor(b1.xMin / s1);
    const k1Max = Math.ceil(b1.xMax / s1);

    for (let k = k1Min; k <= k1Max; k++) {
      const bx = k * s1;
      const variant = Math.abs(k) % 3;

      switch (setId) {
        case 'INTERIOR_ROOM': {
          // Moonlit casement window aperture + night sky pane
          polygons.push({
            vertices: [
              [bx - 75, 90, z1],
              [bx + 75, 90, z1],
              [bx + 75, 310, z1],
              [bx - 75, 310, z1]
            ],
            fill: shadeHexColor(palette.background, 0.48),
            opacity: 0.92,
            tier: 1
          });
          lines.push({
            p0: [bx - 75, 200, z1 + 5],
            p1: [bx + 75, 200, z1 + 5],
            stroke: palette.primary,
            strokeWidth: 2.0,
            opacity: 0.85,
            tier: 1
          });
          break;
        }

        case 'RAINY_STREET': {
          // Mist-shrouded urban tenement block silhouette + rooftop water-tower line
          const h = variant === 0 ? 380 : variant === 1 ? 440 : 340;
          polygons.push({
            vertices: [
              [bx - 85, 0, z1],
              [bx + 85, 0, z1],
              [bx + 80, h, z1],
              [bx - 80, h, z1]
            ],
            fill: shadeHexColor(palette.background, 0.34),
            opacity: 0.9,
            tier: 1
          });
          lines.push({
            p0: [bx - 50, h - 40, z1 + 5],
            p1: [bx + 50, h - 40, z1 + 5],
            stroke: palette.secondary,
            strokeWidth: 2.0,
            opacity: 0.78,
            tier: 1
          });
          break;
        }

        case 'PARK_BENCH': {
          // Rolling twilight hill silhouette + horizon starlight rim
          const crestY = variant === 1 ? 260 : 210;
          polygons.push({
            vertices: [
              [bx - 120, 0, z1],
              [bx + 120, 0, z1],
              [bx + 70, crestY, z1],
              [bx - 60, crestY + 25, z1]
            ],
            fill: shadeHexColor(palette.background, 0.36),
            opacity: 0.88,
            tier: 1
          });
          lines.push({
            p0: [bx - 60, crestY + 25, z1 + 5],
            p1: [bx + 70, crestY, z1 + 5],
            stroke: palette.primary,
            strokeWidth: 1.8,
            opacity: 0.75,
            tier: 1
          });
          break;
        }

        case 'CONCERT_STAGE': {
          // Arena lighting truss tower + diagonal spotlight cone
          polygons.push({
            vertices: [
              [bx - 35, 360, z1],
              [bx + 35, 360, z1],
              [bx + 110, 0, z1],
              [bx - 110, 0, z1]
            ],
            fill: palette.primary,
            opacity: 0.24,
            tier: 1,
            isTwoSided: true
          });
          lines.push({
            p0: [bx, 0, z1 + 8],
            p1: [bx, 380, z1 + 8],
            stroke: palette.accent,
            strokeWidth: 2.5,
            opacity: 0.9,
            tier: 1
          });
          break;
        }

        case 'GOTHIC_CATHEDRAL': {
          // Pointed gothic stained-glass lancet arch + rose tracery bar
          polygons.push({
            vertices: [
              [bx - 65, 40, z1],
              [bx + 65, 40, z1],
              [bx + 65, 320, z1],
              [bx, 450, z1],
              [bx - 65, 320, z1]
            ],
            fill: shadeHexColor(palette.accent, -0.25),
            opacity: 0.86,
            tier: 1
          });
          lines.push({
            p0: [bx, 40, z1 + 6],
            p1: [bx, 450, z1 + 6],
            stroke: palette.primary,
            strokeWidth: 2.2,
            opacity: 0.88,
            tier: 1
          });
          break;
        }
      }
    }

    // --- Tier 2 (Z = -450): Midground Architectural Framing ---
    const b2 = tierBounds?.tier2MidgroundZ ?? { xMin, xMax };
    const span2 = Math.max(1500, b2.xMax - b2.xMin);
    const s2 = Math.max(300, Math.ceil(span2 / 4));
    const k2Min = Math.floor(b2.xMin / s2);
    const k2Max = Math.ceil(b2.xMax / s2);

    for (let k = k2Min; k <= k2Max; k++) {
      const bx = k * s2;

      switch (setId) {
        case 'INTERIOR_ROOM': {
          // Wainscoted interior wall panel + bookshelf / cornice trim
          polygons.push({
            vertices: [
              [bx - 65, 0, z2],
              [bx + 65, 0, z2],
              [bx + 65, 195, z2],
              [bx - 65, 195, z2]
            ],
            fill: shadeHexColor(palette.secondary, -0.18),
            opacity: 0.92,
            tier: 2
          });
          lines.push({
            p0: [bx - 65, 140, z2 + 6],
            p1: [bx + 65, 140, z2 + 6],
            stroke: palette.accent,
            strokeWidth: 2.0,
            opacity: 0.82,
            tier: 2
          });
          break;
        }

        case 'RAINY_STREET': {
          // Wet brick alley facade + glowing neon sign strip
          polygons.push({
            vertices: [
              [bx - 60, 0, z2],
              [bx + 60, 0, z2],
              [bx + 60, 210, z2],
              [bx - 60, 210, z2]
            ],
            fill: shadeHexColor(palette.secondary, -0.12),
            opacity: 0.92,
            tier: 2
          });
          lines.push({
            p0: [bx - 42, 155, z2 + 8],
            p1: [bx + 42, 155, z2 + 8],
            stroke: palette.accent,
            strokeWidth: 2.8,
            opacity: 0.92,
            tier: 2
          });
          break;
        }

        case 'PARK_BENCH': {
          // Stylized autumn tree canopy polygon + trunk line
          polygons.push({
            vertices: [
              [bx - 58, 95, z2],
              [bx + 58, 95, z2],
              [bx + 72, 165, z2],
              [bx, 225, z2],
              [bx - 72, 165, z2]
            ],
            fill: shadeHexColor(palette.secondary, 0.12),
            opacity: 0.9,
            tier: 2
          });
          lines.push({
            p0: [bx, 0, z2 + 4],
            p1: [bx, 135, z2 + 4],
            stroke: shadeHexColor(palette.secondary, -0.35),
            strokeWidth: 3.2,
            opacity: 0.92,
            tier: 2
          });
          break;
        }

        case 'CONCERT_STAGE': {
          // Backline amplifier stack + LED riser bar
          polygons.push({
            vertices: [
              [bx - 52, 0, z2],
              [bx + 52, 0, z2],
              [bx + 52, 165, z2],
              [bx - 52, 165, z2]
            ],
            fill: shadeHexColor(palette.secondary, -0.2),
            opacity: 0.94,
            tier: 2
          });
          lines.push({
            p0: [bx - 48, 125, z2 + 8],
            p1: [bx + 48, 125, z2 + 8],
            stroke: palette.primary,
            strokeWidth: 2.4,
            opacity: 0.9,
            tier: 2
          });
          break;
        }

        case 'GOTHIC_CATHEDRAL': {
          // Ribbed gothic stone arch column + pointed vault rib
          polygons.push({
            vertices: [
              [bx - 36, 0, z2],
              [bx + 36, 0, z2],
              [bx + 28, 240, z2],
              [bx, 285, z2],
              [bx - 28, 240, z2]
            ],
            fill: shadeHexColor(palette.secondary, 0.08),
            opacity: 0.93,
            tier: 2
          });
          lines.push({
            p0: [bx, 0, z2 + 6],
            p1: [bx, 285, z2 + 6],
            stroke: palette.accent,
            strokeWidth: 2.0,
            opacity: 0.84,
            tier: 2
          });
          break;
        }
      }
    }

    // --- Tier 3 (Z = -120 to +40): Stage Floor & Scenic Dressing ---
    const floorPad = 300;
    const deckZHalf = 300;
    polygons.push({
      vertices: [
        [xMin - floorPad, 0, deckZHalf],
        [xMax + floorPad, 0, deckZHalf],
        [xMax + floorPad, 0, -deckZHalf],
        [xMin - floorPad, 0, -deckZHalf]
      ],
      fill: shadeHexColor(palette.background, 0.16),
      opacity: 0.96,
      tier: 0
    });

    const zLines = [-200, -80, 80, 200];
    for (const z of zLines) {
      lines.push({
        p0: [xMin - floorPad, 0.3, z],
        p1: [xMax + floorPad, 0.3, z],
        stroke:
          setId === 'RAINY_STREET' || setId === 'CONCERT_STAGE'
            ? palette.primary
            : shadeHexColor(palette.secondary, -0.35),
        strokeWidth: 1.5,
        opacity: 0.76,
        tier: 1
      });
    }

    const b3 = tierBounds?.tier3RunwayZ ?? { xMin, xMax };
    const span3 = Math.max(1200, b3.xMax - b3.xMin);
    const s3 = Math.max(220, Math.ceil(span3 / 5));
    const k3Min = Math.floor(b3.xMin / s3);
    const k3Max = Math.ceil(b3.xMax / s3);

    for (let k = k3Min; k <= k3Max; k++) {
      const bx = k * s3;

      switch (setId) {
        case 'INTERIOR_ROOM': {
          // Warm floor-lamp shade cone + vertical stand post
          polygons.push({
            vertices: [
              [bx - 18, 95, z3],
              [bx + 18, 95, z3],
              [bx + 12, 122, z3],
              [bx - 12, 122, z3]
            ],
            fill: palette.accent,
            opacity: 0.92,
            tier: 2
          });
          lines.push({
            p0: [bx, 0, z3],
            p1: [bx, 95, z3],
            stroke: palette.secondary,
            strokeWidth: 2.2,
            opacity: 0.88,
            tier: 2
          });
          break;
        }

        case 'RAINY_STREET': {
          // Vintage iron streetlamp + radial rain-cone glow polygon
          polygons.push({
            vertices: [
              [bx - 36, 0, z3],
              [bx + 36, 0, z3],
              [bx + 8, 128, z3],
              [bx - 8, 128, z3]
            ],
            fill: palette.primary,
            opacity: 0.22,
            tier: 2,
            isTwoSided: true
          });
          lines.push({
            p0: [bx, 0, z3 + 2],
            p1: [bx, 132, z3 + 2],
            stroke: shadeHexColor(palette.secondary, 0.35),
            strokeWidth: 2.4,
            opacity: 0.9,
            tier: 2
          });
          break;
        }

        case 'PARK_BENCH': {
          // Slatted vector park bench backrest + seat at Z = -120
          polygons.push({
            vertices: [
              [bx - 32, 14, z3],
              [bx + 32, 14, z3],
              [bx + 32, 38, z3],
              [bx - 32, 38, z3]
            ],
            fill: shadeHexColor(palette.secondary, 0.22),
            opacity: 0.94,
            tier: 2
          });
          lines.push({
            p0: [bx - 34, 22, z3 + 3],
            p1: [bx + 34, 22, z3 + 3],
            stroke: palette.accent,
            strokeWidth: 2.2,
            opacity: 0.9,
            tier: 2
          });
          break;
        }

        case 'CONCERT_STAGE': {
          // Stage floor monitor wedge + microphone stand
          polygons.push({
            vertices: [
              [bx - 20, 0, z3],
              [bx + 20, 0, z3],
              [bx + 16, 22, z3],
              [bx - 16, 22, z3]
            ],
            fill: shadeHexColor(palette.secondary, -0.25),
            opacity: 0.95,
            tier: 2
          });
          lines.push({
            p0: [bx, 0, z3 + 10],
            p1: [bx + 6, 82, z3 + 10],
            stroke: palette.primary,
            strokeWidth: 2.0,
            opacity: 0.9,
            tier: 2
          });
          break;
        }

        case 'GOTHIC_CATHEDRAL': {
          // Sanctuary stone altar pedestal + tall sanctuary candelabra
          polygons.push({
            vertices: [
              [bx - 26, 0, z3],
              [bx + 26, 0, z3],
              [bx + 22, 46, z3],
              [bx - 22, 46, z3]
            ],
            fill: shadeHexColor(palette.secondary, 0.18),
            opacity: 0.94,
            tier: 2
          });
          lines.push({
            p0: [bx, 46, z3 + 2],
            p1: [bx, 112, z3 + 2],
            stroke: palette.accent,
            strokeWidth: 2.2,
            opacity: 0.92,
            tier: 2
          });
          break;
        }
      }
    }

    // --- Tier 4 (Z = +140): Foreground Theatrical Framing ---
    // Strictly omitted on CLOSE_UP shots to prevent face occlusion
    if (!isCloseUp) {
      const b4 = tierBounds?.tier4ForegroundZ ?? { xMin, xMax };
      const span4 = Math.max(1200, b4.xMax - b4.xMin);
      const s4 = Math.max(600, Math.ceil(span4 / 2));
      const k4Min = Math.floor(b4.xMin / s4);
      const k4Max = Math.ceil(b4.xMax / s4);

      for (let k = k4Min; k <= k4Max; k++) {
        const bx = k * s4;

        switch (setId) {
          case 'INTERIOR_ROOM': {
            // Overhead timber ceiling beam + pendant cord
            polygons.push({
              vertices: [
                [bx - 90, 242, z4],
                [bx + 180, 242, z4],
                [bx + 180, 256, z4],
                [bx - 90, 256, z4]
              ],
              fill: shadeHexColor(palette.background, 0.22),
              opacity: 0.92,
              tier: 3
            });
            lines.push({
              p0: [bx + 45, 256, z4],
              p1: [bx + 45, 350, z4],
              stroke: palette.secondary,
              strokeWidth: 1.6,
              opacity: 0.82,
              tier: 3
            });
            break;
          }

          case 'RAINY_STREET': {
            // Overhead rain-slicked utility cable + raindrop streak
            lines.push(
              {
                p0: [bx - 95, 252, z4],
                p1: [bx + 185, 238, z4],
                stroke: palette.secondary,
                strokeWidth: 1.8,
                opacity: 0.85,
                tier: 3
              },
              {
                p0: [bx + 40, 245, z4],
                p1: [bx + 32, 340, z4],
                stroke: palette.primary,
                strokeWidth: 1.4,
                opacity: 0.72,
                tier: 3
              }
            );
            break;
          }

          case 'PARK_BENCH': {
            // Overhanging autumn bough silhouette + twig line
            polygons.push({
              vertices: [
                [bx - 85, 240, z4],
                [bx + 175, 245, z4],
                [bx + 140, 265, z4],
                [bx - 60, 260, z4]
              ],
              fill: shadeHexColor(palette.background, 0.25),
              opacity: 0.9,
              tier: 3
            });
            lines.push({
              p0: [bx - 85, 240, z4],
              p1: [bx + 175, 245, z4],
              stroke: palette.accent,
              strokeWidth: 1.6,
              opacity: 0.8,
              tier: 3
            });
            break;
          }

          case 'CONCERT_STAGE': {
            // Overhead front-of-house lighting truss bar + spotlight hanger
            polygons.push({
              vertices: [
                [bx - 90, 244, z4],
                [bx + 180, 244, z4],
                [bx + 180, 258, z4],
                [bx - 90, 258, z4]
              ],
              fill: shadeHexColor(palette.background, 0.2),
              opacity: 0.92,
              tier: 3
            });
            lines.push({
              p0: [bx + 45, 258, z4],
              p1: [bx + 45, 355, z4],
              stroke: palette.accent,
              strokeWidth: 1.8,
              opacity: 0.85,
              tier: 3
            });
            break;
          }

          case 'GOTHIC_CATHEDRAL': {
            // Vaulted gothic groin-arch rib overhang
            polygons.push({
              vertices: [
                [bx - 95, 238, z4],
                [bx + 185, 238, z4],
                [bx + 150, 262, z4],
                [bx - 60, 262, z4]
              ],
              fill: shadeHexColor(palette.background, 0.22),
              opacity: 0.92,
              tier: 3
            });
            lines.push({
              p0: [bx - 95, 238, z4],
              p1: [bx + 185, 238, z4],
              stroke: palette.primary,
              strokeWidth: 1.8,
              opacity: 0.82,
              tier: 3
            });
            break;
          }
        }
      }
    }

    return { polygons, lines };
  }
}
