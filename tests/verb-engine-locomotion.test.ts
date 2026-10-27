import test from 'node:test';
import assert from 'node:assert/strict';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import { computeSkeletonFK, applyAffine2D } from '../src/engine/rigging/kinematics.js';
import { NON_LOCOMOTION_CLIPS } from '../src/engine/director/trajectory-solver.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';
import type { StoryBeatContract } from '../src/schemas/story-beat.contract.js';

test('F1 Locomotion Anti-Slip & Multi-Beat Continuity Suite', async (t) => {
  const dummyAudio = (f: number): AudioFrameFeature => ({
    frameIndex: f,
    timestamp: f / 30,
    rms: 0,
    rmsRelativeGlobal: 0,
    rmsRelativeLocal: 0,
    localWindowFrames: 30,
    spectralFlux: 0,
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

  await t.test('Reproduction cases: walk_to 175u/209f, walk_to 95u/209f, run_to 255u/119f have slip <= 2%', () => {
    const cases = [
      { verb: 'walk_to' as const, dist: 175, duration: 209 },
      { verb: 'walk_to' as const, dist: 95, duration: 209 },
      { verb: 'run_to' as const, dist: 255, duration: 119 }
    ];

    for (const c of cases) {
      const contract: StoryBeatContract = {
        projectId: 'reproduction_test',
        songDurationSec: c.duration / 30,
        fps: 30,
        sliceFrameRange: { startFrame: 0, endFrame: c.duration },
        cast: [
          {
            instanceId: 'hero',
            role: 'PROTAGONIST',
            archetypeId: 'hero_silhouette',
            palette: { primary: '#0a1128', accent: '#00f0ff' }
          }
        ],
        beats: [
          {
            beatId: 'beat_01',
            startFrame: 0,
            endFrame: c.duration,
            lyricSnippet: '',
            emotionalTone: 'reflective',
            narrativeSubtext: 'locomotion test',
            presentCharacters: ['hero'],
            set: {
              kitId: 'ARCHITECTURAL_INTERIOR',
              variantId: 'moody_night',
              landmarkProps: [],
              atmosphericDensity: 0.5
            },
            actions: [
              {
                instanceId: 'hero',
                verb: c.verb,
                target: { kind: 'position', pos: [-95 + c.dist, 0, 0] },
                speedNorm: 1.0,
                intensityNorm: 0.7
              }
            ],
            camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 }
          }
        ],
        unfulfilledRequests: []
      };

      const manifest = createSyntheticManifest(c.duration);
      const production = VerbCompiler.compile(contract, manifest);
      const builder = new FrameStateBuilder({
        storyboard: production.storyboard,
        choreography: production.choreography,
        rigs: production.rigs,
        audioManifest: manifest,
        getAudioFeatureAtFrame: dummyAudio
      });

      const heroTracks = production.choreography.tracks.filter((tr) => tr.rigId === 'hero');
      const allKfs = heroTracks.flatMap((tr) => tr.transform.keyframes);
      const targetX = -95 + c.dist;
      const arriveKf = allKfs.find((kf) => Math.abs(kf.position[0] - targetX) <= 1.0) ?? allKfs[allKfs.length - 1];
      const arriveF = arriveKf.frame;

      // Assert timeScale within [0.6, 1.6]
      const ts = heroTracks[0].pose?.timeScale ?? 1.0;
      assert.ok(ts >= 0.6 && ts <= 1.6, `${c.verb} ${c.dist}u/${c.duration}f timeScale ${ts} must be within [0.6, 1.6]`);

      // Verify FK interior-contact foot slip <= 2% on move segment
      const rig = production.rigs.get('hero')!;
      let totalContactFrames = 0;
      let maxSlip = 0;

      for (let f = 5; f < arriveF - 5; f++) {
        const state0 = builder.buildFrameState(f);
        const state1 = builder.buildFrameState(f + 1);
        const e0 = state0.entities.find((e) => e.rigId === 'hero')!;
        const e1 = state1.entities.find((e) => e.rigId === 'hero')!;

        const vRoot = Math.abs(e1.worldPosition[0] - e0.worldPosition[0]);
        if (vRoot < 1e-4) continue;

        const fk0 = computeSkeletonFK(rig.skeleton!, e0.jointAngles, e0.jointOffsets);
        const fk1 = computeSkeletonFK(rig.skeleton!, e1.jointAngles, e1.jointOffsets);

        for (const limb of ['leg_l_lower', 'leg_r_lower']) {
          const boneLen = rig.skeleton!.joints.find((j) => j.id === limb)?.length ?? 22;
          const tip0 = applyAffine2D(fk0.get(limb)!, [0, -boneLen]);
          const tip1 = applyAffine2D(fk1.get(limb)!, [0, -boneLen]);

          // Interior contact condition: foot planted at ground (min ground Y) and moving backward in local rig space
          const isContact =
            ((tip0[1] < -45.99 && tip1[1] < -45.99) || (tip0[1] < -40.99 && tip1[1] < -40.99 && c.verb === 'run_to')) &&
            tip1[0] < tip0[0] - 1e-3;
          if (isContact) {
            totalContactFrames++;
            const wFoot0 = e0.worldPosition[0] + e0.scale[0] * tip0[0];
            const wFoot1 = e1.worldPosition[0] + e1.scale[0] * tip1[0];
            const drift = Math.abs(wFoot1 - wFoot0);
            const slipRatio = drift / vRoot;
            if (slipRatio > maxSlip) maxSlip = slipRatio;
            assert.ok(
              slipRatio <= 0.02,
              `Frame ${f} ${c.verb} ${limb} slip ratio ${slipRatio.toFixed(4)} must be <= 0.02 (drift=${drift.toFixed(4)}, vRoot=${vRoot.toFixed(4)})`
            );
          }
        }
      }

      assert.ok(totalContactFrames > 0, `Expected contact frames during locomotion for ${c.verb} ${c.dist}u`);

      // Arrival position within 1 unit of target
      const finalState = builder.buildFrameState(arriveF);
      const finalE = finalState.entities.find((e) => e.rigId === 'hero')!;
      assert.ok(
        Math.abs(finalE.worldPosition[0] - targetX) <= 1.0,
        `Arrival X ${finalE.worldPosition[0]} must be within 1 unit of target ${targetX}`
      );
      assert.ok(arriveF <= c.duration, `Arrival frame ${arriveF} must be <= duration ${c.duration}`);
    }
  });

  await t.test('54-case matrix of walk_to and run_to across distances, durations, and speedNorm', () => {
    const verbs = ['walk_to', 'run_to'] as const;
    const distances = [40, 120, 300];
    const durations = [90, 210, 360];
    const speedNorms = [0.7, 1.0, 1.6];

    let totalCases = 0;
    let unreachableCasesCount = 0;

    for (const verb of verbs) {
      for (const dist of distances) {
        for (const duration of durations) {
          for (const speedNorm of speedNorms) {
            totalCases++;
            const startX = -95;
            const targetX = startX + dist;

            const contract: StoryBeatContract = {
              projectId: `matrix_${verb}_${dist}_${duration}_${speedNorm}`,
              songDurationSec: duration / 30,
              fps: 30,
              sliceFrameRange: { startFrame: 0, endFrame: duration },
              cast: [
                {
                  instanceId: 'hero',
                  role: 'PROTAGONIST',
                  archetypeId: 'hero_silhouette',
                  palette: { primary: '#0a1128', accent: '#00f0ff' }
                }
              ],
              beats: [
                {
                  beatId: 'beat_01',
                  startFrame: 0,
                  endFrame: duration,
                  lyricSnippet: '',
                  emotionalTone: 'reflective',
                  narrativeSubtext: 'locomotion matrix test',
                  presentCharacters: ['hero'],
                  set: {
                    kitId: 'ARCHITECTURAL_INTERIOR',
                    variantId: 'moody_night',
                    landmarkProps: [],
                    atmosphericDensity: 0.5
                  },
                  actions: [
                    {
                      instanceId: 'hero',
                      verb,
                      target: { kind: 'position', pos: [targetX, 0, 0] },
                      speedNorm,
                      intensityNorm: 0.7
                    }
                  ],
                  camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 }
                }
              ],
              unfulfilledRequests: []
            };

            const manifest = createSyntheticManifest(duration);
            const production = VerbCompiler.compile(contract, manifest);
            const heroTracks = production.choreography.tracks.filter((tr) => tr.rigId === 'hero');
            const allKfs = heroTracks.flatMap((tr) => tr.transform.keyframes);
            const isUnreachable = production.compileReport.unreachableTargets.length > 0;

            if (isUnreachable) {
              unreachableCasesCount++;
              const entry = production.compileReport.unreachableTargets[0];
              assert.equal(entry.verb, verb);
              assert.equal(entry.requestedDistance, dist);
              assert.equal(entry.durationFrames, duration);
              assert.ok(entry.achievableDistance < dist);
              assert.ok(entry.minimumFramesNeeded > duration);

              // Stopped at achievableDistance within 1 unit
              const expectedX = startX + entry.achievableDistance;
              const arriveKf = allKfs[allKfs.length - 1];
              assert.ok(
                Math.abs(arriveKf.position[0] - expectedX) <= 1.0,
                `Unreachable ${verb} ${dist}u/${duration}f stopped at ${arriveKf.position[0]} expected ${expectedX}`
              );
            } else {
              // Feasible arrival within 1 unit of target
              const arriveKf = allKfs.find((kf) => Math.abs(kf.position[0] - targetX) <= 1e-3) ?? allKfs[allKfs.length - 1];
              assert.ok(
                Math.abs(arriveKf.position[0] - targetX) <= 1.0,
                `Feasible ${verb} ${dist}u/${duration}f arrived at ${arriveKf.position[0]} expected ${targetX}`
              );
              assert.ok(arriveKf.frame <= duration);
            }

            // Interior-contact slip <= 2% on ALL 54 cases
            const builder = new FrameStateBuilder({
              storyboard: production.storyboard,
              choreography: production.choreography,
              rigs: production.rigs,
              audioManifest: manifest,
              getAudioFeatureAtFrame: dummyAudio
            });

            const rig = production.rigs.get('hero')!;
            const isRunClip = heroTracks.some((t) => t.pose?.clipId === 'sprint_frenzy');
            const lastMoveF = isUnreachable ? duration - 1 : (allKfs.find((kf) => Math.abs(kf.position[0] - targetX) <= 1.0)?.frame ?? duration - 1);
            for (let f = 5; f < lastMoveF - 5; f++) {
              const s0 = builder.buildFrameState(f);
              const s1 = builder.buildFrameState(f + 1);
              const e0 = s0.entities.find((e) => e.rigId === 'hero')!;
              const e1 = s1.entities.find((e) => e.rigId === 'hero')!;
              const vRoot = Math.abs(e1.worldPosition[0] - e0.worldPosition[0]);
              if (vRoot < 1e-4) continue;

              const fk0 = computeSkeletonFK(rig.skeleton!, e0.jointAngles, e0.jointOffsets);
              const fk1 = computeSkeletonFK(rig.skeleton!, e1.jointAngles, e1.jointOffsets);

              for (const limb of ['leg_l_lower', 'leg_r_lower']) {
                const boneLen = rig.skeleton!.joints.find((j) => j.id === limb)?.length ?? 22;
                const tip0 = applyAffine2D(fk0.get(limb)!, [0, -boneLen]);
                const tip1 = applyAffine2D(fk1.get(limb)!, [0, -boneLen]);
                const isContact =
                  ((tip0[1] < -45.99 && tip1[1] < -45.99) || (tip0[1] < -40.99 && tip1[1] < -40.99 && isRunClip)) &&
                  tip1[0] < tip0[0] - 1e-3;
                if (isContact) {
                  const wFoot0 = e0.worldPosition[0] + e0.scale[0] * tip0[0];
                  const wFoot1 = e1.worldPosition[0] + e1.scale[0] * tip1[0];
                  const drift = Math.abs(wFoot1 - wFoot0);
                  const slipRatio = drift / vRoot;
                  assert.ok(
                    slipRatio <= 0.02,
                    `Matrix case ${verb} ${dist}u/${duration}f speedNorm=${speedNorm} frame ${f} ${limb} slip ${slipRatio.toFixed(4)} must be <= 0.02`
                  );
                }
              }
            }
          }
        }
      }
    }

    assert.equal(totalCases, 54, 'Must execute exactly 54 matrix cases');
    assert.equal(unreachableCasesCount, 6, 'Exactly 6 cases (300u in 90f) must be unreachable');
  });

  await t.test('Grid of distances, durations, speedNorm, and both directions satisfies invariants', () => {
    const testCases: Array<{ dist: number; duration: number; speedNorm: number; dir: 1 | -1; isRun: boolean }> = [
      // Short distance with short duration
      { dist: 20, duration: 30, speedNorm: 1.0, dir: 1, isRun: false },
      { dist: 20, duration: 30, speedNorm: 1.0, dir: -1, isRun: false },
      // Short distance with long duration (arrives early, holds with non-locomotion clip)
      { dist: 20, duration: 150, speedNorm: 1.0, dir: 1, isRun: false },
      { dist: 20, duration: 250, speedNorm: 0.5, dir: -1, isRun: false },
      { dist: 35, duration: 120, speedNorm: 1.5, dir: 1, isRun: false },
      // Medium distance with medium duration
      { dist: 95, duration: 120, speedNorm: 0.8, dir: 1, isRun: false },
      { dist: 95, duration: 120, speedNorm: 1.2, dir: -1, isRun: false },
      { dist: 140, duration: 150, speedNorm: 1.0, dir: 1, isRun: false },
      // Run distance with varying speedNorm
      { dist: 180, duration: 120, speedNorm: 1.0, dir: 1, isRun: true },
      { dist: 180, duration: 120, speedNorm: 1.2, dir: -1, isRun: true },
      { dist: 255, duration: 120, speedNorm: 1.0, dir: 1, isRun: true },
      { dist: 255, duration: 150, speedNorm: 1.5, dir: -1, isRun: true },
      { dist: 300, duration: 200, speedNorm: 1.0, dir: 1, isRun: true },
      // Large distance with long duration
      { dist: 350, duration: 250, speedNorm: 1.0, dir: 1, isRun: true },
      { dist: 400, duration: 300, speedNorm: 1.0, dir: 1, isRun: true },
      { dist: 400, duration: 300, speedNorm: 1.2, dir: -1, isRun: true },
      // Unreachable cases (high distance in low duration)
      { dist: 400, duration: 90, speedNorm: 1.0, dir: 1, isRun: true },
      { dist: 350, duration: 60, speedNorm: 1.5, dir: -1, isRun: false },
      { dist: 300, duration: 60, speedNorm: 0.5, dir: 1, isRun: false },
      { dist: 250, duration: 45, speedNorm: 2.0, dir: -1, isRun: true }
    ];

    for (const tc of testCases) {
      const verb = tc.isRun ? 'run_to' : 'walk_to';
      const startX = -95;
      const targetX = startX + tc.dir * tc.dist;

      const contract: StoryBeatContract = {
        projectId: `grid_${tc.dist}_${tc.duration}_${tc.speedNorm}_${tc.dir}`,
        songDurationSec: tc.duration / 30,
        fps: 30,
        sliceFrameRange: { startFrame: 0, endFrame: tc.duration },
        cast: [
          {
            instanceId: 'hero',
            role: 'PROTAGONIST',
            archetypeId: 'hero_silhouette',
            palette: { primary: '#0a1128', accent: '#00f0ff' }
          }
        ],
        beats: [
          {
            beatId: 'beat_01',
            startFrame: 0,
            endFrame: tc.duration,
            lyricSnippet: '',
            emotionalTone: 'reflective',
            narrativeSubtext: 'locomotion grid test',
            presentCharacters: ['hero'],
            set: {
              kitId: 'ARCHITECTURAL_INTERIOR',
              variantId: 'moody_night',
              landmarkProps: [],
              atmosphericDensity: 0.5
            },
            actions: [
              {
                instanceId: 'hero',
                verb,
                target: { kind: 'position', pos: [targetX, 0, 0] },
                speedNorm: tc.speedNorm,
                intensityNorm: 0.7
              }
            ],
            camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 }
          }
        ],
        unfulfilledRequests: []
      };

      const manifest = createSyntheticManifest(tc.duration);
      const production = VerbCompiler.compile(contract, manifest);
      const heroTracks = production.choreography.tracks.filter((tr) => tr.rigId === 'hero');
      const allKfs = heroTracks.flatMap((tr) => tr.transform.keyframes);
      const isUnreachable = production.compileReport.unreachableTargets.length > 0;
      let arriveF: number;

      if (isUnreachable) {
        const entry = production.compileReport.unreachableTargets[0];
        const expectedX = startX + tc.dir * entry.achievableDistance;
        const arriveKf = allKfs[allKfs.length - 1];
        arriveF = arriveKf.frame;
        assert.ok(
          Math.abs(arriveKf.position[0] - expectedX) <= 1.0,
          `Unreachable case dist=${tc.dist} dur=${tc.duration}: stopped at ${arriveKf.position[0]} expected ${expectedX}`
        );
      } else {
        const arriveKf = allKfs.find((kf) => Math.abs(kf.position[0] - targetX) <= 1e-3) ?? allKfs[allKfs.length - 1];
        arriveF = arriveKf.frame;
        // 2. Arrival never after beat end
        assert.ok(
          arriveF <= tc.duration,
          `Arrival frame ${arriveF} must be <= duration ${tc.duration}`
        );
        // 3. Arrival position within 1 unit of target
        const arrivePos = arriveKf.position[0];
        assert.ok(
          Math.abs(arrivePos - targetX) <= 1.0,
          `Arrival position ${arrivePos} must be within 1 unit of target ${targetX}`
        );
      }

      // 1. timeScale within [0.6, 1.6]
      const ts = heroTracks[0].pose?.timeScale ?? 1.0;
      assert.ok(
        ts >= 0.6 && ts <= 1.6,
        `Grid case dist=${tc.dist} dur=${tc.duration} speedNorm=${tc.speedNorm} dir=${tc.dir}: timeScale ${ts} must be within [0.6, 1.6]`
      );

      // 4. If early arrival, hold segments use non-locomotion clips with root speed exactly 0
      const builder = new FrameStateBuilder({
        storyboard: production.storyboard,
        choreography: production.choreography,
        rigs: production.rigs,
        audioManifest: manifest,
        getAudioFeatureAtFrame: dummyAudio
      });

      const isEarlyArrival = production.compileReport.unfulfilledTiming.some((u) =>
        u.reason.toLowerCase().includes('early')
      );
      if (isEarlyArrival) {
        const allSegments = heroTracks.flatMap((tr) => tr.pose?.segments ?? []);
        assert.ok(
          allSegments.length >= 2,
          'Early arrival must define at least 2 pose segments across tracks'
        );
        const holdSeg = allSegments.find((seg) => seg.startFrame >= arriveF) ?? allSegments[allSegments.length - 1];
        assert.ok(
          NON_LOCOMOTION_CLIPS.has(holdSeg.clipId),
          `Hold segment clip "${holdSeg.clipId}" must be a recognized non-locomotion clip`
        );

        for (let f = arriveF; f < tc.duration - 1; f++) {
          const s0 = builder.buildFrameState(f);
          const s1 = builder.buildFrameState(f + 1);
          const e0 = s0.entities.find((e) => e.rigId === 'hero')!;
          const e1 = s1.entities.find((e) => e.rigId === 'hero')!;
          const vHold = Math.abs(e1.worldPosition[0] - e0.worldPosition[0]);
          assert.equal(
            vHold,
            0,
            `Frame ${f}: Hold segment root speed must be exactly 0, got ${vHold}`
          );
        }

        // unfulfilledTiming is recorded in compileReport
        assert.ok(
          production.compileReport.unfulfilledTiming.length > 0,
          'Early arrival must record an unfulfilledTiming report entry'
        );
      }

      // 5. Contact foot slip <= 2% on move segment
      const rig = production.rigs.get('hero')!;
      for (let f = 5; f < arriveF - 5; f++) {
        const state0 = builder.buildFrameState(f);
        const state1 = builder.buildFrameState(f + 1);
        const e0 = state0.entities.find((e) => e.rigId === 'hero')!;
        const e1 = state1.entities.find((e) => e.rigId === 'hero')!;
        const vRoot = Math.abs(e1.worldPosition[0] - e0.worldPosition[0]);
        if (vRoot < 1e-4) continue;

        const fk0 = computeSkeletonFK(rig.skeleton!, e0.jointAngles, e0.jointOffsets);
        const fk1 = computeSkeletonFK(rig.skeleton!, e1.jointAngles, e1.jointOffsets);

        for (const limb of ['leg_l_lower', 'leg_r_lower']) {
          const boneLen = rig.skeleton!.joints.find((j) => j.id === limb)?.length ?? 22;
          const tip0 = applyAffine2D(fk0.get(limb)!, [0, -boneLen]);
          const tip1 = applyAffine2D(fk1.get(limb)!, [0, -boneLen]);
          // Interior contact condition: foot planted at ground (min ground Y) and moving backward in local rig space
          const isContact =
            ((tip0[1] < -45.99 && tip1[1] < -45.99) || (tip0[1] < -40.99 && tip1[1] < -40.99 && tc.isRun)) &&
            tip1[0] < tip0[0] - 1e-3;
          if (isContact) {
            const wFoot0 = e0.worldPosition[0] + e0.scale[0] * tip0[0];
            const wFoot1 = e1.worldPosition[0] + e1.scale[0] * tip1[0];
            const drift = Math.abs(wFoot1 - wFoot0);
            const slipRatio = drift / vRoot;
            assert.ok(
              slipRatio <= 0.02,
              `Case ${tc.dist}u/${tc.duration}f frame ${f} ${limb} slip ${slipRatio.toFixed(4)} must be <= 0.02`
            );
          }
        }
      }
    }
  });

  await t.test('Multi-beat position and phase continuity across beat boundaries', () => {
    const multiBeatContract: StoryBeatContract = {
      projectId: 'multi_beat_continuity',
      songDurationSec: 10,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 300 },
      cast: [
        {
          instanceId: 'hero',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'beat_01',
          startFrame: 0,
          endFrame: 100,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'walk forward',
          presentCharacters: ['hero'],
          set: { kitId: 'ARCHITECTURAL_INTERIOR', variantId: 'moody_night', landmarkProps: [], atmosphericDensity: 0.5 },
          actions: [{ instanceId: 'hero', verb: 'walk_to', target: { kind: 'position', pos: [50, 0, 0] }, speedNorm: 1.0, intensityNorm: 0.7 }],
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 }
        },
        {
          beatId: 'beat_02',
          startFrame: 100,
          endFrame: 200,
          lyricSnippet: '',
          emotionalTone: 'defiant',
          narrativeSubtext: 'turn and walk backward',
          presentCharacters: ['hero'],
          set: { kitId: 'ARCHITECTURAL_INTERIOR', variantId: 'moody_night', landmarkProps: [], atmosphericDensity: 0.5 },
          actions: [{ instanceId: 'hero', verb: 'walk_to', target: { kind: 'position', pos: [-20, 0, 0] }, speedNorm: 1.0, intensityNorm: 0.7 }],
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 }
        },
        {
          beatId: 'beat_03',
          startFrame: 200,
          endFrame: 300,
          lyricSnippet: '',
          emotionalTone: 'euphoric',
          narrativeSubtext: 'sprint forward',
          presentCharacters: ['hero'],
          set: { kitId: 'ARCHITECTURAL_INTERIOR', variantId: 'moody_night', landmarkProps: [], atmosphericDensity: 0.5 },
          actions: [{ instanceId: 'hero', verb: 'run_to', target: { kind: 'position', pos: [80, 0, 0] }, speedNorm: 1.0, intensityNorm: 0.7 }],
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 }
        }
      ],
      unfulfilledRequests: []
    };

    const manifest = createSyntheticManifest(300);
    const production = VerbCompiler.compile(multiBeatContract, manifest);
    const builder = new FrameStateBuilder({
      storyboard: production.storyboard,
      choreography: production.choreography,
      rigs: production.rigs,
      audioManifest: manifest,
      getAudioFeatureAtFrame: dummyAudio
    });

    // Check position continuity across boundaries f=99 -> f=100 and f=199 -> f=200
    const s99 = builder.buildFrameState(99);
    const s100 = builder.buildFrameState(100);
    const e99 = s99.entities.find((e) => e.rigId === 'hero')!;
    const e100 = s100.entities.find((e) => e.rigId === 'hero')!;
    assert.ok(
      Math.abs(e100.worldPosition[0] - e99.worldPosition[0]) <= 2.0,
      `Position across beat 1->2 boundary must be continuous, diff=${Math.abs(e100.worldPosition[0] - e99.worldPosition[0])}`
    );

    const s199 = builder.buildFrameState(199);
    const s200 = builder.buildFrameState(200);
    const e199 = s199.entities.find((e) => e.rigId === 'hero')!;
    const e200 = s200.entities.find((e) => e.rigId === 'hero')!;
    assert.ok(
      Math.abs(e200.worldPosition[0] - e199.worldPosition[0]) <= 1.0,
      `Position across beat 2->3 boundary must be continuous, diff=${Math.abs(e200.worldPosition[0] - e199.worldPosition[0])}`
    );

    // Facing direction flips when moving in reverse direction
    assert.ok(e99.scale[0] > 0, 'Moving forward must have scaleX > 0');
    assert.ok(e199.scale[0] < 0, 'Moving in reverse must have scaleX < 0');
    assert.ok(e200.scale[0] > 0, 'Moving forward again must have scaleX > 0');
  });

  await t.test('Multi-beat continuity when beat 1 has unreachable target', () => {
    // Hero starts at -95. Beat 1 requests moving 300u forward in 90f (unreachable).
    // Achievable distance is ~245.64u.
    // Beat 2 starts at f=90 and requests gesture_point or idle.
    // Beat 2 MUST start from the actual stopped position (~150.64u), NOT the unreachable target (+205u).
    const contract: StoryBeatContract = {
      projectId: 'unreachable_multi_beat',
      songDurationSec: 6,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 180 },
      cast: [
        {
          instanceId: 'hero',
          role: 'PROTAGONIST',
          archetypeId: 'hero_silhouette',
          palette: { primary: '#0a1128', accent: '#00f0ff' }
        }
      ],
      beats: [
        {
          beatId: 'beat_01',
          startFrame: 0,
          endFrame: 90,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'unreachable sprint',
          presentCharacters: ['hero'],
          set: { kitId: 'ARCHITECTURAL_INTERIOR', variantId: 'moody_night', landmarkProps: [], atmosphericDensity: 0.5 },
          actions: [{ instanceId: 'hero', verb: 'run_to', target: { kind: 'position', pos: [205, 0, 0] }, speedNorm: 1.0, intensityNorm: 0.7 }],
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 }
        },
        {
          beatId: 'beat_02',
          startFrame: 90,
          endFrame: 180,
          lyricSnippet: '',
          emotionalTone: 'defiant',
          narrativeSubtext: 'look around from stopped position',
          presentCharacters: ['hero'],
          set: { kitId: 'ARCHITECTURAL_INTERIOR', variantId: 'moody_night', landmarkProps: [], atmosphericDensity: 0.5 },
          actions: [{ instanceId: 'hero', verb: 'gesture_point', speedNorm: 1.0, intensityNorm: 0.7 }],
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 }
        }
      ],
      unfulfilledRequests: []
    };

    const manifest = createSyntheticManifest(180);
    const production = VerbCompiler.compile(contract, manifest);
    assert.equal(production.compileReport.unreachableTargets.length, 1);
    const unreach = production.compileReport.unreachableTargets[0];
    assert.equal(unreach.requestedDistance, 300);

    const builder = new FrameStateBuilder({
      storyboard: production.storyboard,
      choreography: production.choreography,
      rigs: production.rigs,
      audioManifest: manifest,
      getAudioFeatureAtFrame: dummyAudio
    });

    const s89 = builder.buildFrameState(89);
    const s90 = builder.buildFrameState(90);
    const e89 = s89.entities.find((e) => e.rigId === 'hero')!;
    const e90 = s90.entities.find((e) => e.rigId === 'hero')!;

    // Position must match achievable distance exactly
    const expectedX = -95 + unreach.achievableDistance;
    assert.ok(Math.abs(e89.worldPosition[0] - expectedX) <= 1.0, `Frame 89 X ${e89.worldPosition[0]} should be ~${expectedX}`);
    assert.ok(Math.abs(e90.worldPosition[0] - expectedX) <= 1.0, `Frame 90 X ${e90.worldPosition[0]} should be ~${expectedX}`);
    assert.ok(Math.abs(e90.worldPosition[0] - e89.worldPosition[0]) <= 0.1, `Beat boundary 89->90 must be continuous: diff=${Math.abs(e90.worldPosition[0] - e89.worldPosition[0])}`);

    // Hold / gesture in beat 2 must have root speed = 0
    for (let f = 90; f < 179; f++) {
      const sf0 = builder.buildFrameState(f);
      const sf1 = builder.buildFrameState(f + 1);
      const ef0 = sf0.entities.find((e) => e.rigId === 'hero')!;
      const ef1 = sf1.entities.find((e) => e.rigId === 'hero')!;
      assert.equal(Math.abs(ef1.worldPosition[0] - ef0.worldPosition[0]), 0, `Beat 2 frame ${f} must have root speed 0`);
    }
  });
});
