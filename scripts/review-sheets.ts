import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ShotSequencer } from '../src/engine/director/shot-sequencer.js';
import { computeCameraBasis } from '../src/engine/camera/camera-3d.js';
import { projectToScreen } from '../src/engine/camera/projection.js';
import type { DirectorStoryboardContract, CinematicShot } from '../src/schemas/storyboard.contract.js';
import type { StorySpecContract } from '../src/schemas/story-spec.contract.js';
import type { ChoreographyContract } from '../src/schemas/choreography.contract.js';
import type { AudioAnalysisManifest } from '../src/schemas/audio.contract.js';

const execFileAsync = promisify(execFile);

interface CliOptions {
  videoPath?: string;
  artifactsDir?: string;
  outDir: string;
  maxTotalMb: number;
  startFrame?: number;
}

interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
  fps: number;
  frameCount: number;
  sizeBytes: number;
}

interface CellData {
  cellLabel: string;
  timestamp: string;
  timestampSec: number;
  frameIndex: number;
  sectionId: string;
  shotId: string;
  theatricalSet: string;
  interactionBehavior: string;
  leadClip: string;
  partnerClip: string;
  props: string;
  framingMovement: string;
  tone: string;
  lyricLine: string;
  yavg: number;
  flaggedLowLuminance?: boolean;
}

interface DeliverableMeta {
  filename: string;
  title: string;
  width: number;
  height: number;
  sizeBytes: number;
  cells: CellData[];
}

function parseCliArgs(argv: string[]): CliOptions {
  let videoPath: string | undefined;
  let artifactsDir: string | undefined;
  let outDir = path.resolve(process.cwd(), 'output/review');
  let maxTotalMb = 12;
  let startFrame: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--video' || arg === '-v') {
      videoPath = argv[++i];
    } else if (arg.startsWith('--video=')) {
      videoPath = arg.slice('--video='.length);
    } else if (arg === '--artifacts' || arg === '-a') {
      artifactsDir = argv[++i];
    } else if (arg.startsWith('--artifacts=')) {
      artifactsDir = arg.slice('--artifacts='.length);
    } else if (arg === '--out' || arg === '-o') {
      outDir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg.startsWith('--out=')) {
      outDir = path.resolve(process.cwd(), arg.slice('--out='.length));
    } else if (arg === '--max-total-mb' || arg === '-m') {
      maxTotalMb = parseFloat(argv[++i]);
    } else if (arg.startsWith('--max-total-mb=')) {
      maxTotalMb = parseFloat(arg.slice('--max-total-mb='.length));
    } else if (arg === '--start-frame') {
      startFrame = parseInt(argv[++i], 10);
    } else if (arg.startsWith('--start-frame=')) {
      startFrame = parseInt(arg.slice('--start-frame='.length), 10);
    }
  }

  return { videoPath, artifactsDir, outDir, maxTotalMb, ...(startFrame !== undefined ? { startFrame } : {}) };
}

function detectStartOffset(videoPath: string, cliStartFrame?: number): number {
  if (cliStartFrame !== undefined && !Number.isNaN(cliStartFrame)) {
    return cliStartFrame;
  }
  const videoDir = path.dirname(videoPath);
  const chunksBase = path.join(videoDir, 'chunks');
  if (fs.existsSync(chunksBase)) {
    const walk = [chunksBase];
    while (walk.length > 0) {
      const cur = walk.pop()!;
      try {
        const entries = fs.readdirSync(cur, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(cur, e.name);
          if (e.isDirectory()) {
            walk.push(full);
          } else if (e.name.endsWith('.meta.json')) {
            const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
            if (typeof data.startFrame === 'number') {
              return data.startFrame;
            }
          }
        }
      } catch {}
    }
  }
  return 0;
}

