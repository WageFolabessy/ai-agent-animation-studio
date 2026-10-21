import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import { samplePoseTrack } from '../src/engine/rigging/deformer.js';

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
});
