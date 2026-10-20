import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AudioAnalysisManifestSchema,
  type AudioAnalysisManifest,
  type BeatEvent
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
  readonly tempoBpm: number;
  readonly tempoConfidence: number;
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
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

  // Global RMS normalization
  let maxRms = 1e-6;
  for (let f = 0; f < totalFrames; f++) {
    if (rmsRaw[f] > maxRms) maxRms = rmsRaw[f];
  }
  const globalRmsMax = maxRms;
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

  // Normalize 7 frequency bands to [0, 1]
  normalizeArrayInPlace(subBass);
  normalizeArrayInPlace(bass);
  normalizeArrayInPlace(lowMid);
  normalizeArrayInPlace(mid);
  normalizeArrayInPlace(highMid);
  normalizeArrayInPlace(presence);
  normalizeArrayInPlace(brilliance);

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

  // Peak-picking for isOnset and beatEvents
  const minOnsetGap = Math.max(3, Math.round(0.12 * fps));
  const onsetThreshold = 0.22;
  let lastOnsetFrame = -minOnsetGap;
  const beatEvents: BeatEvent[] = [];

  for (let f = 0; f < totalFrames; f++) {
    const strength = onsetStrength[f];
    if (strength < onsetThreshold || f - lastOnsetFrame < minOnsetGap) {
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

  // Estimate tempo BPM from median inter-onset interval
  let tempoBpm = 120;
  let tempoConfidence = 0.85;
  if (beatEvents.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < beatEvents.length; i++) {
      const dt = (beatEvents[i].frameIndex - beatEvents[i - 1].frameIndex) / fps;
      if (dt >= 0.25 && dt <= 1.5) {
        intervals.push(dt);
      }
    }
    if (intervals.length > 0) {
      intervals.sort((a, b) => a - b);
      const medianDt = intervals[intervals.length >>> 1];
      let rawBpm = 60 / medianDt;
      while (rawBpm < 70) rawBpm *= 2;
      while (rawBpm > 180) rawBpm *= 0.5;
      tempoBpm = Number(rawBpm.toFixed(2));
    }
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
    tempoBpm,
    tempoConfidence
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
      tempoBpm: analyzed.tempoBpm,
      tempoConfidence: analyzed.tempoConfidence
    },
    normalization: {
      globalRmsMax: Number(analyzed.globalRmsMax.toFixed(6)),
      localWindowFrames: analyzed.localWindowFrames
    },
    lyrics: parsedLrc.lyrics,
    beatEvents: analyzed.beatEvents,
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
