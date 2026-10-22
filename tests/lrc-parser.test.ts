import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrcContent, parseLrcFile } from '../src/engine/audio/lrc-parser.js';
import { optionalAsset } from './helpers/optional-asset.js';
import { validateProjectContracts } from '../src/schemas/invariants.js';
import { createRenderConfig } from '../src/config/render-config.js';
import { demoStoryboard, demoRigsMap } from '../src/demo/phase2-cinema/index.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';

const TRASHED_AND_SCATTERED_EXCERPT_LRC = `
[ar:Avenged Sevenfold]
[ti:Trashed and Scattered]
[al:City of Evil]
[au:M. Shadows]
[length:05:53.00]
[by:Studio Sync]

[00:00.00][00:46.66][00:59.40][03:12.00]
[00:38.50]Play your game and walk away
[00:42.80]Your integrity don't mean a thing
[00:49.28][03:00.58]Trashed and scattered again
[00:54.10][03:05.40]I'm feelin' so low
[01:10.00]Solo guitar bridge incoming
`;

test('LrcParser: Filters metadata tags, expands multi-timestamp chorus lines, and truncates at empty-timestamp cutoffs', () => {
  const songDurationSeconds = 240.0; // 4 minutes
  const fps = 30;
  const totalFrames = 240 * 30;

  const result = parseLrcContent(TRASHED_AND_SCATTERED_EXCERPT_LRC, {
    songDurationSeconds,
    fps,
    totalFrames,
    maxLineDurationSeconds: 8.0
  });

  // Verify empty cutoff timestamps were recorded
  assert.deepEqual(result.emptyCutoffTimestamps, [0, 46.66, 59.4, 192]);

  // Expected chronological expansion:
  // 0: 38.50s -> "Play your game and walk away" (ends at next lyric 42.80s)
  // 1: 42.80s -> "Your integrity don't mean a thing" (truncated by empty cutoff 46.66s instead of 49.28s!)
  // 2: 49.28s -> "Trashed and scattered again" (ends at next lyric 54.10s)
  // 3: 54.10s -> "I'm feelin' so low" (truncated by empty cutoff 59.40s instead of 54.10 + 8 = 62.10s!)
  // 4: 70.00s -> "Solo guitar bridge incoming" (truncated by maxLineDuration 78.00s)
  // 5: 180.58s (03:00.58) -> "Trashed and scattered again" (ends at 185.40s)
  // 6: 185.40s (03:05.40) -> "I'm feelin' so low" (truncated by empty cutoff 192.00s (03:12.00)!)
  assert.equal(result.lyrics.length, 7);

  assert.equal(result.lyrics[0].text, 'Play your game and walk away');
  assert.equal(result.lyrics[0].startTimeSeconds, 38.5);
  assert.equal(result.lyrics[0].endTimeSeconds, 42.8);

  // Truncated at empty timestamp [00:46.66]!
  assert.equal(result.lyrics[1].text, "Your integrity don't mean a thing");
  assert.equal(result.lyrics[1].startTimeSeconds, 42.8);
  assert.equal(result.lyrics[1].endTimeSeconds, 46.66);

  // First chorus instance at [00:49.28]
  assert.equal(result.lyrics[2].text, 'Trashed and scattered again');
  assert.equal(result.lyrics[2].startTimeSeconds, 49.28);
  assert.equal(result.lyrics[2].endTimeSeconds, 54.1);

  // Truncated at empty timestamp [00:59.40]!
  assert.equal(result.lyrics[3].text, "I'm feelin' so low");
  assert.equal(result.lyrics[3].startTimeSeconds, 54.1);
  assert.equal(result.lyrics[3].endTimeSeconds, 59.4);

  // Truncated by maxLineDurationSeconds (70.0 + 8.0 = 78.0s)
  assert.equal(result.lyrics[4].text, 'Solo guitar bridge incoming');
  assert.equal(result.lyrics[4].startTimeSeconds, 70.0);
  assert.equal(result.lyrics[4].endTimeSeconds, 78.0);

  // Second expanded chorus instance at [03:00.58] = 180.58s
  assert.equal(result.lyrics[5].text, 'Trashed and scattered again');
  assert.equal(result.lyrics[5].startTimeSeconds, 180.58);
  assert.equal(result.lyrics[5].endTimeSeconds, 185.4);

  // Second expanded chorus line 2 truncated by empty cutoff [03:12.00] = 192.0s
  assert.equal(result.lyrics[6].text, "I'm feelin' so low");
  assert.equal(result.lyrics[6].startTimeSeconds, 185.4);
  assert.equal(result.lyrics[6].endTimeSeconds, 192.0);
});