function resolveVideoPath(specified?: string): string {
  if (specified) {
    const abs = path.resolve(process.cwd(), specified);
    if (!fs.existsSync(abs)) {
      throw new Error(`Specified video does not exist: ${abs}`);
    }
    return abs;
  }

  const outputDir = path.resolve(process.cwd(), 'output');
  if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir);
    const finals = files
      .filter(f => f.endsWith('_final.mp4'))
      .map(f => ({ name: f, full: path.join(outputDir, f), mtime: fs.statSync(path.join(outputDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (finals.length > 0) return finals[0].full;

    const anyMp4 = files
      .filter(f => f.endsWith('.mp4') && !f.includes('conformance'))
      .map(f => ({ name: f, full: path.join(outputDir, f), mtime: fs.statSync(path.join(outputDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (anyMp4.length > 0) return anyMp4[0].full;
  }

  const chunksDir = path.resolve(process.cwd(), 'output/chunks');
  if (fs.existsSync(chunksDir)) {
    const chunkFiles = fs.readdirSync(chunksDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => ({ full: path.join(chunksDir, f), mtime: fs.statSync(path.join(chunksDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (chunkFiles.length > 0) return chunkFiles[0].full;
  }

  throw new Error('No video found in output/ or output/chunks/');
}

function resolveArtifactsDir(specified?: string): string {
  if (specified) {
    const abs = path.resolve(process.cwd(), specified);
    if (!fs.existsSync(abs)) {
      throw new Error(`Specified artifacts dir does not exist: ${abs}`);
    }
    return abs;
  }

  const rootArtifacts = path.resolve(process.cwd(), 'output/artifacts');
  if (!fs.existsSync(rootArtifacts)) {
    throw new Error(`Artifacts directory not found: ${rootArtifacts}`);
  }

  const subdirs = fs.readdirSync(rootArtifacts)
    .map(name => path.join(rootArtifacts, name))
    .filter(full => fs.statSync(full).isDirectory())
    .map(full => ({ full, mtime: fs.statSync(full).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (subdirs.length === 0) {
    throw new Error(`No artifact run subdirectories found in ${rootArtifacts}`);
  }

  return subdirs[0].full;
}

async function probeVideo(videoPath: string): Promise<VideoMetadata> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,size',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_frames',
    '-of', 'json',
    videoPath
  ]);

  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.find((s: any) => s.width && s.height);
  if (!stream) {
    throw new Error(`ffprobe could not find video stream in ${videoPath}`);
  }

  const [num, den] = (stream.r_frame_rate || '30/1').split('/').map(Number);
  const fps = den ? num / den : 30;
  const duration = parseFloat(parsed.format?.duration || '0');
  const frameCount = parseInt(stream.nb_frames || '0', 10) || Math.round(duration * fps);
  const sizeBytes = parseInt(parsed.format?.size || '0', 10);

  return {
    width: stream.width,
    height: stream.height,
    duration,
    fps,
    frameCount,
    sizeBytes
  };
}

function formatMmSs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

function getPropsSummary(storySpec: StorySpecContract, sectionId: string): string {
  const cast = storySpec.cast || [];
  const propsSet = new Set<string>();
  for (const c of cast) {
    if (c.accessories) {
      for (const a of c.accessories) propsSet.add(a);
    }
  }
  const sec = storySpec.sections.find(s => s.sectionId === sectionId);
  if (sec?.castDirectives) {
    for (const d of sec.castDirectives) {
      const anyD = d as any;
      if (anyD.accessories) for (const a of anyD.accessories) propsSet.add(a);
      if (anyD.props) for (const p of anyD.props) propsSet.add(p);
      if (anyD.propId) propsSet.add(anyD.propId);
    }
  }
  return propsSet.size > 0 ? Array.from(propsSet).join(', ') : 'none';
}

function buildCellData(
  frameIndex: number,
  fps: number,
  storyboard: DirectorStoryboardContract,
  storySpec: StorySpecContract,
  choreography: ChoreographyContract,
  audioManifest: AudioAnalysisManifest,
  cellLabel: string
): Omit<CellData, 'yavg' | 'flaggedLowLuminance'> {
  const timestampSec = frameIndex / fps;
  const timestamp = formatMmSs(timestampSec);

  let shot: CinematicShot | undefined;
  for (const s of storyboard.shots) {
    if (frameIndex >= s.frameRange.startFrameInclusive && frameIndex < s.frameRange.endFrameExclusive) {
      shot = s;
      break;
    }
  }
  if (!shot) {
    shot = storyboard.shots[storyboard.shots.length - 1];
  }

  const shotId = shot ? shot.id : 'unknown';
  const framingMovement = shot ? `${shot.framing} / ${shot.movement}` : 'unknown';

  let section = storySpec.sections.find(
    s => frameIndex >= s.startFrame && frameIndex < s.endFrame
  );
  if (!section && shot) {
    const sStart = shot.frameRange.startFrameInclusive;
    section = storySpec.sections.find(
      s => sStart >= s.startFrame && sStart < s.endFrame
    );
  }

  const sectionId = section ? section.sectionId : 'unknown';
  const theatricalSet = (shot && shot.theatricalSetId) || (section && section.theatricalSetId) || 'unknown';
  const interactionBehavior = section?.interactionBehavior || 'SOLO';
  const tone = section ? section.emotionalTone : 'unknown';

  let leadClip = 'unknown';
  let partnerClip = 'none';

  if (shot) {
    const leadTrack = choreography.tracks.find(t => t.shotId === shot.id && t.rigId === 'protagonist_lead');
    if (leadTrack?.pose?.clipId) {
      leadClip = leadTrack.pose.clipId;
    }
    const partnerTrack = choreography.tracks.find(t => t.shotId === shot.id && t.rigId === 'narrative_partner');
    if (partnerTrack?.pose?.clipId) {
      partnerClip = partnerTrack.pose.clipId;
    }
  }

  const props = getPropsSummary(storySpec, sectionId);

  let lyricLine = '—';
  if (audioManifest.lyrics) {
    const l = audioManifest.lyrics.find(
      item => frameIndex >= item.frameRange.startFrameInclusive && frameIndex < item.frameRange.endFrameExclusive
    );
    if (l) {
      lyricLine = l.text;
    }
  }

  return {
    cellLabel,
    timestamp,
    timestampSec,
    frameIndex,
    sectionId,
    shotId,
    theatricalSet,
    interactionBehavior,
    leadClip,
    partnerClip,
    props,
    framingMovement,
    tone,
    lyricLine
  };
}

async function getLuminance(imagePath: string): Promise<number> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i', imagePath,
      '-vf', 'signalstats',
      '-f', 'null',
      '-'
    ]);
    const match = stderr.match(/YAVG=([0-9.]+)/);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    return Number.isFinite(val) ? val : 0;
  } catch {
    return 0;
  }
}

async function extractFrame(
  videoPath: string,
  videoFrameIndex: number,
  fps: number,
  outPath: string
): Promise<{ yavg: number; lowLuminance: boolean }> {
  const clampedVideoFrame = Math.max(0, videoFrameIndex);
  const timestamp = clampedVideoFrame / fps;
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', timestamp.toFixed(4),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '4',
    outPath
  ]);
  const yavg = await getLuminance(outPath);
  return { yavg, lowLuminance: yavg < 5.0 };
}

async function enforceImageLimit(filePath: string, maxBytes: number): Promise<boolean> {
  let stats = fs.statSync(filePath);
  if (stats.size <= maxBytes) return false;

  let downscaled = false;
  let qv = 6;
  while (stats.size > maxBytes && qv <= 12) {
    downscaled = true;
    const tmpOut = filePath + '.tmp.jpg';
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', filePath,
      '-q:v', qv.toString(),
      tmpOut
    ]);
    fs.renameSync(tmpOut, filePath);
    stats = fs.statSync(filePath);
    qv += 2;
  }
  return downscaled;
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const videoPath = resolveVideoPath(cli.videoPath);
  const artifactsDir = resolveArtifactsDir(cli.artifactsDir);
  const outDir = cli.outDir;

  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Video file: ${videoPath}`);
  console.log(`Artifacts directory: ${artifactsDir}`);
  console.log(`Output directory: ${outDir}`);

  const meta = await probeVideo(videoPath);
  console.log(`Video metadata: ${meta.width}x${meta.height} @ ${meta.fps} fps, duration ${meta.duration.toFixed(2)}s, ${meta.frameCount} frames, ${(meta.sizeBytes / (1024 * 1024)).toFixed(2)} MB`);

  const fontPath = path.resolve(process.cwd(), 'src/assets/fonts/DejaVuSans.ttf');
  if (!fs.existsSync(fontPath)) {
    throw new Error(`Required font not found at ${fontPath}`);
  }

  // Load artifact JSONs
  const storyboard: DirectorStoryboardContract = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'storyboard.json'), 'utf-8')
  );
  const storySpec: StorySpecContract = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'story-spec.json'), 'utf-8')
  );
  const choreography: ChoreographyContract = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'choreography.json'), 'utf-8')
  );
  const audioManifest: AudioAnalysisManifest = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'audio-manifest.json'), 'utf-8')
  );

  const startOffset = detectStartOffset(videoPath, cli.startFrame);
  const endOffset = startOffset + meta.frameCount;
  console.log(`Video timeline slice: [${startOffset} .. ${endOffset}) frames (offset: ${startOffset})`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-sheets-'));
  const deliverables: DeliverableMeta[] = [];
  const downscalingLog: string[] = [];
  const lowLuminanceLog: string[] = [];

  const activeShots = storyboard.shots.filter(
    s => s.frameRange.endFrameExclusive > startOffset && s.frameRange.startFrameInclusive < endOffset
  );
  const shotPool = activeShots.length > 0 ? activeShots : storyboard.shots;

  try {
    // -------------------------------------------------------------------------
    // 1. 01_overview.jpg
    // -------------------------------------------------------------------------
    console.log('[1/9] Generating 01_overview.jpg...');
    const overviewCellsCount = 24;
    const intervalSec = meta.duration > 0 ? (meta.duration - 0.2) / (overviewCellsCount - 1) : 0;
    const overviewCells: CellData[] = [];
    const overviewInputs: string[] = [];
    const overviewLayout: string[] = [];
    const filterParts01: string[] = [];

    const cols01 = 4;
    const cellW01 = 480;
    const cellH01 = 270;

    for (let i = 0; i < overviewCellsCount; i++) {
      const tSec = Math.min(meta.duration - 0.2, i * intervalSec);
      const videoFrameIndex = Math.min(meta.frameCount - 1, Math.round(tSec * meta.fps));
      const songFrameIndex = startOffset + videoFrameIndex;
      const cellRaw = buildCellData(
        songFrameIndex,
        meta.fps,
        storyboard,
        storySpec,
        choreography,
        audioManifest,
        `Cell ${i + 1}`
      );

      const frameImgPath = path.join(tempDir, `ov_raw_${i}.jpg`);
      const { yavg, lowLuminance } = await extractFrame(videoPath, videoFrameIndex, meta.fps, frameImgPath);
      if (lowLuminance) lowLuminanceLog.push(`01_overview.jpg cell ${i + 1} (F:${songFrameIndex}) low luminance: YAVG=${yavg.toFixed(2)}`);

      const cellMeta: CellData = { ...cellRaw, yavg, flaggedLowLuminance: lowLuminance };
      overviewCells.push(cellMeta);

      const lblFile = path.join(tempDir, `ov_lbl_${i}.txt`);
      fs.writeFileSync(lblFile, `${cellMeta.timestamp}  ${cellMeta.sectionId}`);

      overviewInputs.push('-i', frameImgPath);
      filterParts01.push(
        `[${i}:v]scale=${cellW01}:${cellH01},drawtext=fontfile=${fontPath}:textfile=${lblFile}:fontcolor=white:fontsize=16:box=1:boxcolor=black@0.75:x=10:y=10[v${i}]`
      );

      const col = i % cols01;
      const row = Math.floor(i / cols01);
      overviewLayout.push(`${col * cellW01}_${row * cellH01}`);
    }

    const vInputs01 = overviewCells.map((_, i) => `[v${i}]`).join('');
    const filterComplex01 = `${filterParts01.join(';')};${vInputs01}xstack=inputs=${overviewCellsCount}:layout=${overviewLayout.join('|')}`;
    const out01 = path.join(outDir, '01_overview.jpg');

    await execFileAsync('ffmpeg', [
      '-y',
      ...overviewInputs,
      '-filter_complex', filterComplex01,
      '-frames:v', '1',
      '-q:v', '4',
      out01
    ]);

    let size01 = fs.statSync(out01).size;
    if (await enforceImageLimit(out01, 1.5 * 1024 * 1024)) {
      downscalingLog.push('01_overview.jpg exceeded 1.5 MB and was re-encoded at lower quality');
      size01 = fs.statSync(out01).size;
    }
    deliverables.push({
      filename: '01_overview.jpg',
      title: 'Full Video Overview Grid (24 Cells)',
      width: cols01 * cellW01,
      height: Math.ceil(overviewCellsCount / cols01) * cellH01,
      sizeBytes: size01,
      cells: overviewCells
    });

    // -------------------------------------------------------------------------
    // 2. 02_sections.jpg
    // -------------------------------------------------------------------------
    console.log('[2/9] Generating 02_sections.jpg...');
    let targetSections = storySpec.sections.filter(
      s => s.endFrame > startOffset && s.startFrame < endOffset
    );
    if (targetSections.length === 0) {
      targetSections = [storySpec.sections[0]];
    }

    const secCells: CellData[] = [];
    const rowPaths02: string[] = [];

    const cellW02 = 384;
    const cellH02 = 216;

    for (let sIdx = 0; sIdx < targetSections.length; sIdx++) {
      const s = targetSections[sIdx];
      const sVisStart = Math.max(startOffset, s.startFrame);
      const sVisEnd = Math.min(endOffset, s.endFrame);
      const f25Song = Math.floor(sVisStart + 0.25 * (sVisEnd - sVisStart));
      const f75Song = Math.floor(sVisStart + 0.75 * (sVisEnd - sVisStart));

      const f25Video = Math.max(0, Math.min(meta.frameCount - 1, f25Song - startOffset));
      const f75Video = Math.max(0, Math.min(meta.frameCount - 1, f75Song - startOffset));

      const cell25Raw = buildCellData(f25Song, meta.fps, storyboard, storySpec, choreography, audioManifest, `${s.sectionId} [25%]`);
      const cell75Raw = buildCellData(f75Song, meta.fps, storyboard, storySpec, choreography, audioManifest, `${s.sectionId} [75%]`);

      const img25 = path.join(tempDir, `sec_${s.sectionId}_25.jpg`);
      const img75 = path.join(tempDir, `sec_${s.sectionId}_75.jpg`);

      const res25 = await extractFrame(videoPath, f25Video, meta.fps, img25);
      const res75 = await extractFrame(videoPath, f75Video, meta.fps, img75);

      if (res25.lowLuminance) lowLuminanceLog.push(`02_sections.jpg ${s.sectionId} 25% (F:${f25Song}) low luminance`);
      if (res75.lowLuminance) lowLuminanceLog.push(`02_sections.jpg ${s.sectionId} 75% (F:${f75Song}) low luminance`);

      secCells.push({ ...cell25Raw, yavg: res25.yavg, flaggedLowLuminance: res25.lowLuminance });
      secCells.push({ ...cell75Raw, yavg: res75.yavg, flaggedLowLuminance: res75.lowLuminance });

      // First lyric line of section
      const firstLyric = audioManifest.lyrics?.find(
        l => l.frameRange.startFrameInclusive >= s.startFrame && l.frameRange.startFrameInclusive < s.endFrame
      )?.text || '—';

      const line1 = `[${s.sectionId}] ${formatMmSs(s.startFrame / meta.fps)}-${formatMmSs(s.endFrame / meta.fps)} | Set: ${s.theatricalSetId} | Beh: ${s.interactionBehavior} | Lead: ${cell25Raw.leadClip} | Partner: ${cell25Raw.partnerClip} | Props: ${cell25Raw.props}`;
      const line2 = `Lyric: "${truncate(firstLyric, 50)}"`;

      const t1Path = path.join(tempDir, `sec_t1_${sIdx}.txt`);
      const t2Path = path.join(tempDir, `sec_t2_${sIdx}.txt`);
      const lbl25Path = path.join(tempDir, `sec_l25_${sIdx}.txt`);
      const lbl75Path = path.join(tempDir, `sec_l75_${sIdx}.txt`);

      fs.writeFileSync(t1Path, line1);
      fs.writeFileSync(t2Path, line2);
      fs.writeFileSync(lbl25Path, '25%');
      fs.writeFileSync(lbl75Path, '75%');

      const rowOut = path.join(tempDir, `sec_row_${sIdx}.jpg`);
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', img25,
        '-i', img75,
        '-filter_complex',
        `[0:v]scale=${cellW02}:${cellH02},drawtext=fontfile=${fontPath}:textfile=${lbl25Path}:fontcolor=yellow:fontsize=12:box=1:boxcolor=black@0.7:x=w-tw-8:y=h-th-8[left];` +
        `[1:v]scale=${cellW02}:${cellH02},drawtext=fontfile=${fontPath}:textfile=${lbl75Path}:fontcolor=yellow:fontsize=12:box=1:boxcolor=black@0.7:x=w-tw-8:y=h-th-8[right];` +
        `[left][right]hstack=inputs=2,` +
        `drawtext=fontfile=${fontPath}:textfile=${t1Path}:fontcolor=white:fontsize=11:box=1:boxcolor=black@0.85:x=8:y=6,` +
        `drawtext=fontfile=${fontPath}:textfile=${t2Path}:fontcolor=white:fontsize=11:box=1:boxcolor=black@0.85:x=8:y=20`,
        '-frames:v', '1',
        '-q:v', '4',
        rowOut
      ]);
      rowPaths02.push(rowOut);
    }

    const out02 = path.join(outDir, '02_sections.jpg');
    if (rowPaths02.length === 1) {
      await execFileAsync('ffmpeg', ['-y', '-i', rowPaths02[0], '-q:v', '4', out02]);
    } else {
      const vstackInputs02: string[] = [];
      for (const r of rowPaths02) vstackInputs02.push('-i', r);
      await execFileAsync('ffmpeg', [
        '-y',
        ...vstackInputs02,
        '-filter_complex', `vstack=inputs=${rowPaths02.length}`,
        '-frames:v', '1',
        '-q:v', '4',
        out02
      ]);
    }

    let size02 = fs.statSync(out02).size;
    if (await enforceImageLimit(out02, 1.5 * 1024 * 1024)) {
      downscalingLog.push('02_sections.jpg exceeded 1.5 MB and was re-encoded at lower quality');
      size02 = fs.statSync(out02).size;
    }
    deliverables.push({
      filename: '02_sections.jpg',
      title: `Section Progression Sheet (${targetSections.length} sections, 25% and 75% frames)`,
      width: cellW02 * 2,
      height: cellH02 * targetSections.length,
      sizeBytes: size02,
      cells: secCells
    });

    // -------------------------------------------------------------------------
    // 3. 03_full_wide.jpg
    // -------------------------------------------------------------------------
    console.log('[3/9] Generating 03_full_wide.jpg...');
    const wideShot = shotPool.find(s => s.framing === 'WIDE' || s.framing === 'EXTREME_WIDE') || shotPool[0];
    const wideVisStart = Math.max(startOffset, wideShot.frameRange.startFrameInclusive);
    const wideVisEnd = Math.min(endOffset, wideShot.frameRange.endFrameExclusive);
    const wideSongFrame = Math.floor((wideVisStart + wideVisEnd) / 2);
    const wideVideoFrame = Math.max(0, Math.min(meta.frameCount - 1, wideSongFrame - startOffset));
    const wideCellRaw = buildCellData(wideSongFrame, meta.fps, storyboard, storySpec, choreography, audioManifest, 'Wide Shot Frame');

    const wideRaw = path.join(tempDir, 'wide_raw.jpg');
    const resWide = await extractFrame(videoPath, wideVideoFrame, meta.fps, wideRaw);
    if (resWide.lowLuminance) lowLuminanceLog.push(`03_full_wide.jpg (F:${wideSongFrame}) low luminance`);

    const wideCell: CellData = { ...wideCellRaw, yavg: resWide.yavg, flaggedLowLuminance: resWide.lowLuminance };
    const wideLblPath = path.join(tempDir, 'wide_lbl.txt');
    fs.writeFileSync(wideLblPath, `${wideCell.timestamp} | ${wideCell.sectionId} | ${wideShot.id} | ${wideShot.framing}`);

    const out03 = path.join(outDir, '03_full_wide.jpg');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', wideRaw,
      '-vf', `drawtext=fontfile=${fontPath}:textfile=${wideLblPath}:fontcolor=white:fontsize=18:box=1:boxcolor=black@0.75:x=24:y=h-th-24`,
      '-frames:v', '1',
      '-q:v', '4',
      out03
    ]);

    let size03 = fs.statSync(out03).size;
    if (await enforceImageLimit(out03, 1.5 * 1024 * 1024)) {
      downscalingLog.push('03_full_wide.jpg exceeded 1.5 MB and was re-encoded');
      size03 = fs.statSync(out03).size;
    }
    deliverables.push({
      filename: '03_full_wide.jpg',
      title: 'Full Native Resolution WIDE Shot',
      width: meta.width,
      height: meta.height,
      sizeBytes: size03,
      cells: [wideCell]
    });

    // -------------------------------------------------------------------------
    // 4. 04_full_medium.jpg
    // -------------------------------------------------------------------------
    console.log('[4/9] Generating 04_full_medium.jpg...');
    const medShot = shotPool.find(s => s.framing === 'MEDIUM') || shotPool[Math.min(1, shotPool.length - 1)];
    const medVisStart = Math.max(startOffset, medShot.frameRange.startFrameInclusive);
    const medVisEnd = Math.min(endOffset, medShot.frameRange.endFrameExclusive);
    const medSongFrame = Math.floor((medVisStart + medVisEnd) / 2);
    const medVideoFrame = Math.max(0, Math.min(meta.frameCount - 1, medSongFrame - startOffset));
    const medCellRaw = buildCellData(medSongFrame, meta.fps, storyboard, storySpec, choreography, audioManifest, 'Medium Shot Frame');

    const medRaw = path.join(tempDir, 'med_raw.jpg');
    const resMed = await extractFrame(videoPath, medVideoFrame, meta.fps, medRaw);
    if (resMed.lowLuminance) lowLuminanceLog.push(`04_full_medium.jpg (F:${medSongFrame}) low luminance`);

    const medCell: CellData = { ...medCellRaw, yavg: resMed.yavg, flaggedLowLuminance: resMed.lowLuminance };
    const medLblPath = path.join(tempDir, 'med_lbl.txt');
    fs.writeFileSync(medLblPath, `${medCell.timestamp} | ${medCell.sectionId} | ${medShot.id} | ${medShot.framing}`);

    const out04 = path.join(outDir, '04_full_medium.jpg');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', medRaw,
      '-vf', `drawtext=fontfile=${fontPath}:textfile=${medLblPath}:fontcolor=white:fontsize=18:box=1:boxcolor=black@0.75:x=24:y=h-th-24`,
      '-frames:v', '1',
      '-q:v', '4',
      out04
    ]);

    let size04 = fs.statSync(out04).size;
    if (await enforceImageLimit(out04, 1.5 * 1024 * 1024)) {
      downscalingLog.push('04_full_medium.jpg exceeded 1.5 MB and was re-encoded');
      size04 = fs.statSync(out04).size;
    }
    deliverables.push({
      filename: '04_full_medium.jpg',
      title: 'Full Native Resolution MEDIUM Shot',
      width: meta.width,
      height: meta.height,
      sizeBytes: size04,
      cells: [medCell]
    });

    // -------------------------------------------------------------------------
    // 5. 05_full_closeup.jpg
    // -------------------------------------------------------------------------
    console.log('[5/9] Generating 05_full_closeup.jpg...');
    const cuShot = shotPool.find(s => s.framing === 'CLOSE_UP') || shotPool[Math.min(2, shotPool.length - 1)];
    const cuVisStart = Math.max(startOffset, cuShot.frameRange.startFrameInclusive);
    const cuVisEnd = Math.min(endOffset, cuShot.frameRange.endFrameExclusive);
    const cuSongFrame = Math.floor((cuVisStart + cuVisEnd) / 2);
    const cuVideoFrame = Math.max(0, Math.min(meta.frameCount - 1, cuSongFrame - startOffset));
    const cuCellRaw = buildCellData(cuSongFrame, meta.fps, storyboard, storySpec, choreography, audioManifest, 'Close-Up Shot Frame');

    const cuRaw = path.join(tempDir, 'cu_raw.jpg');
    const resCu = await extractFrame(videoPath, cuVideoFrame, meta.fps, cuRaw);
    if (resCu.lowLuminance) lowLuminanceLog.push(`05_full_closeup.jpg (F:${cuSongFrame}) low luminance`);

    const cuCell: CellData = { ...cuCellRaw, yavg: resCu.yavg, flaggedLowLuminance: resCu.lowLuminance };
    const cuLblPath = path.join(tempDir, 'cu_lbl.txt');
    fs.writeFileSync(cuLblPath, `${cuCell.timestamp} | ${cuCell.sectionId} | ${cuShot.id} | ${cuShot.framing}`);

    const out05 = path.join(outDir, '05_full_closeup.jpg');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', cuRaw,
      '-vf', `drawtext=fontfile=${fontPath}:textfile=${cuLblPath}:fontcolor=white:fontsize=18:box=1:boxcolor=black@0.75:x=24:y=h-th-24`,
      '-frames:v', '1',
      '-q:v', '4',
      out05
    ]);

    let size05 = fs.statSync(out05).size;
    if (await enforceImageLimit(out05, 1.5 * 1024 * 1024)) {
      downscalingLog.push('05_full_closeup.jpg exceeded 1.5 MB and was re-encoded');
      size05 = fs.statSync(out05).size;
    }
    deliverables.push({
      filename: '05_full_closeup.jpg',
      title: 'Full Native Resolution CLOSE_UP Shot',
      width: meta.width,
      height: meta.height,
      sizeBytes: size05,
      cells: [cuCell]
    });

    // -------------------------------------------------------------------------
    // 6. 06_lead_crop.jpg
    // -------------------------------------------------------------------------
    console.log('[6/9] Generating 06_lead_crop.jpg...');
    const leadShot = shotPool.find(s => s.framing === 'CLOSE_UP') || shotPool.find(s => s.framing === 'MEDIUM') || shotPool[0];
    const leadVisStart = Math.max(startOffset, leadShot.frameRange.startFrameInclusive);
    const leadVisEnd = Math.min(endOffset, leadShot.frameRange.endFrameExclusive);
    const leadCropFrame = Math.floor((leadVisStart + leadVisEnd) / 2);
    const leadVideoFrame = Math.max(0, Math.min(meta.frameCount - 1, leadCropFrame - startOffset));

    const sequencer = new ShotSequencer(storyboard);
    const shotLookup = sequencer.getShotForFrame(leadCropFrame);
    const cameraAtFrame = sequencer.interpolateCamera(shotLookup.shot, shotLookup.normalizedProgress);
    const cameraBasis = computeCameraBasis(cameraAtFrame);

    const leadTrack = choreography.tracks.find(
      t => t.shotId === shotLookup.shot.id && t.rigId === 'protagonist_lead'
    );

    let leadPos: [number, number, number] = [0, 0, 0];
    if (leadTrack && leadTrack.transform.keyframes.length >= 2) {
      const k0 = leadTrack.transform.keyframes[0];
      const k1 = leadTrack.transform.keyframes[1];
      const t = shotLookup.normalizedProgress;
      leadPos = [
        k0.position[0] + (k1.position[0] - k0.position[0]) * t,
        k0.position[1] + (k1.position[1] - k0.position[1]) * t,
        k0.position[2] + (k1.position[2] - k0.position[2]) * t,
      ];
    }
    const projected = projectToScreen(leadPos, cameraAtFrame, cameraBasis, meta.width, meta.height);

    const cropW = 960;
    const cropH = 540;
    const projX = (projected.visible && Number.isFinite(projected.x)) ? projected.x : meta.width / 2;
    const projY = (projected.visible && Number.isFinite(projected.y)) ? projected.y : meta.height / 2;

    const cropX = Math.max(0, Math.min(meta.width - cropW, Math.round(projX - cropW / 2)));
    const cropY = Math.max(0, Math.min(meta.height - cropH, Math.round(projY - cropH / 2)));

    const leadCellRaw = buildCellData(
      leadCropFrame,
      meta.fps,
      storyboard,
      storySpec,
      choreography,
      audioManifest,
      'Lead Character Design Crop (960x540)'
    );

    const leadFullRaw = path.join(tempDir, 'lead_raw.jpg');
    const resLead = await extractFrame(videoPath, leadVideoFrame, meta.fps, leadFullRaw);
    if (resLead.lowLuminance) lowLuminanceLog.push(`06_lead_crop.jpg (F:${leadCropFrame}) low luminance`);

    const leadCell: CellData = { ...leadCellRaw, yavg: resLead.yavg, flaggedLowLuminance: resLead.lowLuminance };
    const leadLblPath = path.join(tempDir, 'lead_lbl.txt');
    fs.writeFileSync(leadLblPath, `Lead Character Crop | Frame ${leadCropFrame} (${leadCell.timestamp}) | ${shotLookup.shot.id} (${shotLookup.shot.framing})`);

    const out06 = path.join(outDir, '06_lead_crop.jpg');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', leadFullRaw,
      '-filter_complex',
      `crop=${cropW}:${cropH}:${cropX}:${cropY},drawtext=fontfile=${fontPath}:textfile=${leadLblPath}:fontcolor=white:fontsize=15:box=1:boxcolor=black@0.75:x=16:y=16`,
      '-frames:v', '1',
      '-q:v', '4',
      out06
    ]);

    let size06 = fs.statSync(out06).size;
    if (await enforceImageLimit(out06, 1.5 * 1024 * 1024)) {
      downscalingLog.push('06_lead_crop.jpg exceeded 1.5 MB and was re-encoded');
      size06 = fs.statSync(out06).size;
    }
    deliverables.push({
      filename: '06_lead_crop.jpg',
      title: 'Native-Resolution Crop Around Lead Character (960x540)',
      width: cropW,
      height: cropH,
      sizeBytes: size06,
      cells: [leadCell]
    });

    // -------------------------------------------------------------------------
    // 7. 07_motion_strip.jpg
    // -------------------------------------------------------------------------
    console.log('[7/9] Generating 07_motion_strip.jpg...');
    const motionShot = shotPool.find(s => {
      const tr = choreography.tracks.find(t => t.shotId === s.id && t.rigId === 'protagonist_lead');
      const clip = tr?.pose?.clipId || '';
      return clip.includes('stalk') || clip.includes('walk') || clip.includes('sprint') || clip.includes('run');
    }) || shotPool[0];

    const motionVisStart = Math.max(startOffset, motionShot.frameRange.startFrameInclusive);
    const motionVisEnd = Math.min(endOffset, motionShot.frameRange.endFrameExclusive);
    const motionSpan = motionVisEnd - motionVisStart;
    const motionStartFrame = Math.max(
      startOffset,
      Math.min(endOffset - 22, motionVisStart + Math.max(0, Math.floor((motionSpan - 24) / 2)))
    );

    const motionCells: CellData[] = [];
    const motionInputs: string[] = [];
    const filterParts07: string[] = [];
    const motionCols = 4;
    const cellW07 = 480;
    const cellH07 = 270;

    for (let i = 0; i < 8; i++) {
      const fSong = motionStartFrame + i * 3;
      const fVideo = Math.max(0, Math.min(meta.frameCount - 1, fSong - startOffset));
      const cellRaw = buildCellData(fSong, meta.fps, storyboard, storySpec, choreography, audioManifest, `Motion Frame ${i + 1}`);
      const rawImg = path.join(tempDir, `motion_raw_${i}.jpg`);
      const { yavg, lowLuminance } = await extractFrame(videoPath, fVideo, meta.fps, rawImg);
      if (lowLuminance) lowLuminanceLog.push(`07_motion_strip.jpg frame ${fSong} low luminance`);

      const cData: CellData = { ...cellRaw, yavg, flaggedLowLuminance: lowLuminance };
      motionCells.push(cData);

      const lbl = path.join(tempDir, `motion_lbl_${i}.txt`);
      fs.writeFileSync(lbl, `F: ${fSong} (${cData.timestamp}) | ${cData.leadClip}`);

      motionInputs.push('-i', rawImg);
      filterParts07.push(
        `[${i}:v]scale=${cellW07}:${cellH07},drawtext=fontfile=${fontPath}:textfile=${lbl}:fontcolor=white:fontsize=14:box=1:boxcolor=black@0.75:x=8:y=8[v${i}]`
      );
    }

    const motionLayout = [
      '0_0', '480_0', '960_0', '1440_0',
      '0_270', '480_270', '960_270', '1440_270'
    ];
    const vInputs07 = motionCells.map((_, i) => `[v${i}]`).join('');
    const filterComplex07 = `${filterParts07.join(';')};${vInputs07}xstack=inputs=8:layout=${motionLayout.join('|')}`;
    const out07 = path.join(outDir, '07_motion_strip.jpg');

    await execFileAsync('ffmpeg', [
      '-y',
      ...motionInputs,
      '-filter_complex', filterComplex07,
      '-frames:v', '1',
      '-q:v', '4',
      out07
    ]);

    let size07 = fs.statSync(out07).size;
    if (await enforceImageLimit(out07, 1.5 * 1024 * 1024)) {
      downscalingLog.push('07_motion_strip.jpg exceeded 1.5 MB and was re-encoded');
      size07 = fs.statSync(out07).size;
    }
    deliverables.push({
      filename: '07_motion_strip.jpg',
      title: 'Locomotion Strip (8 frames, step 3)',
      width: motionCols * cellW07,
      height: 2 * cellH07,
      sizeBytes: size07,
      cells: motionCells
    });

    // -------------------------------------------------------------------------
    // 8. 08_lipsync_strip.jpg
    // -------------------------------------------------------------------------
    console.log('[8/9] Generating 08_lipsync_strip.jpg...');
    const candidateLyrics = (audioManifest.lyrics || []).filter(
      l => l.frameRange.endFrameExclusive > startOffset && l.frameRange.startFrameInclusive < endOffset
    );
    let lipsyncStartFrame = startOffset;
    if (candidateLyrics.length > 0) {
      const preferred = candidateLyrics.find(l => {
        const mid = (l.frameRange.startFrameInclusive + l.frameRange.endFrameExclusive) / 2;
        const sh = shotPool.find(s => mid >= s.frameRange.startFrameInclusive && mid < s.frameRange.endFrameExclusive);
        return sh?.framing === 'CLOSE_UP' || sh?.framing === 'MEDIUM';
      }) || candidateLyrics[0];
      const lStart = Math.max(startOffset, preferred.frameRange.startFrameInclusive);
      const lEnd = Math.min(endOffset, preferred.frameRange.endFrameExclusive);
      lipsyncStartFrame = Math.max(startOffset, Math.min(endOffset - 22, lStart + Math.max(0, Math.floor((lEnd - lStart - 24) / 2))));
    } else {
      lipsyncStartFrame = Math.max(startOffset, Math.min(endOffset - 22, shotPool[0].frameRange.startFrameInclusive));
    }

    const lipsyncCells: CellData[] = [];
    const lipsyncInputs: string[] = [];
    const filterParts08: string[] = [];
    const lipsyncCols = 4;
    const cellW08 = 480;
    const cellH08 = 270;

    for (let i = 0; i < 8; i++) {
      const fSong = lipsyncStartFrame + i * 3;
      const fVideo = Math.max(0, Math.min(meta.frameCount - 1, fSong - startOffset));
      const cellRaw = buildCellData(fSong, meta.fps, storyboard, storySpec, choreography, audioManifest, `LipSync Frame ${i + 1}`);
      const rawImg = path.join(tempDir, `lipsync_raw_${i}.jpg`);
      const { yavg, lowLuminance } = await extractFrame(videoPath, fVideo, meta.fps, rawImg);
      if (lowLuminance) lowLuminanceLog.push(`08_lipsync_strip.jpg frame ${fSong} low luminance`);

      const cData: CellData = { ...cellRaw, yavg, flaggedLowLuminance: lowLuminance };
      lipsyncCells.push(cData);

      const lbl = path.join(tempDir, `lipsync_lbl_${i}.txt`);
      fs.writeFileSync(lbl, `F: ${fSong} | "${truncate(cData.lyricLine, 28)}"`);

      lipsyncInputs.push('-i', rawImg);
      filterParts08.push(
        `[${i}:v]scale=${cellW08}:${cellH08},drawtext=fontfile=${fontPath}:textfile=${lbl}:fontcolor=white:fontsize=13:box=1:boxcolor=black@0.75:x=8:y=8[v${i}]`
      );
    }

    const lipsyncLayout = [
      '0_0', '480_0', '960_0', '1440_0',
      '0_270', '480_270', '960_270', '1440_270'
    ];
    const vInputs08 = lipsyncCells.map((_, i) => `[v${i}]`).join('');
    const filterComplex08 = `${filterParts08.join(';')};${vInputs08}xstack=inputs=8:layout=${lipsyncLayout.join('|')}`;
    const out08 = path.join(outDir, '08_lipsync_strip.jpg');

    await execFileAsync('ffmpeg', [
      '-y',
      ...lipsyncInputs,
      '-filter_complex', filterComplex08,
      '-frames:v', '1',
      '-q:v', '4',
      out08
    ]);

    let size08 = fs.statSync(out08).size;
    if (await enforceImageLimit(out08, 1.5 * 1024 * 1024)) {
      downscalingLog.push('08_lipsync_strip.jpg exceeded 1.5 MB and was re-encoded');
      size08 = fs.statSync(out08).size;
    }
    deliverables.push({
      filename: '08_lipsync_strip.jpg',
      title: 'Lip-Sync Sung Lyric Strip (8 frames, step 3)',
      width: lipsyncCols * cellW08,
      height: 2 * cellH08,
      sizeBytes: size08,
      cells: lipsyncCells
    });

    // -------------------------------------------------------------------------
    // 9. 09_cuts.jpg
    // -------------------------------------------------------------------------
    console.log('[9/9] Generating 09_cuts.jpg...');
    const cutsCount = Math.min(6, Math.max(1, shotPool.length - 1));
    const cutStartShotIdx = Math.max(0, Math.floor((shotPool.length - 1 - cutsCount) / 2));
    const cutCells: CellData[] = [];
    const cutRowPaths: string[] = [];

    const cellW09 = 384;
    const cellH09 = 216;

    for (let c = 0; c < cutsCount; c++) {
      const sOut = shotPool[cutStartShotIdx + c];
      const sIn = shotPool[Math.min(shotPool.length - 1, cutStartShotIdx + c + 1)];

      const fOutSong = sOut.frameRange.endFrameExclusive - 1;
      const fInSong = sIn.frameRange.startFrameInclusive;
      const fOutVideo = Math.max(0, Math.min(meta.frameCount - 1, fOutSong - startOffset));
      const fInVideo = Math.max(0, Math.min(meta.frameCount - 1, fInSong - startOffset));

      const cellOutRaw = buildCellData(fOutSong, meta.fps, storyboard, storySpec, choreography, audioManifest, `Cut ${c + 1} Out: ${sOut.id}`);
      const cellInRaw = buildCellData(fInSong, meta.fps, storyboard, storySpec, choreography, audioManifest, `Cut ${c + 1} In: ${sIn.id}`);

      const imgOut = path.join(tempDir, `cut_${c}_out.jpg`);
      const imgIn = path.join(tempDir, `cut_${c}_in.jpg`);

      const resOut = await extractFrame(videoPath, fOutVideo, meta.fps, imgOut);
      const resIn = await extractFrame(videoPath, fInVideo, meta.fps, imgIn);

      if (resOut.lowLuminance) lowLuminanceLog.push(`09_cuts.jpg Cut ${c + 1} Out (F:${fOutSong}) low luminance`);
      if (resIn.lowLuminance) lowLuminanceLog.push(`09_cuts.jpg Cut ${c + 1} In (F:${fInSong}) low luminance`);

      cutCells.push({ ...cellOutRaw, yavg: resOut.yavg, flaggedLowLuminance: resOut.lowLuminance });
      cutCells.push({ ...cellInRaw, yavg: resIn.yavg, flaggedLowLuminance: resIn.lowLuminance });

      const lblOutPath = path.join(tempDir, `cut_lbl_out_${c}.txt`);
      const lblInPath = path.join(tempDir, `cut_lbl_in_${c}.txt`);
      const cutHdrPath = path.join(tempDir, `cut_hdr_${c}.txt`);

      fs.writeFileSync(lblOutPath, `[${sOut.id}] ${sOut.framing} | ${sOut.movement} (F:${fOutSong})`);
      fs.writeFileSync(lblInPath, `[${sIn.id}] ${sIn.framing} | ${sIn.movement} (F:${fInSong})`);
      fs.writeFileSync(cutHdrPath, `Cut ${c + 1}: ${sOut.id} -> ${sIn.id}`);

      const rowOut = path.join(tempDir, `cut_row_${c}.jpg`);
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', imgOut,
        '-i', imgIn,
        '-filter_complex',
        `[0:v]scale=${cellW09}:${cellH09},drawtext=fontfile=${fontPath}:textfile=${lblOutPath}:fontcolor=white:fontsize=12:box=1:boxcolor=black@0.75:x=8:y=h-th-8[left];` +
        `[1:v]scale=${cellW09}:${cellH09},drawtext=fontfile=${fontPath}:textfile=${lblInPath}:fontcolor=white:fontsize=12:box=1:boxcolor=black@0.75:x=8:y=h-th-8[right];` +
        `[left][right]hstack=inputs=2,` +
        `drawtext=fontfile=${fontPath}:textfile=${cutHdrPath}:fontcolor=yellow:fontsize=12:box=1:boxcolor=black@0.85:x=8:y=8`,
        '-frames:v', '1',
        '-q:v', '4',
        rowOut
      ]);
      cutRowPaths.push(rowOut);
    }

    const out09 = path.join(outDir, '09_cuts.jpg');
    if (cutRowPaths.length === 1) {
      await execFileAsync('ffmpeg', ['-y', '-i', cutRowPaths[0], '-q:v', '4', out09]);
    } else {
      const vstackInputs09: string[] = [];
      for (const r of cutRowPaths) vstackInputs09.push('-i', r);
      await execFileAsync('ffmpeg', [
        '-y',
        ...vstackInputs09,
        '-filter_complex', `vstack=inputs=${cutRowPaths.length}`,
        '-frames:v', '1',
        '-q:v', '4',
        out09
      ]);
    }

    let size09 = fs.statSync(out09).size;
    if (await enforceImageLimit(out09, 1.5 * 1024 * 1024)) {
      downscalingLog.push('09_cuts.jpg exceeded 1.5 MB and was re-encoded');
      size09 = fs.statSync(out09).size;
    }
    deliverables.push({
      filename: '09_cuts.jpg',
      title: `Shot Boundary Cuts (${cutsCount} consecutive transitions)`,
      width: cellW09 * 2,
      height: cellH09 * cutsCount,
      sizeBytes: size09,
      cells: cutCells
    });

    // -------------------------------------------------------------------------
    // Global Size Budget Enforcement
    // -------------------------------------------------------------------------
    const maxTotalBytes = cli.maxTotalMb * 1024 * 1024;
    let totalBytes = deliverables.reduce((acc, d) => acc + d.sizeBytes, 0);

    if (totalBytes > maxTotalBytes) {
      console.log(`Total deliverables size (${(totalBytes / (1024 * 1024)).toFixed(2)} MB) exceeds limit (${cli.maxTotalMb} MB). Optimizing...`);
      const sorted = [...deliverables].sort((a, b) => b.sizeBytes - a.sizeBytes);
      for (const d of sorted) {
        if (totalBytes <= maxTotalBytes) break;
        const filePath = path.join(outDir, d.filename);
        const tmpOut = filePath + '.opt.jpg';
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', filePath,
          '-q:v', '8',
          tmpOut
        ]);
        const newSize = fs.statSync(tmpOut).size;
        if (newSize < d.sizeBytes) {
          fs.renameSync(tmpOut, filePath);
          totalBytes = totalBytes - d.sizeBytes + newSize;
          d.sizeBytes = newSize;
          downscalingLog.push(`Globally downscaled ${d.filename} to ${(newSize / 1024).toFixed(1)} KB`);
        } else {
          fs.unlinkSync(tmpOut);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Manifest Generation
    // -------------------------------------------------------------------------
    console.log('Writing review-manifest.md...');
    const manifestPath = path.join(outDir, 'review-manifest.md');
    let md = '# Rendered Video Review Manifest\n\n';

    md += '## Video & Artifact Sources\n\n';
    md += `- **Video File:** \`${videoPath}\`\n`;
    md += `- **Artifacts Directory:** \`${artifactsDir}\`\n`;
    md += `- **Resolution:** ${meta.width}x${meta.height}\n`;
    md += `- **Frame Rate:** ${meta.fps} fps\n`;
    md += `- **Total Frame Count:** ${meta.frameCount} frames\n`;
    md += `- **Timeline Offset:** Frame ${startOffset} (${formatMmSs(startOffset / meta.fps)})\n`;
    md += `- **Duration:** ${meta.duration.toFixed(2)} seconds (${formatMmSs(meta.duration)})\n`;
    md += `- **Video File Size:** ${(meta.sizeBytes / (1024 * 1024)).toFixed(2)} MB (${meta.sizeBytes.toLocaleString()} bytes)\n\n`;

    md += '## Deliverables Summary\n\n';
    md += '| File | Title | Resolution | Cells | Size (KB) | Size (MB) |\n';
    md += '| :--- | :--- | :--- | :--- | :--- | :--- |\n';
    for (const d of deliverables) {
      const kb = (d.sizeBytes / 1024).toFixed(1);
      const mb = (d.sizeBytes / (1024 * 1024)).toFixed(2);
      md += `| \`${d.filename}\` | ${d.title} | ${d.width}x${d.height} | ${d.cells.length} | ${kb} KB | ${mb} MB |\n`;
    }
    const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
    md += `| **TOTAL** | **All 9 Review Deliverables** | — | **${deliverables.reduce((a, d) => a + d.cells.length, 0)}** | **${(totalBytes / 1024).toFixed(1)} KB** | **${totalMb} MB** |\n\n`;
    md += `- **Hard Size Limits:** Each deliverable <= 1.50 MB; total deliverables <= ${cli.maxTotalMb}.00 MB.\n`;
    md += `- **Limit Compliance:** ${totalBytes <= maxTotalBytes ? 'PASS (all files within limits)' : 'FAIL'}\n\n`;

    md += '## Per-Section Summary Table\n\n';
    md += '| Section ID | Time Range | Duration (s) | Theatrical Set | Interaction Behavior | Lead Clip | Partner Clip | Props | Tone |\n';
    md += '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n';
    for (const s of targetSections) {
      const durSec = ((s.endFrame - s.startFrame) / meta.fps).toFixed(2);
      const timeRange = `${formatMmSs(s.startFrame / meta.fps)} - ${formatMmSs(s.endFrame / meta.fps)}`;
      const leadDirective = s.castDirectives?.find(c => c.instanceId === 'protagonist_lead')?.motionPreset || 'unknown';
      const partnerDirective = s.castDirectives?.find(c => c.instanceId === 'narrative_partner')?.motionPreset || 'unknown';
      const propsStr = getPropsSummary(storySpec, s.sectionId);
      md += `| \`${s.sectionId}\` | ${timeRange} | ${durSec}s | \`${s.theatricalSetId}\` | \`${s.interactionBehavior}\` | \`${leadDirective}\` | \`${partnerDirective}\` | ${propsStr} | \`${s.emotionalTone}\` |\n`;
    }
    md += '\n';

    if (downscalingLog.length > 0) {
      md += '## Downscaling & Quality Adjustments\n\n';
      for (const log of downscalingLog) {
        md += `- ${log}\n`;
      }
      md += '\n';
    }

    if (lowLuminanceLog.length > 0) {
      md += '## Flagged Low-Luminance Frames\n\n';
      for (const log of lowLuminanceLog) {
        md += `- ${log}\n`;
      }
      md += '\n';
    }

    md += '## Cell Metadata Tables\n\n';
    for (const d of deliverables) {
      md += `### ${d.filename} — ${d.title}\n\n`;
      md += '| Cell | Time | Frame | Section | Shot | Set | Behavior | Lead Clip | Partner Clip | Props | Framing / Mvt | Tone | Lyric | YAVG | Low Lum |\n';
      md += '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n';
      for (const c of d.cells) {
        const flag = c.flaggedLowLuminance ? 'YES' : 'NO';
        md += `| ${c.cellLabel} | ${c.timestamp} | ${c.frameIndex} | \`${c.sectionId}\` | \`${c.shotId}\` | \`${c.theatricalSet}\` | \`${c.interactionBehavior}\` | \`${c.leadClip}\` | \`${c.partnerClip}\` | ${c.props} | ${c.framingMovement} | \`${c.tone}\` | "${truncate(c.lyricLine, 30)}" | ${c.yavg.toFixed(2)} | ${flag} |\n`;
      }
      md += '\n';
    }

    fs.writeFileSync(manifestPath, md, 'utf-8');
    console.log(`Manifest written to: ${manifestPath}`);

    // -------------------------------------------------------------------------
    // Deliverables Packaging (.zip)
    // -------------------------------------------------------------------------
    const zipPath = path.join(outDir, 'review-sheets.zip');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    const zipFiles = deliverables.map(d => path.join(outDir, d.filename));
    zipFiles.push(manifestPath);

    console.log('Creating zip archive...');
    await execFileAsync('zip', ['-j', zipPath, ...zipFiles]);

    const zipSize = fs.statSync(zipPath).size;
    const zipMb = (zipSize / (1024 * 1024)).toFixed(2);

    console.log('\n================================================================');
    console.log('          REVIEW SHEETS GENERATION COMPLETE                    ');
    console.log('================================================================');
    console.log(`Deliverables Directory: ${outDir}`);
    console.log(`Absolute Zip Path: ${zipPath}`);
    console.log(`Zip Package Size: ${zipMb} MB (${zipSize.toLocaleString()} bytes)\n`);
    console.log('Generated Deliverables:');
    for (const d of deliverables) {
      const mb = (d.sizeBytes / (1024 * 1024)).toFixed(2);
      console.log(`  - ${d.filename.padEnd(20)}: ${mb.padStart(7)} MB (${d.width}x${d.height}, ${d.cells.length} cells)`);
    }
    console.log(`  - review-manifest.md  : ${(fs.statSync(manifestPath).size / 1024).toFixed(1).padStart(7)} KB`);
    console.log(`  - review-sheets.zip   : ${(zipSize / (1024 * 1024)).toFixed(2).padStart(7)} MB`);
    console.log('================================================================\n');

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch(err => {
  console.error('\nFatal error in review-sheets:', err);
  process.exit(1);
});
