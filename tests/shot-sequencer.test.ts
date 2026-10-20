import test from 'node:test';
import assert from 'node:assert/strict';
import { ShotSequencer } from '../src/engine/director/shot-sequencer.js';
import { CameraShakeSystem } from '../src/engine/director/camera-shake.js';
import type { DirectorStoryboardContract, CinematicShot } from '../src/schemas/storyboard.contract.js';
import type { AudioFrameFeature } from '../src/schemas/audio.contract.js';
import { computeCameraBasis } from '../src/engine/camera/camera-3d.js';

function createMockStoryboard(): DirectorStoryboardContract {
  const basePalette = {
    background: '#08081a',
    primary: '#00d4ff',
    secondary: '#ff0077',
    accent: '#ffe600',
    ambientLightColor: '#ffffff',
    ambientIntensity: 0.5,
    keyLightDirection: [0.5, 0.8, -0.3] as [number, number, number],
    audioReactiveGain: 1.0
  };

  const shots: CinematicShot[] = [
    {
      id: 'shot_0',
      shotIndex: 0,
      actNumber: 1,
      frameRange: { startFrameInclusive: 0, endFrameExclusive: 60 },
      framing: 'EXTREME_WIDE',
      movement: 'DOLLY',
      viewpoint: 'OBJECTIVE_THIRD_PERSON',
      cameraStart: {
        projectionMode: 'perspective',
        position: [-200, 260, 1500],
        target: [0, 200, 0],
        up: [0, 1, 0],
        nearPlane: 1,
        farPlane: 5000,
        rollDegrees: 0,
        verticalFovDegrees: 70
      },
      cameraEnd: {
        projectionMode: 'perspective',
        position: [-120, 230, 1150],
        target: [0, 200, 0],
        up: [0, 1, 0],
        nearPlane: 1,
        farPlane: 5000,
        rollDegrees: 0,
        verticalFovDegrees: 70
      },
      cameraEasing: 'easeInOutSine',
      palette: basePalette,
      narrativeAction: 'Establishing scene',
      activeRigIds: ['rig_char']
    },
    {
      id: 'shot_1',
      shotIndex: 1,
      actNumber: 2,
      frameRange: { startFrameInclusive: 60, endFrameExclusive: 120 },
      framing: 'MEDIUM',
      movement: 'ORBIT',
      viewpoint: 'OBJECTIVE_THIRD_PERSON',
      cameraStart: {
        projectionMode: 'perspective',
        position: [0, 100, 500],
        target: [0, 100, 0],
        up: [0, 1, 0],
        nearPlane: 1,
        farPlane: 3000,
        rollDegrees: 0,
        verticalFovDegrees: 50
      },
      cameraEnd: {
        projectionMode: 'perspective',
        position: [500, 100, 0],
        target: [0, 100, 0],
        up: [0, 1, 0],
        nearPlane: 1,
        farPlane: 3000,
        rollDegrees: 0,
        verticalFovDegrees: 50
      },
      cameraEasing: 'linear',
      palette: basePalette,
      narrativeAction: 'Orbiting runner',
      activeRigIds: ['rig_char']
    },
    {
      id: 'shot_2',
      shotIndex: 2,
      actNumber: 3,
      frameRange: { startFrameInclusive: 120, endFrameExclusive: 180 },
      framing: 'CLOSE_UP',
      movement: 'DOLLY',
      viewpoint: 'OBJECTIVE_THIRD_PERSON',
      cameraStart: {
        projectionMode: 'orthographic',
        position: [310, 140, 150],
        target: [300, 138, 0],
        up: [0, 1, 0],
        nearPlane: 1,
        farPlane: 2000,
        rollDegrees: 8,
        orthographicHeight: 1080
      },
      cameraEnd: {
        projectionMode: 'orthographic',
        position: [305, 138, 115],
        target: [300, 138, 0],
        up: [0, 1, 0],
        nearPlane: 1,
        farPlane: 2000,
        rollDegrees: 16,
        orthographicHeight: 1080
      },
      cameraEasing: 'springImpulse',
      palette: basePalette,
      narrativeAction: 'Close-up emotional morph',
      activeRigIds: ['rig_char']
    }
  ];

  return {
    projectId: 'test_storyboard',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    totalFrames: 180,
    acts: [
      { actNumber: 1, title: 'Act 1', narrativeArc: 'Intro', frameRange: { startFrameInclusive: 0, endFrameExclusive: 60 } },
      { actNumber: 2, title: 'Act 2', narrativeArc: 'Run', frameRange: { startFrameInclusive: 60, endFrameExclusive: 120 } },
      { actNumber: 3, title: 'Act 3', narrativeArc: 'Climax', frameRange: { startFrameInclusive: 120, endFrameExclusive: 180 } }
    ],
    shots
  };
}

