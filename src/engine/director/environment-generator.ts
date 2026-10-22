import type {
  SceneEnvironment,
  EnvironmentPolygon,
  EnvironmentLine
} from '../compositor/scene-compositor.js';
import type {
  ColorLightingPalette,
  EnvironmentZoneType
} from '../../schemas/storyboard.contract.js';
import { shadeHexColor } from '../math/color.js';
import { THEMATIC_PALETTES } from './acoustic-segmenter.js';

export { THEMATIC_PALETTES };

export const CANONICAL_RIG_IDS = {
  SKYLINE: 'rig-skyline',
  FACTORIES: 'rig-factories',
  SMOKE_CHIMNEY: 'rig-smoke-chimney',
  RUNNER: 'rig-runner',
  RUNNER_AURA: 'rig-runner-aura',
  FG_PIPES: 'rig-fg-pipes',
  PURSUIT_DRONE: 'rig-pursuit-drone',
  HIGHWAY_GANTRY: 'rig-highway-gantry',
  NEON_BILLBOARD: 'rig-neon-billboard',
  BRIDGE_PYLON: 'rig-bridge-pylon',
  REACTOR_CORE: 'rig-reactor-core'
} as const;

export const RUNNER_BASE_SPEED = 80; // World units per second at 30 FPS

/**
 * Computes the continuous X world coordinate of the runner at a given frame.
 */
export function computeRunnerTrajectoryX(frame: number, fps = 30): number {
  return Number(((frame / fps) * RUNNER_BASE_SPEED).toFixed(2));
}

export interface EnvironmentGeneratorOptions {
  shotId?: string;
  centerX: number;
  zone: EnvironmentZoneType;
  palette: ColorLightingPalette;
}

/**
 * Builds the 3D environment for Zone 1: Cyber Rooftop & Industrial Sky.
 * Features rooftop concrete slab, 3D HVAC ventilation cuboids, parapet railings,
 * and aviation warning beacons.
 */
export function buildRooftopEnvironment(
  centerX: number,
  palette: ColorLightingPalette
): SceneEnvironment {
  const span = 2000;
  const polygons: EnvironmentPolygon[] = [];
  const lines: EnvironmentLine[] = [];

  // 1. Concrete Rooftop Floor
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

  // 2. 3D HVAC Ventilation Cuboids on the roof
  const hvacBoxes = [
    { x: centerX - 280, z: -140, w: 90, h: 48, d: 55 },
    { x: centerX + 310, z: -170, w: 110, h: 58, d: 65 }
  ];

  for (const box of hvacBoxes) {
    const x0 = box.x;
    const x1 = box.x + box.w;
    const z0 = box.z;
    const z1 = box.z + box.d;
    const yTop = box.h;

    // Top face (CCW viewed from above)
    polygons.push({
      vertices: [
        [x0, yTop, z1],
        [x1, yTop, z1],
        [x1, yTop, z0],
        [x0, yTop, z0]
      ],
      fill: shadeHexColor(palette.secondary, 0.42),
      opacity: 0.95,
      tier: 2
    });

    // Front face (CCW viewed from camera +Z)
    polygons.push({
      vertices: [
        [x0, 0, z1],
        [x1, 0, z1],
        [x1, yTop, z1],
        [x0, yTop, z1]
      ],
      fill: shadeHexColor(palette.secondary, 0.28),
      opacity: 0.95,
      tier: 2
    });

    // Front face ventilation louver lines
    lines.push(
      { p0: [x0 + 10, yTop * 0.35, z1 + 1], p1: [x1 - 10, yTop * 0.35, z1 + 1], stroke: palette.primary, strokeWidth: 1.2, opacity: 0.6, tier: 3 },
      { p0: [x0 + 10, yTop * 0.65, z1 + 1], p1: [x1 - 10, yTop * 0.65, z1 + 1], stroke: palette.primary, strokeWidth: 1.2, opacity: 0.6, tier: 3 }
    );
  }

  // 3. Parapet Edge Railing along front roof boundary
  const railZ = 60;
  lines.push({
    p0: [centerX - span, 24, railZ],
    p1: [centerX + span, 24, railZ],
    stroke: '#2b3a55',
    strokeWidth: 2.0,
    opacity: 0.85,
    tier: 2
  });

  // Vertical stanchions
  const stanchionOffsets = [-600, -300, 0, 300, 600];
  for (const off of stanchionOffsets) {
    lines.push({
      p0: [centerX + off, 0, railZ],
      p1: [centerX + off, 24, railZ],
      stroke: '#2b3a55',
      strokeWidth: 2.0,
      opacity: 0.85,
      tier: 2
    });
  }

  // 4. Rooftop Expansion Joint Lines
  const zJoints = [-600, -200, 200, 600];
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

  return { polygons, lines };
}

