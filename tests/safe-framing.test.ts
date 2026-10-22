import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicStorySpec } from '../src/agents/story-spec-agent.js';
import { compileStorySpecToStoryboard } from '../src/engine/director/shot-planner.js';
import { solveChoreography } from '../src/engine/director/choreography-solver.js';
import {
  TrajectorySolver,
  ANATOMICAL_FOCUS_OFFSETS
} from '../src/engine/director/trajectory-solver.js';
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
import { validateSafeFraming } from '../src/schemas/invariants.js';
import {
  createSyntheticRockManifest,
  createSyntheticElectronicManifest,
  createSyntheticBalladManifest
} from './helpers/manifest-factory.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';

test('Mathematical Safe Framing Verification Suite', async (t) => {
  const manifestsToTest: Array<{ name: string; manifest: AudioAnalysisManifest }> = [
    {
      name: '174 BPM 4-Section Rock (Lead Runner + Cyber Beast)',
      manifest: createSyntheticRockManifest({ totalFrames: 2400 })
    },
    {
      name: '110 BPM 3-Section Electronic (Cyber Hound + Patrol Drone)',
      manifest: createSyntheticElectronicManifest({ totalFrames: 1800 })
    },
    {
      name: '74 BPM 3-Section Ballad (Solo Runner)',
      manifest: createSyntheticBalladManifest({ totalFrames: 1800 })
    }
  ];

  for (const { name, manifest } of manifestsToTest) {
    await t.test(`Evaluates safe framing on ${name}`, () => {
      const spec = buildDeterministicStorySpec(manifest, `safe-framing-${manifest.metadata.tempoBpm}`);

      const rigsMap = new Map();
      for (const castItem of spec.cast) {
        const rig = ArchetypeFactory.build({ instanceId: castItem.instanceId, spec: castItem });
        rigsMap.set(castItem.instanceId, rig);
      }

      const solver = new TrajectorySolver();
      const storyboard = compileStorySpecToStoryboard(spec, manifest, solver);
      const choreography = solveChoreography(spec, storyboard, rigsMap, undefined, solver);
      const sequencer = new ShotSequencer(storyboard);

      const contractFramingReport = validateSafeFraming(storyboard, choreography, rigsMap);
      assert.equal(
        contractFramingReport.isValid,
        true,
        `validateSafeFraming failed on ${name}: ${JSON.stringify(contractFramingReport.errors)}`
      );

      // Evaluate EVERY locomotion-capable cast entity present in the spec
      const locomotionCast = spec.cast.filter(
        (c) => c.archetypeId === 'biped_runner' || c.archetypeId === 'quadruped_beast'
      );
      assert.ok(
        locomotionCast.length >= 1,
        `Spec must include locomotion cast entities (found: ${locomotionCast.map((c) => c.archetypeId).join(', ')})`
      );

      const leadCast = spec.cast[0];
      assert.ok(leadCast, 'Spec must have a primary lead cast member at cast[0]');
      const leadFocusSpec = ANATOMICAL_FOCUS_OFFSETS[leadCast.archetypeId];

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

      const totalFrames = storyboard.totalFrames;
      const t0 = performance.now();
      let minZc = Infinity;
      const failures: string[] = [];
      const trackingRelXByShot = new Map<string, number>();

      for (let f = 0; f < totalFrames; f++) {
        const { shot, normalizedProgress } = sequencer.getShotForFrame(f);
        const frameState = stateBuilder.buildFrameState(f);
        const basis = computeCameraBasis(frameState.camera);

        // Evaluate EVERY locomotion-capable entity in the scene:
        // Billboard projection must exist and depth must strictly obey zc >= 135
        for (const castItem of locomotionCast) {
          const entity = frameState.entities.find((e) => e.rigId === castItem.instanceId);
          if (!entity) {
            failures.push(`Frame ${f}: Entity ${castItem.instanceId} not found in frameState`);
            continue;
          }

          const ctx = createBillboardContext(
            entity.worldPosition,
            entity.worldRotationZDegrees,
            entity.scale,
            frameState.camera,
            basis,
            1920,
            1080
          );

          if (!ctx) {
            failures.push(`Frame ${f}: Entity ${castItem.instanceId} billboard projection rejected behind camera`);
            continue;
          }

          if (ctx.depthZ < minZc) minZc = ctx.depthZ;

          // Invariant: No locomotion entity ever approaches camera-space near-plane (zc >= 135)
          if (ctx.depthZ < 135) {
            failures.push(
              `Frame ${f} (Shot ${shot.id}, ${shot.framing}): Entity ${castItem.instanceId} zc=${ctx.depthZ.toFixed(1)} < 135 causes scale explosion`
            );
          }
        }

        // Camera Tracking & Framing Invariants for the Primary Lead Subject (biped_runner or quadruped_beast)
        const leadRig = rigsMap.get(leadCast.instanceId)!;
        const leadEntity = frameState.entities.find((e) => e.rigId === leadCast.instanceId);
        if (leadEntity) {
          // Invariant: Camera-to-character relative X offset remains strictly constant during tracking shots
          if (shot.movement === 'TRACKING') {
            const baseCam = sequencer.interpolateCamera(shot, normalizedProgress);
            const baseRelX = Number((baseCam.position[0] - leadEntity.worldPosition[0]).toFixed(2));

            if (!trackingRelXByShot.has(shot.id)) {
              trackingRelXByShot.set(shot.id, baseRelX);
            } else {
              const initialRelX = trackingRelXByShot.get(shot.id)!;
              if (Math.abs(baseRelX - initialRelX) > 0.10) {
                failures.push(
                  `Frame ${f} (Shot ${shot.id}, TRACKING): Camera-to-character base relative X offset drifted from ${initialRelX} to ${baseRelX}`
                );
              }
            }

            // Audio camera trauma shake must stay within physically bounded limits around base tracking
            const shakeDisplacementX = Math.abs(frameState.camera.position[0] - baseCam.position[0]);
            if (shakeDisplacementX > 5.0) {
              failures.push(
                `Frame ${f} (Shot ${shot.id}, TRACKING): Camera shake displacement X=${shakeDisplacementX.toFixed(2)} exceeds 5.0 bounds`
              );
            }
          }

          const leadCtx = createBillboardContext(
            leadEntity.worldPosition,
            leadEntity.worldRotationZDegrees,
            leadEntity.scale,
            frameState.camera,
            basis,
            1920,
            1080
          );

          if (leadCtx && leadRig.skeleton) {
            const fk = computeSkeletonFK(leadRig.skeleton, leadEntity.jointAngles, leadEntity.jointOffsets);
            const bodyAffine = fk.get(leadFocusSpec.fkBodyCenterJointId);
            const bodyRigPoint: [number, number] = bodyAffine
              ? applyAffine2D(bodyAffine, [0, 0])
              : [0, 0];
            const [sxBody] = projectBillboardPoint(bodyRigPoint, leadCtx);

            if (shot.framing !== 'EXTREME_WIDE' && (sxBody < 384 || sxBody > 1536)) {
              failures.push(
                `Frame ${f} (Shot ${shot.id}, ${shot.framing}): Lead (${leadCast.archetypeId}) body screen X=${sxBody.toFixed(1)} outside [384, 1536]`
              );
            }

            // Head & cranial visor framing in Close-Up and Medium shots
            if (shot.framing === 'CLOSE_UP' || shot.framing === 'MEDIUM') {
              const headAffine = fk.get(leadFocusSpec.fkFocusJointId);
              const visorRigPoint: [number, number] = headAffine
                ? applyAffine2D(headAffine, leadFocusSpec.fkFocusLocalPoint)
                : [0, 56];
              const [sxHead, syHead] = projectBillboardPoint(visorRigPoint, leadCtx);

              if (sxHead < 384 || sxHead > 1536) {
                failures.push(
                  `Frame ${f} (Shot ${shot.id}, ${shot.framing}): Lead (${leadCast.archetypeId}) head screen X=${sxHead.toFixed(1)} outside [384, 1536]`
                );
              }
              if (syHead < 150 || syHead > 680) {
                failures.push(
                  `Frame ${f} (Shot ${shot.id}, ${shot.framing}): Lead (${leadCast.archetypeId}) head screen Y=${syHead.toFixed(1)} outside [150, 680]`
                );
              }
            }
          }
        }
      }

      const elapsed = performance.now() - t0;
      assert.equal(
        failures.length,
        0,
        `Framing failures detected across ${failures.length} frames:\n${failures.slice(0, 10).join('\n')}`
      );
      assert.ok(minZc >= 135, `minZc ${minZc} must be >= 135`);
      assert.ok(elapsed < 1500, `Execution time ${elapsed.toFixed(1)}ms must be strictly < 1500ms (1.5s)`);
    });
  }
});
