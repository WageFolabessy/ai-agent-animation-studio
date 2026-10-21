import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSkeletonFK,
  applyAffine2D,
  createBillboardContext,
  projectBillboardPoint
} from '../src/engine/rigging/kinematics.js';
import { blendMorphTargets } from '../src/engine/rigging/morpher.js';
import { samplePoseTrack } from '../src/engine/rigging/deformer.js';
import type { AssetRigContract } from '../src/schemas/rig.contract.js';
import type { CameraTransform } from '../src/schemas/primitives.schema.js';
import { computeCameraBasis } from '../src/engine/camera/camera-3d.js';

test('Rigging FK: Evaluates 2-bone FK chain with translation and rotation correctly', () => {
  const skeleton = {
    rootJointId: 'root',
    joints: [
      {
        id: 'root',
        parentId: null,
        localOffset2D: [100, 100] as [number, number],
        length: 50,
        rotationZDegrees: 0
      },
      {
        id: 'arm',
        parentId: 'root',
        localOffset2D: [0, 50] as [number, number],
        length: 30,
        rotationZDegrees: 90, // rotated 90 deg CCW
        constraintsDeg: [-180, 180] as [number, number]
      }
    ]
  };

  const fkMap = computeSkeletonFK(skeleton, { root: 0, arm: 90 }, {});

  const rootTransform = fkMap.get('root')!;
  assert.equal(rootTransform.tx, 100);
  assert.equal(rootTransform.ty, 100);

  const armTransform = fkMap.get('arm')!;
  // Root origin is [100, 100], arm offset is [0, 50] -> arm origin is [100, 150]
  assert.equal(armTransform.tx, 100);
  assert.equal(armTransform.ty, 150);

  // Point [0, 10] in arm space. Rotated by 90 deg -> [-10, 0]. Added to origin [100, 150] -> [90, 150]
  const pWorld = applyAffine2D(armTransform, [0, 10]);
  assert.ok(Math.abs(pWorld[0] - 90) < 1e-4);
  assert.ok(Math.abs(pWorld[1] - 150) < 1e-4);
});

test('Rigging FK: Joint constraint clamping', () => {
  const skeleton = {
    rootJointId: 'root',
    joints: [
      {
        id: 'root',
        parentId: null,
        localOffset2D: [0, 0] as [number, number],
        length: 50,
        rotationZDegrees: 0,
        constraintsDeg: [-30, 30] as [number, number] // clamped to [-30, 30]
      }
    ]
  };

  // Provide angle 60 -> should clamp to 30
  const fkMap = computeSkeletonFK(skeleton, { root: 60 }, {});
  const transform = fkMap.get('root')!;
  // cos(30 deg) ~= 0.8660
  assert.ok(Math.abs(transform.a - Math.cos((30 * Math.PI) / 180)) < 1e-4);
});

test('Rigging Morpher: Blends base Bezier curves with additive target weights', () => {
  const baseSegments = [
    {
      p0: [0, 0] as [number, number],
      p1: [10, 20] as [number, number],
      p2: [20, 20] as [number, number],
      p3: [30, 0] as [number, number]
    }
  ];

  const targets = [
    {
      name: 'smile',
      segments: [
        {
          p0: [0, 0] as [number, number],
          p1: [10, 40] as [number, number],
          p2: [20, 40] as [number, number],
          p3: [30, 0] as [number, number]
        }
      ]
    }
  ];

  // At weight 0: identical to base
  const res0 = blendMorphTargets(baseSegments, targets, { smile: 0 });
  assert.deepEqual(res0.segments[0].p1, [10, 20]);

  // At weight 1: identical to smile
  const res1 = blendMorphTargets(baseSegments, targets, { smile: 1.0 });
  assert.deepEqual(res1.segments[0].p1, [10, 40]);

  // At weight 0.5: midpoint [10, 30]
  const resHalf = blendMorphTargets(baseSegments, targets, { smile: 0.5 });
  assert.deepEqual(resHalf.segments[0].p1, [10, 30]);

  // Commands contain M, C, Z
  assert.equal(resHalf.commands[0].cmd, 'M');
  assert.equal(resHalf.commands[1].cmd, 'C');
  assert.equal(resHalf.commands[2].cmd, 'Z');
});

test('Rigging Deformer: samplePoseTrack evaluates looping keyframes and Hermite spline', () => {
  const mockRig: AssetRigContract = {
    id: 'test_rig',
    name: 'Test Rig',
    type: 'character',
    baseTransform: { position: [0, 0, 0], rotationZDegrees: 0, scale: [1, 1] },
    skeleton: {
      rootJointId: 'root',
      joints: [{ id: 'root', parentId: null, localOffset2D: [0, 0], length: 10, rotationZDegrees: 0 }]
    },
    parts: [],
    secondaryMotion: [],
    poseInterpolation: {
      interpolationMode: 'linear',
      loopFrames: 30,
      keyframes: [
        { frame: 0, jointTransforms: [{ jointId: 'root', rotationZDegrees: 0 }] },
        { frame: 30, jointTransforms: [{ jointId: 'root', rotationZDegrees: 60 }] }
      ]
    },
    svgAsset: { idNamespace: 'test_ns' }
  };

  // At frame 15: progress 0.5 -> angle 30
  const pose15 = samplePoseTrack(mockRig, 15, 0);
  assert.ok(Math.abs(pose15.jointAngles.root - 30) < 1e-4);

  // At frame 45 (looping with loopFrames = 30): 45 mod 30 = 15 -> angle 30
  const pose45 = samplePoseTrack(mockRig, 45, 0);
  assert.ok(Math.abs(pose45.jointAngles.root - 30) < 1e-4);
});

test('Rigging Billboard: Context rejects points behind nearPlane and produces exact uniform similarity', () => {
  const camera: CameraTransform = {
    projectionMode: 'perspective',
    position: [0, 0, 500],
    target: [0, 0, 0],
    up: [0, 1, 0],
    nearPlane: 10,
    farPlane: 2000,
    rollDegrees: 0,
    verticalFovDegrees: 60
  };
  const basis = computeCameraBasis(camera);

  // Entity behind camera (z = 600 > camera position 500 => behind nearPlane in camera space)
  const ctxBehind = createBillboardContext([0, 0, 600], 0, [1, 1], camera, basis);
  assert.equal(ctxBehind, null);

  // Entity in front of camera at origin [0, 0, 0] (camera depth = 500)
  const ctx = createBillboardContext([0, 0, 0], 0, [1, 1], camera, basis);
  assert.ok(ctx !== null);
  assert.equal(ctx.depthZ, 500);

  // Origin projects to screen center [960, 540]
  const screenOrigin = projectBillboardPoint([0, 0], ctx);
  assert.ok(Math.abs(screenOrigin[0] - 960) < 1e-4);
  assert.ok(Math.abs(screenOrigin[1] - 540) < 1e-4);

  // Rig point [100, 50] (+x right, +y up): screen x increases, screen y decreases (SVG y-flip)
  const screenPoint = projectBillboardPoint([100, 50], ctx);
  assert.ok(screenPoint[0] > 960);
  assert.ok(screenPoint[1] < 540);
});
