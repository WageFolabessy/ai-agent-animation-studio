import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipAndProjectLine,
  clipAndProjectPolygon,
  clipLineToViewport,
  type ScreenPoint
} from '../src/engine/camera/clipping.js';
import { computeCameraBasis } from '../src/engine/camera/camera-3d.js';
import type { CameraTransform, Vec3 } from '../src/schemas/primitives.schema.js';

const defaultCamera: CameraTransform = {
  projectionMode: 'perspective',
  position: [0, 0, 500],
  target: [0, 0, 0],
  up: [0, 1, 0],
  verticalFovDegrees: 60,
  nearPlane: 10,
  farPlane: 2000,
  rollDegrees: 0
};

const basis = computeCameraBasis(defaultCamera);

test('Clipping: Line with one endpoint behind nearPlane still produces valid clipped segment', () => {
  // P0 is in front of camera at z_world = 200 (in camera space: z_c = 500 - 200 = 300, valid)
  // P1 is behind nearPlane at z_world = 550 (in camera space: z_c = 500 - 550 = -50, behind camera)
  const p0World: Vec3 = [0, 0, 200];
  const p1World: Vec3 = [0, 0, 550];

  const clipped = clipAndProjectLine(p0World, p1World, defaultCamera, basis, 1920, 1080);

  assert.ok(clipped !== null, 'Line segment partially behind nearPlane must not be rejected');
  // Point clipped at nearPlane (z_c = 10)
  assert.ok(clipped.p0.zDepth >= 10, 'Endpoint zDepth must be >= nearPlane');
  assert.ok(clipped.p1.zDepth >= 10, 'Endpoint zDepth must be >= nearPlane');
  // Screen coordinates must be within viewport boundaries [0, 1920] x [0, 1080]
  assert.ok(clipped.p0.x >= 0 && clipped.p0.x <= 1920, 'p0.x within screen');
  assert.ok(clipped.p0.y >= 0 && clipped.p0.y <= 1080, 'p0.y within screen');
  assert.ok(clipped.p1.x >= 0 && clipped.p1.x <= 1920, 'p1.x within screen');
  assert.ok(clipped.p1.y >= 0 && clipped.p1.y <= 1080, 'p1.y within screen');
});

test('Clipping: Line completely behind nearPlane or beyond farPlane is rejected', () => {
  // Both endpoints behind camera (z_c < 0)
  const behind0: Vec3 = [0, 0, 600];
  const behind1: Vec3 = [100, 100, 700];
  assert.equal(clipAndProjectLine(behind0, behind1, defaultCamera, basis), null);

  // Both endpoints beyond farPlane (farPlane = 2000, position = 500 => z_world < -1500)
  const far0: Vec3 = [0, 0, -2000];
  const far1: Vec3 = [100, 100, -2100];
  assert.equal(clipAndProjectLine(far0, far1, defaultCamera, basis), null);
});

test('Clipping: Line outside screen viewport is rejected or clipped to boundaries', () => {
  // Line completely outside screen viewport (x far to the right)
  const outside0: Vec3 = [5000, 0, 0];
  const outside1: Vec3 = [6000, 0, 0];
  assert.equal(clipAndProjectLine(outside0, outside1, defaultCamera, basis), null);

  // Line from inside screen crossing right viewport boundary
  const inside0: Vec3 = [0, 0, 0]; // Center of screen (x=960, y=540)
  const farRight1: Vec3 = [2000, 0, 0]; // Far right outside screen

  const clipped = clipAndProjectLine(inside0, farRight1, defaultCamera, basis, 1920, 1080);
  assert.ok(clipped !== null, 'Line crossing viewport boundary must be clipped');
  assert.ok(Math.abs(clipped.p0.x - 960) < 1, 'Screen center p0.x = 960');
  assert.ok(Math.abs(clipped.p1.x - 1920) < 1e-4, 'Clipped endpoint must be exactly at viewport edge x=1920');
});

