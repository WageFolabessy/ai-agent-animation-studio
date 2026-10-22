import type { AudioAnalysisManifest, LyricLine } from '../../src/schemas/audio.contract.js';

export interface SyntheticManifestOptions {
  audioFilePath?: string;
  totalFrames?: number;
  fps?: 30 | 60;
  sampleRate?: 44100 | 48000;
  tempoBpm?: number;
  tempoConfidence?: number;
  sections?: Array<{
    id: string;
    startFrame: number;
    endFrame: number;
    relativeEnergy: number;
    hasVocals: boolean;
    dominantBand: 'subBass' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'presence' | 'brilliance';
  }>;
  lyrics?: Array<{
    timestamp: number;
    text: string;
    durationSeconds?: number;
    emphasis?: number;
  }>;
}

/**
 * Creates a deterministic, strictly schema-valid synthetic AudioAnalysisManifest in memory.
 */
export function createSyntheticAudioManifest(options: SyntheticManifestOptions): AudioAnalysisManifest {
  const fps = options.fps ?? 30;
  const totalFrames = options.totalFrames ?? 1200;
  const durationSeconds = Number((totalFrames / fps).toFixed(3));
  const tempoBpm = options.tempoBpm ?? 120;
  const tempoConfidence = options.tempoConfidence ?? 0.95;
  const framesPerBeat = (60 / tempoBpm) * fps;
  const framesPerBar = framesPerBeat * 4;

  const beatFrameIndices: number[] = [];
  for (let f = 0; f < totalFrames; f += framesPerBeat) {
    beatFrameIndices.push(Math.round(f));
  }

  const sections = options.sections ?? [
    { id: 'sec-intro', startFrame: 0, endFrame: Math.floor(totalFrames * 0.25), relativeEnergy: 0.4, hasVocals: false, dominantBand: 'mid' as const },
    { id: 'sec-verse', startFrame: Math.floor(totalFrames * 0.25), endFrame: Math.floor(totalFrames * 0.5), relativeEnergy: 0.7, hasVocals: true, dominantBand: 'presence' as const },
    { id: 'sec-chorus', startFrame: Math.floor(totalFrames * 0.5), endFrame: Math.floor(totalFrames * 0.8), relativeEnergy: 0.95, hasVocals: true, dominantBand: 'presence' as const },
    { id: 'sec-outro', startFrame: Math.floor(totalFrames * 0.8), endFrame: totalFrames, relativeEnergy: 0.5, hasVocals: false, dominantBand: 'mid' as const }
  ];

  const rawLyrics = options.lyrics ?? [];
  const lyrics: LyricLine[] = rawLyrics.map((lyric, idx) => {
    const startTime = lyric.timestamp;
    const dur = lyric.durationSeconds ?? 2.5;
    const endTime = Number((startTime + dur).toFixed(2));
    const startFrame = Math.round(startTime * fps);
    const endFrame = Math.max(startFrame + 1, Math.round(endTime * fps));
    return {
      id: `lyric-${idx + 1}`,
      frameRange: {
        startFrameInclusive: startFrame,
        endFrameExclusive: endFrame
      },
      startTimeSeconds: startTime,
      endTimeSeconds: endTime,
      text: lyric.text,
      emphasis: lyric.emphasis ?? 0.8
    };
  });

  return {
    metadata: {
      audioFilePath: options.audioFilePath ?? 'synthetic-track.wav',
      sampleRate: options.sampleRate ?? 44100,
      durationSeconds,
      fps,
      totalFrames,
      tempoBpm,
      tempoConfidence
    },
    normalization: {
      globalRmsMax: 1.0,
      localWindowFrames: 90
    },
    storageReference: {
      type: 'external_binary',
      columnLayoutVersion: 1,
      binaryFilePath: 'synthetic-track.features.bin',
      byteLength: totalFrames * 53 + 32,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000'
    },
    beatEvents: [],
    beatGrid: {
      tempoBpm,
      tempoConfidence,
      framesPerBeat,
      framesPerBar,
      beatFrameIndices
    },
    sections,
    lyrics
  };
}

