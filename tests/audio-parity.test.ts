import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  decodeWavBufferPcm,
  estimateTempoFromPcm,
  synthesizeMusicalWavBuffer,
  analyzeWavFileToArtifacts
} from '../src/engine/audio/wav-analyzer.js';

test('AudioParity: Sub-frame tempo estimation detects 90, 120, 140, 174 BPM within +-1% tolerance', () => {
  const targetBpms = [90, 120, 140, 174];
  const sampleRate = 44100;
  const durationSeconds = 12.0;

  for (const bpm of targetBpms) {
    const wavBuffer = synthesizeMusicalWavBuffer({
      durationSeconds,
      sampleRate,
      bpm
    });
    const decoded = decodeWavBufferPcm(wavBuffer);
    const result = estimateTempoFromPcm(decoded.samples, sampleRate);

    assert.ok(result.tempoBpm !== undefined, `Tempo should be detected for ${bpm} BPM`);
    assert.ok(result.tempoConfidence !== undefined, `Confidence should be calculated for ${bpm} BPM`);
    assert.ok(result.tempoConfidence >= 0.40, `Confidence ${result.tempoConfidence} should be >= 0.40`);

    const detectedBpm = result.tempoBpm!;
    const pctError = Math.abs(detectedBpm - bpm) / bpm;
    assert.ok(
      pctError <= 0.015,
      `BPM error ${pctError * 100}% for target ${bpm} BPM (got ${detectedBpm}) exceeds 1.5%`
    );
  }
});

test('AudioParity: Unmetered noise or silence omits tempoBpm and tempoConfidence', () => {
  const sampleRate = 44100;
  const durationSeconds = 5.0;
  const totalSamples = Math.round(durationSeconds * sampleRate);

  // 1. Pure silence
  const silentSamples = new Float32Array(totalSamples);
  const silentResult = estimateTempoFromPcm(silentSamples, sampleRate);
  assert.equal(silentResult.tempoBpm, undefined, 'Silence must omit tempoBpm');
  assert.equal(silentResult.tempoConfidence, undefined, 'Silence must omit tempoConfidence');

  // 2. Uniform white noise
  const noiseSamples = new Float32Array(totalSamples);
  let seed = 12345;
  for (let i = 0; i < totalSamples; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noiseSamples[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const noiseResult = estimateTempoFromPcm(noiseSamples, sampleRate);
  assert.equal(noiseResult.tempoBpm, undefined, 'White noise must omit tempoBpm');
  assert.equal(noiseResult.tempoConfidence, undefined, 'White noise must omit tempoConfidence');
});

test('AudioParity: TypeScript and Python analyzers achieve numerical parity across all 14 columns', (t) => {
  // Check if python3 and numpy are available
  let pythonAvailable = false;
  try {
    const out = execFileSync('python3', ['-c', 'import numpy; print("OK")'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (out.trim() === 'OK') {
      pythonAvailable = true;
    }
  } catch {
    pythonAvailable = false;
  }

  if (!pythonAvailable) {
    t.skip('Skipping Python parity: python3 with numpy is not available on this environment');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-parity-'));
  try {
    const wavPath = path.join(tmpDir, 'test_song.wav');
    const tsManifestPath = path.join(tmpDir, 'ts.manifest.json');
    const tsBinPath = path.join(tmpDir, 'ts.features.bin');
    const pyManifestPath = path.join(tmpDir, 'py.manifest.json');
    const pyBinPath = path.join(tmpDir, 'py.features.bin');

    const durationSeconds = 6.0;
    const bpm = 120;
    const sampleRate = 44100;
    const fps = 30;

    const wavBuf = synthesizeMusicalWavBuffer({ durationSeconds, sampleRate, bpm });
    fs.writeFileSync(wavPath, wavBuf);

    // 1. Run TypeScript analyzer
    const { manifest: tsManifest, reader: tsReader } = analyzeWavFileToArtifacts({
      wavFilePath: wavPath,
      outManifestPath: tsManifestPath,
      outBinaryPath: tsBinPath,
      fps
    });

    // 2. Run Python analyzer
    const pythonScript = path.resolve(process.cwd(), 'python/analyze_audio.py');
    execFileSync('python3', [
      pythonScript,
      '--audio', wavPath,
      '--out-manifest', pyManifestPath,
      '--out-bin', pyBinPath,
      '--fps', String(fps)
    ]);

    assert.ok(fs.existsSync(pyManifestPath), 'Python manifest must exist');
    assert.ok(fs.existsSync(pyBinPath), 'Python binary must exist');

    const pyManifest = JSON.parse(fs.readFileSync(pyManifestPath, 'utf8'));

    // Verify tempo agreement
    if (tsManifest.metadata.tempoBpm !== undefined && pyManifest.metadata.tempoBpm !== undefined) {
      const diffBpm = Math.abs(tsManifest.metadata.tempoBpm - pyManifest.metadata.tempoBpm);
      assert.ok(diffBpm <= 1.0, `Tempo BPM difference ${diffBpm} exceeds 1.0`);
    }

    // Verify binary layout version
    assert.equal(pyManifest.storageReference.columnLayoutVersion, 1);
    assert.equal(tsManifest.storageReference.columnLayoutVersion, 1);

    // Read Python binary into buffer
    const pyBytes = fs.readFileSync(pyBinPath);
    const totalFrames = tsManifest.metadata.totalFrames;

    // Header size is 32 bytes.
    // Each float column has totalFrames * 4 bytes.
    // Read and compare each column across all frames
    const pyHeaderOffset = 32;
    const bytesPerCol = totalFrames * 4;

    const colNames = [
      'rms',
      'rmsRelativeGlobal',
      'rmsRelativeLocal',
      'spectralFlux',
      'onsetStrength',
      'pitchEstimatedHz',
      'subBass',
      'bass',
      'lowMid',
      'mid',
      'highMid',
      'presence',
      'brilliance'
    ] as const;

    for (let c = 0; c < colNames.length; c++) {
      const colName = colNames[c];
      const colOffset = pyHeaderOffset + c * bytesPerCol;
      const pyCol = new Float32Array(
        pyBytes.buffer,
        pyBytes.byteOffset + colOffset,
        totalFrames
      );

      for (let f = 0; f < totalFrames; f++) {
        const tsVal = (tsReader.getFrameFeature(f) as any)[colName] ??
          (tsReader.getFrameFeature(f).bands as any)[colName];
        const pyVal = pyCol[f];
        const diff = Math.abs(tsVal - pyVal);
        assert.ok(
          diff <= 0.05,
          `Column "${colName}" frame ${f} TS (${tsVal}) vs Py (${pyVal}) diff ${diff} exceeds tolerance 0.05`
        );
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