test('Clipping: Polygon partially crossing nearPlane produces valid clipped polygon', () => {
  // Triangle where 2 vertices are in front of nearPlane and 1 vertex is behind nearPlane
  // position z = 500, nearPlane = 10 (z_c >= 10 => z_world <= 490)
  const v0: Vec3 = [-100, -50, 400]; // z_c = 100 (in front)
  const v1: Vec3 = [100, -50, 400];  // z_c = 100 (in front)
  const v2: Vec3 = [0, 50, 520];     // z_c = -20 (behind nearPlane)

  const clipped = clipAndProjectPolygon([v0, v1, v2], defaultCamera, basis, 1920, 1080);

  assert.ok(clipped !== null, 'Polygon crossing nearPlane must produce clipped polygon');
  // Sutherland-Hodgman clips 1 behind vertex into 2 vertices on the near plane, yielding quadrilateral
  assert.ok(clipped.vertices.length >= 3, `Clipped vertex count must be >= 3 (found: ${clipped.vertices.length})`);

  for (const v of clipped.vertices) {
    assert.ok(v.zDepth >= 10 - 1e-6, `Vertex zDepth (${v.zDepth}) must be >= nearPlane (10)`);
    assert.ok(v.x >= 0 && v.x <= 1920, `Vertex x (${v.x}) must be within viewport`);
    assert.ok(v.y >= 0 && v.y <= 1080, `Vertex y (${v.y}) must be within viewport`);
  }
});

test('Clipping: Polygon completely outside frustum or behind camera is rejected', () => {
  const v0: Vec3 = [-100, -50, 600];
  const v1: Vec3 = [100, -50, 600];
  const v2: Vec3 = [0, 50, 700];

  const clipped = clipAndProjectPolygon([v0, v1, v2], defaultCamera, basis, 1920, 1080);
  assert.equal(clipped, null, 'Polygon completely behind camera must be null');
});

test('Clipping: 2D Line Viewport Liang-Barsky preserves line fully inside', () => {
  const p0: ScreenPoint = { x: 100, y: 100, zDepth: 50 };
  const p1: ScreenPoint = { x: 500, y: 400, zDepth: 100 };

  const res = clipLineToViewport(p0, p1, 1920, 1080);
  assert.ok(res !== null);
  assert.equal(res.p0.x, 100);
  assert.equal(res.p0.y, 100);
  assert.equal(res.p1.x, 500);
  assert.equal(res.p1.y, 400);
});

test('Clipping: Polygon partially crossing screen viewport boundaries is clipped to screen boundaries', () => {
  // Triangle where V0 and V1 are inside viewport, but V2 is far outside screen right edge
  // camera pos: [0, 0, 500], target: [0, 0, 0], fov: 60
  const v0: Vec3 = [0, 0, 0];       // Center of screen (x=960, y=540)
  const v1: Vec3 = [0, 200, 0];     // Above center of screen (x=960, y < 540)
  const v2: Vec3 = [1500, 0, 0];    // Far to the right (unclipped x > 1920)

  const clipped = clipAndProjectPolygon([v0, v1, v2], defaultCamera, basis, 1920, 1080);

  assert.ok(clipped !== null, 'Polygon partially crossing viewport boundary must not be null');
  assert.ok(
    clipped.vertices.length >= 3,
    `Clipped polygon must have >= 3 vertices (found: ${clipped.vertices.length})`
  );

  let foundBoundaryVertex = false;
  for (const v of clipped.vertices) {
    assert.ok(v.x >= 0 && v.x <= 1920, `Vertex x (${v.x}) must be within viewport [0, 1920]`);
    assert.ok(v.y >= 0 && v.y <= 1080, `Vertex y (${v.y}) must be within viewport [0, 1080]`);
    if (Math.abs(v.x - 1920) < 1e-4) {
      foundBoundaryVertex = true;
    }
  }

  assert.ok(foundBoundaryVertex, 'Clipped polygon must have a vertex clipped precisely at x=1920 boundary');
});
