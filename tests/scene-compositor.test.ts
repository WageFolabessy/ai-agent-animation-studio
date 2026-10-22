import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneCompositor, type SceneEnvironment } from '../src/engine/compositor/scene-compositor.js';
import { assertValidSvgPolicy } from '../src/engine/compositor/svg-policy-validator.js';
import { SvgRasterizer } from '../src/renderer/rasterizer.js';
import type { FrameStateContract } from '../src/schemas/frame.contract.js';
import type { AssetRigContract } from '../src/schemas/rig.contract.js';
import type { Vec3 } from '../src/schemas/primitives.schema.js';

function createMockFrameState(): FrameStateContract {
  return {
    frameIndex: 0,
    timeSeconds: 0,
    shotId: 'shot_test',
    camera: {
      projectionMode: 'perspective',
      position: [0, 100, 320],
      target: [0, 0, 0],
      up: [0, 1, 0],
      nearPlane: 1,
      farPlane: 3000,
      rollDegrees: 0,
      verticalFovDegrees: 60
    },
    palette: {
      background: '#08081a',
      primary: '#00d4ff',
      secondary: '#ff0077',
      accent: '#ffe600',
      ambientLightColor: '#ffffff',
      ambientIntensity: 0.5,
      keyLightDirection: [0.5, 0.8, -0.3],
      audioReactiveGain: 1.0
    },
    audio: {
      frameIndex: 0,
      timestamp: 0,
      rms: 0.3,
      rmsRelativeGlobal: 0.3,
      rmsRelativeLocal: 0.3,
      localWindowFrames: 15,
      spectralFlux: 0.1,
      onsetStrength: 0.8,
      isOnset: true,
      bands: { subBass: 0.2, bass: 0.7, lowMid: 0.3, mid: 0.4, highMid: 0.2, presence: 0.1, brilliance: 0.1 }
    },
    lyric: {
      lineId: 'line_1',
      text: 'Visual Cinema Engine',
      progress: 0.5,
      emphasis: 0.5
    },
    entities: []
  };
}

test('SceneCompositor: Renders valid SVG passing policy with depth-sorted primitives and budget counters', () => {
  const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });
  const frameState = createMockFrameState();

  const rigs = new Map<string, AssetRigContract>([
    [
      'rig_runner',
      {
        id: 'rig_runner',
        name: 'Runner',
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
            style: { fill: { kind: 'solid', color: '#ff0055' }, opacity: 0.9, lit: true }
          }
        ],
        secondaryMotion: [],
        svgAsset: { idNamespace: 'runner_ns' }
      }
    ]
  ]);

  frameState.entities = [
    {
      rigId: 'rig_runner',
      worldPosition: [0, 0, 0],
      worldRotationZDegrees: 0,
      scale: [1, 1],
      jointAngles: { root: 0 },
      jointOffsets: {},
      morphWeights: {},
      opacity: 1
    }
  ];

  // Environment with ground polygon and isolated edge grid lines
  const environment: SceneEnvironment = {
    polygons: [
      {
        // Ground plane (CCW viewed from above: n = (0, 1, 0))
        vertices: [
          [-500, 0, 500],
          [500, 0, 500],
          [500, 0, -500],
          [-500, 0, -500]
        ],
        fill: '#151525',
        opacity: 0.8,
        tier: 0
      }
    ],
    lines: [
      {
        p0: [-500, 0, 0],
        p1: [500, 0, 0],
        stroke: '#00d4ff',
        strokeWidth: 2,
        opacity: 0.5
      }
    ]
  };

  const output = compositor.renderFrame(frameState, rigs, environment);

  // Assert valid SVG policy passes cleanly
  assert.doesNotThrow(() => assertValidSvgPolicy(output.svg));

  // Check scene budget limits
  assert.ok(output.stats.drawablesCount <= 220, 'Drawables budget exceeded');
  assert.ok(output.stats.gradientShapesCount <= 100, 'Gradient shapes budget exceeded');
  assert.ok(output.stats.particlesCount <= 150, 'Particles budget exceeded');
  assert.equal(output.stats.filtersCount, 0, 'No filters allowed');

  // Verify ground plane polygon was NOT back-face culled and was emitted before the grid line
  const idxGround = output.svg.indexOf('fill="#151525"');
  const idxGridLine = output.svg.indexOf('stroke="#00d4ff"');
  assert.ok(idxGround !== -1, 'Ground plane polygon must be emitted (not back-face culled)');
  assert.ok(idxGridLine !== -1, 'Grid line must be emitted');
  assert.ok(idxGround < idxGridLine, 'Ground plane (tier 0) must be emitted before surface grid line');

  // Verify lyric overlay was emitted
  assert.ok(output.svg.includes('Visual Cinema Engine'));
});

