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
import type { StoryBeatContract } from '../src/schemas/story-beat.contract.js';

const execFileAsync = promisify(execFile);

async function main() {
  console.log('================================================================');
  console.log('STAGE 1: SOLO ACTING & DESK PROP CONTACT (ARCHITECTURAL_INTERIOR)');
  console.log('================================================================');

  const durationSec = 35;
  const fps = 30;
  const totalFrames = durationSec * fps; // 1050 frames
  const artifactsDir = path.resolve(process.cwd(), 'output', 'artifacts', 'stage1_solo_acting');
  const outputMp4 = path.resolve(process.cwd(), 'output', 'stage1_solo_acting_final.mp4');
  const reviewDir = path.resolve(process.cwd(), 'output', 'review_stage1');

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });

  // 1. Synthesize Audio & Lyrics
  console.log('\n[1/5] Synthesizing 35s Musical Audio & Multilingual Lyrics...');
  const wavPath = path.join(artifactsDir, 'audio.wav');
  const binPath = path.join(artifactsDir, 'features.bin');
  const manifestPath = path.join(artifactsDir, 'audio-manifest.json');

  const wavBuffer = synthesizeMusicalWavBuffer({
    durationSeconds: durationSec,
    sampleRate: 44100,
    bpm: 120
  });
  fs.writeFileSync(wavPath, wavBuffer);

  const rawLrc = `
[00:00.00] Di tengah lorong malam hening merenung
[00:07.00] Meraih secangkir hangat di atas meja
[00:14.00] Seketika langkah berbalik menatap bayang
[00:21.00] Melangkah membawa asa melintasi ruang
[00:28.00] Menunjuk cakrawala fajar yang menjelang
`.trim();

  await analyzeWavFileToArtifacts({
    wavFilePath: wavPath,
    outManifestPath: manifestPath,
    outBinaryPath: binPath,
    rawLrcContent: rawLrc,
    fps
  });

  const { manifest: audioManifest } = loadAudioAnalysis(manifestPath);

  // 2. Define Stage 1 StoryBeatContract
  console.log('\n[2/5] Synthesizing Stage 1 Story Beat Contract...');
  const storyBeatContract: StoryBeatContract = {
    projectId: 'stage1_solo_acting',
    songDurationSec: durationSec,
    fps,
    sliceFrameRange: { startFrame: 0, endFrame: totalFrames },
    cast: [
      {
        instanceId: 'protagonist_lead',
        role: 'PROTAGONIST',
        archetypeId: 'hero_silhouette',
        palette: { primary: '#0a1128', accent: '#00f0ff' }
      }
    ],
    beats: [
      {
        beatId: 'beat_01_walk',
        startFrame: 0,
        endFrame: 210,
        lyricSnippet: 'Di tengah lorong malam hening merenung',
        emotionalTone: 'reflective',
        narrativeSubtext: 'Lead approaches the study desk with measured pace',
        presentCharacters: ['protagonist_lead'],
        set: {
          kitId: 'ARCHITECTURAL_INTERIOR',
          variantId: 'moody_night',
          landmarkProps: ['desk', 'coffee_cup'],
          atmosphericDensity: 0.5
        },
        actions: [
          {
            instanceId: 'protagonist_lead',
            verb: 'walk_to',
            speedNorm: 1.0,
            intensityNorm: 0.7
          }
        ],
        camera: {
          framing: 'WIDE',
          movement: 'DOLLY',
          focalCharacterId: 'protagonist_lead',
          lookRoom: 'right',
          dutchAngleDeg: 0
        }
      },
      {
        beatId: 'beat_02_reach_grasp',
        startFrame: 210,
        endFrame: 420,
        lyricSnippet: 'Meraih secangkir hangat di atas meja',
        emotionalTone: 'melancholic',
        narrativeSubtext: 'Reaching arm with analytical IK and grasping coffee cup',
        presentCharacters: ['protagonist_lead'],
        set: {
          kitId: 'ARCHITECTURAL_INTERIOR',
          variantId: 'moody_night',
          landmarkProps: ['desk', 'coffee_cup'],
          atmosphericDensity: 0.5
        },
        actions: [
          {
            instanceId: 'protagonist_lead',
            verb: 'reach_and_grasp',
            speedNorm: 0.9,
            intensityNorm: 0.8,
            associatedPropId: 'coffee_cup'
          }
        ],
        camera: {
          framing: 'CLOSE_UP',
          movement: 'STATIC',
          focalCharacterId: 'protagonist_lead',
          lookRoom: 'center',
          dutchAngleDeg: 0
        }
      },
      {
        beatId: 'beat_03_snap_turn',
        startFrame: 420,
        endFrame: 630,
        lyricSnippet: 'Seketika langkah berbalik menatap bayang',
        emotionalTone: 'defiant',
        narrativeSubtext: 'Cut-paper snap turnaround with locked foot contact',
        presentCharacters: ['protagonist_lead'],
        set: {
          kitId: 'ARCHITECTURAL_INTERIOR',
          variantId: 'dramatic_twilight',
          landmarkProps: ['desk', 'coffee_cup'],
          atmosphericDensity: 0.6
        },
        actions: [
          {
            instanceId: 'protagonist_lead',
            verb: 'stop_and_turn',
            speedNorm: 1.1,
            intensityNorm: 0.9
          }
        ],
        camera: {
          framing: 'MEDIUM',
          movement: 'PAN',
          focalCharacterId: 'protagonist_lead',
          lookRoom: 'left',
          dutchAngleDeg: 4
        }
      },
      {
        beatId: 'beat_04_carry_put_down',
        startFrame: 630,
        endFrame: 840,
        lyricSnippet: 'Melangkah membawa asa melintasi ruang',
        emotionalTone: 'reflective',
        narrativeSubtext: 'Carrying cup and setting it down safely onto stage surface',
        presentCharacters: ['protagonist_lead'],
        set: {
          kitId: 'ARCHITECTURAL_INTERIOR',
          variantId: 'dramatic_twilight',
          landmarkProps: ['desk', 'coffee_cup'],
          atmosphericDensity: 0.5
        },
        actions: [
          {
            instanceId: 'protagonist_lead',
            verb: 'carry_put_down',
            speedNorm: 1.0,
            intensityNorm: 0.7
          }
        ],
        camera: {
          framing: 'WIDE',
          movement: 'STATIC',
          focalCharacterId: 'protagonist_lead',
          lookRoom: 'center',
          dutchAngleDeg: 0
        }
      },
      {
        beatId: 'beat_05_gesture_point',
        startFrame: 840,
        endFrame: 1050,
        lyricSnippet: 'Menunjuk cakrawala fajar yang menjelang',
        emotionalTone: 'euphoric',
        narrativeSubtext: 'Pointing toward rising horizon in architectural hall',
        presentCharacters: ['protagonist_lead'],
        set: {
          kitId: 'ARCHITECTURAL_INTERIOR',
          variantId: 'clean_minimal',
          landmarkProps: ['desk'],
          atmosphericDensity: 0.4
        },
        actions: [
          {
            instanceId: 'protagonist_lead',
            verb: 'gesture_point',
            speedNorm: 1.0,
            intensityNorm: 0.85
          }
        ],
        camera: {
          framing: 'CLOSE_UP',
          movement: 'STATIC',
          focalCharacterId: 'protagonist_lead',
          lookRoom: 'right',
          dutchAngleDeg: 0
        }
      }
    ],
    unfulfilledRequests: []
  };

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

  // Synthetic story-spec.json conforming strictly to StorySpecContractSchema for review-sheets helper
  const syntheticStorySpec = {
    projectId: 'stage1_solo_acting',
    title: 'Stage 1: Solo Acting & Desk Prop Contact',
    overallMood: 'cyber_noir_theatrical',
    themes: ['isolation', 'discovery'],
    genreProfile: 'neutral' as const,
    cast: [
      {
        instanceId: 'protagonist_lead',
        role: 'PROTAGONIST' as const,
        archetypeId: 'hero_silhouette' as const,
        paletteOverrides: { primary: '#0a1128', accent: '#00f0ff' },
        accessories: ['coffee_cup']
      }
    ],
    sections: storyBeatContract.beats.map((b) => ({
      sectionId: b.beatId,
      startFrame: b.startFrame,
      endFrame: b.endFrame,
      narrativeIntent: b.narrativeSubtext,
      emotionalTone: b.emotionalTone,
      stagingMode: 'theatrical' as const,
      theatricalSetId: b.set.kitId,
      interactionBehavior: 'SOLO' as const,
      environmentKitId: 'industrial_city' as const,
      kitParams: {},
      colorThemeId: 'CYBERPUNK_CYAN' as const,
      cameraIntensity: 0.5,
      castDirectives: [
        {
          instanceId: 'protagonist_lead',
          motionPreset: 'pop_vocal_sway' as const,
          waypoints: [{ frameProgress: 0, stagePosNorm: [0, 0, 0] as [number, number, number] }]
        }
      ]
    }))
  };
  fs.writeFileSync(
    path.join(artifactsDir, 'story-spec.json'),
    JSON.stringify(syntheticStorySpec, null, 2)
  );

  // 4. Render Video via Production Pipeline
  console.log('\n[4/5] Rendering Video via Zero-Disk Streaming Production Pipeline...');
  const renderResult = await runProductionPipeline({
    audioPath: wavPath,
    fromArtifactsDir: artifactsDir,
    outputPath: outputMp4,
    stagingMode: 'theatrical',
    fps,
    width: 1920,
    height: 1080,
    crf: 18,
    threads: 2,
    chunkFrames: 350,
    resume: false
  });

  console.log(`✓ Video rendered: ${renderResult.finalOutputPath} (${(renderResult.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`  Effective FPS: ${renderResult.effectiveFps.toFixed(2)} | Peak Aggregate Memory: ${renderResult.peakAggregateRssMb.toFixed(2)} MB`);

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
  const zipPath = path.join(reviewDir, 'stage1_review_sheets.zip');
  await execFileAsync('zip', ['-j', zipPath, ...fs.readdirSync(reviewDir).filter((f) => f.endsWith('.jpg') || f.endsWith('.txt') || f.endsWith('.json')).map((f) => path.join(reviewDir, f))]);

  console.log(`✓ Review sheets generated in: ${reviewDir}`);
  console.log(`✓ Review ZIP archive created: ${zipPath}`);
  console.log('\n================================================================');
  console.log('STAGE 1 COMPLETE: Ready for Review Gate 1 Evaluation');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Fatal error in Stage 1 rendering:', err);
  process.exit(1);
});
