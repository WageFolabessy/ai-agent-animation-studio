import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEmotionalTone,
  analyzeSectionLyrics,
  extractLyricKeywords,
  detectLyricLanguage
} from '../src/engine/audio/lyric-profile.js';
import {
  buildDeterministicStorySpec,
  buildTheatricalStorySpec
} from '../src/agents/story-spec-agent.js';
import { createSyntheticAudioManifest } from './helpers/manifest-factory.js';

test('F5 Emotional Tone Classification & Language Handling', async (t) => {
  await t.test('Language detection accurately distinguishes English vs non-English lyrics', () => {
    const englishText = 'I am walking through the dark and waiting for the morning light';
    const detectionEn = detectLyricLanguage(englishText);
    assert.equal(detectionEn.isEnglish, true);
    assert.equal(detectionEn.language, 'en');
    assert.ok(detectionEn.stopwordRatio > 0.2);

    const indonesianText = 'di sini kita berdiri bersama menatap langit malam yang kelabu dan penuh harapan';
    const detectionId = detectLyricLanguage(indonesianText);
    assert.equal(detectionId.isEnglish, false);
    assert.equal(detectionId.language, 'unknown/non-english');
    assert.ok(detectionId.stopwordRatio < 0.12);
  });

  await t.test('Negated positive words do not decide tone (inverts to melancholic)', () => {
    // If negation were ignored, "love", "joy", "warm", "safe" would produce tender/euphoric.
    // Under negation handling, negators ("no", "never", "not") invert these to melancholic.
    const negatedPositiveLyrics = 'There is no love here, no joy remains, never warm and not safe';
    const tone = classifyEmotionalTone(negatedPositiveLyrics);
    assert.notEqual(tone, 'tender', 'Negated tender words must not trigger tender tone');
    assert.notEqual(tone, 'euphoric', 'Negated euphoric words must not trigger euphoric tone');
    assert.equal(tone, 'melancholic', 'Negated positive words must resolve to melancholic');
  });

  await t.test('Negated negative words invert to defiant tone', () => {
    const negatedNegativeLyrics = 'We have no fear, we will never weep, without despair we stand';
    const tone = classifyEmotionalTone(negatedNegativeLyrics);
    assert.equal(tone, 'defiant');
  });

  await t.test('Aggressive vs gentle synthetic lines produce distinctly different tones', () => {
    const aggressiveLyrics = 'We fight the storm and strike the enemy with fierce rage, rising unbroken to battle and conquer';
    const gentleLyrics = 'Hold me close with soft whispers, gentle touch and tender love in peaceful quiet';

    const aggressiveTone = classifyEmotionalTone(aggressiveLyrics);
    const gentleTone = classifyEmotionalTone(gentleLyrics);

    assert.notEqual(aggressiveTone, gentleTone, 'Aggressive and gentle lyrics must produce different tones');
    assert.ok(aggressiveTone === 'defiant' || aggressiveTone === 'chaotic', `Expected defiant/chaotic, got ${aggressiveTone}`);
    assert.equal(gentleTone, 'tender');
  });

  await t.test('Indonesian synthetic lines produce no stopword motifs and an audio-derived tone without crashing', () => {
    const indonesianLyrics = 'langit malam yang kelabu melangkah pelan tanpa suara di ujung jalan yang sunyi';

    // 1. Keyword extraction must be empty (no English stopword garbage)
    const keywords = extractLyricKeywords(indonesianLyrics, 5);
    assert.deepEqual(keywords, [], 'Non-English lyrics must yield no stopword motifs');

    // 2. High-energy, heavy-bass audio context derives chaotic/defiant
    const heavyAudioCtx = { energy: 0.85, dominantBand: 'subBass', tempoBpm: 150 };
    const heavyAnalysis = analyzeSectionLyrics(indonesianLyrics, undefined, heavyAudioCtx);
    assert.equal(heavyAnalysis.isEnglish, false);
    assert.equal(heavyAnalysis.detectedLanguage, 'unknown/non-english');
    assert.deepEqual(heavyAnalysis.lyricMotifs, []);
    assert.equal(heavyAnalysis.emotionalTone, 'chaotic');

    // 3. Low-energy, slow audio context derives melancholic/tender
    const softAudioCtx = { energy: 0.20, dominantBand: 'subBass', tempoBpm: 75 };
    const softAnalysis = analyzeSectionLyrics(indonesianLyrics, undefined, softAudioCtx);
    assert.equal(softAnalysis.emotionalTone, 'melancholic');
    assert.deepEqual(softAnalysis.lyricMotifs, []);
  });

  await t.test('Audio feature fallback works when lyrics give no clear signal or are empty', () => {
    const neutralLyrics = 'xyz abc 123';
    const audioCtx = { energy: 0.70, dominantBand: 'presence', tempoBpm: 130 };
    const analysis = analyzeSectionLyrics(neutralLyrics, undefined, audioCtx);
    assert.equal(analysis.emotionalTone, 'euphoric');
  });

  await t.test('Full StorySpec synthesis with Indonesian lyrics produces valid spec with audio-derived tones and no crash', () => {
    const syntheticManifest = createSyntheticAudioManifest({
      totalFrames: 450,
      tempoBpm: 140,
      lyrics: [
        {
          timestamp: 0,
          durationSeconds: 5,
          text: 'di sini kita berdiri bersama menatap langit malam yang kelabu'
        },
        {
          timestamp: 5,
          durationSeconds: 5,
          text: 'melangkah pelan dalam keheningan tanpa ragu dan tanpa henti'
        },
        {
          timestamp: 10,
          durationSeconds: 5,
          text: 'suara langkah terdengar sayup di kejauhan malam'
        }
      ]
    });

    const theatricalSpec = buildTheatricalStorySpec(syntheticManifest, 'synthetic-id-id');
    assert.equal(theatricalSpec.detectedLanguage, 'unknown/non-english');
    for (const sec of theatricalSpec.sections) {
      assert.deepEqual(sec.lyricMotifs, [], 'Sections must have no stopword motifs');
      assert.ok(['defiant', 'melancholic', 'tender', 'euphoric', 'menacing', 'reflective', 'chaotic'].includes(sec.emotionalTone));
    }

    const runnerSpec = buildDeterministicStorySpec(syntheticManifest, 'synthetic-id-runner');
    assert.equal(runnerSpec.detectedLanguage, 'unknown/non-english');
    for (const sec of runnerSpec.sections) {
      assert.deepEqual(sec.lyricMotifs, [], 'Sections must have no stopword motifs');
    }
  });
});
