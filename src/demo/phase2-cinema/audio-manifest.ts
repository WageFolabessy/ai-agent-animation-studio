import type { AudioAnalysisManifest, AudioFeatureReader, AudioFrameFeature } from '../../schemas/audio.contract.js';

export const DEMO_TOTAL_FRAMES = 180;
export const DEMO_FPS = 30;
export const DEMO_DURATION_SECONDS = 6.0;
export const DEMO_SAMPLE_RATE = 44100;

export const DEMO_ONSET_FRAMES: readonly number[] = [
  0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165
];

export const demoAudioManifest: AudioAnalysisManifest = {
  metadata: {
    audioFilePath: 'assets/audio/demo-synth.wav',
    sampleRate: DEMO_SAMPLE_RATE,
    durationSeconds: DEMO_DURATION_SECONDS,
    fps: DEMO_FPS,
    totalFrames: DEMO_TOTAL_FRAMES,
    tempoBpm: 120,
    tempoConfidence: 0.95
  },
  normalization: {
    globalRmsMax: 1.0,
    localWindowFrames: 30
  },
  lyrics: [
    {
      id: 'lyric-0',
      frameRange: { startFrameInclusive: 0, endFrameExclusive: 45 },
      startTimeSeconds: 0.0,
      endTimeSeconds: 1.5,
      text: 'Awakening the Iron Horizon',
      emphasis: 0.8
    },
    {
      id: 'lyric-1',
      frameRange: { startFrameInclusive: 45, endFrameExclusive: 90 },
      startTimeSeconds: 1.5,
      endTimeSeconds: 3.0,
      text: 'Signals Pulse in Motion',
      emphasis: 0.7
    },
    {
      id: 'lyric-2',
      frameRange: { startFrameInclusive: 90, endFrameExclusive: 135 },
      startTimeSeconds: 3.0,
      endTimeSeconds: 4.5,
      // Note: text contains '=' to exercise XML text escaping &#61; fix
      text: 'Velocity = Maximum Drive',
      emphasis: 0.9
    },
    {
      id: 'lyric-3',
      frameRange: { startFrameInclusive: 135, endFrameExclusive: 180 },
      startTimeSeconds: 4.5,
      endTimeSeconds: 6.0,
      text: 'Reaching Cinematic Convergence',
      emphasis: 1.0
    }
  ],
  beatEvents: DEMO_ONSET_FRAMES.map((f) => ({
    frameIndex: f,
    timestamp: f / DEMO_FPS,
    confidence: 1.0
  })),
  storageReference: {
    type: 'memory_columnar',
    columnLayoutVersion: 1
  }
};

export class DemoAudioFeatureReader implements AudioFeatureReader {
  public readonly totalFrames: number = DEMO_TOTAL_FRAMES;

  public getFrameFeature(frameIndex: number): AudioFrameFeature {
    const f = Math.max(0, Math.min(this.totalFrames - 1, frameIndex));
    const dt = f % 15;
    const isOnset = dt === 0;

    // Continuous analytical impulse decays
    const onsetStrength = Math.exp(-dt / 2.0);
    const bass = Math.min(1.0, Math.max(0.0, 0.35 + 0.55 * Math.exp(-dt / 4.0)));
    const rms = Math.min(1.0, Math.max(0.0, 0.4 + 0.3 * Math.sin(f * 0.08)));

    return {
      frameIndex: f,
      timestamp: f / DEMO_FPS,
      rms,
      rmsRelativeGlobal: rms,
      rmsRelativeLocal: rms,
      localWindowFrames: 30,
      spectralFlux: onsetStrength * 1.5,
      onsetStrength,
      isOnset,
      pitchEstimatedHz: 440,
      bands: {
        subBass: Math.min(1.0, Math.max(0.0, bass * 0.9)),
        bass,
        lowMid: Math.min(1.0, Math.max(0.0, rms * 0.8)),
        mid: Math.min(1.0, Math.max(0.0, rms * 0.7)),
        highMid: Math.min(1.0, Math.max(0.0, onsetStrength * 0.6)),
        presence: Math.min(1.0, Math.max(0.0, onsetStrength * 0.5)),
        brilliance: Math.min(1.0, Math.max(0.0, onsetStrength * 0.4))
      }
    };
  }
}
