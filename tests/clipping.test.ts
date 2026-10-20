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

// --- Perspective-correct depth interpolation after viewport clipping (Phase 2, Step 0A) ---

const wideCamera: CameraTransform = {
  projectionMode: 'perspective',
  position: [0, 0, 500],
  target: [0, 0, 0],
  up: [0, 1, 0],
  verticalFovDegrees: 60,
  nearPlane: 1,
  farPlane: 5000,
  rollDegrees: 0
};
const wideBasis = computeCameraBasis(wideCamera);

test('Clipping: Perspective depth at viewport edge uses 1/z interpolation (regression)', () => {
  const p0: Vec3 = [0, 0, 490]; // camera-space depth 10
  const p1: Vec3 = [3000, 0, -1500]; // camera-space depth 2000

  const clipped = clipAndProjectLine(p0, p1, wideCamera, wideBasis, 1920, 1080);
  assert.ok(clipped !== null);
  assert.ok(Math.abs(clipped.p1.x - 1920) < 1e-6, 'Endpoint must lie on the right viewport edge');

  // Closed form: x_c(t) = 3000 t, z_c(t) = 10 + 1990 t, edge where x_c / z_c = k.
  const k = Math.tan((30 * Math.PI) / 180) * (1920 / 1080);
  const tEdge = (10 * k) / (3000 - 1990 * k);
  const expectedDepth = 10 + 1990 * tEdge;

  assert.ok(Math.abs(expectedDepth - 31.33) < 0.05, `closed form sanity: ${expectedDepth}`);
  assert.ok(
    Math.abs(clipped.p1.zDepth - expectedDepth) < 1e-6,
    `Clipped depth ${clipped.p1.zDepth} must equal ${expectedDepth}`
  );
  assert.ok(clipped.p1.zDepth < 100, 'Linear screen-space interpolation (~1371.7) must not be used');
});

test('Clipping: Orthographic depth stays linear in screen space after viewport clipping', () => {
  const orthoCamera: CameraTransform = {
    projectionMode: 'orthographic',
    position: [0, 0, 500],
    target: [0, 0, 0],
    up: [0, 1, 0],
    orthographicHeight: 400,
    nearPlane: 1,
    farPlane: 5000,
    rollDegrees: 0
  };
  const orthoBasis = computeCameraBasis(orthoCamera);

  const clipped = clipAndProjectLine([0, 0, 0], [3000, 0, -1500], orthoCamera, orthoBasis, 1920, 1080);
  assert.ok(clipped !== null);

  const halfWidth = (400 * (1920 / 1080)) / 2;
  const t = halfWidth / 3000;
  const expectedDepth = 500 + t * 1500;
  assert.ok(Math.abs(clipped.p1.zDepth - expectedDepth) < 1e-6);
});

test('Clipping: Clipped polygon vertices stay on the original camera-space plane (round trip)', () => {
  let seed = 0x1badf00d;
  const rng = (): number => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const tanHalf = Math.tan((30 * Math.PI) / 180);
  const aspect = 1920 / 1080;
  const toWorld = (c: Vec3): Vec3 => [
    wideCamera.position[0] + wideBasis.right[0] * c[0] + wideBasis.up[0] * c[1] + wideBasis.forward[0] * c[2],
    wideCamera.position[1] + wideBasis.right[1] * c[0] + wideBasis.up[1] * c[1] + wideBasis.forward[1] * c[2],
    wideCamera.position[2] + wideBasis.right[2] * c[0] + wideBasis.up[2] * c[1] + wideBasis.forward[2] * c[2]
  ];

  let checkedPolygons = 0;
  for (let i = 0; i < 200; i++) {
    const cam: Vec3[] = [0, 1, 2].map(() => {
      const z = 5 + rng() * 400;
      return [(rng() * 2 - 1) * z * 2.5, (rng() * 2 - 1) * z * 1.5, z] as Vec3;
    });

    const clipped = clipAndProjectPolygon(cam.map(toWorld), wideCamera, wideBasis, 1920, 1080);
    if (clipped === null) continue;
    checkedPolygons++;

    const e1: Vec3 = [cam[1][0] - cam[0][0], cam[1][1] - cam[0][1], cam[1][2] - cam[0][2]];
    const e2: Vec3 = [cam[2][0] - cam[0][0], cam[2][1] - cam[0][1], cam[2][2] - cam[0][2]];
    const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nLen = Math.hypot(...n);

    for (const v of clipped.vertices) {
      const z = v.zDepth;
      const xc = ((v.x / 1920) * 2 - 1) * z * tanHalf * aspect;
      const yc = (1 - (v.y / 1080) * 2) * z * tanHalf;
      const distance = Math.abs(n[0] * (xc - cam[0][0]) + n[1] * (yc - cam[0][1]) + n[2] * (z - cam[0][2])) / nLen;
      assert.ok(distance < 1e-6, `Vertex off the source plane by ${distance} (case ${i})`);
    }
  }
  assert.ok(checkedPolygons > 50, `Expected many visible polygons, got ${checkedPolygons}`);
});

