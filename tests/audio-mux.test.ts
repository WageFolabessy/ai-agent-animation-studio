import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderConfig } from '../src/config/render-config.js';
import { buildFfmpegArgs } from '../src/renderer/ffmpeg-streamer.js';
import { RenderPipeline } from '../src/renderer/pipeline.js';
import { assertBt709Tv, probeVideo } from '../src/diagnostics/ffprobe.js';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';
import {
  analyzeWavFileToArtifacts,
  loadAudioAnalysis,
  runPythonAudioAnalyzer,
  synthesizeMusicalWavBuffer
} from '../src/engine/audio/index.js';

test('AudioMux: buildFfmpegArgs preserves video-only args when audio is omitted and adds AAC muxing when configured', () => {
  const videoOnlyConfig = createTestRenderConfig({
    width: 128,
    height: 128,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 30
  });

  const videoOnlyArgs = buildFfmpegArgs(videoOnlyConfig, '/tmp/out.part.mp4');
  assert.equal(videoOnlyArgs.includes('-c:a'), false);
  assert.equal(videoOnlyArgs.includes('-shortest'), false);

  const muxConfig = createTestRenderConfig({
    width: 128,
    height: 128,
    fps: 30,
    pixelFormat: 'rgba',
    totalFrames: 30,
    audio: {
      filePath: 'assets/audio/trashed-and-scattered.flac',
      startSeconds: 49.0,
      durationSeconds: 6.0,
      bitrateKbps: 256
    }
  });

  const muxArgs = buildFfmpegArgs(muxConfig, '/tmp/out.part.mp4');
  assert.ok(muxArgs.includes('-ss'));
  assert.ok(muxArgs.includes('49'));
  assert.ok(muxArgs.includes('-t'));
  assert.ok(muxArgs.includes('6'));
  assert.ok(muxArgs.includes('0:v:0'));
  assert.ok(muxArgs.includes('1:a:0'));
  assert.ok(muxArgs.includes('aac'));
  assert.ok(muxArgs.includes('256k'));
  assert.ok(muxArgs.includes('-shortest'));
});