test('SceneCompositor: Continuous lighting pulse decays smoothly across post-onset frames and lyric fade applies opacity', () => {
  const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });

  // Frame 2 after an onset at frame 0 (current frame is NOT an onset)
  const frame2 = createMockFrameState();
  frame2.frameIndex = 2;
  frame2.timeSeconds = 2 / 30;
  frame2.audio.frameIndex = 2;
  frame2.audio.isOnset = false;
  frame2.audio.onsetStrength = 0;
  frame2.lyric = {
    lineId: 'line_fade',
    text: 'Fading Lyric Line',
    progress: 0.05, // 50% of 0.1 fade-in window -> opacity = 0.5
    emphasis: 0.2
  };

  const outWithOnset = compositor.renderFrame(frame2, new Map(), undefined, [0]);
  const outWithoutOnset = compositor.renderFrame(frame2, new Map(), undefined, []);

  // Because frame 0 was an onset in onsetFrames=[0], frame 2 still has non-zero exponential decay pulse
  assert.notEqual(
    outWithOnset.svg,
    outWithoutOnset.svg,
    'Post-onset frame 2 must retain decayed lighting pulse compared to no-onset baseline'
  );

  // Verify lyric fade-in group opacity="0.50" is applied
  assert.ok(
    outWithOnset.svg.includes('<g opacity="0.50">'),
    'Lyric overlay at progress=0.05 must be wrapped in <g opacity="0.50">'
  );
});

test('SceneCompositor: Back-to-front ordering puts far primitives before near primitives', () => {
  const compositor = new SceneCompositor();
  const frameState = createMockFrameState();

  const environment: SceneEnvironment = {
    polygons: [
      {
        // Near triangle at z = 50
        vertices: [
          [-20, 0, 50],
          [20, 0, 50],
          [0, 30, 50]
        ],
        fill: '#ff0000',
        isTwoSided: true
      },
      {
        // Far triangle at z = -200 (farther from camera at [0, 100, 320])
        vertices: [
          [-100, 0, -200],
          [100, 0, -200],
          [0, 150, -200]
        ],
        fill: '#0000ff',
        isTwoSided: true
      }
    ]
  };

  const output = compositor.renderFrame(frameState, new Map(), environment);

  // In Painter's algorithm, the far triangle (#0000ff) must be emitted BEFORE the near triangle (#ff0000)
  const idxFar = output.svg.indexOf('fill="#0000ff"');
  const idxNear = output.svg.indexOf('fill="#ff0000"');

  assert.ok(idxFar !== -1, 'Far triangle must be present');
  assert.ok(idxNear !== -1, 'Near triangle must be present');
  assert.ok(idxFar < idxNear, 'Far triangle must be emitted BEFORE near triangle in SVG DOM');
});