/**
 * Builds the 3D environment for Zone 2: Dystopian Highway & Gantry.
 * Features asphalt roadway, dashed lane markers, 3D Jersey barriers,
 * overhead steel truss gantries, and streetlamps.
 */
export function buildHighwayEnvironment(
  centerX: number,
  palette: ColorLightingPalette
): SceneEnvironment {
  const span = 2000;
  const polygons: EnvironmentPolygon[] = [];
  const lines: EnvironmentLine[] = [];

  // 1. Asphalt Roadway Floor
  polygons.push({
    vertices: [
      [centerX - span, 0, 320],
      [centerX + span, 0, 320],
      [centerX + span, 0, -320],
      [centerX - span, 0, -320]
    ],
    fill: '#090c14',
    opacity: 0.98,
    tier: 0
  });

  // 2. Dashed Yellow/White Lane Markings along road center (Z = 0)
  const dashLength = 100;
  const dashGap = 100;
  const cycle = dashLength + dashGap;
  const visSpan = 700;
  const startX = centerX - visSpan;
  const endX = centerX + visSpan;

  for (let x = startX; x < endX; x += cycle) {
    lines.push({
      p0: [x, 0.5, 0],
      p1: [Math.min(endX, x + dashLength), 0.5, 0],
      stroke: '#ffb703',
      strokeWidth: 2.5,
      opacity: 0.9,
      tier: 1
    });
  }

  // Solid shoulder lane boundary lines
  lines.push(
    { p0: [startX, 0.5, 110], p1: [endX, 0.5, 110], stroke: '#ffffff', strokeWidth: 1.8, opacity: 0.85, tier: 1 },
    { p0: [startX, 0.5, -170], p1: [endX, 0.5, -170], stroke: '#ffffff', strokeWidth: 1.8, opacity: 0.85, tier: 1 }
  );

  // 3. Concrete Jersey Barriers along road edge (Z = -190)
  const barrierOffsets = [-350, 0, 350];
  for (const off of barrierOffsets) {
    const bx = centerX + off;
    const bw = 220;
    const bz = -195;
    const bh = 22;

    // Angled front face of barrier
    polygons.push({
      vertices: [
        [bx, 0, bz + 12],
        [bx + bw, 0, bz + 12],
        [bx + bw, bh, bz],
        [bx, bh, bz]
      ],
      fill: shadeHexColor(palette.secondary, 0.35),
      opacity: 0.92,
      tier: 2
    });

    // Top cap line
    lines.push({
      p0: [bx, bh, bz],
      p1: [bx + bw, bh, bz],
      stroke: palette.primary,
      strokeWidth: 1.5,
      opacity: 0.75,
      tier: 3
    });
  }

  // 4. Overhead Highway Overpass Truss at Y = 250
  const trussY = 250;
  const trussZ = -40;
  lines.push(
    { p0: [startX, trussY, trussZ], p1: [endX, trussY, trussZ], stroke: '#3a4a6b', strokeWidth: 3.0, opacity: 0.85, tier: 2 },
    { p0: [startX, trussY + 28, trussZ], p1: [endX, trussY + 28, trussZ], stroke: '#3a4a6b', strokeWidth: 2.0, opacity: 0.85, tier: 2 }
  );

  // Diagonal cross-bracing for Warren truss
  const braceSpacing = 280;
  for (let x = startX; x < endX; x += braceSpacing) {
    lines.push(
      { p0: [x, trussY, trussZ], p1: [x + braceSpacing / 2, trussY + 28, trussZ], stroke: '#223048', strokeWidth: 1.5, opacity: 0.75, tier: 2 },
      { p0: [x + braceSpacing / 2, trussY + 28, trussZ], p1: [x + braceSpacing, trussY, trussZ], stroke: '#223048', strokeWidth: 1.5, opacity: 0.75, tier: 2 }
    );
  }

  // 5. Roadside Streetlamp Posts
  const lampOffsets = [-400, 400];
  for (const off of lampOffsets) {
    const lx = centerX + off;
    const lz = -180;
    lines.push(
      { p0: [lx, 0, lz], p1: [lx, 185, lz], stroke: '#32425f', strokeWidth: 2.2, opacity: 0.8, tier: 2 },
      { p0: [lx, 185, lz], p1: [lx, 185, lz + 70], stroke: '#ffd166', strokeWidth: 2.0, opacity: 0.9, tier: 3 }
    );
  }

  return { polygons, lines };
}

/**
 * Builds the 3D environment for Zone 3: Suspended Sky-Bridge & Sunset Chasm.
 * Features narrow steel bridge deck with lateral abyss drop-off (empty space beyond edges),
 * bridge deck expansion joints, A-frame pylon towers, and high-tension diagonal stay cables.
 */
