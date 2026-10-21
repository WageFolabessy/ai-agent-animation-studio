import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AudioAnalysisManifestSchema,
  type AudioAnalysisManifest,
  type BeatEvent,
  type BeatGrid,
  type AudioSection
} from '../../schemas/audio.contract.js';
import {
  encodeColumnarAudioFeatures,
  type ColumnarAudioColumns
} from './columnar-format.js';
import { ColumnarAudioFeatureReader } from './feature-reader.js';
import { parseLrcContent, parseLrcFile, resolveCrossPlatformPath } from './lrc-parser.js';

export const FFT_SIZE = 2048;
const HALF_FFT = FFT_SIZE >>> 1;

// Precompute Hann window and bit-reversal table for 2048-point Radix-2 FFT
const HANN_WINDOW = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  HANN_WINDOW[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
}

const BIT_REVERSE_2048 = new Uint16Array(FFT_SIZE);
{
  const bits = 11; // 2^11 = 2048
  for (let i = 0; i < FFT_SIZE; i++) {
    let rev = 0;
    let val = i;
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (val & 1);
      val >>>= 1;
    }
    BIT_REVERSE_2048[i] = rev;
  }
}

/**
 * In-place 2048-point Radix-2 Cooley-Tukey FFT.
 */
export function fftRadix2_2048(real: Float32Array, imag: Float32Array): void {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = BIT_REVERSE_2048[i];
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const halfSize = size >>> 1;
    const stepAngle = (-2 * Math.PI) / size;
    const wStepR = Math.cos(stepAngle);
    const wStepI = Math.sin(stepAngle);

    for (let i = 0; i < FFT_SIZE; i += size) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfSize; k++) {
        const evenIdx = i + k;
        const oddIdx = evenIdx + halfSize;
        const oR = real[oddIdx];
        const oI = imag[oddIdx];

        const tR = wR * oR - wI * oI;
        const tI = wR * oI + wI * oR;

        real[oddIdx] = real[evenIdx] - tR;
        imag[oddIdx] = imag[evenIdx] - tI;
        real[evenIdx] += tR;
        imag[evenIdx] += tI;

        const nextWR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nextWR;
      }
    }
  }
}

export interface SynthesizeMusicalWavOptions {
  readonly durationSeconds: number;
  readonly sampleRate?: 44100 | 48000;
  readonly bpm?: number;
}

/**
 * Synthesizes a deterministic 16-bit PCM mono `.wav` buffer containing:
 * - Sub-bass + bass kick drum impulses on every beat (exciting subBass 20-60Hz and bass 60-250Hz)
 * - Snare & hi-hat transients on backbeats (exciting highMid 2-4kHz, presence 4-6kHz, brilliance 6-20kHz)
 * - 3-act harmonic synth chord progression (exciting lowMid 250-500Hz and mid 500-2000Hz)
 */
