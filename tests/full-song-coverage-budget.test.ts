import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicStorySpec } from '../src/agents/story-spec-agent.js';
import { StudioAgentOrchestrator, DeterministicMockLlmProvider } from '../src/agents/index.js';
import {
  CINEMATIC_ANGLES,
  MIN_FRUSTUM_RAY_NEG_Z_MARGIN,
  checkCameraFrustumNegativeZ,
  assertStoryboardFrustumNegativeZ
} from '../src/engine/director/shot-planner.js';
import {
  ENVIRONMENT_TIER_DEPTHS,
  computeCameraFrustumXSpanAtZ,
  type EnvironmentTierKey
} from '../src/engine/library/environment-kit.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { SceneCompositor } from '../src/engine/compositor/scene-compositor.js';
import type { SceneEnvironment } from '../src/engine/compositor/scene-compositor.js';
import {
  createSyntheticRockManifest,
  createSyntheticElectronicManifest
} from './helpers/manifest-factory.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';

function computeEnvironmentTierXExtents(
  env: SceneEnvironment
): Record<EnvironmentTierKey, { minX: number; maxX: number }> {
  const extents: Record<EnvironmentTierKey, { minX: number; maxX: number }> = {
    tier1SkylineZ: { minX: Infinity, maxX: -Infinity },
    tier2MidgroundZ: { minX: Infinity, maxX: -Infinity },
    tier3RunwayZ: { minX: Infinity, maxX: -Infinity },
    tier4ForegroundZ: { minX: Infinity, maxX: -Infinity }
  };

  const classifyZ = (z: number): EnvironmentTierKey | null => {
    if (Math.abs(z - ENVIRONMENT_TIER_DEPTHS.tier1SkylineZ) <= 50) return 'tier1SkylineZ';
    if (Math.abs(z - ENVIRONMENT_TIER_DEPTHS.tier2MidgroundZ) <= 50) return 'tier2MidgroundZ';
    if (Math.abs(z - ENVIRONMENT_TIER_DEPTHS.tier3RunwayZ) <= 60) return 'tier3RunwayZ';
    if (Math.abs(z - ENVIRONMENT_TIER_DEPTHS.tier4ForegroundZ) <= 30) return 'tier4ForegroundZ';
    return null;
  };

  for (const poly of env.polygons ?? []) {
    for (const v of poly.vertices) {
      const key = classifyZ(v[2]);
      if (key) {
        if (v[0] < extents[key].minX) extents[key].minX = v[0];
        if (v[0] > extents[key].maxX) extents[key].maxX = v[0];
      }
    }
  }

  for (const line of env.lines ?? []) {
    for (const pt of [line.p0, line.p1]) {
      const key = classifyZ(pt[2]);
      if (key) {
        if (pt[0] < extents[key].minX) extents[key].minX = pt[0];
        if (pt[0] > extents[key].maxX) extents[key].maxX = pt[0];
      }
    }
  }

  return extents;
}