test('ShotSequencer: Fast lookup at boundaries and progress normalized to [0, 1]', () => {
  const storyboard = createMockStoryboard();
  const sequencer = new ShotSequencer(storyboard);

  // Shot 0 boundaries: [0, 60)
  const f0 = sequencer.getShotForFrame(0);
  assert.equal(f0.shot.id, 'shot_0');
  assert.equal(f0.localFrame, 0);
  assert.equal(f0.normalizedProgress, 0);

  const f59 = sequencer.getShotForFrame(59);
  assert.equal(f59.shot.id, 'shot_0');
  assert.equal(f59.localFrame, 59);
  assert.equal(f59.normalizedProgress, 1.0);

  // Shot 1 boundaries: [60, 120)
  const f60 = sequencer.getShotForFrame(60);
  assert.equal(f60.shot.id, 'shot_1');
  assert.equal(f60.localFrame, 0);
  assert.equal(f60.normalizedProgress, 0);

  const f119 = sequencer.getShotForFrame(119);
  assert.equal(f119.shot.id, 'shot_1');
  assert.equal(f119.localFrame, 59);
  assert.equal(f119.normalizedProgress, 1.0);

  // Frame out of bounds throws
  assert.throws(() => sequencer.getShotForFrame(180), /Frame index 180 does not fall within/);
});

test('ShotSequencer: Camera interpolation with standard DOLLY and circular ORBIT', () => {
  const storyboard = createMockStoryboard();
  const sequencer = new ShotSequencer(storyboard);

  // Test DOLLY camera start and end
  const shot0 = storyboard.shots[0];
  const camStart = sequencer.interpolateCamera(shot0, 0);
  assert.deepEqual(camStart.position, shot0.cameraStart.position);

  const camEnd = sequencer.interpolateCamera(shot0, 1);
  assert.deepEqual(camEnd.position, shot0.cameraEnd.position);

  // Test ORBIT camera preserves circular radius around target [0, 100, 0]
  const shot1 = storyboard.shots[1];
  const center = shot1.cameraStart.target;
  const expectedRadius = 500;

  for (let step = 0; step <= 10; step++) {
    const prog = step / 10;
    const camOrbit = sequencer.interpolateCamera(shot1, prog);
    const dist = Math.hypot(
      camOrbit.position[0] - center[0],
      camOrbit.position[1] - center[1],
      camOrbit.position[2] - center[2]
    );
    assert.ok(
      Math.abs(dist - expectedRadius) < 1e-3,
      `ORBIT camera radius must be preserved at progress ${prog} (expected ${expectedRadius}, got ${dist})`
    );
  }
});

test('CameraShakeSystem: Zero shake when audio is silent or gain is 0', () => {
  const shakeSystem = new CameraShakeSystem({ seed: 42, fps: 30 });
  const storyboard = createMockStoryboard();
  const cam = storyboard.shots[0].cameraStart;
  const silentPalette = { ...storyboard.shots[0].palette, audioReactiveGain: 0 };

  const mockAudio = (f = 0): AudioFrameFeature => ({
    frameIndex: f,
    timestamp: f / 30,
    rms: 0,
    rmsRelativeGlobal: 0,
    rmsRelativeLocal: 0,
    localWindowFrames: 15,
    spectralFlux: 0,
    onsetStrength: 1.0,
    isOnset: true,
    bands: { subBass: 0, bass: 1, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0 }
  });

  const shakenCam = shakeSystem.applyShake(cam, 10, mockAudio, silentPalette);
  assert.deepEqual(shakenCam.position, cam.position);
  assert.deepEqual(shakenCam.target, cam.target);
  assert.equal(shakenCam.rollDegrees, cam.rollDegrees);
});

test('CameraShakeSystem: Non-degeneracy and bounds over 10 000 seeded samples', () => {
  const shakeSystem = new CameraShakeSystem({ seed: 9999, fps: 30 });
  const storyboard = createMockStoryboard();
  const cam = storyboard.shots[0].cameraStart;
  const palette = storyboard.shots[0].palette;

  const mockAudioWithKick = (f: number): AudioFrameFeature => ({
    frameIndex: f,
    timestamp: f / 30,
    rms: 0.5,
    rmsRelativeGlobal: 0.5,
    rmsRelativeLocal: 0.5,
    localWindowFrames: 15,
    spectralFlux: 0.2,
    onsetStrength: f % 15 === 0 ? 1.0 : 0.0,
    isOnset: f % 15 === 0,
    bands: { subBass: 0.5, bass: 0.8, lowMid: 0.3, mid: 0.4, highMid: 0.2, presence: 0.1, brilliance: 0.1 }
  });

  const distToTarget = Math.hypot(
    cam.target[0] - cam.position[0],
    cam.target[1] - cam.position[1],
    cam.target[2] - cam.position[2]
  );
  const maxAllowedTrans = 0.25 * distToTarget;

  for (let f = 0; f < 1000; f++) {
    const shaken = shakeSystem.applyShake(cam, f, mockAudioWithKick, palette);
    const trans = Math.hypot(
      shaken.position[0] - cam.position[0],
      shaken.position[1] - cam.position[1],
      shaken.position[2] - cam.position[2]
    );

    assert.ok(trans <= maxAllowedTrans, `Translation shake exceeded max bound at frame ${f}: ${trans}`);
    assert.ok(
      Math.abs(shaken.rollDegrees! - (cam.rollDegrees ?? 0)) <= 2.5 * palette.audioReactiveGain + 1e-4,
      `Roll shake exceeded bounds at frame ${f}`
    );

    // Basis must compute without error (non-degenerate)
    assert.doesNotThrow(() => computeCameraBasis(shaken));
  }
});