export function buildBridgeEnvironment(
  centerX: number,
  palette: ColorLightingPalette
): SceneEnvironment {
  const span = 2000;
  const polygons: EnvironmentPolygon[] = [];
  const lines: EnvironmentLine[] = [];

  // 1. Narrow Bridge Deck (Lateral void beyond Z = [-150, 150] exposes dramatic abyss below)
  polygons.push({
    vertices: [
      [centerX - span, 0, 150],
      [centerX + span, 0, 150],
      [centerX + span, 0, -150],
      [centerX - span, 0, -150]
    ],
    fill: '#0f0a1c',
    opacity: 0.96,
    tier: 0
  });

  // Bridge deck transverse expansion joints
  const jointSpacing = 220;
  const startX = centerX - span;
  const endX = centerX + span;
  for (let x = startX; x < endX; x += jointSpacing) {
    lines.push({
      p0: [x, 0.4, -145],
      p1: [x, 0.4, 145],
      stroke: palette.primary,
      strokeWidth: 1.5,
      opacity: 0.8,
      tier: 1
    });
  }

  // Raised edge safety curbs
  lines.push(
    { p0: [startX, 8, 145], p1: [endX, 8, 145], stroke: '#5a2a7a', strokeWidth: 2.2, opacity: 0.9, tier: 2 },
    { p0: [startX, 8, -145], p1: [endX, 8, -145], stroke: '#5a2a7a', strokeWidth: 2.2, opacity: 0.9, tier: 2 }
  );

  // 2. Giant Bridge Pylon Tower Peak at (centerX, 480, -190)
  const towerX = centerX;
  const towerPeakY = 480;
  const towerZ = -190;

  // A-frame pylon columns
  lines.push(
    { p0: [towerX - 70, 0, towerZ], p1: [towerX, towerPeakY, towerZ], stroke: '#4a154b', strokeWidth: 3.5, opacity: 0.95, tier: 2 },
    { p0: [towerX + 70, 0, towerZ], p1: [towerX, towerPeakY, towerZ], stroke: '#4a154b', strokeWidth: 3.5, opacity: 0.95, tier: 2 },
    { p0: [towerX - 45, 260, towerZ], p1: [towerX + 45, 260, towerZ], stroke: '#ff007f', strokeWidth: 2.5, opacity: 0.9, tier: 3 }
  );

  // 3. High-Tension Diagonal Suspension Stay Cables radiating across the camera view
  const anchorOffsets = [-700, -450, -220, 220, 450, 700];
  for (const off of anchorOffsets) {
    const ax = centerX + off;
    lines.push({
      p0: [towerX, towerPeakY - 20, towerZ],
      p1: [ax, 8, -145],
      stroke: palette.accent,
      strokeWidth: 1.6,
      opacity: 0.85,
      tier: 3
    });
  }

  return { polygons, lines };
}

/**
 * Builds the 3D environment for Zone 4: Subterranean Megatunnel & Reactor Core.
 * Features heavy steel catwalk, yellow/black hazard warning stripes,
 * and 3D octagonal tunnel portal arch ribs establishing immersive perspective depth.
 */
