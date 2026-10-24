import test from 'node:test';
import assert from 'node:assert/strict';
import { solveChoreography } from '../src/engine/director/choreography-solver.js';
import { ArchetypeFactory } from '../src/engine/library/archetype-factory.js';
import {
  buildTheatricalStorySpec,
  buildDeterministicStorySpec
} from '../src/agents/story-spec-agent.js';
import {
  compileStorySpecToStoryboard
} from '../src/engine/director/shot-planner.js';
import {
  computeSkeletonFK,
  applyAffine2D
} from '../src/engine/rigging/kinematics.js';
import { samplePoseTrack } from '../src/engine/rigging/deformer.js';
import {
  analyzeClipContactStride,
  NON_LOCOMOTION_CLIPS
} from '../src/engine/director/trajectory-solver.js';
import { MIN_INTERPERSONAL_CLEARANCE } from '../src/engine/director/relational-blocking-solver.js';
import {
  createSyntheticRockManifest,
  createSyntheticElectronicManifest,
  createSyntheticBalladManifest
} from './helpers/manifest-factory.js';

test('F6 Pursuit & In-Place Stepping Motion Plan Verification', async (t) => {
  const genres = [
    { name: 'ROCK', manifest: createSyntheticRockManifest({ totalFrames: 300, tempoBpm: 148 }) },
    { name: 'ELECTRONIC', manifest: createSyntheticElectronicManifest({ totalFrames: 300, tempoBpm: 128 }) },
    { name: 'BALLAD', manifest: createSyntheticBalladManifest({ totalFrames: 300, tempoBpm: 72 }) }
  ];

  for (const { name: genreName, manifest } of genres) {
    for (const mode of ['runner', 'theatrical'] as const) {
      await t.test(`${genreName} in ${mode} mode: locomotion timeScale in [0.6, 1.6], foot slip <= 2%, movement displacement > 0, no pass-through`, () => {
        const spec =
          mode === 'theatrical'
            ? buildTheatricalStorySpec(manifest, `${genreName.toLowerCase()}_theatrical`)
            : buildDeterministicStorySpec(manifest, `${genreName.toLowerCase()}_runner`);

        const storyboard = compileStorySpecToStoryboard(spec, manifest);

        const rigs = new Map(
          spec.cast.map((item) => [item.instanceId, ArchetypeFactory.build({ instanceId: item.instanceId, spec: item })])
        );

        const choreography = solveChoreography(spec, storyboard, rigs);

        for (const shot of storyboard.shots) {
          const section = spec.sections.find(
            (s) =>
              shot.frameRange.startFrameInclusive >= s.startFrame &&
              shot.frameRange.startFrameInclusive < s.endFrame
          );
          const behavior = section?.interactionBehavior;
          const shotTracks = choreography.tracks.filter((tr) => tr.shotId === shot.id);

          // 1. Movement behaviors check: displacement > 0 and no pass-through
          if (behavior === 'PURSUIT_AND_CONFRONTATION' || behavior === 'PARALLEL_WALK') {
            for (const track of shotTracks) {
              const kfs = track.transform.keyframes;
              const dX = Math.abs(kfs[kfs.length - 1].position[0] - kfs[0].position[0]);
              assert.ok(
                dX > 0,
                `Shot ${shot.id} (${behavior}) track for ${track.rigId} must have root displacement > 0 (got ${dX})`
              );
            }

            if (shotTracks.length >= 2) {
              const leadTrack = shotTracks.find((tr) => tr.rigId === spec.cast[0].instanceId);
              const partnerTrack = shotTracks.find((tr) => tr.rigId !== spec.cast[0].instanceId);
              if (leadTrack && partnerTrack) {
                const leadKfs = leadTrack.transform.keyframes;
                const partKfs = partnerTrack.transform.keyframes;
                const dXStart = partKfs[0].position[0] - leadKfs[0].position[0];
                const dXEnd = partKfs[partKfs.length - 1].position[0] - leadKfs[leadKfs.length - 1].position[0];

                assert.ok(
                  dXStart < -0.1,
                  `Partner should start behind lead in pursuit/parallel (got dXStart = ${dXStart})`
                );
                assert.ok(
                  dXEnd < -0.1,
                  `Partner must never pass through lead (got dXEnd = ${dXEnd})`
                );
                assert.ok(
                  Math.abs(dXEnd) >= MIN_INTERPERSONAL_CLEARANCE - 1.0,
                  `Partner separation at end ${Math.abs(dXEnd)} must respect clearance ${MIN_INTERPERSONAL_CLEARANCE}`
                );
              }
            }
          }

          // 2. For every track: if using locomotion clip, timeScale in [0.6, 1.6] and foot slip <= 2%
          for (const track of shotTracks) {
            const clipId = track.pose?.clipId;
            if (!clipId || NON_LOCOMOTION_CLIPS.has(clipId)) {
              continue;
            }

            const ts = track.pose!.timeScale;
            assert.ok(
              ts >= 0.6 && ts <= 1.6,
              `Locomotion track ${track.rigId} in shot ${shot.id} (${clipId}) timeScale ${ts} outside [0.6, 1.6]`
            );

            const rig = rigs.get(track.rigId);
            if (!rig || !rig.skeleton) continue;

            const clip = rig.poseClips?.[clipId];
            if (!clip) continue;

            const analysis = analyzeClipContactStride(rig, clip, clipId);
            if (analysis.strideLengthUnits <= 0) continue;

            const kfs = track.transform.keyframes;
            const kf0 = kfs[0];
            const kfEnd = kfs[kfs.length - 1];
            const duration = Math.max(1, kfEnd.frame - kf0.frame);
            const vRootTrack = Math.abs(kfEnd.position[0] - kf0.position[0]) / duration;

            if (vRootTrack <= 0.01) continue;

            const footJoints = rig.skeleton.joints.filter((j) => j.id.includes('lower'));
            const s0 = shot.frameRange.startFrameInclusive;
            const startPoseFrame = track.pose!.startPoseFrame ?? 0;

            for (let f = shot.frameRange.startFrameInclusive; f < shot.frameRange.endFrameExclusive - 1; f++) {
              const poseA = samplePoseTrack(rig, f, s0, ts, startPoseFrame, clipId);
              const poseA2 = samplePoseTrack(rig, f + 0.01, s0, ts, startPoseFrame, clipId);
              const poseB1 = samplePoseTrack(rig, f + 0.99, s0, ts, startPoseFrame, clipId);
              const poseB = samplePoseTrack(rig, f + 1, s0, ts, startPoseFrame, clipId);

              const fkA = computeSkeletonFK(rig.skeleton, poseA.jointAngles, poseA.jointOffsets);
              const fkA2 = computeSkeletonFK(rig.skeleton, poseA2.jointAngles, poseA2.jointOffsets);
              const fkB1 = computeSkeletonFK(rig.skeleton, poseB1.jointAngles, poseB1.jointOffsets);
              const fkB = computeSkeletonFK(rig.skeleton, poseB.jointAngles, poseB.jointOffsets);

              const pelA = applyAffine2D(fkA.get('pelvis')!, [0, 0]);
              const pelA2 = applyAffine2D(fkA2.get('pelvis')!, [0, 0]);
              const pelB1 = applyAffine2D(fkB1.get('pelvis')!, [0, 0]);
              const pelB = applyAffine2D(fkB.get('pelvis')!, [0, 0]);

              for (const fj of footJoints) {
                const parentJ = rig.skeleton.joints.find((j) => j.id === fj.parentId)!;
                const epsJ = 0.02 * (parentJ.length + fj.length);
                const tipA = applyAffine2D(fkA.get(fj.id)!, [0, -fj.length]);
                const tipA2 = applyAffine2D(fkA2.get(fj.id)!, [0, -fj.length]);
                const tipB1 = applyAffine2D(fkB1.get(fj.id)!, [0, -fj.length]);
                const tipB = applyAffine2D(fkB.get(fj.id)!, [0, -fj.length]);

                const dRelX = (tipB[0] - pelB[0]) - (tipA[0] - pelA[0]);
                const dStart = (tipA2[0] - pelA2[0]) - (tipA[0] - pelA[0]);
                const dEnd = (tipB[0] - pelB[0]) - (tipB1[0] - pelB1[0]);

                if (
                  tipA[1] <= analysis.groundLevelY + epsJ &&
                  tipB[1] <= analysis.groundLevelY + epsJ &&
                  dStart < -1e-7 &&
                  dEnd < -1e-7 &&
                  dRelX < -1e-6
                ) {
                  const vFootWorld = vRootTrack + dRelX;
                  const slipRatio = Math.abs(vFootWorld) / vRootTrack;
                  assert.ok(
                    slipRatio <= 0.02,
                    `World-space slip for ${track.rigId} (${clipId}) at frame ${f}: ${(slipRatio * 100).toFixed(2)}% > 2%`
                  );
                }
              }
            }
          }
        }
      });
    }
  }
});
