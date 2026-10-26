import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  synthesizeMusicalWavBuffer,
  analyzeWavFileToArtifacts,
  loadAudioAnalysis
} from '../src/engine/audio/index.js';
import { VerbCompiler } from '../src/engine/director/verb-engine/verb-compiler.js';
import { runProductionPipeline } from '../src/engine/director/production-pipeline.js';
import {
  STAGE2_DURATION_SEC,
  STAGE2_FPS,
  STAGE2_TOTAL_FRAMES,
  STAGE2_RAW_LRC,
  STAGE2_STORY_BEAT_CONTRACT,
  STAGE2_SYNTHETIC_STORY_SPEC,
  STAGE2_RENDER_OPTIONS
} from '../src/demo/stage2-scene.js';

const execFileAsync = promisify(execFile);

async function main() {
  console.log('================================================================');
  console.log('STAGE 2: TWO CHARACTERS INTERACTING IN CONTRASTING SETS');
  console.log('================================================================');

  const durationSec = STAGE2_DURATION_SEC;
  const fps = STAGE2_FPS;
  const totalFrames = STAGE2_TOTAL_FRAMES;
  const artifactsDir = path.resolve(process.cwd(), 'output', 'artifacts', 'stage2_two_characters');
  const outputMp4 = path.resolve(process.cwd(), 'output', 'stage2_two_characters_final.mp4');
  const reviewDir = path.resolve(process.cwd(), 'output', 'review_stage2');

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });

  // 1. Synthesize Audio & Lyrics
  console.log(`\n[1/5] Synthesizing 35s Musical Audio & Multilingual Lyrics (${totalFrames} frames)...`);
  const wavPath = path.join(artifactsDir, 'audio.wav');
  const binPath = path.join(artifactsDir, 'features.bin');
  const manifestPath = path.join(artifactsDir, 'audio-manifest.json');

  const wavBuffer = synthesizeMusicalWavBuffer({
    durationSeconds: durationSec,
    sampleRate: 44100,
    bpm: 120
  });
  fs.writeFileSync(wavPath, wavBuffer);

  await analyzeWavFileToArtifacts({
    wavFilePath: wavPath,
    outManifestPath: manifestPath,
    outBinaryPath: binPath,
    rawLrcContent: STAGE2_RAW_LRC,
    fps
  });

  const { manifest: audioManifest } = loadAudioAnalysis(manifestPath);

  // 2. Story Beat Contract (Imported from src/demo/stage2-scene.js)
  console.log('\n[2/5] Loading Stage 2 Story Beat Contract from src/demo/stage2-scene.js...');
  const storyBeatContract = STAGE2_STORY_BEAT_CONTRACT;

  // 3. Compile Story Beats
  console.log('\n[3/5] Compiling Story Beats into Production Contracts...');
  const compiled = VerbCompiler.compile(storyBeatContract, audioManifest);

  // Write contracts to artifactsDir
  fs.writeFileSync(
    path.join(artifactsDir, 'storyboard.json'),
    JSON.stringify(compiled.storyboard, null, 2)
  );
  fs.writeFileSync(
    path.join(artifactsDir, 'rigs.json'),
    JSON.stringify({ rigs: Array.from(compiled.rigs.values()) }, null, 2)
  );
  fs.writeFileSync(
    path.join(artifactsDir, 'choreography.json'),
    JSON.stringify(compiled.choreography, null, 2)
  );
  fs.writeFileSync(
    path.join(artifactsDir, 'story-beat.json'),
    JSON.stringify(storyBeatContract, null, 2)
  );
  fs.writeFileSync(
    path.join(artifactsDir, 'story-spec.json'),
    JSON.stringify(STAGE2_SYNTHETIC_STORY_SPEC, null, 2)
  );

  // 4. Render Video via Production Pipeline
  console.log('\n[4/5] Rendering Video via Zero-Disk Streaming Production Pipeline...');
  const renderResult = await runProductionPipeline({
    ...STAGE2_RENDER_OPTIONS,
    audioPath: wavPath,
    fromArtifactsDir: artifactsDir,
    outputPath: outputMp4
  });

  console.log(`✓ Video rendered: ${renderResult.finalOutputPath} (${(renderResult.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)`);

  const bilateralAliasMp4 = path.resolve(process.cwd(), 'output', 'stage2_bilateral_final.mp4');
  fs.copyFileSync(outputMp4, bilateralAliasMp4);

  // 5. Generate Review Sheets & Manifest
  console.log('\n[5/5] Generating Review Sheets & Review Package...');
  await execFileAsync('npx', [
    'tsx',
    'scripts/review-sheets.ts',
    '--video',
    outputMp4,
    '--artifacts',
    artifactsDir,
    '--out',
    reviewDir,
    '--max-total-mb',
    '12'
  ]);

  // Zip review package
  const zipPath = path.join(reviewDir, 'stage2_review_sheets.zip');
  await execFileAsync('zip', [
    '-j',
    zipPath,
    ...fs.readdirSync(reviewDir)
      .filter((f) => f.endsWith('.jpg') || f.endsWith('.txt') || f.endsWith('.json') || f.endsWith('.md'))
      .map((f) => path.join(reviewDir, f))
  ]);

  const zipStats = fs.statSync(zipPath);
  console.log(`✓ Review sheets generated in: ${reviewDir}`);
  console.log(`✓ Review ZIP archive created: ${zipPath} (${(zipStats.size / (1024 * 1024)).toFixed(2)} MB)`);

  // 6. Print Comprehensive Gates & Timing Report
  const medianFps = renderResult.medianFps;
  const peakAggMb = renderResult.peakAggregateRssMb;
  const peakNodeMb = renderResult.peakNodeRssMb;
  const peakChildMb = renderResult.peakChildRssMb;
  const maxDrawables = renderResult.drawableStats?.total.max ?? 0;

  const fpsPass = medianFps >= 15.0;
  const memPass = peakAggMb <= 600.0;
  const memWarn = peakAggMb > 400.0 && peakAggMb <= 600.0;
  const drawablesPass = maxDrawables <= 220;

  console.log('\n================================================================');
  console.log('                 STAGE 2 METRICS & BUDGET REPORT                ');
  console.log('================================================================');
  console.log('Per-Stage Frame Timing (avg / p95):');
  console.log(`  Generate:   ${renderResult.timingStats?.generate.avgMs.toFixed(2)} ms / ${renderResult.timingStats?.generate.p95Ms.toFixed(2)} ms`);
  console.log(`  Rasterize:  ${renderResult.timingStats?.rasterize.avgMs.toFixed(2)} ms / ${renderResult.timingStats?.rasterize.p95Ms.toFixed(2)} ms`);
  console.log(`  Wait/Pipe:  ${renderResult.timingStats?.wait.avgMs.toFixed(2)} ms / ${renderResult.timingStats?.wait.p95Ms.toFixed(2)} ms`);
  console.log('\nDrawable Counts by Category (max / mean / p95):');
  if (renderResult.drawableStats) {
    const cats = renderResult.drawableStats.categories;
    console.log(`  Environment: ${cats.environment.max} / ${cats.environment.mean.toFixed(1)} / ${cats.environment.p95}`);
    console.log(`  Characters:  ${cats.characters.max} / ${cats.characters.mean.toFixed(1)} / ${cats.characters.p95}`);
    console.log(`  Props:       ${cats.props.max} / ${cats.props.mean.toFixed(1)} / ${cats.props.p95}`);
    console.log(`  Lighting:    ${cats.lighting.max} / ${cats.lighting.mean.toFixed(1)} / ${cats.lighting.p95}`);
    console.log(`  Overlays:    ${cats.overlays.max} / ${cats.overlays.mean.toFixed(1)} / ${cats.overlays.p95}`);
    console.log(`  Total:       ${renderResult.drawableStats.total.max} / ${renderResult.drawableStats.total.mean.toFixed(1)} / ${renderResult.drawableStats.total.p95} (Budget <= 220)`);
  }
  console.log('\nSystem & Memory Performance:');
  console.log(`  Peak Node RSS:      ${peakNodeMb.toFixed(2)} MB`);
  console.log(`  Peak FFmpeg RSS:    ${peakChildMb.toFixed(2)} MB`);
  console.log(`  Peak Aggregate RSS: ${peakAggMb.toFixed(2)} MB  [${memPass ? (memWarn ? 'WARN' : 'PASS') : 'FAIL'}] (Target < 400 MB, Hard fail > 600 MB)`);
  console.log(`  Median FPS:         ${medianFps.toFixed(2)} FPS  [${fpsPass ? 'PASS' : 'FAIL'}] (Gate >= 15.0 FPS)`);
  console.log(`  Effective FPS:      ${renderResult.effectiveFps.toFixed(2)} FPS`);
  console.log(`  Drawables Peak:     ${maxDrawables}  [${drawablesPass ? 'PASS' : 'FAIL'}] (Budget <= 220)`);
  console.log('================================================================');

  if (!fpsPass || !memPass || !drawablesPass) {
    console.error('FATAL: Stage 2 failed one or more performance gates!');
    process.exit(1);
  }

  console.log('STAGE 2 COMPLETE: Ready for Review Gate 2 Evaluation');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Fatal error in Stage 2 rendering:', err);
  process.exit(1);
});
