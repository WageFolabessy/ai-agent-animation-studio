import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDeterministicStorySpec } from '../src/agents/story-spec-agent.js';
import { compileStorySpecToStoryboard } from '../src/engine/director/shot-planner.js';
import { solveChoreography } from '../src/engine/director/choreography-solver.js';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import { ShotSequencer } from '../src/engine/director/shot-sequencer.js';
import { computeCameraBasis, worldToCameraSpace } from '../src/engine/camera/camera-3d.js';
import { projectCameraPointToScreen } from '../src/engine/camera/clipping.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';

test('Mathematical Safe Framing Verification Suite', async (t) => {
  const manifestPath = path.resolve(process.cwd(), 'output/artifacts/56fef2ec779d/audio-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    t.skip('Skipping: Audio manifest for Trashed and Scattered is not cached on disk');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as AudioAnalysisManifest;
  const spec = buildDeterministicStorySpec(manifest, 'trashed-and-scattered-safe-framing');

  const rigsMap = new Map();
  for (const castItem of spec.cast) {
    const rig = ArchetypeFactory.build({ instanceId: castItem.instanceId, spec: castItem });
    rigsMap.set(castItem.instanceId, rig);
  }

  const storyboard = compileStorySpecToStoryboard(spec, manifest);
  solveChoreography(spec, storyboard, rigsMap);
  const sequencer = new ShotSequencer(storyboard);

  await t.test('All 10,598 frames obey z_c >= 135, safe horizontal framing, and head centering (< 1.0s)', () => {
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
      const { shot, normalizedProgress } = sequencer.getShotForFrame(f);
      const camera = sequencer.interpolateCamera(shot, normalizedProgress);
      const basis = computeCameraBasis(camera);

      // Character world coordinate at frame f
      const charPos: [number, number, number] = [f * 0.45, 75, 0];
      const pCamChar = worldToCameraSpace(charPos, camera, basis);
      const zc = pCamChar[2];
      if (zc < minZc) minZc = zc;

      if (zc < 135) {
        failures.push(`Frame ${f} (Shot ${shot.id}, ${shot.framing}): Camera distance zc=${zc.toFixed(1)} < 135 causes scale explosion`);
      }

      const pScreenChar = projectCameraPointToScreen(pCamChar, camera, 1920, 1080);
      if (pScreenChar.x < minXs) minXs = pScreenChar.x;
      if (pScreenChar.x > maxXs) maxXs = pScreenChar.x;

      if (shot.framing !== 'EXTREME_WIDE' && (pScreenChar.x < 384 || pScreenChar.x > 1536)) {
        failures.push(`Frame ${f} (Shot ${shot.id}, ${shot.framing}): Character screen X=${pScreenChar.x.toFixed(1)} outside [384, 1536]`);
      }

      // Head position (Y = 75 + 58 = 133, X = charX + 3)
      const headPos: [number, number, number] = [charPos[0] + 3, charPos[1] + 58, 0];
      const pCamHead = worldToCameraSpace(headPos, camera, basis);
      const pScreenHead = projectCameraPointToScreen(pCamHead, camera, 1920, 1080);

      if (shot.framing === 'CLOSE_UP' || shot.framing === 'MEDIUM') {
        if (pScreenHead.y < minYsHead) minYsHead = pScreenHead.y;
        if (pScreenHead.y > maxYsHead) maxYsHead = pScreenHead.y;

        if (pScreenHead.y < 194 || pScreenHead.y > 594) {
          failures.push(`Frame ${f} (Shot ${shot.id}, ${shot.framing}): Head screen Y=${pScreenHead.y.toFixed(1)} outside [194, 594]`);
        }
      }
    }

    const elapsed = performance.now() - t0;

    assert.equal(failures.length, 0, `Framing failures detected across ${failures.length} frames:\n${failures.slice(0, 10).join('\n')}`);
    assert.ok(elapsed < 1000, `Execution time ${elapsed.toFixed(1)}ms must be strictly < 1000ms (1.0s)`);
    assert.ok(minZc >= 135, `minZc ${minZc} must be >= 135`);
  });
});