test('LrcParser: Computes deterministic acoustic emphasis and passes all project contract lyric invariants', () => {
  const sampleLrc = `
[ti:Cybernetic Pulse]
[00:00.00][00:02.50]
[00:00.50][00:03.00]Systems online = ready
[00:01.50]usters engaged
[00:04.20]Final convergence
`;

  const mockFeature = (f: number): AudioFrameFeature => {
    const highEnergy = f >= 90; // Frames 90..180 have higher energy
    return {
      frameIndex: f,
      timestamp: f / 30,
      rms: highEnergy ? 0.9 : 0.3,
      rmsRelativeGlobal: highEnergy ? 0.9 : 0.3,
      rmsRelativeLocal: highEnergy ? 0.9 : 0.3,
      localWindowFrames: 90,
      spectralFlux: 0.2,
      onsetStrength: 0.2,
      isOnset: false,
      bands: {
        subBass: 0.2,
        bass: 0.3,
        lowMid: 0.4,
        mid: highEnergy ? 0.8 : 0.2,
        highMid: 0.5,
        presence: highEnergy ? 0.7 : 0.1,
        brilliance: 0.3
      }
    };
  };

  const parsed = parseLrcContent(sampleLrc, {
    songDurationSeconds: 6.0,
    fps: 30,
    totalFrames: 180,
    featureSource: mockFeature
  });

  assert.equal(parsed.lyrics.length, 4);
  // Line at 0.50s (frames 15..45) is in low-energy region; line at 3.00s (frames 90..126) is in high-energy region
  assert.ok(
    parsed.lyrics[2].emphasis > parsed.lyrics[0].emphasis,
    `Expected high-energy chorus repeat emphasis (${parsed.lyrics[2].emphasis}) > low-energy intro (${parsed.lyrics[0].emphasis})`
  );

  // Verify line 1 (starting at 1.50s) was truncated by empty cutoff at 2.50s (frame 75)
  assert.equal(parsed.lyrics[1].frameRange.startFrameInclusive, 45);
  assert.equal(parsed.lyrics[1].frameRange.endFrameExclusive, 75);

  // Validate against full validateProjectContracts invariants
  const audioManifest: AudioAnalysisManifest = {
    metadata: {
      audioFilePath: 'demo.wav',
      sampleRate: 44100,
      durationSeconds: 6.0,
      fps: 30,
      totalFrames: 180
    },
    normalization: {
      globalRmsMax: 1.0,
      localWindowFrames: 90
    },
    lyrics: parsed.lyrics,
    beatEvents: [],
    storageReference: {
      type: 'memory_columnar',
      columnLayoutVersion: 1
    }
  };

  const renderConfig = createRenderConfig({
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 180
  });

  const report = validateProjectContracts(audioManifest, demoStoryboard, renderConfig, demoRigsMap);
  const fatalOrErrors = report.errors.filter((e) => e.severity === 'fatal' || e.severity === 'error');
  assert.equal(fatalOrErrors.length, 0, `Unexpected invariant errors: ${JSON.stringify(fatalOrErrors)}`);
  assert.equal(report.isValid, true);
});

