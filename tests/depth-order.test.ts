import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortDrawables,
  compareDrawables,
  type SortablePrimitive
} from '../src/engine/compositor/depth-sort.js';
import { SceneCompositor, type SceneEnvironment } from '../src/engine/compositor/scene-compositor.js';
import type { FrameStateContract } from '../src/schemas/frame.contract.js';
import type { AssetRigContract } from '../src/schemas/rig.contract.js';

test('DepthSort: layerPass 0 ground polygons are strictly drawn before layerPass 1 entities even when closer to camera', () => {
  // Scenario:
  // Character anchor is at depthKey = 80 (further from camera).
  // A subdivided ground polygon in front of the character has depthKey = 25 (closer to camera).
  // Without layerPass priority, Painter's algorithm (depthKey DESC) would draw the ground at 25 AFTER the character at 80,
  // painting ground on top of the character's feet!
  // With layerPass priority (0 for ground, 1 for entity), ground is drawn FIRST (underneath).
  const groundPiece: SortablePrimitive = {
    kind: 'env_polygon',
    depthKey: 25,
    tier: 0,
    layerPass: 0,
    index: 0
  };

  const character: SortablePrimitive = {
    kind: 'billboard_entity',
    depthKey: 80,
    tier: 3,
    layerPass: 1,
    index: 1
  };

  const sorted = sortDrawables([character, groundPiece]);

  assert.equal(sorted[0].kind, 'env_polygon', 'Ground polygon must be drawn first');
  assert.equal(sorted[1].kind, 'billboard_entity', 'Character entity must be drawn second (on top of ground)');
  assert.equal(compareDrawables(groundPiece, character), -1);
  assert.equal(compareDrawables(character, groundPiece), 1);
});

test('DepthSort: within the same layerPass, depthKey DESC sorting is preserved', () => {
  const farBuilding: SortablePrimitive = {
    kind: 'building_far',
    depthKey: 300,
    tier: 2,
    layerPass: 1,
    index: 0
  };
  const character: SortablePrimitive = {
    kind: 'character',
    depthKey: 100,
    tier: 3,
    layerPass: 1,
    index: 1
  };
  const foregroundProp: SortablePrimitive = {
    kind: 'prop_near',
    depthKey: 40,
    tier: 4,
    layerPass: 1,
    index: 2
  };

  const sorted = sortDrawables([foregroundProp, farBuilding, character]);
  assert.equal(sorted[0].kind, 'building_far');
  assert.equal(sorted[1].kind, 'character');
  assert.equal(sorted[2].kind, 'prop_near');
});

test('SceneCompositor: horizontal ground floor renders underneath character feet in SVG markup', () => {
  const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });

  const mockRig: any = {
    id: 'hero_runner',
    name: 'Hero Runner',
    type: 'character',
    renderMode: 'billboard',
    baseTransform: { position: [0, 0, 0], rotationZDegrees: 0, scale: [1, 1] },
    skeleton: {
      rootJointId: 'root',
      joints: [{ id: 'root', parentId: null, localOffset2D: [0, 0], length: 10, rotationZDegrees: 0 }]
    },
    parts: [
      {
        id: 'torso',
        jointId: 'root',
        localOffset2D: [0, 0],
        shape: { kind: 'rect', size: [40, 80] },
        style: { fill: { kind: 'solid', color: '#ff0055' }, opacity: 0.9, lit: false }
      }
    ],
    secondaryMotion: [],
    svgAsset: { idNamespace: 'hero_ns' }
  };

  const rigs = new Map<string, AssetRigContract>([['hero_runner', mockRig]]);

  const frameState: FrameStateContract = {
    frameIndex: 10,
    timeSeconds: 0.33,
    shotId: 'shot_01',
    camera: {
      projectionMode: 'perspective',
      position: [0, 50, -100],
      target: [0, 10, 0],
      up: [0, 1, 0],
      nearPlane: 1,
      farPlane: 1000,
      rollDegrees: 0,
      verticalFovDegrees: 50
    },
    palette: {
      background: '#0a0a14',
      primary: '#ff3366',
      secondary: '#33ccff',
      accent: '#ffff00',
      ambientLightColor: '#ffffff',
      ambientIntensity: 0.8,
      keyLightDirection: [0, 1, 0],
      audioReactiveGain: 1.0
    },
    audio: {
      frameIndex: 10,
      timestamp: 0.33,
      rms: 0.5,
      rmsRelativeGlobal: 0.5,
      rmsRelativeLocal: 0.5,
      localWindowFrames: 15,
      spectralFlux: 0.1,
      onsetStrength: 0,
      isOnset: false,
      bands: { subBass: 0.2, bass: 0.3, lowMid: 0.3, mid: 0.4, highMid: 0.5, presence: 0.2, brilliance: 0.1 }
    },
    entities: [
      {
        rigId: 'hero_runner',
        worldPosition: [0, 0, 0],
        worldRotationZDegrees: 0,
        scale: [1, 1],
        opacity: 1,
        jointAngles: { root: 0 },
        jointOffsets: {},
        morphWeights: {}
      }
    ],
    lyric: null
  };

  // Environment with a horizontal ground floor polygon
  const env: SceneEnvironment = {
    polygons: [
      {
        // Ground floor with upward normal (n_y > 0.9) at y = 0
        vertices: [
          [-500, 0, 500],
          [500, 0, 500],
          [500, 0, -50],
          [-500, 0, -50]
        ],
        fill: '#111827',
        isTwoSided: true
      }
    ]
  };

  const result = compositor.renderFrame(
    frameState,
    rigs,
    env,
    [],
    () => frameState.audio
  );

  assert.ok(result.svg.includes('<svg'), 'SVG must be generated');
  assert.ok(result.svg.includes('#ff0055'), 'Character part fill must be rendered');

  const groundPos = result.svg.indexOf('#111827');
  const entityPos = result.svg.indexOf('#ff0055');

  assert.ok(groundPos > 0, 'Ground polygon must be present');
  assert.ok(entityPos > 0, 'Entity part must be present');
  assert.ok(
    groundPos < entityPos,
    `Ground polygon (at pos ${groundPos}) must be rendered before entity (at pos ${entityPos}) in SVG`
  );
});