test('SceneCompositor: Canonical 3D cube renders top/front faces and culls back faces', () => {
  const compositor = new SceneCompositor();
  const frameState = createMockFrameState();

  // Canonical cube at origin: camera is elevated at [0, 100, 320]
  const vertices: Vec3[] = [
    [-30, -30, -30], // 0
    [30, -30, -30],  // 1
    [30, 30, -30],   // 2
    [-30, 30, -30],  // 3
    [-30, -30, 30],  // 4
    [30, -30, 30],   // 5
    [30, 30, 30],    // 6
    [-30, 30, 30]    // 7
  ];

  // Outward CCW face winding
  const faces = [
    { name: 'front', verts: [vertices[4], vertices[5], vertices[6], vertices[7]], fill: '#ff1111' },
    { name: 'back', verts: [vertices[1], vertices[0], vertices[3], vertices[2]], fill: '#1111ff' },
    { name: 'top', verts: [vertices[7], vertices[6], vertices[2], vertices[3]], fill: '#11ff11' },
    { name: 'bottom', verts: [vertices[0], vertices[1], vertices[5], vertices[4]], fill: '#ffff11' }
  ];

  const environment: SceneEnvironment = {
    polygons: faces.map((f) => ({
      vertices: f.verts,
      fill: f.fill,
      isTwoSided: false // backface culling enabled!
    }))
  };

  const output = compositor.renderFrame(frameState, new Map(), environment);

  // From [0, 100, 320]: front face (#ff1111) and top face (#11ff11) MUST be rendered
  assert.ok(output.svg.includes('fill="#ff1111"'), 'Front face must be rendered');
  assert.ok(output.svg.includes('fill="#11ff11"'), 'Top face must be rendered');

  // Back face (#1111ff) and bottom face (#ffff11) MUST be culled
  assert.ok(!output.svg.includes('fill="#1111ff"'), 'Interior back face must be culled');
  assert.ok(!output.svg.includes('fill="#ffff11"'), 'Bottom face must be culled');
});

test('SceneCompositor: Rasterization smoke test (rasterizes max 2 frames without errors)', async () => {
  const compositor = new SceneCompositor();
  const frameState = createMockFrameState();

  const output = compositor.renderFrame(frameState, new Map());

  // Rasterize 1 frame to verify resvg and font rasterizer handle the markup
  const rasterizer = new SvgRasterizer({ width: 1920, height: 1080 });
  const buffer = rasterizer.rasterize(output.svg);
  assert.equal(buffer.length, 1920 * 1080 * 4);
});

test('SceneCompositor: Eye ellipse parts scale vertically with blink morph weight and lyric backing capsule renders', () => {
  const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });
  const rigs = new Map<string, AssetRigContract>([
    [
      'rig_char',
      {
        id: 'rig_char',
        name: 'Char',
        type: 'character',
        renderMode: 'billboard',
        baseTransform: { position: [0, 0, 0], rotationZDegrees: 0, scale: [1, 1] },
        parts: [
          {
            id: 'char-eye-l',
            jointId: null,
            localOffset2D: [0, 0],
            shape: { kind: 'ellipse', radius: [2.0, 2.0] },
            style: { fill: { kind: 'solid', color: '#ff0055' }, opacity: 1.0, lit: false }
          }
        ],
        secondaryMotion: [],
        svgAsset: { idNamespace: 'char_ns' }
      }
    ]
  ]);

  const openFrame = createMockFrameState();
  openFrame.entities = [
    {
      rigId: 'rig_char',
      worldPosition: [0, 0, 0],
      worldRotationZDegrees: 0,
      scale: [1, 1],
      jointAngles: {},
      jointOffsets: {},
      morphWeights: { blink: 0 },
      opacity: 1
    }
  ];

  const blinkFrame = createMockFrameState();
  blinkFrame.entities = [
    {
      rigId: 'rig_char',
      worldPosition: [0, 0, 0],
      worldRotationZDegrees: 0,
      scale: [1, 1],
      jointAngles: {},
      jointOffsets: {},
      morphWeights: { blink: 1.0 },
      opacity: 1
    }
  ];

  const outOpen = compositor.renderFrame(openFrame, rigs);
  const outBlink = compositor.renderFrame(blinkFrame, rigs);

  // When blink=0, rx === ry === 2.0 so it emits a <circle>; when blink=1.0, ry = 0.30 !== rx so it emits a flattened <polygon>
  assert.ok(outOpen.svg.includes('<circle '), 'Open eye with equal radii should emit <circle>');
  assert.ok(outBlink.svg.includes('<polygon '), 'Blinking eye with squashed ry should emit flattened <polygon>');
  assert.ok(outOpen.svg.includes('fill="#060814" opacity="0.78"'), 'Lyric backing plate rect must be emitted');
});

