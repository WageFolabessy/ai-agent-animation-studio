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
  console.log('STAGE 2: TWO CHARACTERS INTERACTING IN CONTRASTING SETS');
  console.log('================================================================');

  const durationSec = 35;
  const fps = 30;
  const totalFrames = durationSec * fps; // 1050 frames
  const artifactsDir = path.resolve(process.cwd(), 'output', 'artifacts', 'stage2_two_characters');
  const outputMp4 = path.resolve(process.cwd(), 'output', 'stage2_two_characters_final.mp4');
  const reviewDir = path.resolve(process.cwd(), 'output', 'review_stage2');

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
[00:00.00] Di dalam aula temaram melangkah bertaut
[00:07.00] Bertemu tatap bayang di balik tiang megah
[00:14.00] Pelukan sesaat lalu terhempas berjarak
[00:21.00] Berlari keluar menembus dingin lampu kota
[00:28.00] Menatap menara langit menjulang menanti fajar
`.trim();

  await analyzeWavFileToArtifacts({
    wavFilePath: wavPath,
    outManifestPath: manifestPath,
    outBinaryPath: binPath,
    rawLrcContent: rawLrc,
    fps
  });

  const { manifest: audioManifest } = loadAudioAnalysis(manifestPath);

  // 2. Define Stage 2 StoryBeatContract (2 characters, 2 sets, bilateral interaction)
  console.log('\n[2/5] Synthesizing Stage 2 Story Beat Contract...');
  const storyBeatContract: StoryBeatContract = {
    projectId: 'stage2_two_characters',
    songDurationSec: durationSec,
    fps,
    sliceFrameRange: { startFrame: 0, endFrame: totalFrames },
    cast: [
      {
        instanceId: 'protagonist_lead',
        role: 'PROTAGONIST',
        archetypeId: 'hero_silhouette',
        palette: { primary: '#0a1128', accent: '#00f0ff' } // Cool cyber-noir
      },
      {
        instanceId: 'narrative_partner',
        role: 'PARTNER',
        archetypeId: 'companion_silhouette',
        palette: { primary: '#3d1c06', accent: '#ff9100' } // Warm industrial copper
      }
    ],
    beats: [
      {
        beatId: 'beat_01_interior_approach',
        startFrame: 0,
        endFrame: 210,
        lyricSnippet: 'Di dalam aula temaram melangkah bertaut',
        emotionalTone: 'reflective',
        narrativeSubtext: 'Lead and companion approach inside the vaulted interior hall',
        presentCharacters: ['protagonist_lead', 'narrative_partner'],
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
          },
          {
            instanceId: 'narrative_partner',
            verb: 'walk_to',
            speedNorm: 1.0,
            intensityNorm: 0.7
          }
        ],
        camera: {
          framing: 'WIDE',
          movement: 'DOLLY',
          focalCharacterId: 'protagonist_lead',
          lookRoom: 'center',
          dutchAngleDeg: 0
        }
      },
      {
        beatId: 'beat_02_interior_confront',
        startFrame: 210,
        endFrame: 420,
        lyricSnippet: 'Bertemu tatap bayang di balik tiang megah',
        emotionalTone: 'melancholic',
        narrativeSubtext: 'Tense confrontation across the desk surface',
        presentCharacters: ['protagonist_lead', 'narrative_partner'],
        set: {
          kitId: 'ARCHITECTURAL_INTERIOR',
          variantId: 'dramatic_twilight',
          landmarkProps: ['desk', 'coffee_cup'],
          atmosphericDensity: 0.6
        },
        actions: [
          {
            instanceId: 'protagonist_lead',
            verb: 'reach_and_grasp',
            speedNorm: 1.0,
            intensityNorm: 0.8,
            associatedPropId: 'coffee_cup'
          },
          {
            instanceId: 'narrative_partner',
            verb: 'look_at',
            speedNorm: 1.0,
            intensityNorm: 0.8
          }
        ],
        camera: {
          framing: 'INSERT',
          movement: 'STATIC',
          focalCharacterId: 'protagonist_lead',
          lookRoom: 'center',
          dutchAngleDeg: 0
        }
      },
      {
        beatId: 'beat_03_embrace_push',
        startFrame: 420,
        endFrame: 630,
        lyricSnippet: 'Pelukan sesaat lalu terhempas berjarak',
        emotionalTone: 'defiant',
        narrativeSubtext: 'Bilateral embrace and dramatic push-away recoil with guaranteed clearance',
        presentCharacters: ['protagonist_lead', 'narrative_partner'],
        set: {
          kitId: 'ARCHITECTURAL_INTERIOR',
          variantId: 'dramatic_twilight',
          landmarkProps: [],
          atmosphericDensity: 0.6
        },
        actions: [
          {
            instanceId: 'protagonist_lead',
            verb: 'embrace_push_away',
            speedNorm: 1.1,
            intensityNorm: 0.95
          },
          {
            instanceId: 'narrative_partner',
            verb: 'embrace_push_away',
            speedNorm: 1.1,
            intensityNorm: 0.95
          }
        ],
        camera: {
          framing: 'MEDIUM',
          movement: 'PAN',
          focalCharacterId: 'protagonist_lead',
          lookRoom: 'center',
          dutchAngleDeg: 3
        }
      },
      {
        beatId: 'beat_04_exterior_run',
        startFrame: 630,
        endFrame: 840,
        lyricSnippet: 'Berlari keluar menembus dingin lampu kota',
        emotionalTone: 'chaotic',
        narrativeSubtext: 'Characters transition outdoors onto the rainy urban street overlook',
        presentCharacters: ['protagonist_lead', 'narrative_partner'],
        set: {
          kitId: 'EXTERIOR_URBAN_VISTA',
          variantId: 'storm_overcast',
          landmarkProps: ['umbrella'],
          atmosphericDensity: 0.7
        },
        actions: [
          {
            instanceId: 'protagonist_lead',
            verb: 'run_to',
            speedNorm: 1.3,
            intensityNorm: 0.9
          },
          {
            instanceId: 'narrative_partner',
            verb: 'walk_to',
            speedNorm: 1.0,
            intensityNorm: 0.7
          }
        ],
        camera: {
          framing: 'WIDE',
          movement: 'STATIC',
          focalCharacterId: 'protagonist_lead',
          lookRoom: 'right',
          dutchAngleDeg: -2
        }
      },
      {
        beatId: 'beat_05_exterior_outlook',
        startFrame: 840,
        endFrame: 1050,
        lyricSnippet: 'Menatap menara langit menjulang menanti fajar',
        emotionalTone: 'euphoric',
        narrativeSubtext: 'Pointing together towards the towering skyline towers as dawn approaches',
        presentCharacters: ['protagonist_lead', 'narrative_partner'],
        set: {
          kitId: 'EXTERIOR_URBAN_VISTA',
          variantId: 'clean_minimal',
          landmarkProps: ['umbrella'],
          atmosphericDensity: 0.4
        },
        actions: [
          {
            instanceId: 'protagonist_lead',
            verb: 'gesture_point',
            speedNorm: 1.0,
            intensityNorm: 0.85
          },
          {
            instanceId: 'narrative_partner',
            verb: 'look_at',
            speedNorm: 1.0,
            intensityNorm: 0.75
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

  // Story spec conforming strictly to StorySpecContractSchema for review-sheets helper
  const syntheticStorySpec = {
    projectId: 'stage2_two_characters',
    title: 'Stage 2: Bilateral Interaction & Contrasting Sets',
    overallMood: 'cyber_noir_theatrical',
    themes: ['conflict', 'connection', 'urban_journey'],
    genreProfile: 'neutral' as const,
    cast: [
      {
        instanceId: 'protagonist_lead',
        role: 'PROTAGONIST' as const,
        archetypeId: 'hero_silhouette' as const,
        paletteOverrides: { primary: '#0a1128', accent: '#00f0ff' },
        accessories: ['coffee_cup']
      },
      {
        instanceId: 'narrative_partner',
        role: 'PARTNER' as const,
        archetypeId: 'companion_silhouette' as const,
        paletteOverrides: { primary: '#3d1c06', accent: '#ff9100' },
        accessories: ['umbrella']
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
      interactionBehavior:
        b.beatId === 'beat_03_embrace_push'
          ? ('FACE_TO_FACE' as const)
          : b.beatId === 'beat_04_exterior_run'
            ? ('PARALLEL_WALK' as const)
            : ('DUET_PERFORMANCE' as const),
      environmentKitId: 'industrial_city' as const,
      kitParams: {},
      colorThemeId: 'CYBERPUNK_CYAN' as const,
      cameraIntensity: 0.6,
      castDirectives: [
        {
          instanceId: 'protagonist_lead',
          motionPreset: 'pop_vocal_sway' as const,
          waypoints: [{ frameProgress: 0, stagePosNorm: [0, 0, 0] as [number, number, number] }]
        },
        {
          instanceId: 'narrative_partner',
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
  const zipPath = path.join(reviewDir, 'stage2_review_sheets.zip');
  await execFileAsync('zip', [
    '-j',
    zipPath,
    ...fs.readdirSync(reviewDir)
      .filter((f) => f.endsWith('.jpg') || f.endsWith('.txt') || f.endsWith('.json') || f.endsWith('.md'))
      .map((f) => path.join(reviewDir, f))
  ]);

  console.log(`✓ Review sheets generated in: ${reviewDir}`);
  console.log(`✓ Review ZIP archive created: ${zipPath}`);
  console.log('\n================================================================');
  console.log('STAGE 2 COMPLETE: Ready for Review Gate 2 Evaluation');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Fatal error in Stage 2 rendering:', err);
  process.exit(1);
});