test('Full-Song Frustum Environment Coverage & Drawables Budget Suite (10,800 Frames)', async (t) => {
  await t.test(
    'Every preset in CINEMATIC_ANGLES satisfies -Z frustum corner ray invariant at start and end with camera-shake margin',
    () => {
      for (const angle of CINEMATIC_ANGLES) {
        const startCam = {
          projectionMode: 'perspective' as const,
          position: angle.camOffsetStart,
          target: angle.targetOffsetStart,
          up: [0, 1, 0] as [number, number, number],
          nearPlane: 10,
          farPlane: 3000,
          rollDegrees: angle.rollDegrees,
          verticalFovDegrees: angle.fov
        };
        const endCam = {
          projectionMode: 'perspective' as const,
          position: angle.camOffsetEnd,
          target: angle.targetOffsetEnd,
          up: [0, 1, 0] as [number, number, number],
          nearPlane: 10,
          farPlane: 3000,
          rollDegrees: angle.rollDegrees,
          verticalFovDegrees: angle.fov
        };

        const checkStart = checkCameraFrustumNegativeZ(startCam);
        const checkEnd = checkCameraFrustumNegativeZ(endCam);

        assert.ok(
          checkStart.valid,
          `Preset ${angle.name} camOffsetStart violates -Z frustum invariant: maxRayZ=${checkStart.maxRayZ.toFixed(4)} > -${MIN_FRUSTUM_RAY_NEG_Z_MARGIN}`
        );
        assert.ok(
          checkEnd.valid,
          `Preset ${angle.name} camOffsetEnd violates -Z frustum invariant: maxRayZ=${checkEnd.maxRayZ.toFixed(4)} > -${MIN_FRUSTUM_RAY_NEG_Z_MARGIN}`
        );
      }
    }
  );

  const fullSongProfiles: Array<{ name: string; manifest: AudioAnalysisManifest }> = [
    {
      name: '6-Minute 174 BPM Rock Full Song (10,800 frames)',
      manifest: createSyntheticRockManifest({ totalFrames: 10800 })
    },
    {
      name: '6-Minute 110 BPM Electronic Full Song (10,800 frames)',
      manifest: createSyntheticElectronicManifest({ totalFrames: 10800 })
    }
  ];

  for (const { name, manifest } of fullSongProfiles) {
    await t.test(
      `Verifies every tier in ENVIRONMENT_TIER_DEPTHS covers camera frustum across 10,800 frames and drawablesCount <= 220 on ${name}`,
      async () => {
        const spec = buildDeterministicStorySpec(manifest, `full-song-${manifest.metadata.tempoBpm}`);
        const orchestrator = new StudioAgentOrchestrator(new DeterministicMockLlmProvider());

        const getAudioFeatureAtFrame = (f: number) => ({
          frameIndex: f,
          timestamp: f / 30,
          rms: 0.75,
          rmsRelativeGlobal: 0.8,
          rmsRelativeLocal: 0.8,
          localWindowFrames: 90,
          spectralFlux: 0.65,
          onsetStrength: f % 6 === 0 ? 0.92 : 0.25,
          isOnset: f % 6 === 0,
          bands: {
            subBass: 0.7,
            bass: 0.85,
            lowMid: 0.6,
            mid: 0.7,
            highMid: 0.65,
            presence: 0.75,
            brilliance: 0.6
          }
        });

        const orchestration = await orchestrator.orchestrate({
          projectId: `full_song_test_${manifest.metadata.tempoBpm}`,
          audioManifest: manifest,
          getAudioFeatureAtFrame,
          storySpec: spec,
          useSpecPipeline: true
        });

        const { storyboard, rigs, choreography, getEnvironmentForShot } = orchestration;
        assert.equal(storyboard.totalFrames, 10800);

        // 1. Verify all storyboard shots satisfy the -Z frustum ray invariant
        assertStoryboardFrustumNegativeZ(storyboard.shots);

        // Precompute per-shot tier X extents once per shot (just as getEnvironmentForShot is memoized)
        const shotTierExtentsMap = new Map<
          string,
          Record<EnvironmentTierKey, { minX: number; maxX: number }>
        >();
        for (const shot of storyboard.shots) {
          const env = getEnvironmentForShot(shot.id);
          const envDrawables = (env.polygons?.length ?? 0) + (env.lines?.length ?? 0);
          assert.ok(
            envDrawables <= 65,
            `Shot ${shot.id} environment drawables (${envDrawables}) exceeds 65 budget`
          );
          shotTierExtentsMap.set(shot.id, computeEnvironmentTierXExtents(env));
        }

        const shotFramingMap = new Map(storyboard.shots.map((s) => [s.id, s.framing]));
        const shotEnvMap = new Map<string, SceneEnvironment>();
        for (const shot of storyboard.shots) {
          shotEnvMap.set(shot.id, getEnvironmentForShot(shot.id));
        }

        const stateBuilder = new FrameStateBuilder({
          storyboard,
          audioManifest: manifest,
          rigs,
          choreography,
          getAudioFeatureAtFrame
        });

        const compositor = new SceneCompositor({ width: 1920, height: 1080 });
        const tierKeys = Object.keys(ENVIRONMENT_TIER_DEPTHS) as EnvironmentTierKey[];
        const onsetFrames: number[] = [];
        for (let f = 0; f < storyboard.totalFrames; f += 6) {
          onsetFrames.push(f);
        }

        let maxDrawablesObserved = 0;

        for (let f = 0; f < storyboard.totalFrames; f++) {
          const frameState = stateBuilder.buildFrameState(f);
          const shotExtents = shotTierExtentsMap.get(frameState.shotId)!;
          const shotFraming = shotFramingMap.get(frameState.shotId);
          const isCloseUp = shotFraming === 'CLOSE_UP';

          // Check frustum coverage across every tier plane in ENVIRONMENT_TIER_DEPTHS on all 10,800 frames
          for (const key of tierKeys) {
            if (key === 'tier4ForegroundZ' && isCloseUp) {
              continue; // Foreground overhang is intentionally excluded on CLOSE_UP shots
            }
            const zPlane = ENVIRONMENT_TIER_DEPTHS[key];
            const frustumSpan = computeCameraFrustumXSpanAtZ(frameState.camera, zPlane);
            const tierExtent = shotExtents[key];

            assert.ok(
              tierExtent.minX <= frustumSpan.xMin && tierExtent.maxX >= frustumSpan.xMax,
              `Frame ${f} (shot ${frameState.shotId}, ${shotFraming}) tier ${key} (Z=${zPlane}) ` +
                `geometry [${tierExtent.minX.toFixed(1)}, ${tierExtent.maxX.toFixed(1)}] does not cover ` +
                `camera frustum [${frustumSpan.xMin.toFixed(1)}, ${frustumSpan.xMax.toFixed(1)}]`
            );
          }

          // Evaluate SceneCompositor drawables budget on every single frame of the 10,800-frame timeline
          const env = shotEnvMap.get(frameState.shotId)!;
          const { stats } = compositor.renderFrame(
            frameState,
            rigs,
            env,
            onsetFrames,
            getAudioFeatureAtFrame
          );
          if (stats.drawablesCount > maxDrawablesObserved) {
            maxDrawablesObserved = stats.drawablesCount;
          }
          assert.ok(
            stats.drawablesCount <= 220,
            `Frame ${f} (shot ${frameState.shotId}) drawablesCount=${stats.drawablesCount} exceeds hard budget of 220`
          );
        }

        assert.ok(
          maxDrawablesObserved > 20 && maxDrawablesObserved <= 220,
          `Expected positive maxDrawablesObserved <= 220, got ${maxDrawablesObserved}`
        );
      }
    );
  }
});
