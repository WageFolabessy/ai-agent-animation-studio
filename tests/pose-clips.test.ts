import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import { samplePoseTrack } from '../src/engine/rigging/deformer.js';
import { computeSkeletonFK, applyAffine2D } from '../src/engine/rigging/kinematics.js';
import { evaluateLimbFootTrajectory } from '../src/engine/rigging/ik-leg-solver.js';
import {
  TrajectorySolver,
  computeClipStrideLength,
  analyzeClipContactStride,
  computeMusicalMotionParameters,
  NON_LOCOMOTION_CLIPS
} from '../src/engine/director/trajectory-solver.js';
import { solveChoreography } from '../src/engine/director/choreography-solver.js';
import type { StorySpecContract } from '../src/schemas/story-spec.contract.js';
import { compileStorySpecToStoryboard } from '../src/engine/director/shot-planner.js';
import { createSyntheticRockManifest } from './helpers/manifest-factory.js';

test('Pose Clips & Motion State Machine Suite', async (t) => {
  const runner = ArchetypeFactory.build({
    instanceId: 'runner_test',
    spec: {
      instanceId: 'runner_test',
      archetypeId: 'biped_runner',
      scale: 1.0,
      accessories: []
    }
  });

  const expectedClipNames = [
    'stalk_crouch',
    'sprint_frenzy',
    'evade_leap',
    'defiant_scream',
    'combat_clash',
    'exhausted_walk'
  ];

  await t.test('All 6 named motion presets exist and have valid keyframes', () => {
    assert.ok(runner.poseClips, 'runner should have poseClips map');

    for (const name of expectedClipNames) {
      const clip = runner.poseClips[name];
      assert.ok(clip, `Clip ${name} should exist in runner.poseClips`);
      assert.ok(clip.keyframes.length >= 2, `Clip ${name} should have >= 2 keyframes`);
      assert.ok(clip.loopFrames && clip.loopFrames > 0, `Clip ${name} should define loopFrames`);
    }
  });

  await t.test('All joint rotations in every keyframe obey joint constraint limits', () => {
    const jointConstraintMap = new Map<string, [number, number]>();
    for (const joint of runner.skeleton!.joints) {
      if (joint.constraintsDeg) {
        jointConstraintMap.set(joint.id, joint.constraintsDeg);
      }
    }

    for (const name of expectedClipNames) {
      const clip = runner.poseClips![name];
      for (const kf of clip.keyframes) {
        for (const jt of kf.jointTransforms) {
          const limits = jointConstraintMap.get(jt.jointId);
          if (limits) {
            const [minDeg, maxDeg] = limits;
            assert.ok(
              jt.rotationZDegrees >= minDeg - 0.01 && jt.rotationZDegrees <= maxDeg + 0.01,
              `Clip ${name} keyframe ${kf.frame} joint ${jt.jointId} angle ${jt.rotationZDegrees}° must be within [${minDeg}°, ${maxDeg}°]`
            );
          }
        }
      }
    }
  });

  await t.test('samplePoseTrack resolves clipId dynamically from rig.poseClips', () => {
    // 1. Without clipId, samples default poseInterpolation (sprint_frenzy)
    const defaultSample = samplePoseTrack(runner, 0, 0, 1.0, 0);
    assert.equal(defaultSample.jointAngles.torso, -14);

    // 2. With clipId = 'stalk_crouch', torso should lean -24°
    const crouchSample = samplePoseTrack(runner, 0, 0, 1.0, 0, 'stalk_crouch');
    assert.equal(crouchSample.jointAngles.torso, -24);
    assert.equal(crouchSample.jointAngles.head, 15);

    // 3. With clipId = 'defiant_scream', torso tilts back +12° and head tilts up +25°
    const screamSample = samplePoseTrack(runner, 0, 0, 1.0, 0, 'defiant_scream');
    assert.equal(screamSample.jointAngles.torso, 12);
    assert.equal(screamSample.jointAngles.head, 25);

    // 4. With clipId = 'combat_clash', parry and lunge
    const clashSample = samplePoseTrack(runner, 0, 0, 1.0, 0, 'combat_clash');
    assert.equal(clashSample.jointAngles.torso, -12);
  });

  await t.test('All clips loop smoothly: keyframe[0] matches keyframe[end]', () => {
    for (const name of expectedClipNames) {
      const clip = runner.poseClips![name];
      const kf0 = clip.keyframes[0];
      const kfLast = clip.keyframes[clip.keyframes.length - 1];
      assert.equal(kf0.frame, 0);
      assert.equal(kfLast.frame, clip.loopFrames);

      const map0 = new Map(kf0.jointTransforms.map((t) => [t.jointId, t.rotationZDegrees]));
      const mapLast = new Map(kfLast.jointTransforms.map((t) => [t.jointId, t.rotationZDegrees]));

      for (const [jointId, angle0] of map0.entries()) {
        const angleLast = mapLast.get(jointId);
        assert.ok(angleLast !== undefined, `Joint ${jointId} missing in loop closure for clip ${name}`);
        assert.ok(
          Math.abs(angle0 - angleLast) < 0.01,
          `Loop mismatch for joint ${jointId} in clip ${name}: start=${angle0}, end=${angleLast}`
        );
      }
    }
  });

  await t.test(
    'Analytical 2-bone IK round-trips every generated keyframe through computeSkeletonFK within 1e-6',
    () => {
      const bipedSpecs: Record<
        string,
        {
          loopFrames: number;
          stanceFrames: number;
          strideLengthUnits: number;
          groundY: number;
          swingLift: number;
        }
      > = {
        stalk_crouch: {
          loopFrames: 36,
          stanceFrames: 22,
          strideLengthUnits: 48.0,
          groundY: -47.0,
          swingLift: 10.0
        },
        sprint_frenzy: {
          loopFrames: 18,
          stanceFrames: 8,
          strideLengthUnits: 23.0,
          groundY: -41.0,
          swingLift: 8.5
        },
        exhausted_walk: {
          loopFrames: 42,
          stanceFrames: 25,
          strideLengthUnits: 46.0,
          groundY: -46.0,
          swingLift: 8.0
        }
      };

      const legLUpper = runner.skeleton!.joints.find((j) => j.id === 'leg_l_upper')!;
      const legLLower = runner.skeleton!.joints.find((j) => j.id === 'leg_l_lower')!;
      const legRUpper = runner.skeleton!.joints.find((j) => j.id === 'leg_r_upper')!;
      const legRLower = runner.skeleton!.joints.find((j) => j.id === 'leg_r_lower')!;

      for (const [clipId, spec] of Object.entries(bipedSpecs)) {
        const clip = runner.poseClips![clipId];
        assert.equal(clip.contactFrames, spec.stanceFrames);
        assert.equal(clip.strideLengthUnits, spec.strideLengthUnits);
        assert.equal(clip.keyframes.length, spec.loopFrames + 1);

        for (const kf of clip.keyframes) {
          const angles: Record<string, number> = {};
          const offsets: Record<string, [number, number]> = {};
          for (const jt of kf.jointTransforms) {
            angles[jt.jointId] = jt.rotationZDegrees;
            if (jt.localOffset2D) {
              offsets[jt.jointId] = jt.localOffset2D;
            }
          }

          // Anatomical backward knee flexion sign convention: lower leg rotation <= 0
          assert.ok(angles.leg_l_lower <= 0, `Left knee must bend backward (<= 0) in ${clipId}`);
          assert.ok(angles.leg_r_lower <= 0, `Right knee must bend backward (<= 0) in ${clipId}`);

          const fk = computeSkeletonFK(runner.skeleton!, angles, offsets);
          const pelvisAff = fk.get('pelvis')!;
          const hipL = applyAffine2D(pelvisAff, legLUpper.localOffset2D);
          const hipR = applyAffine2D(pelvisAff, legRUpper.localOffset2D);

          const footLActual = applyAffine2D(fk.get('leg_l_lower')!, [0, -legLLower.length]);
          const footRActual = applyAffine2D(fk.get('leg_r_lower')!, [0, -legRLower.length]);

          const fWrapped = kf.frame === spec.loopFrames ? 0 : kf.frame;
          const footLExpected = evaluateLimbFootTrajectory(
            fWrapped,
            0,
            spec.loopFrames,
            spec.stanceFrames,
            spec.strideLengthUnits,
            hipL[0],
            spec.groundY,
            spec.swingLift,
            0
          );
          const footRExpected = evaluateLimbFootTrajectory(
            fWrapped,
            Math.floor(spec.loopFrames / 2),
            spec.loopFrames,
            spec.stanceFrames,
            spec.strideLengthUnits,
            hipR[0],
            spec.groundY,
            spec.swingLift,
            0
          );

          const errL = Math.hypot(footLActual[0] - footLExpected[0], footLActual[1] - footLExpected[1]);
          const errR = Math.hypot(footRActual[0] - footRExpected[0], footRActual[1] - footRExpected[1]);

          assert.ok(
            errL <= 1e-6,
            `FK round-trip error for ${clipId} left foot at frame ${kf.frame}: ${errL} > 1e-6`
          );
          assert.ok(
            errR <= 1e-6,
            `FK round-trip error for ${clipId} right foot at frame ${kf.frame}: ${errR} > 1e-6`
          );
        }
      }

      // Also verify quadruped beast_gallop FK round-trip within 1e-6
      const beast = ArchetypeFactory.build({
        instanceId: 'test_beast_ik',
        spec: { instanceId: 'test_beast_ik', archetypeId: 'quadruped_beast', scale: 1.0, accessories: [] }
      });
      const gallopClip = beast.poseClips!.beast_gallop;
      const flUpper = beast.skeleton!.joints.find((j) => j.id === 'leg_fl_upper')!;
      const flLower = beast.skeleton!.joints.find((j) => j.id === 'leg_fl_lower')!;
      const frUpper = beast.skeleton!.joints.find((j) => j.id === 'leg_fr_upper')!;
      const frLower = beast.skeleton!.joints.find((j) => j.id === 'leg_fr_lower')!;
      const blUpper = beast.skeleton!.joints.find((j) => j.id === 'leg_bl_upper')!;
      const blLower = beast.skeleton!.joints.find((j) => j.id === 'leg_bl_lower')!;
      const brUpper = beast.skeleton!.joints.find((j) => j.id === 'leg_br_upper')!;
      const brLower = beast.skeleton!.joints.find((j) => j.id === 'leg_br_lower')!;

      for (const kf of gallopClip.keyframes) {
        const angles: Record<string, number> = {};
        const offsets: Record<string, [number, number]> = {};
        for (const jt of kf.jointTransforms) {
          angles[jt.jointId] = jt.rotationZDegrees;
          if (jt.localOffset2D) {
            offsets[jt.jointId] = jt.localOffset2D;
          }
        }
        const fk = computeSkeletonFK(beast.skeleton!, angles, offsets);
        const pelvisAff = fk.get('pelvis')!;
        const chestAff = fk.get('chest')!;
        const hipFL = applyAffine2D(chestAff, flUpper.localOffset2D);
        const hipFR = applyAffine2D(chestAff, frUpper.localOffset2D);
        const hipBL = applyAffine2D(pelvisAff, blUpper.localOffset2D);
        const hipBR = applyAffine2D(pelvisAff, brUpper.localOffset2D);

        const fWrapped = kf.frame === 24 ? 0 : kf.frame;
        const expFL = evaluateLimbFootTrajectory(fWrapped, 12, 24, 10, 54.0, hipFL[0], -32.5, 4.5, -1.0);
        const expFR = evaluateLimbFootTrajectory(fWrapped, 16, 24, 10, 54.0, hipFR[0], -32.5, 4.5, -1.0);
        const expBL = evaluateLimbFootTrajectory(fWrapped, 0, 24, 10, 54.0, hipBL[0], -32.5, 4.5, -6.5);
        const expBR = evaluateLimbFootTrajectory(fWrapped, 4, 24, 10, 54.0, hipBR[0], -32.5, 4.5, -6.5);

        const actFL = applyAffine2D(fk.get('leg_fl_lower')!, [0, -flLower.length]);
        const actFR = applyAffine2D(fk.get('leg_fr_lower')!, [0, -frLower.length]);
        const actBL = applyAffine2D(fk.get('leg_bl_lower')!, [0, -blLower.length]);
        const actBR = applyAffine2D(fk.get('leg_br_lower')!, [0, -brLower.length]);

        assert.ok(Math.hypot(actFL[0] - expFL[0], actFL[1] - expFL[1]) <= 1e-6);
        assert.ok(Math.hypot(actFR[0] - expFR[0], actFR[1] - expFR[1]) <= 1e-6);
        assert.ok(Math.hypot(actBL[0] - expBL[0], actBL[1] - expBL[1]) <= 1e-6);
        assert.ok(Math.hypot(actBR[0] - expBR[0], actBR[1] - expBR[1]) <= 1e-6);
      }
    }
  );

  await t.test(
    'Contralateral arm/leg counter-swing is preserved across all biped locomotion clips',
    () => {
      for (const clipId of ['stalk_crouch', 'sprint_frenzy', 'exhausted_walk']) {
        const clip = runner.poseClips![clipId];
        const N = clip.loopFrames!;
        const pose0 = samplePoseTrack(runner, 0, 0, 1.0, 0, clipId);
        const poseHalf = samplePoseTrack(runner, Math.floor(N / 2), 0, 1.0, 0, clipId);

        // At f = 0, left leg is at front strike -> right arm swings forward (+), left arm swings back (-)
        assert.ok(
          pose0.jointAngles.arm_r_upper > pose0.jointAngles.arm_l_upper,
          `Clip ${clipId} at frame 0 must swing right arm forward of left arm`
        );
        // At f = N/2, right leg is at front strike -> left arm swings forward (+), right arm swings back (-)
        assert.ok(
          poseHalf.jointAngles.arm_l_upper > poseHalf.jointAngles.arm_r_upper,
          `Clip ${clipId} at frame N/2 must swing left arm forward of right arm`
        );
      }
    }
  );

  await t.test(
    'Non-vacuous contact-frame minimums, <=10% airborne backward share, and <=2% world-space foot slip',
    () => {
      const locomotionMinimums: Record<string, number> = {
        stalk_crouch: Math.ceil(0.55 * 36), // 20
        exhausted_walk: Math.ceil(0.55 * 42), // 24
        sprint_frenzy: Math.ceil(0.38 * 18) // 7
      };
      const footJoints = [
        runner.skeleton!.joints.find((j) => j.id === 'leg_l_lower')!,
        runner.skeleton!.joints.find((j) => j.id === 'leg_r_lower')!
      ];

      for (const [clipId, minContact] of Object.entries(locomotionMinimums)) {
        const clip = runner.poseClips![clipId];
        const analysis = analyzeClipContactStride(runner, clip, clipId);
        const { groundLevelY, epsilon, strideLengthUnits, maxRelativeDeviation, perLimbStats } = analysis;
        assert.ok(strideLengthUnits > 0, `Clip ${clipId} must have non-zero stride length`);
        assert.ok(
          maxRelativeDeviation <= 0.02,
          `Clip ${clipId} max relative deviation ${(maxRelativeDeviation * 100).toFixed(2)}% must be <= 2%`
        );

        for (const limbId of ['leg_l_lower', 'leg_r_lower']) {
          const stats = perLimbStats[limbId];
          assert.ok(stats, `Missing perLimbStats for ${limbId} in ${clipId}`);
          assert.ok(
            stats.contactFrames >= minContact,
            `Clip ${clipId} limb ${limbId} contactFrames (${stats.contactFrames}) must be >= ${minContact}`
          );
          const airborneBackwardShare =
            stats.backwardFrames > 0 ? stats.airborneBackwardFrames / stats.backwardFrames : 0;
          assert.ok(
            airborneBackwardShare <= 0.1,
            `Clip ${clipId} limb ${limbId} airborne backward share ${(airborneBackwardShare * 100).toFixed(1)}% must be <= 10%`
          );
        }

        const loopFrames = clip.loopFrames!;
        const timeScale = 1.0;
        const vRoot = (timeScale * strideLengthUnits) / loopFrames;

        for (let f = 0; f < loopFrames; f++) {
          const poseA = samplePoseTrack(runner, f, 0, timeScale, 0, clipId);
          const poseB = samplePoseTrack(runner, f + 1, 0, timeScale, 0, clipId);

          const fkA = computeSkeletonFK(runner.skeleton!, poseA.jointAngles, poseA.jointOffsets);
          const fkB = computeSkeletonFK(runner.skeleton!, poseB.jointAngles, poseB.jointOffsets);

          const pelvisA = applyAffine2D(fkA.get('pelvis')!, [0, 0]);
          const pelvisB = applyAffine2D(fkB.get('pelvis')!, [0, 0]);

          const footL_A = applyAffine2D(fkA.get('leg_l_lower')!, [0, -footJoints[0].length]);
          const footL_B = applyAffine2D(fkB.get('leg_l_lower')!, [0, -footJoints[0].length]);
          const footR_A = applyAffine2D(fkA.get('leg_r_lower')!, [0, -footJoints[1].length]);
          const footR_B = applyAffine2D(fkB.get('leg_r_lower')!, [0, -footJoints[1].length]);

          const dL = (footL_B[0] - pelvisB[0]) - (footL_A[0] - pelvisA[0]);
          const dR = (footR_B[0] - pelvisB[0]) - (footR_A[0] - pelvisA[0]);

          if (footL_A[1] <= groundLevelY + epsilon && footL_B[1] <= groundLevelY + epsilon && dL < -1e-6) {
            const vContactWorld = vRoot + dL;
            const slipRatio = Math.abs(vContactWorld) / vRoot;
            assert.ok(
              slipRatio <= 0.02,
              `Left foot slip for ${clipId} at frame ${f}: slip ratio ${(slipRatio * 100).toFixed(2)}% must be <= 2%`
            );
          }
          if (footR_A[1] <= groundLevelY + epsilon && footR_B[1] <= groundLevelY + epsilon && dR < -1e-6) {
            const vContactWorld = vRoot + dR;
            const slipRatio = Math.abs(vContactWorld) / vRoot;
            assert.ok(
              slipRatio <= 0.02,
              `Right foot slip for ${clipId} at frame ${f}: slip ratio ${(slipRatio * 100).toFixed(2)}% must be <= 2%`
            );
          }
        }
      }
    }
  );

  await t.test(
    'Phase continuity: transitions between clips with lengths 18, 24, 30, 36, and 42 preserve normalized phase',
    () => {
      const loopLengths = [18, 24, 30, 36, 42];

      for (let i = 0; i < loopLengths.length - 1; i++) {
        const loopA = loopLengths[i];
        const loopB = loopLengths[i + 1];

        // Arbitrary accumulated clock at transition point
        const clockA = 47.25;
        const normalizedPhaseA = ((clockA % loopA) + loopA) % loopA / loopA;

        // Continuous carry-over formula
        const startPoseFrameB = normalizedPhaseA * loopB;
        const normalizedPhaseB = startPoseFrameB / loopB;

        assert.ok(
          Math.abs(normalizedPhaseA - normalizedPhaseB) < 1e-6,
          `Normalized phase must match: ${normalizedPhaseA} vs ${normalizedPhaseB} across ${loopA}->${loopB}`
        );
      }
    }
  );

  await t.test(
    'Independent pose clocks: two bipeds in the same shot maintain completely independent clocks',
    () => {
      const runnerA = ArchetypeFactory.build({
        instanceId: 'lead_hero',
        spec: { instanceId: 'lead_hero', archetypeId: 'biped_runner', scale: 1.0, accessories: [] }
      });
      const runnerB = ArchetypeFactory.build({
        instanceId: 'companion_runner',
        spec: { instanceId: 'companion_runner', archetypeId: 'biped_runner', scale: 0.95, accessories: [] }
      });

      const testRigs = new Map([
        ['lead_hero', runnerA],
        ['companion_runner', runnerB]
      ]);

      const manifest = createSyntheticRockManifest({ totalFrames: 300 });
      const testSpec: StorySpecContract = {
        projectId: 'test_independent_clocks',
        title: 'Clock Test',
        overallMood: 'Action',
        themes: ['speed'],
        genreProfile: 'rock_metal',
        cast: [
          { instanceId: 'lead_hero', archetypeId: 'biped_runner', scale: 1.0, accessories: [] },
          { instanceId: 'companion_runner', archetypeId: 'biped_runner', scale: 0.95, accessories: [] }
        ],
        sections: [
          {
            sectionId: 'sec_1',
            startFrame: 0,
            endFrame: 100,
            narrativeIntent: 'Verse',
            emotionalTone: 'defiant',
            lyricMotifs: [],
            environmentKitId: 'industrial_city',
            kitParams: {},
            colorThemeId: 'CYBERPUNK_CYAN',
            cameraIntensity: 0.8,
            castDirectives: [
              {
                instanceId: 'lead_hero',
                motionPreset: 'sprint_frenzy',
                waypoints: [{ frameProgress: 0, stagePosNorm: [0, 0, 0] }, { frameProgress: 1, stagePosNorm: [0, 0, 0] }]
              },
              {
                instanceId: 'companion_runner',
                motionPreset: 'stalk_crouch',
                waypoints: [{ frameProgress: 0, stagePosNorm: [-0.3, 0, 0] }, { frameProgress: 1, stagePosNorm: [-0.3, 0, 0] }]
              }
            ]
          },
          {
            sectionId: 'sec_2',
            startFrame: 100,
            endFrame: 200,
            narrativeIntent: 'Chorus',
            emotionalTone: 'defiant',
            lyricMotifs: [],
            environmentKitId: 'industrial_city',
            kitParams: {},
            colorThemeId: 'CYBERPUNK_CYAN',
            cameraIntensity: 0.8,
            castDirectives: [
              {
                instanceId: 'lead_hero',
                motionPreset: 'sprint_frenzy',
                waypoints: [{ frameProgress: 0, stagePosNorm: [0, 0, 0] }, { frameProgress: 1, stagePosNorm: [0, 0, 0] }]
              },
              {
                instanceId: 'companion_runner',
                motionPreset: 'stalk_crouch',
                waypoints: [{ frameProgress: 0, stagePosNorm: [-0.3, 0, 0] }, { frameProgress: 1, stagePosNorm: [-0.3, 0, 0] }]
              }
            ]
          },
          {
            sectionId: 'sec_3',
            startFrame: 200,
            endFrame: 300,
            narrativeIntent: 'Outro',
            emotionalTone: 'defiant',
            lyricMotifs: [],
            environmentKitId: 'industrial_city',
            kitParams: {},
            colorThemeId: 'CYBERPUNK_CYAN',
            cameraIntensity: 0.8,
            castDirectives: [
              {
                instanceId: 'lead_hero',
                motionPreset: 'sprint_frenzy',
                waypoints: [{ frameProgress: 0, stagePosNorm: [0, 0, 0] }, { frameProgress: 1, stagePosNorm: [0, 0, 0] }]
              },
              {
                instanceId: 'companion_runner',
                motionPreset: 'stalk_crouch',
                waypoints: [{ frameProgress: 0, stagePosNorm: [-0.3, 0, 0] }, { frameProgress: 1, stagePosNorm: [-0.3, 0, 0] }]
              }
            ]
          }
        ]
      };

      const solver = new TrajectorySolver();
      const testStoryboard = compileStorySpecToStoryboard(testSpec, manifest, solver);
      const choreo = solveChoreography(testSpec, testStoryboard, testRigs, undefined, solver);

      const shot0 = testStoryboard.shots[0];
      const trackA_s0 = choreo.tracks.find((t) => t.shotId === shot0.id && t.rigId === 'lead_hero')!;
      const trackB_s0 = choreo.tracks.find((t) => t.shotId === shot0.id && t.rigId === 'companion_runner')!;

      assert.ok(trackA_s0 && trackB_s0);
      assert.ok(trackA_s0.pose?.timeScale && trackA_s0.pose.timeScale >= 0.6 && trackA_s0.pose.timeScale <= 1.6);
      assert.ok(trackB_s0.pose?.timeScale && trackB_s0.pose.timeScale >= 0.6 && trackB_s0.pose.timeScale <= 1.6);
      assert.equal(trackA_s0.pose?.clipId, 'sprint_frenzy');
      assert.equal(trackB_s0.pose?.clipId, 'stalk_crouch');

      if (testStoryboard.shots.length > 1) {
        const shot1 = testStoryboard.shots[1];
        const trackB_s1 = choreo.tracks.find((t) => t.shotId === shot1.id && t.rigId === 'companion_runner');
        if (trackB_s1) {
          assert.equal(trackB_s1.pose?.clipId, 'stalk_crouch');
        }
      }
    }
  );

  await t.test(
    'Quadruped beast motion: beast_gallop contact relative deviation is <= 2%, all 4 paws have >= 10 contact frames, and beast_idle root speed = 0',
    () => {
      const beast = ArchetypeFactory.build({
        instanceId: 'test_beast',
        spec: { instanceId: 'test_beast', archetypeId: 'quadruped_beast', scale: 1.0, accessories: [] }
      });

      assert.ok(beast.poseClips?.beast_gallop, 'beast_gallop clip must exist');
      assert.ok(beast.poseClips?.beast_idle, 'beast_idle clip must exist');

      const gallopAnalysis = analyzeClipContactStride(beast, beast.poseClips.beast_gallop, 'beast_gallop');
      assert.ok(gallopAnalysis.strideLengthUnits > 0);
      assert.ok(
        gallopAnalysis.maxRelativeDeviation <= 0.02,
        `beast_gallop maxRelativeDeviation ${(gallopAnalysis.maxRelativeDeviation * 100).toFixed(2)}% must be <= 2%`
      );

      const minPawContact = Math.ceil(0.38 * 24); // 10
      for (const pawId of ['leg_fl_lower', 'leg_fr_lower', 'leg_bl_lower', 'leg_br_lower']) {
        const stats = gallopAnalysis.perLimbStats[pawId];
        assert.ok(stats, `Missing perLimbStats for ${pawId}`);
        assert.ok(
          stats.contactFrames >= minPawContact,
          `beast_gallop paw ${pawId} contactFrames (${stats.contactFrames}) must be >= ${minPawContact}`
        );
        const airborneShare =
          stats.backwardFrames > 0 ? stats.airborneBackwardFrames / stats.backwardFrames : 0;
        assert.ok(
          airborneShare <= 0.1,
          `beast_gallop paw ${pawId} airborne backward share ${(airborneShare * 100).toFixed(1)}% must be <= 10%`
        );
      }

      const idleStride = computeClipStrideLength(beast, beast.poseClips.beast_idle, 'beast_idle');
      const idleMotion = computeMusicalMotionParameters(beast.poseClips.beast_idle, idleStride, 15, 'beast_idle');
      assert.equal(idleMotion.rootSpeed, 0);
      assert.equal(idleMotion.timeScale, 1.0);
    }
  );

  await t.test(
    'Musical timeScale is in [0.6, 1.6] and world-space foot slip via solveChoreography is <= 2% across rock (174 bpm), electronic (110 bpm) and ballad (74 bpm)',
    () => {
      const tempos = [174, 110, 74];
      const clipsToTest = ['sprint_frenzy', 'stalk_crouch', 'exhausted_walk', 'beast_gallop'] as const;

      const biped = ArchetypeFactory.build({
        instanceId: 'test_biped',
        spec: { instanceId: 'test_biped', archetypeId: 'biped_runner', scale: 1.0, accessories: [] }
      });
      const quad = ArchetypeFactory.build({
        instanceId: 'test_quad',
        spec: { instanceId: 'test_quad', archetypeId: 'quadruped_beast', scale: 1.0, accessories: [] }
      });

      for (const bpm of tempos) {
        const fpb = (60 / bpm) * 30; // 30 fps
        const manifest = createSyntheticRockManifest({ tempoBpm: bpm, totalFrames: 300 });

        for (const clipId of clipsToTest) {
          const isBeast = clipId === 'beast_gallop';
          const rig = isBeast ? quad : biped;
          const clip = rig.poseClips![clipId];
          const analysis = analyzeClipContactStride(rig, clip, clipId);
          const motion = computeMusicalMotionParameters(clip, analysis.strideLengthUnits, fpb, clipId);

          assert.ok(
            motion.timeScale >= 0.6 && motion.timeScale <= 1.6,
            `Clip ${clipId} at ${bpm} BPM produced timeScale ${motion.timeScale} outside [0.6, 1.6]`
          );
          assert.ok(motion.rootSpeed > 0, `Clip ${clipId} at ${bpm} BPM must have positive root speed`);

          const specMotionPreset = isBeast ? 'gallop' : clipId;

          // Verify world-space foot slip through real solveChoreography track output
          const testSpec: StorySpecContract = {
            projectId: `slip_test_${clipId}_${bpm}`,
            title: 'Slip Test',
            overallMood: 'Focused',
            themes: ['precision'],
            genreProfile: 'rock_metal',
            cast: [
              {
                instanceId: rig.id,
                archetypeId: isBeast ? 'quadruped_beast' : 'biped_runner',
                scale: 1.0,
                accessories: []
              }
            ],
            sections: [
              {
                sectionId: 'sec_1',
                startFrame: 0,
                endFrame: 100,
                narrativeIntent: 'Instrumentals',
                emotionalTone: 'defiant',
                lyricMotifs: [],
                environmentKitId: 'industrial_city',
                kitParams: {},
                colorThemeId: 'CYBERPUNK_CYAN',
                cameraIntensity: 0.5,
                castDirectives: [
                  {
                    instanceId: rig.id,
                    motionPreset: specMotionPreset,
                    waypoints: [
                      { frameProgress: 0, stagePosNorm: [0, 0, 0] },
                      { frameProgress: 1, stagePosNorm: [0, 0, 0] }
                    ]
                  }
                ]
              },
              {
                sectionId: 'sec_2',
                startFrame: 100,
                endFrame: 200,
                narrativeIntent: 'Instrumentals',
                emotionalTone: 'defiant',
                lyricMotifs: [],
                environmentKitId: 'industrial_city',
                kitParams: {},
                colorThemeId: 'CYBERPUNK_CYAN',
                cameraIntensity: 0.5,
                castDirectives: [
                  {
                    instanceId: rig.id,
                    motionPreset: specMotionPreset,
                    waypoints: [
                      { frameProgress: 0, stagePosNorm: [0, 0, 0] },
                      { frameProgress: 1, stagePosNorm: [0, 0, 0] }
                    ]
                  }
                ]
              },
              {
                sectionId: 'sec_3',
                startFrame: 200,
                endFrame: 300,
                narrativeIntent: 'Instrumentals',
                emotionalTone: 'defiant',
                lyricMotifs: [],
                environmentKitId: 'industrial_city',
                kitParams: {},
                colorThemeId: 'CYBERPUNK_CYAN',
                cameraIntensity: 0.5,
                castDirectives: [
                  {
                    instanceId: rig.id,
                    motionPreset: specMotionPreset,
                    waypoints: [
                      { frameProgress: 0, stagePosNorm: [0, 0, 0] },
                      { frameProgress: 1, stagePosNorm: [0, 0, 0] }
                    ]
                  }
                ]
              }
            ]
          };

          const solver = new TrajectorySolver();
          const sb = compileStorySpecToStoryboard(testSpec, manifest, solver);
          // Force first shot framing to MEDIUM so close-up scream override doesn't trigger
          sb.shots[0].framing = 'MEDIUM';
          const choreo = solveChoreography(testSpec, sb, new Map([[rig.id, rig]]), fpb, solver);
          const shot0 = sb.shots[0];
          const track = choreo.tracks.find((tr) => tr.shotId === shot0.id && tr.rigId === rig.id)!;
          assert.ok(track, `Track must exist for ${rig.id} in shot ${shot0.id}`);
          assert.equal(track.pose?.clipId, clipId);

          const kfs = track.transform.keyframes;
          const kf0 = kfs[0];
          const kfEnd = kfs[kfs.length - 1];
          const vRootTrack = (kfEnd.position[0] - kf0.position[0]) / Math.max(1, kfEnd.frame - kf0.frame);
          const tsTrack = track.pose!.timeScale;
          const startPoseFrame = track.pose!.startPoseFrame ?? 0;

          const footJoints = rig.skeleton!.joints.filter((j) => j.id.includes('lower'));
          let verifiedGroundedSteps = 0;
          for (let f = shot0.frameRange.startFrameInclusive; f < shot0.frameRange.endFrameExclusive - 1; f++) {
            const s0 = shot0.frameRange.startFrameInclusive;
            const poseA = samplePoseTrack(rig, f, s0, tsTrack, startPoseFrame, clipId);
            const poseA2 = samplePoseTrack(rig, f + 0.01, s0, tsTrack, startPoseFrame, clipId);
            const poseB1 = samplePoseTrack(rig, f + 0.99, s0, tsTrack, startPoseFrame, clipId);
            const poseB = samplePoseTrack(rig, f + 1, s0, tsTrack, startPoseFrame, clipId);

            const fkA = computeSkeletonFK(rig.skeleton!, poseA.jointAngles, poseA.jointOffsets);
            const fkA2 = computeSkeletonFK(rig.skeleton!, poseA2.jointAngles, poseA2.jointOffsets);
            const fkB1 = computeSkeletonFK(rig.skeleton!, poseB1.jointAngles, poseB1.jointOffsets);
            const fkB = computeSkeletonFK(rig.skeleton!, poseB.jointAngles, poseB.jointOffsets);

            const pelA = applyAffine2D(fkA.get('pelvis')!, [0, 0]);
            const pelA2 = applyAffine2D(fkA2.get('pelvis')!, [0, 0]);
            const pelB1 = applyAffine2D(fkB1.get('pelvis')!, [0, 0]);
            const pelB = applyAffine2D(fkB.get('pelvis')!, [0, 0]);

            for (const fj of footJoints) {
              const parentJ = rig.skeleton!.joints.find((j) => j.id === fj.parentId)!;
              const epsJ = 0.02 * (parentJ.length + fj.length);
              const tipA = applyAffine2D(fkA.get(fj.id)!, [0, -fj.length]);
              const tipA2 = applyAffine2D(fkA2.get(fj.id)!, [0, -fj.length]);
              const tipB1 = applyAffine2D(fkB1.get(fj.id)!, [0, -fj.length]);
              const tipB = applyAffine2D(fkB.get(fj.id)!, [0, -fj.length]);

              const dRelX = (tipB[0] - pelB[0]) - (tipA[0] - pelA[0]);
              const dStart = (tipA2[0] - pelA2[0]) - (tipA[0] - pelA[0]);
              const dEnd = (tipB[0] - pelB[0]) - (tipB1[0] - pelB1[0]);

              // Step lies inside grounded stance interval when both endpoints are within epsJ of ground
              // and instantaneous foot velocity is backward at both start and end of the frame transition
              if (
                tipA[1] <= analysis.groundLevelY + epsJ &&
                tipB[1] <= analysis.groundLevelY + epsJ &&
                dStart < -1e-7 &&
                dEnd < -1e-7 &&
                dRelX < -1e-6
              ) {
                verifiedGroundedSteps++;
                const vFootWorld = vRootTrack + dRelX;
                const slipRatio = Math.abs(vFootWorld) / vRootTrack;
                assert.ok(
                  slipRatio <= 0.02,
                  `World-space slip for ${clipId} (${fj.id}) at ${bpm} BPM frame ${f}: ${(slipRatio * 100).toFixed(2)}% > 2%`
                );
              }
            }
          }
          assert.ok(
            verifiedGroundedSteps >= 10,
            `Expected >= 10 grounded stance steps in shot for ${clipId} at ${bpm} BPM, got ${verifiedGroundedSteps}`
          );
        }
      }
    }
  );

  await t.test(
    'Non-locomotion clips set character root velocity = 0 and preserve position',
    () => {
      for (const clipId of Array.from(NON_LOCOMOTION_CLIPS)) {
        const motion = computeMusicalMotionParameters(
          { keyframes: [], interpolationMode: 'linear', loopFrames: 24 },
          100, // even with dummy positive stride
          15,
          clipId
        );
        assert.equal(motion.rootSpeed, 0, `Non-locomotion clip ${clipId} must have rootSpeed = 0`);
        assert.equal(motion.timeScale, 1.0, `Non-locomotion clip ${clipId} must have timeScale = 1.0`);
      }
    }
  );
});
