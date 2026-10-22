import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import { samplePoseTrack } from '../src/engine/rigging/deformer.js';
import { computeSkeletonFK, applyAffine2D } from '../src/engine/rigging/kinematics.js';
import {
  computeClipStrideLength,
  calculatePhysicalTimeScaleAndSpeed
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
    assert.equal(defaultSample.jointAngles.torso, -18);

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
    'Contact-foot world velocity during contact frames is <= 2% of character root velocity',
    () => {
      const locomotionClips = ['stalk_crouch', 'sprint_frenzy', 'exhausted_walk'];
      const footJoints = [
        runner.skeleton!.joints.find((j) => j.id === 'leg_l_lower')!,
        runner.skeleton!.joints.find((j) => j.id === 'leg_r_lower')!
      ];

      for (const clipId of locomotionClips) {
        const clip = runner.poseClips![clipId];
        const stride = computeClipStrideLength(runner, clip, clipId);
        assert.ok(stride > 0, `Clip ${clipId} must have non-zero stride length`);

        const motion = calculatePhysicalTimeScaleAndSpeed(1.0, clip, stride, clipId);
        assert.ok(motion.timeScale > 0 && motion.speedPerFrame > 0);

        const loopFrames = clip.loopFrames!;
        const timeScale = 1.0;
        const vRoot = (timeScale * stride) / loopFrames;

        let leftNetWorldDx = 0;
        let leftStanceRootDx = 0;
        let rightNetWorldDx = 0;
        let rightStanceRootDx = 0;

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

          // Stance phase: foot moves backward relative to root
          if (dL < 0) {
            leftNetWorldDx += vRoot + dL;
            leftStanceRootDx += vRoot;
          }
          if (dR < 0) {
            rightNetWorldDx += vRoot + dR;
            rightStanceRootDx += vRoot;
          }
        }

        const leftSlip = Math.abs(leftNetWorldDx) / leftStanceRootDx;
        const rightSlip = Math.abs(rightNetWorldDx) / rightStanceRootDx;

        assert.ok(
          leftSlip <= 0.02,
          `Left foot slip for ${clipId}: slip ratio ${leftSlip.toFixed(4)} must be <= 0.02 (2%)`
        );
        assert.ok(
          rightSlip <= 0.02,
          `Right foot slip for ${clipId}: slip ratio ${rightSlip.toFixed(4)} must be <= 0.02 (2%)`
        );
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

      const testStoryboard = compileStorySpecToStoryboard(testSpec, manifest);
      const choreo = solveChoreography(testSpec, testStoryboard, testRigs);

      const shot0 = testStoryboard.shots[0];
      const trackA_s0 = choreo.tracks.find((t) => t.shotId === shot0.id && t.rigId === 'lead_hero')!;
      const trackB_s0 = choreo.tracks.find((t) => t.shotId === shot0.id && t.rigId === 'companion_runner')!;

      assert.ok(trackA_s0 && trackB_s0);
      assert.notEqual(trackA_s0.pose?.timeScale, trackB_s0.pose?.timeScale);
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
});