test('LrcParser: Parses real full-length sample LRC when present with zero overlap or sort errors', (t) => {
  const lrcPath = optionalAsset('trashed-and-scattered.lrc');
  if (!lrcPath) {
    t.skip('Optional real asset not found: trashed-and-scattered.lrc');
    return;
  }
  const songDurationSeconds = 353.2667;
  const fps = 30;
  const totalFrames = Math.round(songDurationSeconds * fps); // 10,598 frames

  const parsed = parseLrcFile(lrcPath, {
    songDurationSeconds,
    fps,
    totalFrames
  });

  // Line 5 of 5 Trashed And Scattered.lrc has 12 empty-timestamp instrumental cutoffs
  assert.equal(parsed.emptyCutoffTimestamps.length, 12);
  assert.ok(parsed.lyrics.length > 60, `Expected > 60 expanded lyric lines, got ${parsed.lyrics.length}`);

  // Verify chorus "Trashed and scattered again, I'm feelin' so low" appears twice ([00:49.28] and [03:00.58])
  const chorusMatches = parsed.lyrics.filter((l) =>
    l.text.startsWith("Trashed and scattered again, I'm feelin' so low")
  );
  assert.equal(chorusMatches.length, 2);
  assert.equal(chorusMatches[0].startTimeSeconds, 49.28);
  assert.equal(chorusMatches[1].startTimeSeconds, 180.58);

  // Verify guitar solo cutoff at [03:55.52] (235.52s) truncates [03:52.01] "I'll never let you seize control"
  const preSoloLine = parsed.lyrics.find(
    (l) => Math.abs(l.startTimeSeconds - 232.01) < 0.05 && l.text.includes('seize control')
  );
  assert.ok(preSoloLine, 'Expected pre-solo line at 03:52.01 (232.01s)');
  assert.equal(preSoloLine.endTimeSeconds, 235.52);

  // Verify strict ascending non-overlapping frameRange across all expanded lines
  for (let i = 1; i < parsed.lyrics.length; i++) {
    const prev = parsed.lyrics[i - 1];
    const curr = parsed.lyrics[i];
    assert.ok(
      curr.frameRange.startFrameInclusive > prev.frameRange.startFrameInclusive,
      `Unsorted lyric at index ${i}`
    );
    assert.ok(
      curr.frameRange.startFrameInclusive >= prev.frameRange.endFrameExclusive,
      `Overlapping lyric at index ${i}: ${prev.id} ends at ${prev.frameRange.endFrameExclusive} > ${curr.id} starts at ${curr.frameRange.startFrameInclusive}`
    );
  }
});

test('LrcParser: Applies [offset: +/- ms] header tag to shift lyric timestamps', () => {
  const lrc = `
[offset:+500]
[00:10.00]Positive offset line
[00:15.00]Next line
`;
  const result = parseLrcContent(lrc, {
    songDurationSeconds: 30.0,
    fps: 30,
    totalFrames: 900
  });

  assert.equal(result.lyrics.length, 2);
  // 10.00s + 0.50s = 10.50s
  assert.equal(result.lyrics[0].startTimeSeconds, 10.5);
  // 15.00s + 0.50s = 15.50s
  assert.equal(result.lyrics[0].endTimeSeconds, 15.5);
  assert.equal(result.lyrics[1].startTimeSeconds, 15.5);
});

test('LrcParser: Preserves lyric that started before clipStartSeconds but is still active at clip start', () => {
  const lrc = `
[00:08.00]Line starting before slice
[00:14.00]Line after slice
`;
  // Slice starts at 10.0s, duration 10.0s (covers 10.0s to 20.0s)
  const result = parseLrcContent(lrc, {
    songDurationSeconds: 10.0,
    fps: 30,
    totalFrames: 300,
    clipStartSeconds: 10.0
  });

  assert.equal(result.lyrics.length, 2);
  // The first line started at 8.0s, ends at 14.0s.
  // In the slice [10.0, 20.0], it starts at frame 0 (relSeconds 0.0) and ends at 4.0s (14 - 10)
  assert.equal(result.lyrics[0].startTimeSeconds, 0);
  assert.equal(result.lyrics[0].frameRange.startFrameInclusive, 0);
  assert.equal(result.lyrics[0].endTimeSeconds, 4.0);
  assert.equal(result.lyrics[0].frameRange.endFrameExclusive, 120);
  assert.equal(result.lyrics[0].text, 'Line starting before slice');

  // The second line starts at relSeconds 4.0 (14 - 10)
  assert.equal(result.lyrics[1].startTimeSeconds, 4.0);
  assert.equal(result.lyrics[1].frameRange.startFrameInclusive, 120);
});

