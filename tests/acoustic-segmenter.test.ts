import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AcousticTimelineSegmenter,
  THEMATIC_PALETTES
} from '../src/engine/director/acoustic-segmenter.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../src/schemas/audio.contract.js';

function createMockManifest(
  totalFrames: number,
  fps: 30 | 60 = 30,
  bpm = 120
): AudioAnalysisManifest {
  const durationSeconds = totalFrames / fps;
  const framesPerBeat = Math.round((60 / bpm) * fps);

  const beatEvents = [];
  for (let f = 0; f < totalFrames; f += framesPerBeat) {
    beatEvents.push({
      frameIndex: f,
      timestamp: Number((f / fps).toFixed(3)),
      confidence: 0.95
    });
  }

  return {
    metadata: {
      audioFilePath: 'synthetic_song.wav',
      durationSeconds,
      sampleRate: 44100,
      fps,
      totalFrames,
      tempoBpm: bpm
    },
    normalization: {
      globalRmsMax: 1.0,
      localWindowFrames: 30
    },
    storageReference: {
      type: 'external_binary',
      columnLayoutVersion: 1,
      binaryFilePath: 'synthetic_song.features.bin',
      byteLength: totalFrames * 53 + 32,
      sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    },
    beatEvents,
    lyrics: [
      {
        id: 'verse-1',
        startTimeSeconds: 2.0,
        endTimeSeconds: 10.0,
        frameRange: { startFrameInclusive: 60, endFrameExclusive: 300 },
        text: 'Silent shadows across the city neon grid',
        emphasis: 0.5
      },
      {
        id: 'chorus-1',
        startTimeSeconds: 16.0,
        endTimeSeconds: 28.0,
        frameRange: { startFrameInclusive: 480, endFrameExclusive: 840 },
        text: 'Ignition velocity breaking through the dark',
        emphasis: 0.95
      }
    ]
  };
}

test('AcousticSegmenter: Detects drop dynamics and snaps boundaries to musical measures (EDM Track)', () => {
  const fps = 30;
  const totalFrames = 3000; // 100.0s
  const bpm = 120; // 60/120 * 30 = 15 frames/beat, 60 frames/bar (2.0s per bar)
  const manifest = createMockManifest(totalFrames, fps, bpm);

  // Synthesize EDM feature profile:
  // 0..600 (0-20s): Quiet buildup (RMS ~0.25, low bass)
  // 600..1800 (20-60s): Explosive Drop / Chorus (RMS ~0.85, high bass 0.8)
  // 1800..2400 (60-80s): Solo / Melody (RMS ~0.65, high presence 0.7)
  // 2400..3000 (80-100s): Outro decay (RMS ~0.3)
  const getFeature = (f: number): AudioFrameFeature => {
    let rms = 0.25;
    let subBass = 0.2;
    let bass = 0.2;
    let presence = 0.2;
    let brilliance = 0.2;

    if (f >= 600 && f < 1800) {
      rms = 0.88;
      subBass = 0.85;
      bass = 0.9;
      presence = 0.6;
    } else if (f >= 1800 && f < 2400) {
      rms = 0.65;
      subBass = 0.4;
      bass = 0.4;
      presence = 0.75;
      brilliance = 0.7;
    } else if (f >= 2400) {
      rms = 0.35;
      subBass = 0.25;
      bass = 0.25;
    }

    return {
      frameIndex: f,
      timestamp: f / fps,
      rms,
      rmsRelativeGlobal: rms,
      rmsRelativeLocal: rms,
      localWindowFrames: 30,
      spectralFlux: rms * 0.4,
      onsetStrength: rms * 0.6,
      isOnset: f % 15 === 0,
      bands: {
        subBass,
        bass,
        lowMid: 0.3,
        mid: 0.4,
        highMid: 0.3,
        presence,
        brilliance
      }
    };
  };

  const segmenter = new AcousticTimelineSegmenter(manifest, {
    getAudioFeatureAtFrame: getFeature,
    minSectionSeconds: 6.0
  });

  const sections = segmenter.segment();
  assert.ok(sections.length >= 3, `Expected at least 3 sections, got ${sections.length}`);

  // 1. Verify strict boundary continuity [0, totalFrames)
  assert.equal(sections[0].startFrame, 0);
  for (let i = 1; i < sections.length; i++) {
    assert.equal(sections[i].startFrame, sections[i - 1].endFrame);
  }
  assert.equal(sections[sections.length - 1].endFrame, totalFrames);

  // 2. Verify musical bar snapping (all internal boundaries divisible by framesPerBar=60)
  for (let i = 1; i < sections.length; i++) {
    const boundary = sections[i].startFrame;
    assert.equal(
      boundary % 60,
      0,
      `Section boundary ${boundary} must snap to 60-frame musical bar`
    );
  }

  // 3. Verify acoustic classification
  const buildup = sections[0];
  assert.equal(buildup.acousticPersonality, 'BUILDUP');
  assert.equal(buildup.zoneType, 'ROOFTOP');
  assert.deepEqual(buildup.palette, THEMATIC_PALETTES.CYBERPUNK_CYAN);

  // The drop section around f=600..1800 should be classified as CLIMAX_BREAKDOWN or DRIVING_RHYTHM
  const dropSection = sections.find((s) => s.startFrame >= 600 && s.endFrame <= 1800);
  assert.ok(dropSection, 'Expected drop section in range [600, 1800]');
  assert.equal(dropSection?.zoneType, 'REACTOR');
  assert.equal(dropSection?.acousticPersonality, 'CLIMAX_BREAKDOWN');
  assert.equal(dropSection?.hasPursuitDrone, true);

  // 4. Verify 3-Act partitioning
  const acts = new Set(sections.map((s) => s.actNumber));
  assert.ok(acts.has(1) && acts.has(2) && acts.has(3), 'Must cover Acts 1, 2, and 3');
});