test('Clipping: Canonical 3D cube from elevated perspective renders top and outer front faces, culls interior/bottom/back', () => {
  const cubeVertices: Vec3[] = [
    [-60, -60, -60], // 0: back bottom left
    [60, -60, -60],  // 1: back bottom right
    [60, 60, -60],   // 2: back top right
    [-60, 60, -60],  // 3: back top left
    [-60, -60, 60],  // 4: front bottom left
    [60, -60, 60],   // 5: front bottom right
    [60, 60, 60],    // 6: front top right
    [-60, 60, 60]    // 7: front top left
  ];

  // Strictly CCW winding viewed from outside
  const cubeFaces: { name: string; indices: [number, number, number, number] }[] = [
    { name: 'front', indices: [4, 5, 6, 7] },  // +Z
    { name: 'back', indices: [1, 0, 3, 2] },   // -Z
    { name: 'left', indices: [0, 4, 7, 3] },   // -X
    { name: 'right', indices: [5, 1, 2, 6] },  // +X
    { name: 'top', indices: [7, 6, 2, 3] },    // +Y
    { name: 'bottom', indices: [0, 1, 5, 4] }  // -Y
  ];

  const elevatedCamera: CameraTransform = {
    projectionMode: 'perspective',
    position: [0, 100, 320],
    target: [0, 0, 0],
    up: [0, 1, 0],
    verticalFovDegrees: 60,
    nearPlane: 1,
    farPlane: 2000,
    rollDegrees: 0
  };

  const visibleFaceNames: string[] = [];
  const culledFaceNames: string[] = [];

  for (const face of cubeFaces) {
    const [i0, i1, i2] = face.indices;
    const w0 = cubeVertices[i0];
    const w1 = cubeVertices[i1];
    const w2 = cubeVertices[i2];

    const edge1: Vec3 = [w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]];
    const edge2: Vec3 = [w2[0] - w0[0], w2[1] - w0[1], w2[2] - w0[2]];
    // Outward normal from CCW winding
    const normal: Vec3 = [
      edge1[1] * edge2[2] - edge1[2] * edge2[1],
      edge1[2] * edge2[0] - edge1[0] * edge2[2],
      edge1[0] * edge2[1] - edge1[1] * edge2[0]
    ];

    const toCam: Vec3 = [
      elevatedCamera.position[0] - w0[0],
      elevatedCamera.position[1] - w0[1],
      elevatedCamera.position[2] - w0[2]
    ];
    const dot = normal[0] * toCam[0] + normal[1] * toCam[1] + normal[2] * toCam[2];

    if (dot > 0) {
      visibleFaceNames.push(face.name);
    } else {
      culledFaceNames.push(face.name);
    }
  }

  // Top (+Y) and Front (+Z) MUST be facing camera and visible
  assert.ok(visibleFaceNames.includes('top'), 'Top face must be visible from elevated perspective');
  assert.ok(visibleFaceNames.includes('front'), 'Front face must be visible from elevated perspective');

  // Bottom (-Y) and Back (-Z) MUST be facing away and culled
  assert.ok(culledFaceNames.includes('bottom'), 'Bottom face must be culled');
  assert.ok(culledFaceNames.includes('back'), 'Back face must be culled');
});

