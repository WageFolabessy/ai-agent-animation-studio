import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import type { StoryBeatContract, ActionVerbType } from '../src/schemas/story-beat.contract.js';

test('F3 Verb Engine Timing Clamps & Code Hygiene Suite', async (t) => {
  const ALL_VERBS: ActionVerbType[] = [
    'walk_to',
    'run_to',
    'stop_and_turn',
    'look_at',
    'reach_and_grasp',
    'carry_put_down',
    'sit_stand',
    'gesture_point',
    'embrace_push_away',
    'fall_recover'
  ];

  await t.test('Property test: Keyframes are non-decreasing and strictly within [startF, lastF] for beat lengths 12..600', () => {
    const testDurations = [12, 13, 15, 20, 24, 30, 45, 60, 90, 120, 150, 210, 300, 450, 600];

    for (const duration of testDurations) {
      for (const verb of ALL_VERBS) {
        // Multi-beat contract with 3 beats of length `duration` to test both isolated and sequential beats
        const totalFrames = duration * 3;
        const beats = [0, 1, 2].map((i) => ({
          beatId: `beat_${i + 1}`,
          startFrame: i * duration,
          endFrame: (i + 1) * duration,
          lyricSnippet: '',
          emotionalTone: 'reflective' as const,
          narrativeSubtext: `testing ${verb} length ${duration}`,
          presentCharacters: ['hero', 'companion'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR' as const,
            variantId: 'moody_night' as const,
            landmarkProps: ['coffee_cup'],
            atmosphericDensity: 0.5
          },
          camera: {
            framing: 'WIDE' as const,
            movement: 'STATIC' as const,
            focalCharacterId: 'hero',
            lookRoom: 'center' as const,
            dutchAngleDeg: 0
          },
          actions: [
            {
              instanceId: 'hero',
              verb,
              associatedPropId: 'coffee_cup',
              speedNorm: 1.0,
              intensityNorm: 0.7
            },
            {
              instanceId: 'companion',
              verb,
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        }));

        const contract: StoryBeatContract = {
          projectId: `prop_test_${verb}_${duration}`,
          songDurationSec: totalFrames / 30,
          fps: 30,
          sliceFrameRange: { startFrame: 0, endFrame: totalFrames },
          cast: [
            {
              instanceId: 'hero',
              role: 'PROTAGONIST',
              archetypeId: 'hero_silhouette',
              palette: { primary: '#0a1128', accent: '#00f0ff' }
            },
            {
              instanceId: 'companion',
              role: 'PARTNER',
              archetypeId: 'companion_silhouette',
              palette: { primary: '#3d1c06', accent: '#ff9100' }
            }
          ],
          beats,
          unfulfilledRequests: []
        };

        const production = VerbCompiler.compile(contract);

        for (const track of production.choreography.tracks) {
          const shot = production.storyboard.shots.find((s) => s.id === track.shotId);
          assert.ok(shot, `Shot "${track.shotId}" must exist in storyboard`);
          const startF = shot.frameRange.startFrameInclusive;
          const endF = shot.frameRange.endFrameExclusive;
          const lastF = endF - 1;

          // 1. Transform keyframes: non-decreasing and inside [startF, lastF]
          const kfs = track.transform.keyframes;
          assert.ok(kfs.length >= 1, `Track ${track.rigId} in shot ${track.shotId} must have keyframes`);
          for (let j = 0; j < kfs.length; j++) {
            const kf = kfs[j];
            assert.ok(
              kf.frame >= startF && kf.frame <= lastF,
              `Transform keyframe frame ${kf.frame} must be in [${startF}, ${lastF}] for ${verb} at duration ${duration}`
            );
            if (j > 0) {
              assert.ok(
                kf.frame >= kfs[j - 1].frame,
                `Transform keyframes must be non-decreasing: frame ${kf.frame} vs prev ${kfs[j - 1].frame} for ${verb} at duration ${duration}`
              );
            }
          }

          // 2. Morph keyframes: non-decreasing and inside [startF, lastF]
          for (const [target, mKeys] of Object.entries(track.morphKeyframes ?? {})) {
            for (let j = 0; j < mKeys.length; j++) {
              const mk = mKeys[j];
              assert.ok(
                mk.frame >= startF && mk.frame <= lastF,
                `Morph ${target} keyframe frame ${mk.frame} must be in [${startF}, ${lastF}] for ${verb} at duration ${duration}`
              );
              if (j > 0) {
                assert.ok(
                  mk.frame >= mKeys[j - 1].frame,
                  `Morph ${target} keyframes must be non-decreasing: frame ${mk.frame} vs prev ${mKeys[j - 1].frame} for ${verb} at duration ${duration}`
                );
              }
            }
          }

          // 3. Attachment spans: startFrame >= startF, endFrame <= endF
          for (const span of track.attachmentSpans ?? []) {
            assert.ok(
              span.startFrame >= startF && span.endFrame <= endF,
              `Attachment span [${span.startFrame}, ${span.endFrame}) must be inside [${startF}, ${endF}] for ${verb} at duration ${duration}`
            );
            assert.ok(
              span.endFrame > span.startFrame,
              `Attachment span must have positive duration: [${span.startFrame}, ${span.endFrame})`
            );
          }
        }
      }
    }
  });

  await t.test('Proportional timing preserves relative fraction within documented clamps', () => {
    const durations = [100, 200, 300];
    const verbsToTest: ActionVerbType[] = ['reach_and_grasp', 'carry_put_down', 'stop_and_turn'];

    for (const verb of verbsToTest) {
      const fractions: number[] = [];
      for (const d of durations) {
        const contract: StoryBeatContract = {
          projectId: `prop_timing_${verb}_${d}`,
          songDurationSec: (d * 3) / 30,
          fps: 30,
          sliceFrameRange: { startFrame: 0, endFrame: d * 3 },
          cast: [
            {
              instanceId: 'hero',
              role: 'PROTAGONIST',
              archetypeId: 'hero_silhouette',
              palette: { primary: '#0a1128', accent: '#00f0ff' }
            }
          ],
          beats: [0, 1, 2].map((i) => ({
            beatId: `beat_${i + 1}`,
            startFrame: i * d,
            endFrame: (i + 1) * d,
            lyricSnippet: '',
            emotionalTone: 'reflective' as const,
            narrativeSubtext: 'timing proportionality',
            presentCharacters: ['hero'],
            set: {
              kitId: 'ARCHITECTURAL_INTERIOR' as const,
              variantId: 'moody_night' as const,
              landmarkProps: ['coffee_cup'],
              atmosphericDensity: 0.5
            },
            camera: {
              framing: 'WIDE' as const,
              movement: 'STATIC' as const,
              focalCharacterId: 'hero',
              lookRoom: 'center' as const,
              dutchAngleDeg: 0
            },
            actions: [
              {
                instanceId: 'hero',
                verb,
                associatedPropId: 'coffee_cup',
                speedNorm: 1.0,
                intensityNorm: 0.7
              }
            ]
          })),
          unfulfilledRequests: []
        };

        const production = VerbCompiler.compile(contract);
        if (verb === 'reach_and_grasp') {
          const propTrack = production.choreography.tracks.find((t) => t.rigId === 'coffee_cup' && t.shotId === 'beat_1');
          const span = propTrack?.attachmentSpans?.[0];
          assert.ok(span, 'reach_and_grasp must produce an attachment span');
          fractions.push(span.startFrame / d);
        } else if (verb === 'carry_put_down') {
          const propTrack = production.choreography.tracks.find((t) => t.rigId === 'coffee_cup' && t.shotId === 'beat_1');
          const span = propTrack?.attachmentSpans?.[0];
          assert.ok(span, 'carry_put_down must produce an attachment span');
          fractions.push(span.endFrame / d);
        } else if (verb === 'stop_and_turn') {
          const heroTrack = production.choreography.tracks.find((t) => t.rigId === 'hero' && t.shotId === 'beat_1')!;
          const turnKf = heroTrack.transform.keyframes[1];
          fractions.push(turnKf.frame / d);
        }
      }

      // Assert timing fractions across durations are within +-0.05 tolerance of each other
      const maxDiff = Math.max(...fractions) - Math.min(...fractions);
      assert.ok(
        maxDiff <= 0.05,
        `Verb ${verb} timing must be proportional across beat lengths, max relative variation was ${maxDiff.toFixed(4)}`
      );
    }
  });

  await t.test('Prop socket and destination resolution honor directive and fallback rules', () => {
    // 1. Explicit propSocket directive
    const socketContract: StoryBeatContract = {
      projectId: 'socket_directive_test',
      songDurationSec: 3,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 90 },
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
          beatId: 'b1',
          startFrame: 0,
          endFrame: 90,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'socket directive',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['coffee_cup'],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [
            {
              instanceId: 'hero',
              verb: 'reach_and_grasp',
              associatedPropId: 'coffee_cup',
              propSocket: 'hand_l',
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        }
      ],
      unfulfilledRequests: []
    };

    const socketProd = VerbCompiler.compile(socketContract);
    const propTrack = socketProd.choreography.tracks.find(
      (t) => t.rigId === 'coffee_cup' && (t.attachmentSpans?.length ?? 0) > 0
    );
    assert.ok(propTrack, 'Expected a coffee_cup track with attachmentSpans');
    assert.equal(propTrack?.attachmentSpans?.[0].socketId, 'hand_l');

    // 2. Put down places prop at destination
    const putDownContract: StoryBeatContract = {
      projectId: 'put_down_dest_test',
      songDurationSec: 3,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 90 },
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
          beatId: 'b1',
          startFrame: 0,
          endFrame: 90,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'put down target',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: ['coffee_cup'],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [
            {
              instanceId: 'hero',
              verb: 'carry_put_down',
              associatedPropId: 'coffee_cup',
              target: { kind: 'position', pos: [-55, 68, 0] },
              speedNorm: 1.0,
              intensityNorm: 0.7
            }
          ]
        }
      ],
      unfulfilledRequests: []
    };

    const putDownProd = VerbCompiler.compile(putDownContract);
    const putDownTracks = putDownProd.choreography.tracks.filter((t) => t.rigId === 'coffee_cup');
    const lastTrack = putDownTracks[putDownTracks.length - 1];
    const lastKf = lastTrack.transform.keyframes[lastTrack.transform.keyframes.length - 1];
    assert.deepEqual(lastKf.position, [-55, 68, 0]);
  });

  await t.test('Hygiene scan: Zero denylisted scenario names or absolute frame numbers in verb-engine', () => {
    const verbEngineDir = path.resolve(process.cwd(), 'src/engine/director/verb-engine');
    const files = fs.readdirSync(verbEngineDir).filter((f) => f.endsWith('.ts'));

    assert.ok(files.length > 0, 'verb-engine directory must contain typescript files');

    // Denylist: absolute frame number comments and scenario-specific object names in comments / logic
    const frameNumberCommentPattern = /\/\/.*(?:\bframe\s+\d+\b|~frame\b)/i;
    const denylistedCommentWords = [
      /\/\/.*\bdesk\b/i,
      /\/\/.*\bcup\b/i,
      /\/\/.*\bumbrella\b/i
    ];

    for (const file of files) {
      const fullPath = path.join(verbEngineDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
        const line = lines[lineNo - 1];

        // 1. Check for absolute frame numbers in comments
        assert.ok(
          !frameNumberCommentPattern.test(line),
          `Hygiene violation in ${file}:${lineNo}: absolute frame number in comment: "${line.trim()}"`
        );

        // 2. Check for denylisted scenario object names in comments
        for (const pattern of denylistedCommentWords) {
          assert.ok(
            !pattern.test(line),
            `Hygiene violation in ${file}:${lineNo}: denylisted scenario word in comment: "${line.trim()}"`
          );
        }
      }
    }
  });
});