export function synthesizeMusicalWavBuffer(options: SynthesizeMusicalWavOptions): Buffer {
  const sampleRate = options.sampleRate ?? 44100;
  const durationSeconds = options.durationSeconds;
  const bpm = options.bpm ?? 120;
  const totalSamples = Math.round(durationSeconds * sampleRate);
  const beatPeriodSec = 60 / bpm;

  const dataBytes = totalSamples * 2;
  const wavBuffer = Buffer.alloc(44 + dataBytes);

  // RIFF WAVE header
  wavBuffer.write('RIFF', 0, 'ascii');
  wavBuffer.writeUInt32LE(36 + dataBytes, 4);
  wavBuffer.write('WAVE', 8, 'ascii');
  wavBuffer.write('fmt ', 12, 'ascii');
  wavBuffer.writeUInt32LE(16, 16); // PCM fmt chunk size
  wavBuffer.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  wavBuffer.writeUInt16LE(1, 22); // NumChannels = 1 (mono)
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  wavBuffer.writeUInt16LE(2, 32); // BlockAlign
  wavBuffer.writeUInt16LE(16, 34); // BitsPerSample = 16
  wavBuffer.write('data', 36, 'ascii');
  wavBuffer.writeUInt32LE(dataBytes, 40);

  let prngState = 0x13579bdf;
  const nextNoise = (): number => {
    prngState = (Math.imul(prngState, 1664525) + 1013904223) >>> 0;
    return (prngState / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const beatIndex = Math.floor(t / beatPeriodSec);
    const beatTime = t - beatIndex * beatPeriodSec;

    // 1. Kick drum on every beat: pitch sweep 115Hz -> 44Hz + sub-bass 48Hz body
    const kickEnv = Math.exp(-beatTime * 11.0);
    const kickPhase = 2 * Math.PI * (44 * beatTime + (71 / 16.0) * (1 - Math.exp(-16.0 * beatTime)));
    const kickSub = Math.sin(2 * Math.PI * 46 * t) * Math.exp(-beatTime * 8.5);
    const kickSample = 0.48 * kickEnv * Math.sin(kickPhase) + 0.25 * kickSub;

    // 2. Snare + Hi-Hat transients on odd beats (backbeat) & eighth-note hats
    const isBackbeat = beatIndex % 2 === 1;
    const snareEnv = isBackbeat ? Math.exp(-beatTime * 18.0) : 0;
    const eighthTime = t % (beatPeriodSec * 0.5);
    const hatEnv = Math.exp(-eighthTime * 38.0);
    const n = nextNoise();
    const highCarrier =
      0.4 * Math.sin(2 * Math.PI * 2800 * t) +
      0.35 * Math.sin(2 * Math.PI * 5100 * t) +
      0.25 * Math.sin(2 * Math.PI * 9200 * t);
    const transientSample = (0.28 * snareEnv + 0.12 * hatEnv) * n * highCarrier;

    // 3. Harmonic pad / lead progression across 3 acts
    const actGain = t < durationSeconds * 0.33 ? 0.22 : t < durationSeconds * 0.75 ? 0.32 : 0.42;
    const rootHz = t < durationSeconds * 0.33 ? 220 : t < durationSeconds * 0.75 ? 261.63 : 329.63;
    const padSample =
      actGain *
      (0.45 * Math.sin(2 * Math.PI * rootHz * t) +
        0.35 * Math.sin(2 * Math.PI * (rootHz * 1.5) * t) +
        0.2 * Math.sin(2 * Math.PI * (rootHz * 2.5) * t));

    const mixed = Math.max(-0.98, Math.min(0.98, kickSample + transientSample + padSample));
    const pcm16 = Math.round(mixed * 32767);
    wavBuffer.writeInt16LE(pcm16, 44 + i * 2);
  }

  return wavBuffer;
}

export interface DecodedWavPcm {
  readonly sampleRate: 44100 | 48000;
  readonly samples: Float32Array;
  readonly durationSeconds: number;
}

/**
 * Decodes an uncompressed PCM `.wav` buffer (16-bit int, 24-bit int, or 32-bit float)
 * into mono `Float32Array` samples in `[-1, 1]`.
 */
export function decodeWavBufferPcm(
  wavBytes: Uint8Array,
  sliceOptions?: { startSeconds?: number; durationSeconds?: number }
): DecodedWavPcm {
  if (wavBytes.byteLength < 44) {
    throw new Error(`Invalid WAV file: buffer too small (${wavBytes.byteLength} bytes)`);
  }

  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11)
  );
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error(`Invalid WAV header: expected RIFF/WAVE, got ${riff}/${wave}`);
  }

  let audioFormat = 0;
  let numChannels = 0;
  let sampleRateRaw = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let offset = 12;
  while (offset + 8 <= wavBytes.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16 && payloadOffset + 16 <= wavBytes.byteLength) {
      audioFormat = view.getUint16(payloadOffset, true);
      numChannels = view.getUint16(payloadOffset + 2, true);
      sampleRateRaw = view.getUint32(payloadOffset + 4, true);
      bitsPerSample = view.getUint16(payloadOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = payloadOffset;
      dataSize = Math.min(chunkSize, wavBytes.byteLength - payloadOffset);
      break;
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || numChannels < 1) {
    throw new Error('Invalid WAV file: missing fmt or data chunk');
  }
  if (sampleRateRaw !== 44100 && sampleRateRaw !== 48000) {
    throw new Error(`Unsupported WAV sampleRate ${sampleRateRaw}; expected 44100 or 48000`);
  }
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(
      `Unsupported WAV audioFormat ${audioFormat}; only PCM (1) and IEEE Float (3) are supported`
    );
  }

  const bytesPerSample = bitsPerSample >>> 3;
  const frameStride = bytesPerSample * numChannels;
  const totalSampleFrames = Math.floor(dataSize / frameStride);

  const startSample = sliceOptions?.startSeconds
    ? Math.max(0, Math.min(totalSampleFrames, Math.round(sliceOptions.startSeconds * sampleRateRaw)))
    : 0;
  const requestedCount = sliceOptions?.durationSeconds
    ? Math.round(sliceOptions.durationSeconds * sampleRateRaw)
    : totalSampleFrames - startSample;
  const sampleCount = Math.max(1, Math.min(totalSampleFrames - startSample, requestedCount));

  const mono = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const framePos = dataOffset + (startSample + i) * frameStride;
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const samplePos = framePos + ch * bytesPerSample;
      if (audioFormat === 1 && bitsPerSample === 16) {
        sum += view.getInt16(samplePos, true) / 32768;
      } else if (audioFormat === 1 && bitsPerSample === 24) {
        const b0 = view.getUint8(samplePos);
        const b1 = view.getUint8(samplePos + 1);
        const b2 = view.getInt8(samplePos + 2);
        const val = (b2 << 16) | (b1 << 8) | b0;
        sum += val / 8388608;
      } else if (audioFormat === 3 && bitsPerSample === 32) {
        sum += view.getFloat32(samplePos, true);
      } else {
        throw new Error(`Unsupported WAV bit depth: format=${audioFormat}, bits=${bitsPerSample}`);
      }
    }
    mono[i] = sum / numChannels;
  }

  return {
    sampleRate: sampleRateRaw,
    samples: mono,
    durationSeconds: sampleCount / sampleRateRaw
  };
}