test('SceneCompositor: ArchetypeFactory.buildBipedRunner renders distinct facial morph <path> d attributes and reduced eye blink vertical span', async () => {
  const { ArchetypeFactory } = await import('../src/engine/library/archetype-factory.js');
  const runnerRig = ArchetypeFactory.build({
    instanceId: 'lead_runner',
    spec: {
      instanceId: 'lead_runner',
      archetypeId: 'biped_runner',
      scale: 1.0,
      accessories: []
    }
  });

  // Verify morph and eye ellipse parts exist on biped_runner
  const morphPart = runnerRig.parts.find((p) => p.shape.kind === 'morph');
  const eyePart = runnerRig.parts.find(
    (p) => p.shape.kind === 'ellipse' && p.id.includes('eye')
  );
  assert.ok(morphPart, 'biped_runner must define a shape.kind === "morph" part');
  assert.ok(eyePart, 'biped_runner must define an ellipse part whose id contains "eye"');

  const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });
  const rigs = new Map<string, AssetRigContract>([['lead_runner', runnerRig]]);

  const neutralFrame = createMockFrameState();
  neutralFrame.camera.position = [12, 123, 155];
  neutralFrame.camera.target = [12, 123, 0];
  neutralFrame.entities = [
    {
      rigId: 'lead_runner',
      worldPosition: [0, 75, 0],
      worldRotationZDegrees: 0,
      scale: [1.35, 1.35],
      jointAngles: {},
      jointOffsets: {},
      morphWeights: { mouthOpen: 0, browRaise: 0, blink: 0 },
      opacity: 1
    }
  ];

  const expressiveFrame = createMockFrameState();
  expressiveFrame.camera.position = [12, 123, 155];
  expressiveFrame.camera.target = [12, 123, 0];
  expressiveFrame.entities = [
    {
      rigId: 'lead_runner',
      worldPosition: [0, 75, 0],
      worldRotationZDegrees: 0,
      scale: [1.35, 1.35],
      jointAngles: {},
      jointOffsets: {},
      morphWeights: { mouthOpen: 1.0, browRaise: 1.0, blink: 0.9 },
      opacity: 1
    }
  ];

  const outNeutral = compositor.renderFrame(neutralFrame, rigs);
  const outExpressive = compositor.renderFrame(expressiveFrame, rigs);

  const pathRegex = /<path d="([^"]+)"/g;
  const neutralPaths = [...outNeutral.svg.matchAll(pathRegex)].map((m) => m[1]);
  const expressivePaths = [...outExpressive.svg.matchAll(pathRegex)].map((m) => m[1]);

  assert.ok(neutralPaths.length >= 1, 'Expected morph <path> element in neutral render');
  assert.ok(expressivePaths.length >= 1, 'Expected morph <path> element in expressive render');
  assert.notDeepEqual(
    neutralPaths,
    expressivePaths,
    'Active morphWeights { mouthOpen: 1, browRaise: 1, blink: 0.9 } must produce distinct <path> d attributes'
  );

  // Extract 12-vertex eye polygons (opacity="0.98") and compare vertical span (maxY - minY)
  const polyRegex = /<polygon points="([^"]+)"[^>]*opacity="0\.98"\/>/g;
  const getVerticalSpans = (svg: string): number[] =>
    [...svg.matchAll(polyRegex)].map((m) => {
      const ys = m[1]
        .trim()
        .split(/\s+/)
        .map((pair) => Number(pair.split(',')[1]));
      return Math.max(...ys) - Math.min(...ys);
    });

  const neutralSpans = getVerticalSpans(outNeutral.svg);
  const expressiveSpans = getVerticalSpans(outExpressive.svg);
  assert.equal(neutralSpans.length, expressiveSpans.length);
  assert.ok(
    expressiveSpans.some((span, idx) => span < neutralSpans[idx] * 0.5),
    'Eye optic ellipse vertical span must shrink significantly when blink=0.9'
  );
});

