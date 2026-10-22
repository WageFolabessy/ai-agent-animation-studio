import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from '../src/config/paths.js';
import { DEMO_FPS } from '../src/demo/phase2-cinema/index.js';
import {
  runProductionPipeline,
  type ProductionPipelineOptions
} from '../src/engine/director/production-pipeline.js';
import type { CanonicalGenreName } from '../src/engine/director/genre-directing-matrix.js';

interface StudioCliOptions extends ProductionPipelineOptions {
  readonly isProduceMode?: boolean;
}

function parseCliArgs(argv: string[]): StudioCliOptions {
  let audioPath: string | undefined;
  let lrcPath: string | undefined;
  let outputPath: string | undefined;
  let artifactsDir: string | undefined;
  let fromArtifactsDir: string | undefined;
  let providerName: 'mock' | 'openai' = 'mock';
  let chunkFrames = 1500; // ~50s @ 30fps
  let maxChunks: number | undefined;
  let resume = true;
  let bitrateKbps = 256;
  let startFrame: number | undefined;
  let frameCount: number | undefined;
  let usePythonAudio = false;
  let isProduceMode = false;
  let noLyricsInPrompt = process.env.ANIMATION_STUDIO_NO_LYRICS === '1';
  let fps: 30 | 60 = DEMO_FPS as 30;
  let width = 1920;
  let height = 1080;
  let threads = 2;
  let stagingMode: 'runner' | 'theatrical' = 'runner';
  let genreOverride: CanonicalGenreName | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--audio' && i + 1 < argv.length) {
      audioPath = argv[++i];
    } else if (arg === '--lrc' && i + 1 < argv.length) {
      lrcPath = argv[++i];
    } else if (arg === '--out' && i + 1 < argv.length) {
      outputPath = path.resolve(argv[++i]);
    } else if (arg === '--produce') {
      isProduceMode = true;
    } else if (arg === '--theatrical') {
      stagingMode = 'theatrical';
    } else if (arg === '--runner') {
      stagingMode = 'runner';
    } else if (arg === '--mode' && i + 1 < argv.length) {
      const m = argv[++i].toLowerCase();
      stagingMode = m === 'theatrical' ? 'theatrical' : 'runner';
    } else if (arg === '--genre' && i + 1 < argv.length) {
      const g = argv[++i].toUpperCase();
      if (['POP', 'BALLAD', 'ROCK', 'METAL', 'ELECTRONIC', 'ACOUSTIC'].includes(g)) {
        genreOverride = g as CanonicalGenreName;
      }
    } else if (arg === '--artifacts' && i + 1 < argv.length) {
      artifactsDir = path.resolve(argv[++i]);
    } else if (arg === '--from-artifacts' && i + 1 < argv.length) {
      fromArtifactsDir = path.resolve(argv[++i]);
    } else if (arg === '--provider' && i + 1 < argv.length) {
      const p = argv[++i];
      providerName = p === 'openai' ? 'openai' : 'mock';
    } else if (arg === '--mock') {
      providerName = 'mock';
    } else if (arg === '--python') {
      usePythonAudio = true;
    } else if (arg === '--no-python') {
      usePythonAudio = false;
    } else if (arg === '--chunk-frames' && i + 1 < argv.length) {
      chunkFrames = Math.max(30, Number.parseInt(argv[++i], 10));
    } else if (arg === '--max-chunks' && i + 1 < argv.length) {
      maxChunks = Math.max(1, Number.parseInt(argv[++i], 10));
    } else if (arg === '--start-frame' && i + 1 < argv.length) {
      startFrame = Math.max(0, Number.parseInt(argv[++i], 10));
    } else if (arg === '--frame-count' && i + 1 < argv.length) {
      frameCount = Math.max(1, Number.parseInt(argv[++i], 10));
    } else if (arg === '--fps' && i + 1 < argv.length) {
      const val = Number.parseInt(argv[++i], 10);
      fps = val === 60 ? 60 : 30;
    } else if (arg === '--resolution' && i + 1 < argv.length) {
      const res = argv[++i].toLowerCase();
      if (res === '720p') {
        width = 1280;
        height = 720;
      } else {
        width = 1920;
        height = 1080;
      }
    } else if (arg === '--threads' && i + 1 < argv.length) {
      threads = Math.max(1, Number.parseInt(argv[++i], 10));
    } else if (arg === '--no-resume') {
      resume = false;
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg === '--no-lyrics-in-prompt') {
      noLyricsInPrompt = true;
    } else if (arg === '--bitrate' && i + 1 < argv.length) {
      bitrateKbps = Number.parseInt(argv[++i], 10) || 256;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: npm run studio -- [options]

Canonical studio CLI for song-driven animated video generation.

Options:
  --audio <file>           Path to master song file (.wav, .flac, .mp3)
  --lrc <file>             Path to synchronized lyrics file (.lrc)
  --out <file>             Target path for stitched MP4 output
  --produce                Run full production mode (defaults output to trashed_and_scattered_final.mp4)
  --theatrical             Enable Theatrical Narrative 2.5D discrete stage cinema
  --runner                 Use continuous infinite parallax runner mode (default)
  --mode <theatrical|runner> Staging mode (default: runner)
  --genre <name>           Directing genre override ('POP'|'BALLAD'|'ROCK'|'METAL'|'ELECTRONIC'|'ACOUSTIC')
  --artifacts <dir>        Directory to store intermediate artifacts
  --from-artifacts <dir>   Render directly from previously synthesized artifacts (skips LLM)
  --provider <name>        LLM backend provider: 'mock' or 'openai' (default: 'mock')
  --chunk-frames <num>     Number of frames per rendered chunk (default: 1500)
  --max-chunks <num>       Maximum number of chunks to render (useful for quick previews)
  --start-frame <num>      Initial timeline frame index to start rendering from (default: 0)
  --frame-count <num>      Total number of frames to render from start-frame
  --fps <30|60>            Output video framerate (default: 30)
  --resolution <1080p|720p> Output resolution (default: 1080p)
  --threads <num>          Encoding threads for FFmpeg (default: 2)
  --python / --no-python   Use Python audio analyzer instead of TypeScript (default: --no-python)
  --resume / --no-resume   Resume rendering using valid existing chunk files (default: enabled)
  --no-lyrics-in-prompt    Omit lyric text from LLM prompts (timestamps are preserved)
  --bitrate <kbps>         Master continuous audio AAC bitrate in kbps (default: 256)
  --help, -h               Show this help message and exit
`);
      process.exit(0);
    }
  }

  // Resolve sample fixture audio if not explicitly provided
  const defaultFlac = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.flac');
  const defaultLrc = path.resolve(process.cwd(), 'assets/audio/trashed-and-scattered.lrc');
  if (!audioPath && fs.existsSync(defaultFlac)) {
    audioPath = defaultFlac;
    if (!lrcPath && fs.existsSync(defaultLrc)) {
      lrcPath = defaultLrc;
    }
  }

  // Resolve default output path if not specified
  if (!outputPath) {
    if (isProduceMode) {
      const baseName = audioPath ? path.basename(audioPath, path.extname(audioPath)) : 'production';
      outputPath = path.join(OUTPUT_DIR, `${baseName}_final.mp4`);
    } else {
      outputPath = path.join(OUTPUT_DIR, 'studio-render.mp4');
    }
  }

  return {
    ...(audioPath ? { audioPath } : {}),
    ...(lrcPath ? { lrcPath } : {}),
    outputPath,
    ...(artifactsDir ? { artifactsDir } : {}),
    ...(fromArtifactsDir ? { fromArtifactsDir } : {}),
    providerName,
    usePythonAudio,
    chunkFrames,
    ...(maxChunks !== undefined ? { maxChunks } : {}),
    ...(startFrame !== undefined ? { startFrame } : {}),
    ...(frameCount !== undefined ? { frameCount } : {}),
    resume,
    bitrateKbps,
    width,
    height,
    fps,
    threads,
    stagingMode,
    ...(genreOverride ? { genreOverride } : {}),
    noLyricsInPrompt,
    isProduceMode
  };
}

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('       AUTONOMOUS AI AGENT ANIMATION STUDIO PRODUCTION CLI       ');
  console.log('================================================================');

  const cli = parseCliArgs(process.argv.slice(2));

  await runProductionPipeline({
    ...cli,
    useSpecPipeline: true
  });
}

main().catch((err) => {
  console.error('\nProduction Pipeline Error:', err);
  process.exit(1);
});
