import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  Vec2Schema,
  Vec3Schema,
  FrameRangeSchema,
  CameraTransformSchema,
  PerspectiveCameraSchema,
  OrthographicCameraSchema,
  AudioBandEnergySchema,
  AudioFrameFeatureSchema,
  AudioAnalysisManifestSchema,
  DirectorStoryboardContractSchema,
  AssetRigContractSchema,
  FrameStateContractSchema
} from '../src/schemas/index.js';

test('Primitives: Vec2, Vec3, and FrameRange validation', () => {
  assert.deepEqual(Vec2Schema.parse([10.5, -20.2]), [10.5, -20.2]);
  assert.deepEqual(Vec3Schema.parse([0, 1, 2]), [0, 1, 2]);

  // FrameRange: valid
  const range = FrameRangeSchema.parse({
    startFrameInclusive: 0,
    endFrameExclusive: 150
  });
  assert.equal(range.startFrameInclusive, 0);
  assert.equal(range.endFrameExclusive, 150);

  // FrameRange: invalid (start >= end)
  assert.throws(() => {
    FrameRangeSchema.parse({
      startFrameInclusive: 100,
      endFrameExclusive: 50
    });
  });
});

test('Camera: Perspective & Orthographic Discriminated Union & Degeneracy Check', () => {
  // Valid perspective camera
  const persp = CameraTransformSchema.parse({
    projectionMode: 'perspective',
    position: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    verticalFovDegrees: 60,
    nearPlane: 0.1,
    farPlane: 1000,
    rollDegrees: 0
  });
  assert.equal(persp.projectionMode, 'perspective');

  // Valid orthographic camera
  const ortho = CameraTransformSchema.parse({
    projectionMode: 'orthographic',
    position: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    orthographicHeight: 1080,
    nearPlane: 0.1,
    farPlane: 1000,
    rollDegrees: 0
  });
  assert.equal(ortho.projectionMode, 'orthographic');

  // Degenerate camera: position === target
  assert.throws(() => {
    CameraTransformSchema.parse({
      projectionMode: 'perspective',
      position: [0, 0, 0],
      target: [0, 0, 0],
      up: [0, 1, 0],
      verticalFovDegrees: 60
    });
  });

  // Degenerate camera: up is collinear with view direction (target - position = [0, 10, 0], up = [0, 1, 0])
  assert.throws(() => {
    CameraTransformSchema.parse({
      projectionMode: 'perspective',
      position: [0, 0, 0],
      target: [0, 10, 0],
      up: [0, 1, 0],
      verticalFovDegrees: 60
    });
  });
});

test('JSON Schema Export: Native Zod 4 draft-07 export verification', () => {
  const jsonSchema = z.toJSONSchema(DirectorStoryboardContractSchema, { target: 'draft-07' });

  assert.equal(typeof jsonSchema, 'object');
  assert.notEqual(jsonSchema, null);

  const schemaObj = jsonSchema as Record<string, unknown>;
  assert.equal(schemaObj.type, 'object');
  assert.equal(typeof schemaObj.properties, 'object');
  assert.ok(Array.isArray(schemaObj.required));
  assert.ok((schemaObj.required as string[]).includes('projectId'));
  assert.ok((schemaObj.required as string[]).includes('acts'));
  assert.ok((schemaObj.required as string[]).includes('shots'));
});

test('Audio Manifest: Schema rejects invalid totalFrames or sampleRate', () => {
  const validManifest = {
    metadata: {
      audioFilePath: 'audio.mp3',
      sampleRate: 44100,
      durationSeconds: 5.0,
      fps: 30,
      totalFrames: 150,
      tempoBpm: 120
    },
    normalization: {
      globalRmsMax: 0.95,
      localWindowFrames: 15
    },
    lyrics: [],
    beatEvents: [],
    storageReference: {
      type: 'memory_columnar',
      columnLayoutVersion: 1
    }
  };

  assert.doesNotThrow(() => {
    AudioAnalysisManifestSchema.parse(validManifest);
  });

  // Invalid sample rate
  assert.throws(() => {
    AudioAnalysisManifestSchema.parse({
      ...validManifest,
      metadata: { ...validManifest.metadata, sampleRate: 22050 }
    });
  });
});

test('RenderConfig & Thread Mapping: Configuration and safe mapping verification', async () => {
  const { createRenderConfig, createTestRenderConfig, mapFfmpegThreads } = await import('../src/config/render-config.js');

  // Default threads is 2
  const prodConfig = createRenderConfig({
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 150
  });
  assert.equal(prodConfig.threads, 2);
  assert.equal(prodConfig.expectedFrameBytes, 1920 * 1080 * 4);

  // Test config allows non-1080p resolution without type errors or as any
  const testConfig = createTestRenderConfig({
    width: 64,
    height: 64,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 4,
    threads: 1
  });
  assert.equal(testConfig.width, 64);
  assert.equal(testConfig.height, 64);
  assert.equal(testConfig.expectedFrameBytes, 64 * 64 * 4);

  // Thread mapping checks: 'auto' maps to 2, not 0
  assert.deepEqual(mapFfmpegThreads('auto'), ['-threads', '2']);
  assert.deepEqual(mapFfmpegThreads(1), ['-threads', '1']);
  assert.deepEqual(mapFfmpegThreads(4), ['-threads', '4']);
});

