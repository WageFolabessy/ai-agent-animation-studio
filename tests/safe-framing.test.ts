import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDeterministicStorySpec } from '../src/agents/story-spec-agent.js';
import { compileStorySpecToStoryboard } from '../src/engine/director/shot-planner.js';
import { solveChoreography } from '../src/engine/director/choreography-solver.js';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import { ShotSequencer } from '../src/engine/director/shot-sequencer.js';
import { computeCameraBasis } from '../src/engine/camera/camera-3d.js';
import {
  computeSkeletonFK,
  createBillboardContext,
  projectBillboardPoint,
  applyAffine2D
} from '../src/engine/rigging/kinematics.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';

test('Mathematical Safe Framing Verification Suite', async (t) => {
  const manifestPath = path.resolve(process.cwd(), 'output/artifacts/56fef2ec779d/audio-manifest.json');
  let manifest: AudioAnalysisManifest;

  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as AudioAnalysisManifest;
  } else {
    // Deterministic in-memory manifest fallback so suite ALWAYS executes (0 skips)
    const totalFrames = 10598;
    const fps = 30;
    const durationSeconds = totalFrames / fps;
    manifest = {
      metadata: {
        audioFilePath: 'trashed-and-scattered.wav',
        durationSeconds,
        sampleRate: 44100,
        fps,
        totalFrames,
        tempoBpm: 174,
        tempoConfidence: 0.95
      },
      normalization: {
        globalRmsMax: 1.0,
        localWindowFrames: 90
      },
      storageReference: {
        type: 'external_binary',
        columnLayoutVersion: 1,
        binaryFilePath: 'trashed-and-scattered.features.bin',
        byteLength: totalFrames * 53 + 32,
        sha256: '0000000000000000000000000000000000000000000000000000000000000000'
      },
      beatEvents: [],
      beatGrid: {
        tempoBpm: 174,
        tempoConfidence: 0.95,
        framesPerBeat: (60 / 174) * 30,
        framesPerBar: 4 * (60 / 174) * 30,
        beatFrameIndices: []
      },
      sections: [
        { id: 'sec-1', startFrame: 0, endFrame: 1200, relativeEnergy: 0.35, hasVocals: false, dominantBand: 'mid' },
        { id: 'sec-2', startFrame: 1200, endFrame: 3200, relativeEnergy: 0.75, hasVocals: true, dominantBand: 'presence' },
        { id: 'sec-3', startFrame: 3200, endFrame: 5400, relativeEnergy: 0.88, hasVocals: true, dominantBand: 'presence' },
        { id: 'sec-4', startFrame: 5400, endFrame: 7200, relativeEnergy: 0.95, hasVocals: false, dominantBand: 'brilliance' },
        { id: 'sec-5', startFrame: 7200, endFrame: 9200, relativeEnergy: 0.85, hasVocals: true, dominantBand: 'presence' },
        { id: 'sec-6', startFrame: 9200, endFrame: totalFrames, relativeEnergy: 0.3, hasVocals: false, dominantBand: 'mid' }
      ],
      lyrics: []
    };
  }

  const spec = buildDeterministicStorySpec(manifest, 'trashed-and-scattered-safe-framing');

  const rigsMap = new Map();
  for (const castItem of spec.cast) {
    const rig = ArchetypeFactory.build({ instanceId: castItem.instanceId, spec: castItem });
    rigsMap.set(castItem.instanceId, rig);
  }

  const storyboard = compileStorySpecToStoryboard(spec, manifest);
  const choreography = solveChoreography(spec, storyboard, rigsMap);
  const sequencer = new ShotSequencer(storyboard);

  // Safeguard 3: Select the lead biped runner rig
  const leadCastItem = spec.cast.find((c) => c.archetypeId === 'biped_runner') ?? spec.cast[0];
  const leadRigId = leadCastItem.instanceId;
  const leadRig = rigsMap.get(leadRigId)!;

  const stateBuilder = new FrameStateBuilder({
    storyboard,
    audioManifest: manifest,
    rigs: rigsMap,
    choreography,
    getAudioFeatureAtFrame: (_f) => ({
      frameIndex: _f,
      timestamp: _f / 30,
      rms: 0.5,
      rmsRelativeGlobal: 0.5,
      rmsRelativeLocal: 0.5,
      localWindowFrames: 90,
      spectralFlux: 0.3,
      onsetStrength: 0.2,
      isOnset: false,
      bands: {
        subBass: 0.3,
        bass: 0.4,
        lowMid: 0.4,
        mid: 0.5,
        highMid: 0.4,
        presence: 0.4,
        brilliance: 0.3
      }
    })
  });

  await t.test('All 10,598 frames obey z_c >= 135, safe horizontal framing, and head centering (< 1.5s)', () => {
    const totalFrames = storyboard.totalFrames;
    assert.equal(totalFrames, 10598, 'Total frames must equal 10,598 for Trashed and Scattered');

    const t0 = performance.now();
    let minZc = Infinity;
    let minXs = Infinity;
    let maxXs = -Infinity;
    let minYsHead = Infinity;
    let maxYsHead = -Infinity;
    const failures: string[] = [];

    for (let f = 0; f < totalFrames; f++) {
      const { shot } = sequencer.getShotForFrame(f);
      const frameState = stateBuilder.buildFrameState(f);
      const basis = computeCameraBasis(frameState.camera);

      const leadEntity = frameState.entities.find((e) => e.rigId === leadRigId);
      if (!leadEntity) {
        failures.push(`Frame ${f}: Lead entity ${leadRigId} not found in frameState`);
        continue;
      }

      const ctx = createBillboardContext(
        leadEntity.worldPosition,
        leadEntity.worldRotationZDegrees,
        leadEntity.scale,
        frameState.camera,
        basis,
        1920,
        1080
      );

      if (!ctx) {
        failures.push(`Frame ${f}: Billboard projection context rejected behind camera`);
        continue;
      }

      const zc = ctx.depthZ;
      if (zc < minZc) minZc = zc;

      if (zc < 135) {
        failures.push(`Frame ${f} (Shot ${shot.id}, ${shot.framing}): Camera distance zc=${zc.toFixed(1)} < 135 causes scale explosion`);
      }

      const pScreenPelvis = ctx.screenAnchor;
      if (pScreenPelvis.x < minXs) minXs = pScreenPelvis.x;
      if (pScreenPelvis.x > maxXs) maxXs = pScreenPelvis.x;

      if (shot.framing !== 'EXTREME_WIDE' && (pScreenPelvis.x < 384 || pScreenPelvis.x > 1536)) {
        failures.push(`Frame ${f} (Shot ${shot.id}, ${shot.framing}): Character screen X=${pScreenPelvis.x.toFixed(1)} outside [384, 1536]`);
      }

      // Safeguard 3: Compute actual FK for head joint + cranial visor center at local offset [4, 18]
      const fk = computeSkeletonFK(leadRig.skeleton!, leadEntity.jointAngles, leadEntity.jointOffsets);
      const headAffine = fk.get('head');
      const visorRigPoint: [number, number] = headAffine ? applyAffine2D(headAffine, [4, 18]) : [0, 56];
      const [, syHead] = projectBillboardPoint(visorRigPoint, ctx);

      if (shot.framing === 'CLOSE_UP' || shot.framing === 'MEDIUM') {
        if (syHead < minYsHead) minYsHead = syHead;
        if (syHead > maxYsHead) maxYsHead = syHead;

        if (syHead < 150 || syHead > 680) {
          failures.push(`Frame ${f} (Shot ${shot.id}, ${shot.framing}): Head screen Y=${syHead.toFixed(1)} outside [150, 680]`);
        }
      }
    }

    const elapsed = performance.now() - t0;

    assert.equal(failures.length, 0, `Framing failures detected across ${failures.length} frames:\n${failures.slice(0, 10).join('\n')}`);
    assert.ok(elapsed < 1500, `Execution time ${elapsed.toFixed(1)}ms must be strictly < 1500ms (1.5s)`);
    assert.ok(minZc >= 135, `minZc ${minZc} must be >= 135`);
  });
});