export function buildReactorTunnelEnvironment(
  centerX: number,
  palette: ColorLightingPalette
): SceneEnvironment {
  const span = 2000;
  const polygons: EnvironmentPolygon[] = [];
  const lines: EnvironmentLine[] = [];

  // 1. Steel Catwalk Floor
  polygons.push({
    vertices: [
      [centerX - span, 0, 180],
      [centerX + span, 0, 180],
      [centerX + span, 0, -180],
      [centerX - span, 0, -180]
    ],
    fill: '#090308',
    opacity: 0.98,
    tier: 0
  });

  // Catwalk yellow caution edge stripes
  lines.push(
    { p0: [centerX - span, 0.4, 175], p1: [centerX + span, 0.4, 175], stroke: '#ffcc00', strokeWidth: 2.5, opacity: 0.9, tier: 1 },
    { p0: [centerX - span, 0.4, -175], p1: [centerX + span, 0.4, -175], stroke: '#ffcc00', strokeWidth: 2.5, opacity: 0.9, tier: 1 }
  );

  // 2. 3D Tunnel Portal Arch Ribs
  // 5 perspective octagonal portal frames surrounding the camera and runner
  const ribOffsets = [-500, -250, 0, 250, 500];
  const zLeft = -210;
  const zRight = 190;
  const yPost = 210;
  const yApex = 280;

  for (const off of ribOffsets) {
    const rx = centerX + off;

    // Left upright pillar
    lines.push({ p0: [rx, 0, zLeft], p1: [rx, yPost, zLeft], stroke: palette.primary, strokeWidth: 2.2, opacity: 0.88, tier: 2 });
    // Left diagonal bevel
    lines.push({ p0: [rx, yPost, zLeft], p1: [rx, yApex, zLeft + 60], stroke: palette.primary, strokeWidth: 2.2, opacity: 0.88, tier: 2 });
    // Overhead lintel beam
    lines.push({ p0: [rx, yApex, zLeft + 60], p1: [rx, yApex, zRight - 60], stroke: palette.primary, strokeWidth: 2.5, opacity: 0.92, tier: 2 });
    // Right diagonal bevel
    lines.push({ p0: [rx, yApex, zRight - 60], p1: [rx, yPost, zRight], stroke: palette.primary, strokeWidth: 2.2, opacity: 0.88, tier: 2 });
    // Right upright pillar
    lines.push({ p0: [rx, yPost, zRight], p1: [rx, 0, zRight], stroke: palette.primary, strokeWidth: 2.2, opacity: 0.88, tier: 2 });

    // Emergency alarm strobe beacon cross on arch apex
    lines.push(
      { p0: [rx, yApex + 2, 0], p1: [rx, yApex + 12, 0], stroke: palette.accent, strokeWidth: 2.0, opacity: 0.95, tier: 3 },
      { p0: [rx - 5, yApex + 7, 0], p1: [rx + 5, yApex + 7, 0], stroke: palette.accent, strokeWidth: 2.0, opacity: 0.95, tier: 3 }
    );
  }

  // 3. Longitudinal Wall Conduits running continuously along tunnel sides
  lines.push(
    { p0: [centerX - span, 110, zLeft + 5], p1: [centerX + span, 110, zLeft + 5], stroke: '#ff0033', strokeWidth: 1.8, opacity: 0.85, tier: 2 },
    { p0: [centerX - span, 170, zLeft + 5], p1: [centerX + span, 170, zLeft + 5], stroke: '#ff0033', strokeWidth: 1.8, opacity: 0.85, tier: 2 },
    { p0: [centerX - span, 110, zRight - 5], p1: [centerX + span, 110, zRight - 5], stroke: '#00ffff', strokeWidth: 1.8, opacity: 0.75, tier: 2 }
  );

  return { polygons, lines };
}

/**
 * Dispatches to the zone-specific 3D environment builder based on options.
 */
export function buildDynamicEnvironment(
  options: EnvironmentGeneratorOptions
): SceneEnvironment {
  const { centerX, zone, palette } = options;

  switch (zone) {
    case 'ROOFTOP':
      return buildRooftopEnvironment(centerX, palette);
    case 'HIGHWAY':
      return buildHighwayEnvironment(centerX, palette);
    case 'BRIDGE':
      return buildBridgeEnvironment(centerX, palette);
    case 'REACTOR':
      return buildReactorTunnelEnvironment(centerX, palette);
    default:
      return buildRooftopEnvironment(centerX, palette);
  }
}

/**
 * Provides continuous 3D ground plane and perspective grid environment across all shots,
 * using a localized ground grid in close-up shots to keep drawable counts low while
 * preserving the horizon floor.
 */
/**
 * @deprecated Superseded by `EnvironmentKit.build()` in `src/engine/library/environment-kit.ts`.
 * Retained for legacy fallback and unit test compatibility.
 */
export function getOrchestratedEnvironment(
  shotId: string,
  centerX = 0,
  zone: EnvironmentZoneType = 'ROOFTOP',
  palette?: ColorLightingPalette
): SceneEnvironment {
  if (shotId === 'shot-3' && Math.abs(centerX) < 400 && zone === 'ROOFTOP') {
    return {
      polygons: [
        {
          vertices: [
            [-400, 0, 300],
            [700, 0, 300],
            [700, 0, -500],
            [-400, 0, -500]
          ],
          fill: '#0c101d',
          opacity: 0.95,
          tier: 0
        }
      ],
      lines: [
        { p0: [-400, 0, 0], p1: [700, 0, 0], stroke: '#1b2438', strokeWidth: 1.5, opacity: 0.8, tier: 2 },
        { p0: [300, 0, -500], p1: [300, 0, 300], stroke: '#1b2438', strokeWidth: 1.5, opacity: 0.8, tier: 2 }
      ]
    };
  }

  const effectivePalette: ColorLightingPalette = palette ?? {
    background: '#090b16',
    primary: '#00f0ff',
    secondary: '#3a506b',
    accent: '#ff0055',
    ambientLightColor: '#1a243b',
    ambientIntensity: 0.72,
    keyLightDirection: [-0.5, -0.8, -0.3],
    audioReactiveGain: 0.65
  };

  return buildDynamicEnvironment({
    shotId,
    centerX,
    zone,
    palette: effectivePalette
  });
}
