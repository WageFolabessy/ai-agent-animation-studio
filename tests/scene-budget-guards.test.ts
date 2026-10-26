import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE1_STORY_BEAT_CONTRACT,
  STAGE1_TOTAL_FRAMES,
  STAGE1_SYNTHETIC_STORY_SPEC
} from '../src/demo/stage1-scene.js';
import {
  STAGE2_STORY_BEAT_CONTRACT,
  STAGE2_TOTAL_FRAMES,
  STAGE2_SYNTHETIC_STORY_SPEC
} from '../src/demo/stage2-scene.js';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor, type SceneBudgetStats } from '../src/engine/compositor/scene-compositor.js';
import { EnvironmentKit, computeShotEnvironmentBounds } from '../src/engine/library/environment-kit.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';

test('F4 Scene Budget Guards: Deterministic budget and per-category sub-budget enforcement across every frame', async (t) => {
  const dummyAudio = (f: number): AudioFrameFeature => ({
    frameIndex: f,
    timestamp: f / 30,
    rms: 0.1,
    rmsRelativeGlobal: 0.1,
    rmsRelativeLocal: 0.1,
    localWindowFrames: 30,
    spectralFlux: 0.05,
    onsetStrength: 0,
    isOnset: false,
    bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0 }
  });

  const createSyntheticManifest = (totalFrames: number): AudioAnalysisManifest => ({
    metadata: {
      audioFilePath: 'synthetic.wav',
      sampleRate: 44100,
      durationSeconds: totalFrames / 30,
      totalFrames,
      fps: 30
    },
    normalization: { globalRmsMax: 1.0, localWindowFrames: 30 },
    lyrics: [],
    beatEvents: [],
    storageReference: { type: 'memory_columnar', columnLayoutVersion: 1 }
  });

  interface CategorySummary {
    max: number;
    mean: number;
    p95: number;
  }

  function evaluateScenarioBudget(
    scenarioName: string,
    contract: typeof STAGE1_STORY_BEAT_CONTRACT,
    storySpec: typeof STAGE1_SYNTHETIC_STORY_SPEC,
    totalFrames: number,
    subBudgets: {
      charactersMax: number;
      environmentMax: number;
      propsMax: number;
      lightingMax: number;
      overlaysMax: number;
      totalMax: number;
    }
  ): Record<string, CategorySummary> {
    const manifest = createSyntheticManifest(totalFrames);
    const prod = VerbCompiler.compile(contract, manifest);
    const builder = new FrameStateBuilder({
      storyboard: prod.storyboard,
      choreography: prod.choreography,
      rigs: prod.rigs,
      audioManifest: manifest,
      getAudioFeatureAtFrame: dummyAudio
    });

    const shotMap = new Map(prod.storyboard.shots.map((s) => [s.id, s]));
    const envCache = new Map<string, ReturnType<typeof EnvironmentKit.build>>();
    const getEnvironmentForShot = (shotId: string) => {
      const cached = envCache.get(shotId);
      if (cached) return cached;
      const shot = shotMap.get(shotId);
      const centerX = shot ? (shot.cameraStart.position[0] + shot.cameraEnd.position[0]) / 2 : 0;
      const startFrame = shot?.frameRange.startFrameInclusive ?? 0;
      const sec =
        storySpec.sections.find((s) => startFrame >= s.startFrame && startFrame < s.endFrame) ??
        storySpec.sections[storySpec.sections.length - 1];
      const bounds = shot ? computeShotEnvironmentBounds(shot) : undefined;
      const xMin = bounds ? bounds.xMin : centerX - 600;
      const xMax = bounds ? bounds.xMax : centerX + 900;
      const env = EnvironmentKit.build({
        section: sec,
        shotId,
        centerX,
        framing: shot?.framing,
        xMin,
        xMax,
        tierBounds: bounds?.tierBounds
      });
      envCache.set(shotId, env);
      return env;
    };

    const compositor = new SceneCompositor({ width: 1920, height: 1080, fps: 30 });
    const statsHistory: SceneBudgetStats[] = [];

    for (let f = 0; f < totalFrames; f++) {
      const frameState = builder.buildFrameState(f);
      const env = getEnvironmentForShot(frameState.shotId);
      const result = compositor.renderFrame(frameState, prod.rigs, env, [], dummyAudio);
      const stats = result.stats;

      // 1. Assert overall drawables budget <= 220 after culling
      assert.ok(
        stats.drawablesCount <= subBudgets.totalMax,
        `${scenarioName} Frame ${f} drawablesCount (${stats.drawablesCount}) exceeded total limit of ${subBudgets.totalMax}`
      );

      // 2. Assert category breakdown exists and sum matches drawablesCount
      assert.ok(stats.categories, `${scenarioName} Frame ${f} missing categories in SceneBudgetStats`);
      const sumCategories =
        stats.categories.environment +
        stats.categories.characters +
        stats.categories.props +
        stats.categories.lighting +
        stats.categories.overlays;
      assert.equal(
        sumCategories,
        stats.drawablesCount,
        `${scenarioName} Frame ${f} category sum (${sumCategories}) does not match drawablesCount (${stats.drawablesCount})`
      );

      // 3. Enforce documented sub-budgets per frame
      assert.ok(
        stats.categories.characters <= subBudgets.charactersMax,
        `${scenarioName} Frame ${f} characters drawables (${stats.categories.characters}) exceeded sub-budget ${subBudgets.charactersMax}`
      );
      assert.ok(
        stats.categories.environment <= subBudgets.environmentMax,
        `${scenarioName} Frame ${f} environment drawables (${stats.categories.environment}) exceeded sub-budget ${subBudgets.environmentMax}`
      );
      assert.ok(
        stats.categories.props <= subBudgets.propsMax,
        `${scenarioName} Frame ${f} props drawables (${stats.categories.props}) exceeded sub-budget ${subBudgets.propsMax}`
      );
      assert.ok(
        stats.categories.lighting <= subBudgets.lightingMax,
        `${scenarioName} Frame ${f} lighting drawables (${stats.categories.lighting}) exceeded sub-budget ${subBudgets.lightingMax}`
      );
      assert.ok(
        stats.categories.overlays <= subBudgets.overlaysMax,
        `${scenarioName} Frame ${f} overlays drawables (${stats.categories.overlays}) exceeded sub-budget ${subBudgets.overlaysMax}`
      );

      statsHistory.push(stats);
    }

    const categories = ['environment', 'characters', 'props', 'lighting', 'overlays', 'total'] as const;
    const summary: Record<string, CategorySummary> = {};

    for (const cat of categories) {
      const vals = statsHistory.map((s) => (cat === 'total' ? s.drawablesCount : s.categories?.[cat] ?? 0));
      vals.sort((a, b) => a - b);
      const max = vals[vals.length - 1];
      const mean = Number((vals.reduce((acc, v) => acc + v, 0) / vals.length).toFixed(1));
      const p95 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))];
      summary[cat] = { max, mean, p95 };
    }

    return summary;
  }

  await t.test('Stage 1 (Solo acting, 1 character): 1,050 frames satisfy <= 220 budget and category sub-budgets', () => {
    const breakdown = evaluateScenarioBudget(
      'Stage 1',
      STAGE1_STORY_BEAT_CONTRACT,
      STAGE1_SYNTHETIC_STORY_SPEC,
      STAGE1_TOTAL_FRAMES,
      {
        totalMax: 220,
        charactersMax: 32, // Single character sub-budget: <= 32 (measured max 26)
        environmentMax: 65, // Environment sub-budget: <= 65 (measured max 35)
        propsMax: 10, // Prop sub-budget: <= 10 (measured max 2)
        lightingMax: 15, // Lighting sub-budget: <= 15 (measured max 4)
        overlaysMax: 10 // Overlay sub-budget: <= 10 (measured max 1)
      }
    );

    assert.ok(breakdown.total.max <= 220, `Stage 1 max drawables (${breakdown.total.max}) must stay <= 220`);
    assert.ok(breakdown.characters.max <= 32, `Stage 1 characters max (${breakdown.characters.max}) <= 32`);
    assert.ok(breakdown.environment.max <= 65, `Stage 1 environment max (${breakdown.environment.max}) <= 65`);
    assert.ok(breakdown.props.max <= 10, `Stage 1 props max (${breakdown.props.max}) <= 10`);
    assert.ok(breakdown.lighting.max <= 15, `Stage 1 lighting max (${breakdown.lighting.max}) <= 15`);
    assert.ok(breakdown.overlays.max <= 10, `Stage 1 overlays max (${breakdown.overlays.max}) <= 10`);
  });

  await t.test('Stage 2 (Two characters, bilateral): 1,050 frames satisfy <= 220 budget and category sub-budgets', () => {
    const breakdown = evaluateScenarioBudget(
      'Stage 2',
      STAGE2_STORY_BEAT_CONTRACT,
      STAGE2_SYNTHETIC_STORY_SPEC,
      STAGE2_TOTAL_FRAMES,
      {
        totalMax: 220,
        charactersMax: 60, // Dual character sub-budget: <= 60 (measured max 51; ~30/char)
        environmentMax: 65, // Environment sub-budget: <= 65 (measured max 35)
        propsMax: 10, // Prop sub-budget: <= 10 (measured max 2)
        lightingMax: 15, // Lighting sub-budget: <= 15 (measured max 6)
        overlaysMax: 10 // Overlay sub-budget: <= 10 (measured max 1)
      }
    );

    assert.ok(breakdown.total.max <= 220, `Stage 2 max drawables (${breakdown.total.max}) must stay <= 220`);
    assert.ok(breakdown.characters.max <= 60, `Stage 2 characters max (${breakdown.characters.max}) <= 60`);
    assert.ok(breakdown.environment.max <= 65, `Stage 2 environment max (${breakdown.environment.max}) <= 65`);
    assert.ok(breakdown.props.max <= 10, `Stage 2 props max (${breakdown.props.max}) <= 10`);
    assert.ok(breakdown.lighting.max <= 15, `Stage 2 lighting max (${breakdown.lighting.max}) <= 15`);
    assert.ok(breakdown.overlays.max <= 10, `Stage 2 overlays max (${breakdown.overlays.max}) <= 10`);
  });
});