/**
 * Creates a deterministic 174 BPM 4-section high-energy rock audio manifest.
 */
export function createSyntheticRockManifest(overrides?: Partial<SyntheticManifestOptions>): AudioAnalysisManifest {
  const fps = overrides?.fps ?? 30;
  const totalFrames = overrides?.totalFrames ?? 2400; // 80 seconds at 30fps

  const f1 = Math.floor(totalFrames * 0.2);
  const f2 = Math.floor(totalFrames * 0.5);
  const f3 = Math.floor(totalFrames * 0.8);

  return createSyntheticAudioManifest({
    audioFilePath: 'synthetic-rock.wav',
    fps,
    totalFrames,
    tempoBpm: 174,
    tempoConfidence: 0.96,
    sections: [
      { id: 'sec-rock-intro', startFrame: 0, endFrame: f1, relativeEnergy: 0.5, hasVocals: false, dominantBand: 'mid' },
      { id: 'sec-rock-verse', startFrame: f1, endFrame: f2, relativeEnergy: 0.8, hasVocals: true, dominantBand: 'presence' },
      { id: 'sec-rock-chorus', startFrame: f2, endFrame: f3, relativeEnergy: 0.98, hasVocals: true, dominantBand: 'presence' },
      { id: 'sec-rock-solo', startFrame: f3, endFrame: totalFrames, relativeEnergy: 0.92, hasVocals: false, dominantBand: 'brilliance' }
    ],
    lyrics: [
      { timestamp: Number((f1 / fps + 1).toFixed(2)), text: 'Thunder in the city burning bright' },
      { timestamp: Number((f1 / fps + 4).toFixed(2)), text: 'Running through the shadows into light' },
      { timestamp: Number((f2 / fps + 1).toFixed(2)), text: 'Trashed and scattered shattered ground' },
      { timestamp: Number((f2 / fps + 5).toFixed(2)), text: 'Never look back never slow down' }
    ],
    ...overrides
  });
}

/**
 * Creates a deterministic 110 BPM 3-section mid-tempo electronic audio manifest.
 */
export function createSyntheticElectronicManifest(overrides?: Partial<SyntheticManifestOptions>): AudioAnalysisManifest {
  const fps = overrides?.fps ?? 30;
  const totalFrames = overrides?.totalFrames ?? 1800; // 60 seconds at 30fps

  const f1 = Math.floor(totalFrames * 0.33);
  const f2 = Math.floor(totalFrames * 0.7);

  return createSyntheticAudioManifest({
    audioFilePath: 'synthetic-electronic.wav',
    fps,
    totalFrames,
    tempoBpm: 110,
    tempoConfidence: 0.91,
    sections: [
      { id: 'sec-elec-build', startFrame: 0, endFrame: f1, relativeEnergy: 0.45, hasVocals: false, dominantBand: 'subBass' },
      { id: 'sec-elec-drop', startFrame: f1, endFrame: f2, relativeEnergy: 0.85, hasVocals: true, dominantBand: 'bass' },
      { id: 'sec-elec-breakdown', startFrame: f2, endFrame: totalFrames, relativeEnergy: 0.55, hasVocals: false, dominantBand: 'mid' }
    ],
    lyrics: [
      { timestamp: Number((f1 / fps + 1).toFixed(2)), text: 'Digital pulse beneath the skin' },
      { timestamp: Number((f1 / fps + 4).toFixed(2)), text: 'The synthetic neon glow within' }
    ],
    ...overrides
  });
}

/**
 * Creates a deterministic 124 BPM 3-section euphoric pop-dance audio manifest.
 */