/**
 * Decodes any supported audio file (`.wav`, `.flac`, `.mp3`, `.ogg`, `.m4a`) into mono
 * `Float32Array` PCM samples. Uses pure TypeScript parsing for `.wav` files and invokes
 * FFmpeg (`f32le` pipe, zero temp files, zero shell interpolation) for compressed formats
 * like `.flac` and `.mp3`.
 */
export function decodeAudioFilePcm(
  audioFilePath: string,
  options?: {
    startSeconds?: number;
    durationSeconds?: number;
    targetSampleRate?: 44100 | 48000;
  }
): DecodedWavPcm {
  const resolved = resolveCrossPlatformPath(audioFilePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Audio file does not exist or is not a regular file: "${resolved}"`);
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.wav') {
    const wavBuffer = fs.readFileSync(resolved);
    return decodeWavBufferPcm(wavBuffer, {
      startSeconds: options?.startSeconds,
      durationSeconds: options?.durationSeconds
    });
  }

  const sampleRate: 44100 | 48000 = options?.targetSampleRate ?? 44100;
  const args: string[] = ['-v', 'error'];
  if (options?.startSeconds !== undefined && options.startSeconds > 0) {
    args.push('-ss', options.startSeconds.toString());
  }
  if (options?.durationSeconds !== undefined && options.durationSeconds > 0) {
    args.push('-t', options.durationSeconds.toString());
  }
  args.push(
    '-i',
    resolved,
    '-vn',
    '-ac',
    '1',
    '-ar',
    sampleRate.toString(),
    '-f',
    'f32le',
    'pipe:1'
  );

  const rawBuf = execFileSync('ffmpeg', args, {
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const sampleCount = Math.floor(rawBuf.byteLength / 4);
  if (sampleCount <= 0) {
    throw new Error(`FFmpeg decoded 0 audio samples from "${resolved}"`);
  }

  const aligned = rawBuf.byteOffset % 4 === 0 ? rawBuf : new Uint8Array(rawBuf);
  const samples = new Float32Array(aligned.buffer, aligned.byteOffset, sampleCount);

  return {
    sampleRate,
    samples,
    durationSeconds: sampleCount / sampleRate
  };
}

export interface AnalyzePcmOptions {
  readonly samples: Float32Array;
  readonly sampleRate: 44100 | 48000;
  readonly fps: 30 | 60;
  readonly totalFrames?: number;
}

export interface AnalyzedPcmColumnsResult {
  readonly fps: 30 | 60;
  readonly sampleRate: 44100 | 48000;
  readonly totalFrames: number;
  readonly durationSeconds: number;
  readonly localWindowFrames: number;
  readonly globalRmsMax: number;
  readonly columns: ColumnarAudioColumns;
  readonly beatEvents: BeatEvent[];
  readonly tempoBpm?: number;
  readonly tempoConfidence?: number;
  readonly beatGrid?: BeatGrid;
  readonly sections?: AudioSection[];
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

export function computePercentile(arr: Float32Array, p: number): number {
  const nonZero: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > 1e-6) nonZero.push(arr[i]);
  }
  if (nonZero.length === 0) return 1.0;
  nonZero.sort((a, b) => a - b);
  const idx = Math.min(nonZero.length - 1, Math.floor((p / 100) * nonZero.length));
  return nonZero[idx] > 1e-6 ? nonZero[idx] : 1.0;
}

function normalizeArrayInPlace(arr: Float32Array): number {
  let maxVal = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > maxVal) maxVal = arr[i];
  }
  const denom = maxVal > 1e-12 ? maxVal : 1;
  for (let i = 0; i < arr.length; i++) {
    arr[i] = clamp01(arr[i] / denom);
  }
  return maxVal;
}

/**
 * Estimates musical tempo (BPM) and confidence via sub-frame lag autocorrelation
 * over a fine hop-size spectral difference envelope.
 */
export function estimateTempoFromPcm(
  samples: Float32Array,
  sampleRate: 44100 | 48000
): { tempoBpm?: number; tempoConfidence?: number } {
  const hop = 512;
  const fo = sampleRate / hop; // ~86.13 Hz at 44.1k
  const numHops = Math.floor(samples.length / hop);
  if (numHops < 30) return {};

  // Compute onset strength envelope over hops using 2-tap low/high band difference
  const envelope = new Float32Array(numHops);
  let prevLow = 0;
  let prevHigh = 0;

  for (let m = 0; m < numHops; m++) {
    const start = m * hop;
    let lowEnergy = 0;
    let highEnergy = 0;
    const end = Math.min(samples.length - 1, start + hop);
    for (let j = start; j < end; j++) {
      const s0 = samples[j];
      const s1 = samples[j + 1];
      const lowVal = s0 + s1;
      const highVal = s0 - s1;
      lowEnergy += lowVal * lowVal;
      highEnergy += highVal * highVal;
    }
    const dLow = Math.max(0, lowEnergy - prevLow);
    const dHigh = Math.max(0, highEnergy - prevHigh);
    envelope[m] = dLow + 1.5 * dHigh;
    prevLow = lowEnergy;
    prevHigh = highEnergy;
  }

  // Mean-center envelope
  let envMean = 0;
  for (let m = 0; m < numHops; m++) envMean += envelope[m];
  envMean /= numHops;
  const centered = new Float32Array(numHops);
  let envVar = 0;
  for (let m = 0; m < numHops; m++) {
    centered[m] = envelope[m] - envMean;
    envVar += centered[m] * centered[m];
  }
  if (envVar < 1e-8) return {}; // Silence or flat signal

  // Autocorrelation over 60..200 BPM lag range
  const tauMin = Math.round((60 / 200) * fo); // ~26 hops
  const tauMax = Math.round((60 / 60) * fo);  // ~86 hops
  const tau0 = (60 / 120) * fo; // ~43 hops
  const sigmaTau = 0.40;

  const lags = new Float32Array(tauMax + 3);
  const rawLags = new Float32Array(tauMax + 3);
  let peakTau = tauMin;
  let peakVal = -Infinity;

  for (let tau = tauMin - 1; tau <= tauMax + 1; tau++) {
    let sum = 0;
    let sumSq1 = 0;
    let sumSq2 = 0;
    const limit = numHops - tau;
    for (let n = 0; n < limit; n++) {
      const x1 = centered[n];
      const x2 = centered[n + tau];
      sum += x1 * x2;
      sumSq1 += x1 * x1;
      sumSq2 += x2 * x2;
    }
    const denom = Math.sqrt(sumSq1 * sumSq2);
    const normR = denom > 1e-8 ? sum / denom : 0;
    rawLags[tau] = normR;

    // Log-normal prior centered at 120 BPM
    const prior = Math.exp(-0.5 * Math.pow(Math.log(tau / tau0) / sigmaTau, 2));
    const weighted = normR * prior;
    lags[tau] = weighted;

    if (tau >= tauMin && tau <= tauMax && weighted > peakVal) {
      peakVal = weighted;
      peakTau = tau;
    }
  }

  // Check for octave halving (e.g. 174 BPM pattern with strong 2-beat kick/snare harmonic)
  const halfTau = Math.round(peakTau / 2);
  if (halfTau >= tauMin && lags[halfTau] >= 0.45 * lags[peakTau]) {
    const isLocalHalfPeak =
      lags[halfTau] >= lags[halfTau - 1] && lags[halfTau] >= lags[halfTau + 1];
    if (isLocalHalfPeak) {
      peakTau = halfTau;
    }
  }

  // Parabolic 3-point peak interpolation
  const alpha = lags[peakTau - 1];
  const beta = lags[peakTau];
  const gamma = lags[peakTau + 1];
  const denomParabola = alpha - 2 * beta + gamma;
  let delta = 0;
  if (Math.abs(denomParabola) > 1e-8) {
    delta = 0.5 * ((alpha - gamma) / denomParabola);
    delta = Math.max(-0.5, Math.min(0.5, delta));
  }
  const refinedTau = peakTau + delta;
  const bpm = (60 * fo) / refinedTau;

  // Prominence & confidence metric
  let sumR = 0;
  let countR = 0;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    sumR += lags[tau];
    countR++;
  }
  const meanR = sumR / countR;
  let varR = 0;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    const diff = lags[tau] - meanR;
    varR += diff * diff;
  }
  const stdR = Math.sqrt(varR / countR);
  const rawBeta = rawLags[peakTau];
  const prominence = (beta - meanR) / Math.max(1e-5, stdR);
  const confidence = Math.max(
    0,
    Math.min(1, (prominence / 2.5) * Math.max(0, Math.min(1, rawBeta)))
  );

  if (confidence < 0.40) {
    return {};
  }

  return {
    tempoBpm: Number(bpm.toFixed(2)),
    tempoConfidence: Number(confidence.toFixed(4))
  };
}

/**
 * Performs frame-aligned 2048-point STFT analysis on mono PCM samples and outputs
 * normalized 7-band energy, global & 3.0s rolling local RMS, half-wave rectified
 * spectral flux, onset strength, peak-picked onsets, and beat events.
 */
export function analyzePcmAudioToColumns(options: AnalyzePcmOptions): AnalyzedPcmColumnsResult {
  const { samples, sampleRate, fps } = options;
  const durationSeconds = samples.length / sampleRate;
  const totalFrames = options.totalFrames ?? Math.max(1, Math.round(durationSeconds * fps));
  const localWindowFrames = 3 * fps; // 3.0-second rolling local window

  const rmsRaw = new Float32Array(totalFrames);
  const rms = new Float32Array(totalFrames);
  const rmsRelativeGlobal = new Float32Array(totalFrames);
  const rmsRelativeLocal = new Float32Array(totalFrames);
  const spectralFlux = new Float32Array(totalFrames);
  const onsetStrength = new Float32Array(totalFrames);
  const pitchEstimatedHz = new Float32Array(totalFrames);
  const subBass = new Float32Array(totalFrames);
  const bass = new Float32Array(totalFrames);
  const lowMid = new Float32Array(totalFrames);
  const mid = new Float32Array(totalFrames);
  const highMid = new Float32Array(totalFrames);
  const presence = new Float32Array(totalFrames);
  const brilliance = new Float32Array(totalFrames);
  const isOnset = new Uint8Array(totalFrames);

  const fftReal = new Float32Array(FFT_SIZE);
  const fftImag = new Float32Array(FFT_SIZE);
  const prevLogMag = new Float32Array(HALF_FFT + 1);
  const binHz = sampleRate / FFT_SIZE;

  for (let f = 0; f < totalFrames; f++) {
    const centerSample = Math.round((f * sampleRate) / fps);
    const startSample = centerSample - HALF_FFT;

    let sumSq = 0;
    for (let k = 0; k < FFT_SIZE; k++) {
      const idx = startSample + k;
      const s = idx >= 0 && idx < samples.length ? samples[idx] : 0;
      sumSq += s * s;
      fftReal[k] = s * HANN_WINDOW[k];
      fftImag[k] = 0;
    }

    rmsRaw[f] = Math.sqrt(sumSq / FFT_SIZE);
    rms[f] = clamp01(rmsRaw[f]);

    fftRadix2_2048(fftReal, fftImag);

    let sumSubBass = 0, cntSubBass = 0;
    let sumBass = 0, cntBass = 0;
    let sumLowMid = 0, cntLowMid = 0;
    let sumMid = 0, cntMid = 0;
    let sumHighMid = 0, cntHighMid = 0;
    let sumPresence = 0, cntPresence = 0;
    let sumBrilliance = 0, cntBrilliance = 0;

    let fluxSum = 0;
    let maxVocalBinMag = 0;
    let maxVocalBinIdx = 0;

    for (let m = 1; m <= HALF_FFT; m++) {
      const re = fftReal[m];
      const im = fftImag[m];
      const magSq = re * re + im * im;
      const mag = Math.sqrt(magSq);
      const freq = m * binHz;

      const logMag = Math.log1p(10.0 * mag);
      if (f > 0) {
        const diff = logMag - prevLogMag[m];
        if (diff > 0) fluxSum += diff;
      }
      prevLogMag[m] = logMag;

      if (freq >= 20 && freq < 60) {
        sumSubBass += magSq;
        cntSubBass++;
      } else if (freq >= 60 && freq < 250) {
        sumBass += magSq;
        cntBass++;
      } else if (freq >= 250 && freq < 500) {
        sumLowMid += magSq;
        cntLowMid++;
      } else if (freq >= 500 && freq < 2000) {
        sumMid += magSq;
        cntMid++;
      } else if (freq >= 2000 && freq < 4000) {
        sumHighMid += magSq;
        cntHighMid++;
      } else if (freq >= 4000 && freq < 6000) {
        sumPresence += magSq;
        cntPresence++;
      } else if (freq >= 6000 && freq <= 20000) {
        sumBrilliance += magSq;
        cntBrilliance++;
      }

      if (freq >= 80 && freq <= 1200 && mag > maxVocalBinMag) {
        maxVocalBinMag = mag;
        maxVocalBinIdx = m;
      }
    }

    spectralFlux[f] = f === 0 ? 0 : fluxSum;
    subBass[f] = cntSubBass > 0 ? Math.sqrt(sumSubBass / cntSubBass) : 0;
    bass[f] = cntBass > 0 ? Math.sqrt(sumBass / cntBass) : 0;
    lowMid[f] = cntLowMid > 0 ? Math.sqrt(sumLowMid / cntLowMid) : 0;
    mid[f] = cntMid > 0 ? Math.sqrt(sumMid / cntMid) : 0;
    highMid[f] = cntHighMid > 0 ? Math.sqrt(sumHighMid / cntHighMid) : 0;
    presence[f] = cntPresence > 0 ? Math.sqrt(sumPresence / cntPresence) : 0;
    brilliance[f] = cntBrilliance > 0 ? Math.sqrt(sumBrilliance / cntBrilliance) : 0;

    // Voiced pitch estimate if energy is significant, else 0 (unvoiced)
    pitchEstimatedHz[f] = rmsRaw[f] > 0.03 && maxVocalBinIdx > 0 ? maxVocalBinIdx * binHz : 0;
  }

  // Global RMS normalization via robust 98th-percentile scaling
  const p98Rms = computePercentile(rmsRaw, 98);
  const globalRmsMax = p98Rms > 1e-6 ? p98Rms : 1.0;
  for (let f = 0; f < totalFrames; f++) {
    rmsRelativeGlobal[f] = clamp01(rmsRaw[f] / globalRmsMax);
  }

  // Rolling 3.0s local RMS normalization
  const halfWin = localWindowFrames >>> 1;
  for (let f = 0; f < totalFrames; f++) {
    const wStart = Math.max(0, f - halfWin);
    const wEnd = Math.min(totalFrames - 1, f + halfWin);
    let localMax = 1e-6;
    for (let k = wStart; k <= wEnd; k++) {
      if (rmsRaw[k] > localMax) localMax = rmsRaw[k];
    }
    rmsRelativeLocal[f] = clamp01(rmsRaw[f] / localMax);
  }

  // Unified cross-band spectral energy scaling preserving physical spectral balance
  const totBandEnergy = new Float32Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    totBandEnergy[f] =
      subBass[f] + bass[f] + lowMid[f] + mid[f] + highMid[f] + presence[f] + brilliance[f];
  }
  const bandScale = computePercentile(totBandEnergy, 98);
  const denomBand = bandScale > 1e-6 ? bandScale : 1.0;
  for (let f = 0; f < totalFrames; f++) {
    subBass[f] = clamp01(subBass[f] / denomBand);
    bass[f] = clamp01(bass[f] / denomBand);
    lowMid[f] = clamp01(lowMid[f] / denomBand);
    mid[f] = clamp01(mid[f] / denomBand);
    highMid[f] = clamp01(highMid[f] / denomBand);
    presence[f] = clamp01(presence[f] / denomBand);
    brilliance[f] = clamp01(brilliance[f] / denomBand);
  }

  // Novelty / onset strength (half-wave rectified spectral flux minus local moving average)
  const fluxHalfWin = Math.max(2, Math.floor(0.5 * fps));
  for (let f = 0; f < totalFrames; f++) {
    const wStart = Math.max(0, f - fluxHalfWin);
    const wEnd = Math.min(totalFrames - 1, f + fluxHalfWin);
    let meanFlux = 0;
    for (let k = wStart; k <= wEnd; k++) {
      meanFlux += spectralFlux[k];
    }
    meanFlux /= wEnd - wStart + 1;
    onsetStrength[f] = Math.max(0, spectralFlux[f] - meanFlux);
  }

  normalizeArrayInPlace(spectralFlux);
  normalizeArrayInPlace(onsetStrength);

  // Peak-picking with adaptive local threshold (mean + 1.4 * std + 0.04)
  const minOnsetGap = Math.max(3, Math.round(0.12 * fps));
  const onsetHalfWin = Math.max(2, Math.round(0.5 * fps));
  let lastOnsetFrame = -minOnsetGap;
  const beatEvents: BeatEvent[] = [];

  for (let f = 0; f < totalFrames; f++) {
    const strength = onsetStrength[f];
    const wStart = Math.max(0, f - onsetHalfWin);
    const wEnd = Math.min(totalFrames - 1, f + onsetHalfWin);
    let meanS = 0;
    for (let k = wStart; k <= wEnd; k++) meanS += onsetStrength[k];
    meanS /= wEnd - wStart + 1;

    let varS = 0;
    for (let k = wStart; k <= wEnd; k++) {
      const diff = onsetStrength[k] - meanS;
      varS += diff * diff;
    }
    const stdS = Math.sqrt(varS / (wEnd - wStart + 1));
    const adaptiveThreshold = meanS + 1.4 * stdS + 0.04;

    if (strength < adaptiveThreshold || f - lastOnsetFrame < minOnsetGap) {
      continue;
    }
    let isLocalPeak = true;
    for (let k = Math.max(0, f - 2); k <= Math.min(totalFrames - 1, f + 2); k++) {
      if (k !== f && onsetStrength[k] > strength) {
        isLocalPeak = false;
        break;
      }
    }
    if (isLocalPeak) {
      isOnset[f] = 1;
      lastOnsetFrame = f;
      beatEvents.push({
        frameIndex: f,
        timestamp: Number((f / fps).toFixed(4)),
        confidence: Number(clamp01(strength).toFixed(4))
      });
    }
  }

  // Estimate musical tempo with sub-frame lag resolution
  const tempoResult = estimateTempoFromPcm(samples, sampleRate);
  const tempoBpm = tempoResult.tempoBpm;
  const tempoConfidence = tempoResult.tempoConfidence;

  // Synthesize musical beat grid if confident tempo is detected
  let beatGrid: BeatGrid | undefined;
  if (tempoBpm !== undefined && tempoConfidence !== undefined && tempoConfidence >= 0.4) {
    const framesPerBeat = (60 / tempoBpm) * fps;
    const framesPerBar = 4 * framesPerBeat;

    // Find phase maximizing onset energy
    let bestPhase = 0;
    let bestEnergy = -1;
    const maxPhase = Math.max(1, Math.round(framesPerBeat));
    for (let phase = 0; phase < maxPhase; phase++) {
      let phaseEnergy = 0;
      for (let f = phase; f < totalFrames; f += Math.round(framesPerBeat)) {
        phaseEnergy += onsetStrength[f];
      }
      if (phaseEnergy > bestEnergy) {
        bestEnergy = phaseEnergy;
        bestPhase = phase;
      }
    }

    const beatFrameIndices: number[] = [];
    for (let f = bestPhase; f < totalFrames; f += Math.round(framesPerBeat)) {
      beatFrameIndices.push(f);
    }
    const downbeatIndices: number[] = [];
    for (let f = bestPhase; f < totalFrames; f += Math.round(framesPerBar)) {
      downbeatIndices.push(f);
    }

    beatGrid = {
      tempoBpm,
      tempoConfidence,
      framesPerBeat: Number(framesPerBeat.toFixed(4)),
      framesPerBar: Number(framesPerBar.toFixed(4)),
      beatFrameIndices,
      downbeatIndices
    };
  }

  // Decompose into macro acoustic sections
  const sectionSpanFrames = Math.max(300, Math.round(30 * fps)); // ~30.0s nominal section
  const sections: AudioSection[] = [];
  const numSections = Math.max(1, Math.ceil(totalFrames / sectionSpanFrames));
  for (let s = 0; s < numSections; s++) {
    const startFrame = s * sectionSpanFrames;
    const endFrame = Math.min(totalFrames, (s + 1) * sectionSpanFrames);
    let secRms = 0;
    let cnt = 0;
    for (let f = startFrame; f < endFrame; f++) {
      secRms += rmsRelativeGlobal[f];
      cnt++;
    }
    const relativeEnergy = cnt > 0 ? Number((secRms / cnt).toFixed(4)) : 0.5;
    sections.push({
      id: `sec-${s + 1}`,
      startFrame,
      endFrame,
      relativeEnergy,
      hasVocals: false,
      dominantBand: 'mid'
    });
  }

  return {
    fps,
    sampleRate,
    totalFrames,
    durationSeconds,
    localWindowFrames,
    globalRmsMax,
    columns: {
      rms,
      rmsRelativeGlobal,
      rmsRelativeLocal,
      spectralFlux,
      onsetStrength,
      pitchEstimatedHz,
      subBass,
      bass,
      lowMid,
      mid,
      highMid,
      presence,
      brilliance,
      isOnset
    },
    beatEvents,
    ...(tempoBpm !== undefined ? { tempoBpm } : {}),
    ...(tempoConfidence !== undefined ? { tempoConfidence } : {}),
    ...(beatGrid !== undefined ? { beatGrid } : {}),
    ...(sections !== undefined ? { sections } : {})
  };
}

export interface AnalyzeWavToArtifactsOptions {
  readonly wavFilePath: string;
  readonly outManifestPath: string;
  readonly outBinaryPath: string;
  readonly fps: 30 | 60;
  readonly lrcFilePath?: string;
  readonly rawLrcContent?: string;
  readonly startSeconds?: number;
  readonly durationSeconds?: number;
  readonly totalFrames?: number;
}

/**
 * End-to-end TypeScript WAV + LRC analyzer that writes `<name>.features.bin` and
 * `<name>.manifest.json` (`storageReference.type === 'external_binary'`) and returns
 * the validated manifest and $O(1)$ `ColumnarAudioFeatureReader`.
 */
export function analyzeWavFileToArtifacts(options: AnalyzeWavToArtifactsOptions): {
  manifest: AudioAnalysisManifest;
  reader: ColumnarAudioFeatureReader;
} {
  const resolvedWav = resolveCrossPlatformPath(options.wavFilePath);
  const resolvedManifest = path.resolve(options.outManifestPath);
  const resolvedBin = path.resolve(options.outBinaryPath);

  const decoded = decodeAudioFilePcm(resolvedWav, {
    startSeconds: options.startSeconds,
    durationSeconds: options.durationSeconds
  });

  const analyzed = analyzePcmAudioToColumns({
    samples: decoded.samples,
    sampleRate: decoded.sampleRate,
    fps: options.fps,
    totalFrames: options.totalFrames
  });

  const binaryBytes = encodeColumnarAudioFeatures(
    {
      fps: analyzed.fps,
      totalFrames: analyzed.totalFrames,
      sampleRate: analyzed.sampleRate,
      localWindowFrames: analyzed.localWindowFrames,
      globalRmsMax: analyzed.globalRmsMax
    },
    analyzed.columns
  );

  fs.mkdirSync(path.dirname(resolvedBin), { recursive: true });
  fs.mkdirSync(path.dirname(resolvedManifest), { recursive: true });
  fs.writeFileSync(resolvedBin, binaryBytes);

  const sha256 = crypto.createHash('sha256').update(binaryBytes).digest('hex');
  const reader = new ColumnarAudioFeatureReader(binaryBytes, {
    expectedTotalFrames: analyzed.totalFrames,
    expectedFps: analyzed.fps,
    expectedSampleRate: analyzed.sampleRate,
    expectedByteLength: binaryBytes.byteLength,
    expectedSha256: sha256
  });

  const lrcOptions = {
    songDurationSeconds: analyzed.durationSeconds,
    fps: analyzed.fps,
    totalFrames: analyzed.totalFrames,
    clipStartSeconds: options.startSeconds ?? 0,
    featureSource: reader
  };

  const parsedLrc = options.lrcFilePath
    ? parseLrcFile(options.lrcFilePath, lrcOptions)
    : options.rawLrcContent
      ? parseLrcContent(options.rawLrcContent, lrcOptions)
      : { lyrics: [], emptyCutoffTimestamps: [] };

  const relativeBinPath = path.relative(path.dirname(resolvedManifest), resolvedBin);

  const manifest: AudioAnalysisManifest = AudioAnalysisManifestSchema.parse({
    metadata: {
      audioFilePath: options.wavFilePath,
      sampleRate: analyzed.sampleRate,
      durationSeconds: Number(analyzed.durationSeconds.toFixed(4)),
      fps: analyzed.fps,
      totalFrames: analyzed.totalFrames,
      ...(analyzed.tempoBpm !== undefined ? { tempoBpm: analyzed.tempoBpm } : {}),
      ...(analyzed.tempoConfidence !== undefined
        ? { tempoConfidence: analyzed.tempoConfidence }
        : {})
    },
    normalization: {
      globalRmsMax: Number(analyzed.globalRmsMax.toFixed(6)),
      localWindowFrames: analyzed.localWindowFrames
    },
    lyrics: parsedLrc.lyrics,
    beatEvents: analyzed.beatEvents,
    ...(analyzed.beatGrid !== undefined ? { beatGrid: analyzed.beatGrid } : {}),
    ...(analyzed.sections !== undefined ? { sections: analyzed.sections } : {}),
    storageReference: {
      type: 'external_binary',
      columnLayoutVersion: 1,
      binaryFilePath: relativeBinPath,
      byteLength: binaryBytes.byteLength,
      sha256
    }
  });

  fs.writeFileSync(resolvedManifest, JSON.stringify(manifest, null, 2));

  return { manifest, reader };
}
