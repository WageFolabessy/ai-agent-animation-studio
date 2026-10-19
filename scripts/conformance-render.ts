import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SvgRasterizer } from '../src/renderer/rasterizer.js';
import { RenderPipeline } from '../src/renderer/pipeline.js';
import { createTestRenderConfig } from '../src/config/render-config.js';
import { SvgBuilder } from '../src/engine/compositor/svg-builder.js';
import { findTemporaryImageFiles } from '../src/diagnostics/artifact-hygiene.js';
import { probeVideo, assertBt709Tv } from '../src/diagnostics/ffprobe.js';
import { OUTPUT_DIR } from '../src/config/paths.js';

async function runConformanceTest(): Promise<void> {
  console.log('=== STARTING CONFORMANCE TEST (GATE B) ===');

  const width = 64;
  const height = 64;
  const fps = 30;
  const totalFrames = 4;
  const expectedBytes = width * height * 4;

  const config = createTestRenderConfig({
    width,
    height,
    fps,
    pixelFormat: 'rgba',
    totalFrames,
    crf: 18,
    preset: 'veryfast',
    threads: 2
  });

  const rasterizer = new SvgRasterizer({
    width,
    height,
    loadSystemFonts: false
  });

  const framesSvg: string[] = [
    // Frame 0: Red
    new SvgBuilder({ width, height, backgroundColor: '#000000' })
      .addRect(0, 0, width, height, '#ff0000', 1)
      .build(),
    // Frame 1: Green
    new SvgBuilder({ width, height, backgroundColor: '#000000' })
      .addRect(0, 0, width, height, '#00ff00', 1)
      .build(),
    // Frame 2: Blue
    new SvgBuilder({ width, height, backgroundColor: '#000000' })
      .addRect(0, 0, width, height, '#0000ff', 1)
      .build(),
    // Frame 3: Semi-transparent white over opaque black background
    new SvgBuilder({ width, height, backgroundColor: '#000000' })
      .addRect(0, 0, width, height, '#ffffff', 0.5)
      .build()
  ];

  // --- STAGE A: Pre-Encoding Buffer Check ---
  console.log('\n[Stage A] Verifying Pre-Encoding Buffers...');
  const rawFrames: Buffer[] = [];

  for (let i = 0; i < framesSvg.length; i++) {
    const raw = rasterizer.rasterize(framesSvg[i]);
    rawFrames.push(raw);

    if (raw.byteLength !== expectedBytes) {
      throw new Error(`Frame ${i} byteLength mismatch: ${raw.byteLength} != ${expectedBytes}`);
    }
  }

  // Verify RGBA channel order
  const f0 = rawFrames[0]; // Red
  console.log(`Frame 0 (Red) RGBA Pixel 0: [${f0[0]}, ${f0[1]}, ${f0[2]}, ${f0[3]}]`);
  if (f0[0] < 250 || f0[1] > 5 || f0[2] > 5 || f0[3] !== 255) {
    throw new Error(`Frame 0 does not match RGBA Red format: [${f0[0]}, ${f0[1]}, ${f0[2]}, ${f0[3]}]`);
  }

  const f1 = rawFrames[1]; // Green
  console.log(`Frame 1 (Green) RGBA Pixel 0: [${f1[0]}, ${f1[1]}, ${f1[2]}, ${f1[3]}]`);
  if (f1[0] > 5 || f1[1] < 250 || f1[2] > 5 || f1[3] !== 255) {
    throw new Error(`Frame 1 does not match RGBA Green format: [${f1[0]}, ${f1[1]}, ${f1[2]}, ${f1[3]}]`);
  }

  const f2 = rawFrames[2]; // Blue
  console.log(`Frame 2 (Blue) RGBA Pixel 0: [${f2[0]}, ${f2[1]}, ${f2[2]}, ${f2[3]}]`);
  if (f2[0] > 5 || f2[1] > 5 || f2[2] < 250 || f2[3] !== 255) {
    throw new Error(`Frame 2 does not match RGBA Blue format: [${f2[0]}, ${f2[1]}, ${f2[2]}, ${f2[3]}]`);
  }

  const f3 = rawFrames[3]; // 50% white over black
  console.log(`Frame 3 (Semi-transparent white) RGBA Pixel 0: [${f3[0]}, ${f3[1]}, ${f3[2]}, ${f3[3]}]`);
  const expectedNominalGray = f3[0];
  console.log(`Identified alpha model: nominal gray = ${expectedNominalGray}`);
  if (Math.abs(expectedNominalGray - 128) > 20) {
    throw new Error(`Frame 3 alpha blending result is outside nominal range: ${expectedNominalGray}`);
  }

  console.log('✓ Pre-encoding buffer check passed 100%.');

  // --- STAGE B: Stream Encoding & Output Commit via RenderPipeline ---
  console.log('\n[Stage B] Performing Stream Encoding & Output Commit via RenderPipeline...');
  const outputPath = path.join(OUTPUT_DIR, 'conformance.mp4');

  const pipeline = new RenderPipeline({
    config,
    outputPath,
    frameGenerator: (i) => framesSvg[i]
  });

  const pipeResult = await pipeline.run();
  console.log(`✓ Video encoded and atomically committed to: ${pipeResult.finalOutputPath}`);

  // Verify that the staging file .part.mp4 does not remain on disk
  if (fs.existsSync(pipeResult.stagingPartPath)) {
    throw new Error(`Temporary staging file .part.mp4 still exists on disk: ${pipeResult.stagingPartPath}`);
  }
  console.log('✓ Staging .part.mp4 clean from disk (zero staging residue).');

  // --- STAGE C: ffprobe Metadata Verification ---
  console.log('\n[Stage C] Validating Metadata with ffprobe...');
  const probe = probeVideo(pipeResult.finalOutputPath);
  const streamInfo = probe.stream;

  console.log('ffprobe stream info:', JSON.stringify(streamInfo));
  if (streamInfo.codec_name !== 'h264') throw new Error(`Codec is not h264: ${streamInfo.codec_name}`);
  if (streamInfo.width !== width) throw new Error(`Width mismatch: ${streamInfo.width} != ${width}`);
  if (streamInfo.height !== height) throw new Error(`Height mismatch: ${streamInfo.height} != ${height}`);
  if (streamInfo.pix_fmt !== 'yuv420p') throw new Error(`Pixel format mismatch: ${streamInfo.pix_fmt}`);
  if (probe.frameCount !== totalFrames) {
    throw new Error(`Frame count mismatch: ${probe.frameCount} != ${totalFrames}`);
  }

  // Explicit BT.709 Color Metadata validation
  assertBt709Tv(streamInfo);
  console.log('✓ BT.709 ffprobe metadata validated successfully.');

  // --- STAGE D: Post-Decode Color Tolerance Verification ---
  console.log('\n[Stage D] Decoding Output and Verifying Color Tolerances...');
  const decodedBuffer = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', pipeResult.finalOutputPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  const frameBytesDecoded = width * height * 3;
  if (decodedBuffer.byteLength !== frameBytesDecoded * totalFrames) {
    throw new Error(`Decoded byte length mismatch: ${decodedBuffer.byteLength} != ${frameBytesDecoded * totalFrames}`);
  }

  const getDecodedPixel = (frameIdx: number) => {
    const offset = frameIdx * frameBytesDecoded + (32 * width + 32) * 3;
    return [decodedBuffer[offset], decodedBuffer[offset + 1], decodedBuffer[offset + 2]];
  };

  const decRed = getDecodedPixel(0);
  console.log(`Decoded Frame 0 (Red): [${decRed.join(', ')}]`);
  if (decRed[0] < 200 || decRed[1] > 40 || decRed[2] > 40) {
    throw new Error(`Decoded Red outside tolerance: [${decRed.join(', ')}]`);
  }

  const decGreen = getDecodedPixel(1);
  console.log(`Decoded Frame 1 (Green): [${decGreen.join(', ')}]`);
  if (decGreen[0] > 40 || decGreen[1] < 200 || decGreen[2] > 40) {
    throw new Error(`Decoded Green outside tolerance: [${decGreen.join(', ')}]`);
  }

  const decBlue = getDecodedPixel(2);
  console.log(`Decoded Frame 2 (Blue): [${decBlue.join(', ')}]`);
  if (decBlue[0] > 40 || decBlue[1] > 40 || decBlue[2] < 200) {
    throw new Error(`Decoded Blue outside tolerance: [${decBlue.join(', ')}]`);
  }

  const decGray = getDecodedPixel(3);
  console.log(`Decoded Frame 3 (Gray): [${decGray.join(', ')}]`);
  if (
    Math.abs(decGray[0] - expectedNominalGray) > 15 ||
    Math.abs(decGray[1] - expectedNominalGray) > 15 ||
    Math.abs(decGray[2] - expectedNominalGray) > 15
  ) {
    throw new Error(`Decoded Gray outside tolerance (expected ~${expectedNominalGray}): [${decGray.join(', ')}]`);
  }

  console.log('✓ Post-decode color tolerance check passed.');

  // --- STAGE E: Recursive Zero Leaked Image Files Verification ---
  const junkFiles = findTemporaryImageFiles();
  if (junkFiles.length > 0) {
    throw new Error(`Leaked temporary image files found on disk: ${junkFiles.join(', ')}`);
  }
  console.log('✓ Verified zero temporary image files across workspace disk.');
  console.log(`✓ Published output: ${pipeResult.finalOutputPath}`);
  console.log('\n=== CONFORMANCE TEST (GATE B) PASSED 100% ===');
}

runConformanceTest().catch((err) => {
  console.error('\n❌ CONFORMANCE TEST FAILED:', err);
  process.exit(1);
});