export function createSyntheticPopDanceManifest(overrides?: Partial<SyntheticManifestOptions>): AudioAnalysisManifest {
  const fps = overrides?.fps ?? 30;
  const totalFrames = overrides?.totalFrames ?? 1800;

  const f1 = Math.floor(totalFrames * 0.3);
  const f2 = Math.floor(totalFrames * 0.75);

  return createSyntheticAudioManifest({
    audioFilePath: 'synthetic-pop.wav',
    fps,
    totalFrames,
    tempoBpm: 124,
    tempoConfidence: 0.94,
    sections: [
      { id: 'sec-pop-verse', startFrame: 0, endFrame: f1, relativeEnergy: 0.55, hasVocals: true, dominantBand: 'mid' },
      { id: 'sec-pop-chorus', startFrame: f1, endFrame: f2, relativeEnergy: 0.85, hasVocals: true, dominantBand: 'presence' },
      { id: 'sec-pop-outro', startFrame: f2, endFrame: totalFrames, relativeEnergy: 0.65, hasVocals: true, dominantBand: 'mid' }
    ],
    lyrics: [
      { timestamp: Number((1).toFixed(2)), text: 'Dance beneath the golden light' },
      { timestamp: Number((f1 / fps + 1).toFixed(2)), text: 'Electric stars shine bright tonight celebrate the joy' },
      { timestamp: Number((f2 / fps + 1).toFixed(2)), text: 'Radiant magic forever high' }
    ],
    ...overrides
  });
}

/**
 * Creates a deterministic 74 BPM 3-section melancholic acoustic ballad audio manifest.
 */
export function createSyntheticBalladManifest(overrides?: Partial<SyntheticManifestOptions>): AudioAnalysisManifest {
  const fps = overrides?.fps ?? 30;
  const totalFrames = overrides?.totalFrames ?? 1800;

  const f1 = Math.floor(totalFrames * 0.35);
  const f2 = Math.floor(totalFrames * 0.7);

  return createSyntheticAudioManifest({
    audioFilePath: 'synthetic-ballad.wav',
    fps,
    totalFrames,
    tempoBpm: 74,
    tempoConfidence: 0.90,
    sections: [
      { id: 'sec-ballad-verse', startFrame: 0, endFrame: f1, relativeEnergy: 0.25, hasVocals: true, dominantBand: 'lowMid' },
      { id: 'sec-ballad-chorus', startFrame: f1, endFrame: f2, relativeEnergy: 0.45, hasVocals: true, dominantBand: 'mid' },
      { id: 'sec-ballad-outro', startFrame: f2, endFrame: totalFrames, relativeEnergy: 0.20, hasVocals: true, dominantBand: 'lowMid' }
    ],
    lyrics: [
      { timestamp: Number((1).toFixed(2)), text: 'Shadows fade in silent memory' },
      { timestamp: Number((f1 / fps + 1).toFixed(2)), text: 'Tears of sorrow hollow pain and lost grief' },
      { timestamp: Number((f2 / fps + 1).toFixed(2)), text: 'Goodbye to the quiet road alone' }
    ],
    ...overrides
  });
}

/**
 * Creates a deterministic 130 BPM 3-section instrumental audio manifest with zero lyrics.
 */
export function createSyntheticInstrumentalManifest(overrides?: Partial<SyntheticManifestOptions>): AudioAnalysisManifest {
  const fps = overrides?.fps ?? 30;
  const totalFrames = overrides?.totalFrames ?? 1800;

  const f1 = Math.floor(totalFrames * 0.33);
  const f2 = Math.floor(totalFrames * 0.66);

  return createSyntheticAudioManifest({
    audioFilePath: 'synthetic-instrumental.wav',
    fps,
    totalFrames,
    tempoBpm: 130,
    tempoConfidence: 0.92,
    sections: [
      { id: 'sec-inst-1', startFrame: 0, endFrame: f1, relativeEnergy: 0.50, hasVocals: false, dominantBand: 'subBass' },
      { id: 'sec-inst-2', startFrame: f1, endFrame: f2, relativeEnergy: 0.80, hasVocals: false, dominantBand: 'bass' },
      { id: 'sec-inst-3', startFrame: f2, endFrame: totalFrames, relativeEnergy: 0.60, hasVocals: false, dominantBand: 'mid' }
    ],
    lyrics: [],
    ...overrides
  });
}