test('AudioMux: Synthesizes WAV, extracts .features.bin, renders video + AAC audio via RenderPipeline, and verifies with ffprobe', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-audiomux-'));
  try {
    const wavPath = path.join(tmpDir, 'synth.wav');
    const manifestPath = path.join(tmpDir, 'synth.manifest.json');
    const binPath = path.join(tmpDir, 'synth.features.bin');
    const outputMp4 = path.join(tmpDir, 'muxed.mp4');

    const wavBuf = synthesizeMusicalWavBuffer({
      durationSeconds: 1.0,
      sampleRate: 44100,
      bpm: 120
    });
    fs.writeFileSync(wavPath, wavBuf);

    const { manifest } = analyzeWavFileToArtifacts({
      wavFilePath: wavPath,
      outManifestPath: manifestPath,
      outBinaryPath: binPath,
      fps: 30,
      rawLrcContent: '[00:00.00][00:00.80]\n[00:00.10]Audio Reactive Synthesis'
    });

    assert.equal(manifest.metadata.totalFrames, 30);
    assert.equal(manifest.lyrics.length, 1);
    assert.equal(manifest.lyrics[0].endTimeSeconds, 0.8);

    const loaded = loadAudioAnalysis(manifestPath);
    assert.equal(loaded.reader.totalFrames, 30);

    const config = createTestRenderConfig({
      width: 64,
      height: 64,
      fps: 30,
      pixelFormat: 'rgba',
      totalFrames: 30,
      preset: 'ultrafast',
      threads: 1,
      audio: {
        filePath: wavPath,
        bitrateKbps: 192
      }
    });

    const pipeline = new RenderPipeline({
      config,
      outputPath: outputMp4,
      frameGenerator: (frameIndex: number) => {
        const feat = loaded.reader.getFrameFeature(frameIndex);
        const lum = Math.round(40 + 180 * feat.rmsRelativeGlobal);
        const color = `rgb(${lum}, 30, 90)`;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`;
      }
    });

    await pipeline.run();

    const probe = probeVideo(outputMp4);
    assert.equal(probe.stream.codec_name, 'h264');
    assert.equal(probe.frameCount, 30);
    assertBt709Tv(probe.stream);

    assert.ok(probe.audioStream, 'Expected muxed MP4 to contain an audio stream');
    assert.equal(probe.audioStream.codec_name, 'aac');
    assert.equal(probe.audioStream.sample_rate, '44100');

    assert.equal(findTemporaryImageFiles().length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AudioMux: Analyzes and muxes real Trashed And Scattered FLAC + LRC chorus slice when present', async () => {
  const flacPath = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.flac');
  const lrcPath = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.lrc');
  if (!fs.existsSync(flacPath) || !fs.existsSync(lrcPath)) {
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-flacmux-'));
  try {
    const manifestPath = path.join(tmpDir, 'chorus.manifest.json');
    const binPath = path.join(tmpDir, 'chorus.features.bin');
    const outputMp4 = path.join(tmpDir, 'chorus.mp4');

    // Analyze 2.0s chorus slice starting at 49.0s ([00:49.28] "Trashed and scattered again...")
    const { manifest, reader } = analyzeWavFileToArtifacts({
      wavFilePath: flacPath,
      lrcFilePath: lrcPath,
      outManifestPath: manifestPath,
      outBinaryPath: binPath,
      fps: 30,
      startSeconds: 49.0,
      durationSeconds: 2.0,
      totalFrames: 60
    });

    assert.equal(manifest.metadata.totalFrames, 60);
    assert.ok(
      manifest.lyrics.some((l) => l.text.includes('Trashed and scattered again')),
      'Expected chorus lyric in 49.0s..51.0s slice'
    );

    const config = createTestRenderConfig({
      width: 64,
      height: 64,
      fps: 30,
      pixelFormat: 'rgba',
      totalFrames: 60,
      preset: 'ultrafast',
      threads: 1,
      audio: {
        filePath: flacPath,
        startSeconds: 49.0,
        durationSeconds: 2.0,
        bitrateKbps: 192
      }
    });

    const pipeline = new RenderPipeline({
      config,
      outputPath: outputMp4,
      frameGenerator: (frameIndex: number) => {
        const feat = reader.getFrameFeature(frameIndex);
        const r = Math.round(50 + 200 * feat.bands.bass);
        const b = Math.round(50 + 200 * feat.bands.presence);
        return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="rgb(${r},20,${b})"/></svg>`;
      }
    });

    await pipeline.run();

    const probe = probeVideo(outputMp4);
    assert.equal(probe.stream.codec_name, 'h264');
    assert.equal(probe.frameCount, 60);
    assertBt709Tv(probe.stream);
    assert.ok(probe.audioStream, 'Expected muxed MP4 from FLAC to contain an AAC audio stream');
    assert.equal(probe.audioStream.codec_name, 'aac');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AudioMux: Python offline analyzer bridge (python/analyze_audio.py) produces valid .features.bin and manifest', () => {
  const flacPath = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.flac');
  const lrcPath = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.lrc');
  if (!fs.existsSync(flacPath) || !fs.existsSync(lrcPath)) {
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaas-pybridge-'));
  try {
    const manifestPath = path.join(tmpDir, 'py_chorus.manifest.json');
    const binPath = path.join(tmpDir, 'py_chorus.features.bin');

    const { manifest, reader } = runPythonAudioAnalyzer({
      audioFilePath: flacPath,
      lrcFilePath: lrcPath,
      outManifestPath: manifestPath,
      outBinaryPath: binPath,
      fps: 30,
      sampleRate: 44100,
      startSeconds: 49.0,
      durationSeconds: 2.0
    });

    assert.equal(manifest.metadata.totalFrames, 60);
    assert.equal(reader.totalFrames, 60);
    assert.equal(reader.byteLength, 32 + 53 * 60);
    assert.ok(manifest.lyrics.some((l) => l.text.includes('Trashed and scattered again')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