test('AcousticSegmenter: Virtuosic melodic solo section dispatches BRIDGE biome and SUNSET_GOLD palette', () => {
  const fps = 30;
  const totalFrames = 4000;
  const manifest = createMockManifest(totalFrames, fps, 140);

  const getFeature = (f: number): AudioFrameFeature => {
    const isSolo = f >= 1800 && f < 2700;
    return {
      frameIndex: f,
      timestamp: f / fps,
      rms: isSolo ? 0.62 : 0.45,
      rmsRelativeGlobal: 0.6,
      rmsRelativeLocal: 0.6,
      localWindowFrames: 30,
      spectralFlux: 0.3,
      onsetStrength: 0.5,
      isOnset: false,
      bands: {
        subBass: 0.3,
        bass: 0.35,
        lowMid: 0.3,
        mid: 0.4,
        highMid: isSolo ? 0.6 : 0.3,
        presence: isSolo ? 0.7 : 0.25,
        brilliance: isSolo ? 0.65 : 0.2
      }
    };
  };

  const segmenter = new AcousticTimelineSegmenter(manifest, {
    getAudioFeatureAtFrame: getFeature
  });

  const sections = segmenter.segment();
  const virtuosicSection = sections.find((s) => s.acousticPersonality === 'VIRTUOSIC_MELODY');

  assert.ok(virtuosicSection, 'Expected a section classified as VIRTUOSIC_MELODY');
  assert.equal(virtuosicSection?.zoneType, 'BRIDGE');
  assert.deepEqual(virtuosicSection?.palette, THEMATIC_PALETTES.SUNSET_GOLD);
  assert.equal(virtuosicSection?.hasPursuitDrone, true);
});

test('AcousticSegmenter: Full song acoustic segmentation partitions contiguous timeline into 3 continuous Acts', () => {
  const fps = 30;
  const totalFrames = 3600; // 2 minutes
  const manifest = createMockManifest(totalFrames, fps, 130);

  const getFeature = (f: number): AudioFrameFeature => ({
    frameIndex: f,
    timestamp: f / fps,
    rms: 0.5 + 0.3 * Math.sin(f / 300),
    rmsRelativeGlobal: 0.6,
    rmsRelativeLocal: 0.6,
    localWindowFrames: 30,
    spectralFlux: 0.2,
    onsetStrength: 0.4,
    isOnset: f % 20 === 0,
    bands: {
      subBass: 0.4,
      bass: 0.5,
      lowMid: 0.3,
      mid: 0.35,
      highMid: 0.3,
      presence: 0.35,
      brilliance: 0.25
    }
  });

  const segmenter = new AcousticTimelineSegmenter(manifest, {
    getAudioFeatureAtFrame: getFeature
  });

  const sections = segmenter.segment();
  assert.ok(sections.length >= 3);
  assert.equal(sections[0].startFrame, 0);
  assert.equal(sections[sections.length - 1].endFrame, totalFrames);

  for (let i = 1; i < sections.length; i++) {
    assert.equal(
      sections[i].startFrame,
      sections[i - 1].endFrame,
      `Section ${i} must start where section ${i - 1} ends`
    );
  }

  const actsFound = new Set(sections.map((s) => s.actNumber));
  assert.ok(actsFound.has(1), 'Must contain Act 1');
  assert.ok(actsFound.has(2), 'Must contain Act 2');
  assert.ok(actsFound.has(3), 'Must contain Act 3');
});
