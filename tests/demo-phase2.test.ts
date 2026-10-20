import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  demoStoryboard,
  demoRigsMap,
  demoAudioManifest,
  DemoAudioFeatureReader,
  demoChoreography,
  getDemoEnvironment,
  DEMO_TOTAL_FRAMES,
  DEMO_ONSET_FRAMES
} from '../src/demo/phase2-cinema/index.js';
import { validateProjectContracts, validateChoreography } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import { assertValidSvgPolicy } from '../src/engine/compositor/svg-policy-validator.js';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';

test('Demo Phase 2: Contracts pass all validators with zero errors', () => {
  const renderConfig = createRenderConfig({
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 180,
    preset: 'veryfast',
    crf: 18,
    threads: 2
  });

  const projectReport = validateProjectContracts(
    demoAudioManifest,
    demoStoryboard,
    renderConfig,
    demoRigsMap
  );

  const fatalOrErrors = projectReport.errors.filter(
    (e) => e.severity === 'fatal' || e.severity === 'error'
  );
  assert.equal(
    fatalOrErrors.length,
    0,
    `Project validation failed: ${JSON.stringify(fatalOrErrors, null, 2)}`
  );
  assert.equal(projectReport.isValid, true);

  const choreoReport = validateChoreography(demoChoreography, demoStoryboard, demoRigsMap);
  const choreoErrors = choreoReport.errors.filter(
    (e) => e.severity === 'fatal' || e.severity === 'error'
  );
  assert.equal(
    choreoErrors.length,
    0,
    `Choreography validation failed: ${JSON.stringify(choreoErrors, null, 2)}`
  );
  assert.equal(choreoReport.isValid, true);
});

test('Demo Phase 2: All 180 frames generate policy-valid SVG within §8.4 budget', () => {
  const audioReader = new DemoAudioFeatureReader();
  const builder = new FrameStateBuilder({
    storyboard: demoStoryboard,
    audioManifest: demoAudioManifest,
    rigs: demoRigsMap,
    choreography: demoChoreography,
    getAudioFeatureAtFrame: (f) => audioReader.getFrameFeature(f)
  });

  const compositor = new SceneCompositor({
    width: 1920,
    height: 1080,
    fps: 30
  });

  let maxDrawables = 0;
  let maxGradients = 0;
  let maxParticles = 0;

  for (let f = 0; f < DEMO_TOTAL_FRAMES; f++) {
    const frameState = builder.buildFrameState(f);
    const env = getDemoEnvironment(frameState.shotId);
    const result = compositor.renderFrame(
      frameState,
      demoRigsMap,
      env,
      DEMO_ONSET_FRAMES,
      (idx) => audioReader.getFrameFeature(idx)
    );

    // Validate SVG Security Policy
    assertValidSvgPolicy(result.svg);

    // Check §8.4 Scene Budget
    assert.ok(
      result.stats.drawablesCount <= 220,
      `Frame ${f}: drawables count ${result.stats.drawablesCount} > limit 220`
    );
    assert.ok(
      result.stats.gradientShapesCount <= 100,
      `Frame ${f}: gradient shapes count ${result.stats.gradientShapesCount} > limit 100`
    );
    assert.ok(
      result.stats.particlesCount <= 150,
      `Frame ${f}: particles count ${result.stats.particlesCount} > limit 150`
    );
    assert.equal(result.stats.filtersCount, 0, `Frame ${f}: filters must be 0`);

    if (result.stats.drawablesCount > maxDrawables) maxDrawables = result.stats.drawablesCount;
    if (result.stats.gradientShapesCount > maxGradients) maxGradients = result.stats.gradientShapesCount;
    if (result.stats.particlesCount > maxParticles) maxParticles = result.stats.particlesCount;
  }

  assert.ok(maxDrawables > 0, 'Compositor emitted drawables');
});

test('Demo Phase 2: Determinism check (identical SHA-256 hashes across independent runs)', () => {
  const audioReader1 = new DemoAudioFeatureReader();
  const builder1 = new FrameStateBuilder({
    storyboard: demoStoryboard,
    audioManifest: demoAudioManifest,
    rigs: demoRigsMap,
    choreography: demoChoreography,
    getAudioFeatureAtFrame: (f) => audioReader1.getFrameFeature(f)
  });
  const comp1 = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });

  const audioReader2 = new DemoAudioFeatureReader();
  const builder2 = new FrameStateBuilder({
    storyboard: demoStoryboard,
    audioManifest: demoAudioManifest,
    rigs: demoRigsMap,
    choreography: demoChoreography,
    getAudioFeatureAtFrame: (f) => audioReader2.getFrameFeature(f)
  });
  const comp2 = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });

  // Sample frames across all 4 shots
  const sampleFrames = [0, 25, 59, 60, 80, 99, 100, 120, 134, 135, 155, 179];

  for (const f of sampleFrames) {
    const s1 = builder1.buildFrameState(f);
    const env1 = getDemoEnvironment(s1.shotId);
    const r1 = comp1.renderFrame(
      s1,
      demoRigsMap,
      env1,
      DEMO_ONSET_FRAMES,
      (idx) => audioReader1.getFrameFeature(idx)
    );

    const s2 = builder2.buildFrameState(f);
    const env2 = getDemoEnvironment(s2.shotId);
    const r2 = comp2.renderFrame(
      s2,
      demoRigsMap,
      env2,
      DEMO_ONSET_FRAMES,
      (idx) => audioReader2.getFrameFeature(idx)
    );

    const hash1 = crypto.createHash('sha256').update(r1.svg).digest('hex');
    const hash2 = crypto.createHash('sha256').update(r2.svg).digest('hex');

    assert.equal(hash1, hash2, `Frame ${f} SVG output must be strictly deterministic across evaluations`);
  }
});

test('Demo Phase 2: Disk hygiene verification (zero temporary image files)', () => {
  const leaks = findTemporaryImageFiles(process.cwd());
  assert.equal(
    leaks.length,
    0,
    `Found temporary image files on disk: ${JSON.stringify(leaks)}`
  );
});
