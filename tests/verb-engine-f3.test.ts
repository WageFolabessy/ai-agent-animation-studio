import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { FrameStateBuilder } from '../src/engine/director/frame-state-builder.js';
import type { StoryBeatContract, ActionVerbType } from '../src/schemas/story-beat.contract.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';

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

  await t.test('Hygiene scan: TypeScript-AST enforcement of allowlisted numeric literals, ratios, and comments in verb-engine', () => {
    const verbEngineDir = path.resolve(process.cwd(), 'src/engine/director/verb-engine');
    const files = fs.readdirSync(verbEngineDir).filter((f) => f.endsWith('.ts'));

    assert.ok(files.length > 0, 'verb-engine directory must contain typescript files');

    const ALLOWED_NUMBERS = new Set([0, 1, 2, -1]);
    const frameNumberCommentPattern = /\/\/.*(?:\bframe\s+\d+\b|~frame\b)/i;
    const denylistedCommentWords = [
      /\/\/.*\bdesk\b/i,
      /\/\/.*\bcup\b/i,
      /\/\/.*\bchair\b/i,
      /\/\/.*\bumbrella\b/i
    ];

    function isInsideNamedTolerance(node: ts.Node): boolean {
      let cur: ts.Node | undefined = node;
      while (cur) {
        if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) {
          const n = cur.name.text.toUpperCase();
          if (n.includes('TOLERANCE') || n.includes('EPSILON') || n.includes('THRESHOLD') || n === 'HALF') {
            return true;
          }
        }
        cur = cur.parent;
      }
      return false;
    }

    function isInsideExportedConstantsBlock(node: ts.Node): boolean {
      let cur: ts.Node | undefined = node;
      while (cur) {
        if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name) && cur.name.text === 'VERB_CONSTANTS') {
          return true;
        }
        cur = cur.parent;
      }
      return false;
    }

    function isNum(n: ts.Node): boolean {
      return (
        ts.isNumericLiteral(n) ||
        (ts.isPrefixUnaryExpression(n) &&
          n.operator === ts.SyntaxKind.MinusToken &&
          ts.isNumericLiteral(n.operand))
      );
    }

    for (const file of files) {
      const fullPath = path.join(verbEngineDir, file);
      const sourceText = fs.readFileSync(fullPath, 'utf8');
      const sourceFile = ts.createSourceFile(fullPath, sourceText, ts.ScriptTarget.Latest, true);

      // 1. AST walk for literal ratios and non-allowlisted numeric literals
      function walkAst(node: ts.Node) {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.SlashToken) {
          if (isNum(node.left) && isNum(node.right)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            assert.fail(
              `Hygiene AST violation in ${file}:${line + 1}: forbidden literal ratio "a / b": "${node.getText(sourceFile)}"`
            );
          }
        }

        if (ts.isNumericLiteral(node)) {
          const val = Number(node.text);
          if (!ALLOWED_NUMBERS.has(val)) {
            if (isInsideExportedConstantsBlock(node)) {
              // Allowed inside exported VERB_CONSTANTS block
            } else if (isInsideNamedTolerance(node)) {
              // Allowed inside named tolerance / epsilon / threshold / HALF
            } else {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              assert.fail(
                `Hygiene AST violation in ${file}:${line + 1}: non-allowlisted numeric literal "${node.text}". Must be in [0, 1, 2, -1], named 0.5, declared named tolerance, or inside VERB_CONSTANTS.`
              );
            }
          }
        }

        ts.forEachChild(node, walkAst);
      }

      walkAst(sourceFile);

      // 2. Comments check for absolute frame numbers and denylisted scenario names
      const lines = sourceText.split('\n');
      for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
        const line = lines[lineNo - 1];
        assert.ok(
          !frameNumberCommentPattern.test(line),
          `Hygiene violation in ${file}:${lineNo}: absolute frame number in comment: "${line.trim()}"`
        );

        for (const pattern of denylistedCommentWords) {
          assert.ok(
            !pattern.test(line),
            `Hygiene violation in ${file}:${lineNo}: denylisted scenario word in comment: "${line.trim()}"`
          );
        }
      }
    }
  });

  await t.test('F3 Transition Model: hard cuts have full opacity, act boundaries dip to black, frame pure and chunk independent', () => {
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

    // 6-beat contract across 3 acts (total 600 frames, 100 frames per beat)
    // Acts partitioned: shotRanges [0..2] -> Act 1 (b1, b2), Act 2 (b3, b4), Act 3 (b5, b6)
    const testContract: StoryBeatContract = {
      projectId: 'transition_test',
      songDurationSec: 600 / 30,
      fps: 30,
      sliceFrameRange: { startFrame: 0, endFrame: 600 },
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
          endFrame: 100,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'act 1 start',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: [],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'look_at', speedNorm: 1.0, intensityNorm: 0.7 }]
        },
        {
          beatId: 'b2',
          startFrame: 100,
          endFrame: 200,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'act 1 interior cut',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: [],
            atmosphericDensity: 0.5
          },
          // Identical camera to test invisible cut detection
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'look_at', speedNorm: 1.0, intensityNorm: 0.7 }]
        },
        {
          beatId: 'b3',
          startFrame: 200,
          endFrame: 300,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'act 2 boundary',
          presentCharacters: ['hero'],
          set: {
            kitId: 'EXTERIOR_URBAN_VISTA',
            variantId: 'moody_night',
            landmarkProps: [],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'CLOSE_UP', movement: 'DOLLY', focalCharacterId: 'hero', lookRoom: 'right', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'look_at', speedNorm: 1.0, intensityNorm: 0.7 }]
        },
        {
          beatId: 'b4',
          startFrame: 300,
          endFrame: 400,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'act 2 interior cut',
          presentCharacters: ['hero'],
          set: {
            kitId: 'EXTERIOR_URBAN_VISTA',
            variantId: 'moody_night',
            landmarkProps: [],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'MEDIUM', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'look_at', speedNorm: 1.0, intensityNorm: 0.7 }]
        },
        {
          beatId: 'b5',
          startFrame: 400,
          endFrame: 500,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'act 3 boundary',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: [],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'WIDE', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'look_at', speedNorm: 1.0, intensityNorm: 0.7 }]
        },
        {
          beatId: 'b6',
          startFrame: 500,
          endFrame: 600,
          lyricSnippet: '',
          emotionalTone: 'reflective',
          narrativeSubtext: 'act 3 interior cut',
          presentCharacters: ['hero'],
          set: {
            kitId: 'ARCHITECTURAL_INTERIOR',
            variantId: 'moody_night',
            landmarkProps: [],
            atmosphericDensity: 0.5
          },
          camera: { framing: 'MEDIUM', movement: 'STATIC', focalCharacterId: 'hero', lookRoom: 'center', dutchAngleDeg: 0 },
          actions: [{ instanceId: 'hero', verb: 'look_at', speedNorm: 1.0, intensityNorm: 0.7 }]
        }
      ],
      unfulfilledRequests: []
    };

    const manifest = createSyntheticManifest(600);
    const prod = VerbCompiler.compile(testContract, manifest);
    const shots = prod.storyboard.shots;

    // 1. Slice start (shot 0): dip_to_black 10 frames
    assert.equal(shots[0].transitionIn?.type, 'dip_to_black');
    assert.equal(shots[0].transitionIn?.durationFrames, 10);

    // 2. Ordinary boundary (shot 1, intra-act within Act 1): cut with duration 0
    assert.equal(shots[1].transitionIn?.type, 'cut');
    assert.equal(shots[1].transitionIn?.durationFrames, 0);

    // 3. Act boundary (shot 2, Act 1 -> Act 2): dip_to_black 10 frames
    assert.equal(shots[2].transitionIn?.type, 'dip_to_black');
    assert.equal(shots[2].transitionIn?.durationFrames, 10);

    // 4. Ordinary boundary (shot 3, intra-act within Act 2): cut with duration 0
    assert.equal(shots[3].transitionIn?.type, 'cut');
    assert.equal(shots[3].transitionIn?.durationFrames, 0);

    // 5. Act boundary (shot 4, Act 2 -> Act 3): dip_to_black 10 frames
    assert.equal(shots[4].transitionIn?.type, 'dip_to_black');
    assert.equal(shots[4].transitionIn?.durationFrames, 10);

    // 6. Ordinary boundary (shot 5, intra-act within Act 3): cut with duration 0
    assert.equal(shots[5].transitionIn?.type, 'cut');
    assert.equal(shots[5].transitionIn?.durationFrames, 0);

    // 7. Slice end (shot 5 transitionOut): dip_to_black 10 frames
    assert.equal(shots[5].transitionOut?.type, 'dip_to_black');
    assert.equal(shots[5].transitionOut?.durationFrames, 10);

    // 8. Invisible cuts detection: shot 0 to shot 1 had identical camera
    assert.ok(prod.compileReport.invisibleCuts && prod.compileReport.invisibleCuts.length >= 1, 'Expected invisible cuts reported');
    const cut01 = prod.compileReport.invisibleCuts.find((ic) => ic.boundaryFrame === 100);
    assert.ok(cut01, 'Expected invisible cut at frame 100');
    assert.equal(cut01?.fromShotId, shots[0].id);
    assert.equal(cut01?.toShotId, shots[1].id);

    // 9. Opacity values through FrameStateBuilder
    const builder = new FrameStateBuilder({
      storyboard: prod.storyboard,
      choreography: prod.choreography,
      rigs: prod.rigs,
      audioManifest: manifest,
      getAudioFeatureAtFrame: dummyAudio
    });

    // Hard cut at frame 100: frame 99 (end of shot 0) and frame 100 (start of shot 1) must be full opacity
    const frame99 = builder.buildFrameState(99);
    const frame100 = builder.buildFrameState(100);
    assert.equal(frame99.transitionOverlayOpacity, undefined, 'Frame 99 must have full opacity');
    assert.equal(frame100.transitionOverlayOpacity, undefined, 'Frame 100 must have full opacity (cut)');

    // Act boundary at frame 200 (shot 2): dip_to_black progression
    const frame200 = builder.buildFrameState(200);
    assert.equal(frame200.transitionOverlayOpacity, 1.0, 'Frame 200 must be full black');
    const frame205 = builder.buildFrameState(205);
    assert.equal(frame205.transitionOverlayOpacity, 0.5, 'Frame 205 must be half black (u=0.5)');
    const frame210 = builder.buildFrameState(210);
    assert.equal(frame210.transitionOverlayOpacity, undefined, 'Frame 210 must be full scene opacity');

    // Slice end at frame 599 (shot 5): dip_to_black progression
    const frame590 = builder.buildFrameState(590);
    assert.equal(frame590.transitionOverlayOpacity, 0.1, 'Frame 590 must start dipping to black');
    const frame599 = builder.buildFrameState(599);
    assert.equal(frame599.transitionOverlayOpacity, 1.0, 'Frame 599 (last frame) must be full black');

    // 10. Frame purity: evaluating frame in random vs sequential order yields identical output
    const stateA = builder.buildFrameState(205);
    const stateB = builder.buildFrameState(205);
    assert.deepEqual(stateA, stateB, 'Frame evaluation must be pure function of frameIndex');

    // 11. Chunk independence: separate builders yield identical output
    const builder2 = new FrameStateBuilder({
      storyboard: prod.storyboard,
      choreography: prod.choreography,
      rigs: prod.rigs,
      audioManifest: manifest,
      getAudioFeatureAtFrame: dummyAudio
    });
    const stateChunk1 = builder.buildFrameState(203);
    const stateChunk2 = builder2.buildFrameState(203);
    assert.deepEqual(stateChunk1, stateChunk2, 'Different instances must yield identical frame state');
  });
});