test('AssetRigContract: Validates parts, pose interpolation, and view angle variants', () => {
  const validRig = {
    id: 'rig_hero',
    name: 'Hero Character',
    type: 'character',
    viewAngle: 'three_quarter',
    renderMode: 'billboard',
    baseTransform: {
      position: [0, 0, 0],
      rotationZDegrees: 0,
      scale: [1, 1]
    },
    skeleton: {
      rootJointId: 'joint_root',
      joints: [
        {
          id: 'joint_root',
          parentId: null,
          localOffset2D: [0, 0],
          length: 50,
          rotationZDegrees: 0
        },
        {
          id: 'joint_head',
          parentId: 'joint_root',
          localOffset2D: [0, 50],
          length: 30,
          rotationZDegrees: 0
        }
      ]
    },
    parts: [
      {
        id: 'part_torso',
        jointId: 'joint_root',
        localOffset2D: [0, 0],
        shape: { kind: 'rect', size: [40, 60] },
        style: { fill: { kind: 'solid', color: '#112233' }, opacity: 1, lit: true }
      },
      {
        id: 'part_head',
        jointId: 'joint_head',
        localOffset2D: [0, 0],
        shape: { kind: 'ellipse', radius: [20, 20] },
        style: { fill: { kind: 'palette', role: 'primary', shade: 0.1 }, opacity: 1, lit: true }
      }
    ],
    poseInterpolation: {
      interpolationMode: 'linear',
      loopFrames: 60,
      keyframes: [
        {
          frame: 0,
          jointTransforms: [
            { jointId: 'joint_root', rotationZDegrees: 0 },
            { jointId: 'joint_head', rotationZDegrees: 5 }
          ],
          easing: 'ease_in_out'
        },
        {
          frame: 30,
          jointTransforms: [
            { jointId: 'joint_root', rotationZDegrees: 10 },
            { jointId: 'joint_head', rotationZDegrees: -5 }
          ],
          easing: 'linear'
        }
      ]
    },
    svgAsset: {
      idNamespace: 'hero_ns'
    }
  };

  const parsed = AssetRigContractSchema.parse(validRig);
  assert.equal(parsed.viewAngle, 'three_quarter');
  assert.equal(parsed.parts.length, 2);
  assert.equal(parsed.poseInterpolation?.keyframes.length, 2);

  // Invalid viewAngle
  assert.throws(() => {
    AssetRigContractSchema.parse({
      ...validRig,
      viewAngle: 'isometric_top'
    });
  });

  // Invalid part style opacity (> 1.0)
  assert.throws(() => {
    AssetRigContractSchema.parse({
      ...validRig,
      parts: [
        {
          id: 'part_torso',
          jointId: 'joint_root',
          shape: { kind: 'rect', size: [40, 60] },
          style: { opacity: 1.5 }
        }
      ]
    });
  });

  // Invalid pose keyframe (negative frame)
  assert.throws(() => {
    AssetRigContractSchema.parse({
      ...validRig,
      poseInterpolation: {
        interpolationMode: 'linear',
        keyframes: [
          { frame: -1, jointTransforms: [{ jointId: 'joint_root', rotationZDegrees: 0 }] }
        ]
      }
    });
  });
});

test('ChoreographyContract: Validates entity tracks and morph bindings', async () => {
  const { ChoreographyContractSchema } = await import('../src/schemas/choreography.contract.js');

  const validChoreo = {
    projectId: 'demo_phase2',
    tracks: [
      {
        rigId: 'rig_hero',
        shotId: 'shot_1',
        transform: {
          keyframes: [
            {
              frame: 0,
              position: [0, 100, 500],
              rotationZDegrees: 0,
              scale: [1, 1],
              opacity: 1,
              easing: 'linear'
            },
            {
              frame: 30,
              position: [50, 100, 500],
              rotationZDegrees: 10,
              scale: [1, 1],
              opacity: 1,
              easing: 'easeInQuad'
            }
          ]
        },
        pose: {
          timeScale: 1,
          startPoseFrame: 0
        },
        morphKeyframes: {
          mouth_open: [{ frame: 0, weight: 0 }, { frame: 15, weight: 0.8 }]
        },
        morphBindings: [
          {
            target: 'mouth_open',
            source: 'audio.rms',
            gain: 1.5,
            bias: 0.1,
            spring: { zeta: 0.6, omega: 15 }
          }
        ]
      }
    ]
  };

  const parsed = ChoreographyContractSchema.parse(validChoreo);
  assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.tracks[0].transform.keyframes.length, 2);
  assert.equal(parsed.tracks[0].morphBindings.length, 1);
});

test('SvgViewBox: Validates negative, decimal, whitespace-delimited viewBoxes and rejects invalid dimensions', async () => {
  const { SvgViewBoxSchema } = await import('../src/schemas/rig.contract.js');

  // Valid: negative values
  assert.doesNotThrow(() => SvgViewBoxSchema.parse('-50 -50 100 100'));
  // Valid: decimal numbers
  assert.doesNotThrow(() => SvgViewBoxSchema.parse('0 0 1920.5 1080'));
  // Valid: with commas and mixed whitespace
  assert.doesNotThrow(() => SvgViewBoxSchema.parse(' -10.5,  20.25, 800.75,  600 '));

  // Invalid: less than 4 components
  assert.throws(() => SvgViewBoxSchema.parse('0 0 100'));
  // Invalid: more than 4 components
  assert.throws(() => SvgViewBoxSchema.parse('0 0 100 100 100'));
  // Invalid: non-numeric
  assert.throws(() => SvgViewBoxSchema.parse('0 0 abc 100'));
  // Invalid: width <= 0
  assert.throws(() => SvgViewBoxSchema.parse('0 0 0 100'));
  assert.throws(() => SvgViewBoxSchema.parse('0 0 -100 100'));
  // Invalid: height <= 0
  assert.throws(() => SvgViewBoxSchema.parse('0 0 100 0'));
  assert.throws(() => SvgViewBoxSchema.parse('0 0 100 -50'));
});

