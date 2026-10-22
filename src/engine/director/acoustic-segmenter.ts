import type {
  EnvironmentZoneType,
  ColorLightingPalette
} from '../../schemas/storyboard.contract.js';
import type { AudioAnalysisManifest, AudioFrameFeature } from '../../schemas/audio.contract.js';

export type AcousticPersonalityType =
  | 'BUILDUP'
  | 'DRIVING_RHYTHM'
  | 'VIRTUOSIC_MELODY'
  | 'CLIMAX_BREAKDOWN'
  | 'ATMOSPHERIC_DECAY';

export interface AcousticSectionDescriptor {
  sectionIndex: number;
  sectionType: string;
  title: string;
  narrativeArc: string;
  startFrame: number;
  endFrame: number;
  actNumber: 1 | 2 | 3;
  palette: ColorLightingPalette;
  hasPursuitDrone: boolean;
  zoneType: EnvironmentZoneType;
  acousticPersonality: AcousticPersonalityType;
  meanRms: number;
  peakRms: number;
  bassDominance: number;
  highDominance: number;
}

export const THEMATIC_PALETTES: Record<string, ColorLightingPalette> = {
  CYBERPUNK_CYAN: {
    background: '#090b16',
    primary: '#00f0ff',
    secondary: '#3a506b',
    accent: '#ff0055',
    ambientLightColor: '#1a243b',
    ambientIntensity: 0.72,
    keyLightDirection: [-0.5, -0.8, -0.3],
    audioReactiveGain: 0.65
  },
  VOLTAGE_ORANGE: {
    background: '#14080a',
    primary: '#ff5500',
    secondary: '#4a306d',
    accent: '#ffdd00',
    ambientLightColor: '#2b1418',
    ambientIntensity: 0.8,
    keyLightDirection: [-0.3, -0.7, -0.5],
    audioReactiveGain: 0.85
  },
  SUNSET_GOLD: {
    background: '#1a0520',
    primary: '#ffd700',
    secondary: '#3a0ca3',
    accent: '#ff007f',
    ambientLightColor: '#2b0f4c',
    ambientIntensity: 0.84,
    keyLightDirection: [0.4, -0.8, -0.4],
    audioReactiveGain: 0.95
  },
  CRIMSON_FURY: {
    background: '#080204',
    primary: '#ff0033',
    secondary: '#2e0b12',
    accent: '#ffffff',
    ambientLightColor: '#30080d',
    ambientIntensity: 0.88,
    keyLightDirection: [-0.6, -0.9, -0.2],
    audioReactiveGain: 1.15
  },
  MIDNIGHT_VOID: {
    background: '#050210',
    primary: '#7928ca',
    secondary: '#1b1435',
    accent: '#00ffff',
    ambientLightColor: '#180e2e',
    ambientIntensity: 0.7,
    keyLightDirection: [0.2, -0.8, -0.5],
    audioReactiveGain: 0.55
  }
};

export interface SegmenterOptions {
  getAudioFeatureAtFrame?: (frameIndex: number) => AudioFrameFeature;
  targetSectionSeconds?: number;
  minSectionSeconds?: number;
  maxSectionSeconds?: number;
}

interface FrameSample {
  frame: number;
  intensity: number;
  rms: number;
  bass: number;
  high: number;
  flux: number;
}

/**
 * Autonomous, song-agnostic acoustic timeline segmenter.
 * Detects musical structural shifts (intros, verses, drops, breakdowns, solos, and outros)
 * from energy envelopes, spectral flux, beat/bar grids, and lyric stanzas.
 */
/**
 * @deprecated Superseded by `segmentAudioSections` in `src/engine/audio/wav-analyzer.ts`
 * and `StorySpecAgent` section compilation. Retained for standalone unit test compatibility.
 */
export class AcousticTimelineSegmenter {
  private readonly manifest: AudioAnalysisManifest;
  private readonly getFeature?: (f: number) => AudioFrameFeature;
  public readonly targetSectionSeconds: number;
  private readonly minSectionSeconds: number;
  private readonly maxSectionSeconds: number;

  constructor(manifest: AudioAnalysisManifest, options: SegmenterOptions = {}) {
    this.manifest = manifest;
    this.getFeature = options.getAudioFeatureAtFrame;
    this.targetSectionSeconds = options.targetSectionSeconds ?? 35.0;
    this.minSectionSeconds = options.minSectionSeconds ?? 8.0;
    this.maxSectionSeconds = options.maxSectionSeconds ?? 65.0;
  }

  /**
   * Decomposes the audio timeline into a sequence of contiguous, acoustically classified sections.
   */
  public segment(): AcousticSectionDescriptor[] {
    const totalFrames = this.manifest.metadata.totalFrames;
    const fps = this.manifest.metadata.fps;

    // Handle trivial / micro timelines (e.g. <= 300 frames)
    if (totalFrames <= 300) {
      return this.segmentMicroTimeline(totalFrames);
    }

    // 1. Build sampled energy & feature contour
    const samples = this.buildEnergyContour(totalFrames, fps);

    // 2. Compute musical bar / measure grid
    const bpm = this.resolveTempoBpm();
    const framesPerBeat = Math.max(1, Math.round((60 / bpm) * fps));
    const framesPerBar = 4 * framesPerBeat; // 4/4 musical measure assumption

    // 3. Detect candidate boundary frames
    const rawBoundaries = this.detectCandidateBoundaries(samples, totalFrames, fps);

    // 4. Snap boundaries to bar grid and enforce minimum/maximum section lengths
    const boundaries = this.cleanAndSnapBoundaries(rawBoundaries, totalFrames, fps, framesPerBar);

    // 5. Partition sections into 3 continuous Acts
    const sectionRanges = this.buildSectionRanges(boundaries);
    const actAssignments = this.assignActs(sectionRanges, totalFrames);

    // 6. Acoustically classify each section and assign environment biomes + palettes
    return sectionRanges.map((range, idx) => {
      const act = actAssignments[idx];
      return this.classifySection(idx, range.start, range.end, act, samples, totalFrames);
    });
  }

  private segmentMicroTimeline(totalFrames: number): AcousticSectionDescriptor[] {
    const act1End = Math.max(1, Math.floor(totalFrames * 0.25));
    const act2End = Math.max(act1End + 1, Math.floor(totalFrames * 0.75));

    return [
      {
        sectionIndex: 0,
        sectionType: 'INTRO',
        title: 'Act I: Awakening Horizon [Buildup]',
        narrativeArc: 'Establishing neon horizon and initial sprint launch.',
        startFrame: 0,
        endFrame: act1End,
        actNumber: 1,
        palette: THEMATIC_PALETTES.CYBERPUNK_CYAN,
        hasPursuitDrone: false,
        zoneType: 'ROOFTOP',
        acousticPersonality: 'BUILDUP',
        meanRms: 0.3,
        peakRms: 0.45,
        bassDominance: 0.3,
        highDominance: 0.3
      },
      {
        sectionIndex: 1,
        sectionType: 'DRIVING_SECTION',
        title: 'Act II: High-Velocity Transit [Driving Rhythm]',
        narrativeArc: 'High-speed tracking and sweeping kinematics.',
        startFrame: act1End,
        endFrame: act2End,
        actNumber: 2,
        palette: THEMATIC_PALETTES.VOLTAGE_ORANGE,
        hasPursuitDrone: true,
        zoneType: 'HIGHWAY',
        acousticPersonality: 'DRIVING_RHYTHM',
        meanRms: 0.6,
        peakRms: 0.75,
        bassDominance: 0.5,
        highDominance: 0.4
      },
      {
        sectionIndex: 2,
        sectionType: 'CLIMAX_FINALE',
        title: 'Act III: Core Convergence [Climax Breakdown]',
        narrativeArc: 'Dramatic core ignition and cybernetic convergence.',
        startFrame: act2End,
        endFrame: totalFrames,
        actNumber: 3,
        palette: THEMATIC_PALETTES.CRIMSON_FURY,
        hasPursuitDrone: true,
        zoneType: 'REACTOR',
        acousticPersonality: 'CLIMAX_BREAKDOWN',
        meanRms: 0.8,
        peakRms: 0.95,
        bassDominance: 0.7,
        highDominance: 0.6
      }
    ];
  }

  private resolveTempoBpm(): number {
    if (this.manifest.metadata.tempoBpm && this.manifest.metadata.tempoBpm > 40) {
      return this.manifest.metadata.tempoBpm;
    }
    const beats = this.manifest.beatEvents;
    if (beats && beats.length > 4) {
      const intervals: number[] = [];
      for (let i = 1; i < beats.length; i++) {
        const dt = beats[i].timestamp - beats[i - 1].timestamp;
        if (dt > 0.2 && dt < 2.0) intervals.push(dt);
      }
      if (intervals.length > 0) {
        const avgDt = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        return Math.round(60 / avgDt);
      }
    }
    return 120; // Default sensible musical tempo
  }

  private buildEnergyContour(totalFrames: number, fps: number): FrameSample[] {
    const hop = Math.max(1, Math.round(fps * 0.5)); // 0.5-second hop
    const samples: FrameSample[] = [];

    // Fallback beat map for quick O(1) density lookup
    const beatFrames = new Set(this.manifest.beatEvents.map((b) => b.frameIndex));

    for (let f = 0; f < totalFrames; f += hop) {
      if (this.getFeature) {
        const feat = this.getFeature(f);
        const rms = feat.rms;
        const bass = (feat.bands.subBass + feat.bands.bass) * 0.5;
        const high = (feat.bands.presence + feat.bands.brilliance) * 0.5;
        const flux = feat.spectralFlux;
        const onset = feat.onsetStrength;

        // Composite intensity
        const intensity =
          0.40 * rms + 0.25 * bass + 0.15 * flux + 0.10 * high + 0.10 * onset;

        samples.push({
          frame: f,
          intensity,
          rms,
          bass,
          high,
          flux
        });
      } else {
        // Feature reader unavailable: estimate from beat events and lyrics
        let nearBeats = 0;
        for (let df = -hop; df <= hop; df += 5) {
          if (beatFrames.has(f + df)) nearBeats++;
        }
        const beatDensity = Math.min(1.0, nearBeats / 4.0);

        let lyricEmphasis = 0.2;
        const curSec = f / fps;
        for (const lyric of this.manifest.lyrics) {
          if (curSec >= lyric.startTimeSeconds && curSec <= lyric.endTimeSeconds) {
            lyricEmphasis = Math.max(lyricEmphasis, lyric.emphasis);
          }
        }

        const estIntensity = 0.5 * beatDensity + 0.5 * lyricEmphasis;
        samples.push({
          frame: f,
          intensity: estIntensity,
          rms: estIntensity,
          bass: estIntensity * 0.8,
          high: estIntensity * 0.7,
          flux: estIntensity * 0.5
        });
      }
    }

    // Apply 3-tap smoothing filter to reduce transient noise
    if (samples.length >= 3) {
      const smoothed: FrameSample[] = [];
      for (let i = 0; i < samples.length; i++) {
        const prev = samples[Math.max(0, i - 1)].intensity;
        const curr = samples[i].intensity;
        const next = samples[Math.min(samples.length - 1, i + 1)].intensity;
        const smoothInt = 0.2 * prev + 0.6 * curr + 0.2 * next;
        smoothed.push({ ...samples[i], intensity: smoothInt });
      }
      return smoothed;
    }

    return samples;
  }

  private detectCandidateBoundaries(
    samples: FrameSample[],
    totalFrames: number,
    fps: number
  ): number[] {
    const minSpan = Math.round(this.minSectionSeconds * fps);
    const candidates: Array<{ frame: number; score: number }> = [];

    // 1. First-derivative novelty detection over samples
    for (let i = 2; i < samples.length - 2; i++) {
      const past = (samples[i - 2].intensity + samples[i - 1].intensity) / 2;
      const future = (samples[i + 1].intensity + samples[i + 2].intensity) / 2;
      const dEnergy = Math.abs(future - past);

      // Contrast score
      if (dEnergy > 0.08) {
        candidates.push({
          frame: samples[i].frame,
          score: dEnergy
        });
      }
    }

    // 2. Structural lyric gaps (> 3.0 seconds without vocal delivery)
    for (let l = 1; l < this.manifest.lyrics.length; l++) {
      const prevLyric = this.manifest.lyrics[l - 1];
      const nextLyric = this.manifest.lyrics[l];
      const gapSec = nextLyric.startTimeSeconds - prevLyric.endTimeSeconds;
      if (gapSec >= 3.0) {
        const midpointFrame = Math.round(
          ((prevLyric.endTimeSeconds + nextLyric.startTimeSeconds) / 2) * fps
        );
        candidates.push({
          frame: midpointFrame,
          score: 0.25 + Math.min(0.2, gapSec * 0.05)
        });
      }
    }

    // Sort candidates by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Greedily pick non-conflicting candidates that respect minSpan
    const pickedFrames: number[] = [0];
    for (const c of candidates) {
      if (c.frame < minSpan || c.frame > totalFrames - minSpan) continue;
      const conflicts = pickedFrames.some((p) => Math.abs(p - c.frame) < minSpan);
      if (!conflicts) {
        pickedFrames.push(c.frame);
      }
    }

    pickedFrames.push(totalFrames);
    pickedFrames.sort((a, b) => a - b);
    return pickedFrames;
  }

  private cleanAndSnapBoundaries(
    raw: number[],
    totalFrames: number,
    fps: number,
    framesPerBar: number
  ): number[] {
    const minFrames = Math.max(framesPerBar * 2, Math.round(this.minSectionSeconds * fps));
    const maxFrames = Math.round(this.maxSectionSeconds * fps);

    // Snap interior points to nearest bar boundary
    const snapped: number[] = [0];
    for (let i = 1; i < raw.length - 1; i++) {
      const f = raw[i];
      const snappedF = Math.round(f / framesPerBar) * framesPerBar;
      if (snappedF > 0 && snappedF < totalFrames) {
        snapped.push(snappedF);
      }
    }
    snapped.push(totalFrames);

    // Deduplicate and enforce minimum span
    const filtered: number[] = [0];
    for (let i = 1; i < snapped.length; i++) {
      const prev = filtered[filtered.length - 1];
      const curr = snapped[i];
      if (curr - prev >= minFrames || i === snapped.length - 1) {
        if (i === snapped.length - 1 && curr - prev < minFrames && filtered.length > 1) {
          // Merge last boundary into final totalFrames
          filtered[filtered.length - 1] = totalFrames;
        } else {
          filtered.push(curr);
        }
      }
    }

    // Subdivide any spans exceeding maxFrames
    const result: number[] = [0];
    for (let i = 1; i < filtered.length; i++) {
      const prev = result[result.length - 1];
      const curr = filtered[i];
      const span = curr - prev;

      if (span > maxFrames) {
        const subCount = Math.ceil(span / maxFrames);
        const subStep = Math.round(span / subCount / framesPerBar) * framesPerBar;
        for (let s = 1; s < subCount; s++) {
          result.push(prev + s * subStep);
        }
      }
      result.push(curr);
    }

    // Ensure final boundary strictly equals totalFrames
    result[result.length - 1] = totalFrames;
    return result;
  }

  private buildSectionRanges(
    boundaries: number[]
  ): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    for (let i = 1; i < boundaries.length; i++) {
      ranges.push({
        start: boundaries[i - 1],
        end: boundaries[i]
      });
    }
    return ranges;
  }

  /**
   * Partitions continuous sections into exactly 3 Acts to satisfy invariant requirements.
   * Act 1: ~20% - 35% of timeline
   * Act 2: ~30% - 40% of timeline (cumulative ~55% - 75%)
   * Act 3: remainder up to 100%
   */
  private assignActs(
    ranges: Array<{ start: number; end: number }>,
    totalFrames: number
  ): Array<1 | 2 | 3> {
    const count = ranges.length;
    if (count <= 3) {
      return ranges.map((_, i) => (Math.min(3, i + 1) as 1 | 2 | 3));
    }

    const act1Ideal = totalFrames * 0.28;
    const act2Ideal = totalFrames * 0.65;

    let act1CutIdx = 0;
    let minAct1Diff = Infinity;
    for (let i = 0; i < count - 2; i++) {
      const diff = Math.abs(ranges[i].end - act1Ideal);
      if (diff < minAct1Diff) {
        minAct1Diff = diff;
        act1CutIdx = i;
      }
    }

    let act2CutIdx = act1CutIdx + 1;
    let minAct2Diff = Infinity;
    for (let i = act1CutIdx + 1; i < count - 1; i++) {
      const diff = Math.abs(ranges[i].end - act2Ideal);
      if (diff < minAct2Diff) {
        minAct2Diff = diff;
        act2CutIdx = i;
      }
    }

    return ranges.map((_, i) => {
      if (i <= act1CutIdx) return 1;
      if (i <= act2CutIdx) return 2;
      return 3;
    });
  }

  private classifySection(
    sectionIndex: number,
    startFrame: number,
    endFrame: number,
    actNumber: 1 | 2 | 3,
    samples: FrameSample[],
    totalFrames: number
  ): AcousticSectionDescriptor {
    // Collect samples falling inside this section
    const inSection = samples.filter((s) => s.frame >= startFrame && s.frame < endFrame);
    let sumRms = 0;
    let peakRms = 0;
    let sumBass = 0;
    let sumHigh = 0;
    const n = Math.max(1, inSection.length);

    for (const s of inSection) {
      sumRms += s.rms;
      if (s.rms > peakRms) peakRms = s.rms;
      sumBass += s.bass;
      sumHigh += s.high;
    }

    const meanRms = Number((sumRms / n).toFixed(3));
    const bassDominance = Number((sumBass / n).toFixed(3));
    const highDominance = Number((sumHigh / n).toFixed(3));

    const isFirst = sectionIndex === 0;
    const isLast = endFrame >= totalFrames;
    const progress = (startFrame + endFrame) / 2 / totalFrames;

    let personality: AcousticPersonalityType;
    let zoneType: EnvironmentZoneType;
    let palette: ColorLightingPalette;
    let hasPursuitDrone = false;
    let title: string;
    let narrativeArc: string;

    if (isFirst || (progress < 0.2 && meanRms < 0.52)) {
      personality = 'BUILDUP';
      zoneType = 'ROOFTOP';
      palette = THEMATIC_PALETTES.CYBERPUNK_CYAN;
      hasPursuitDrone = false;
      title = `Act ${actNumber}: Industrial Awakening [Buildup]`;
      narrativeArc = 'Establishing high rooftop vista, industrial skyline, and initial acceleration.';
    } else if (isLast && meanRms < 0.6) {
      personality = 'ATMOSPHERIC_DECAY';
      zoneType = 'REACTOR';
      palette = THEMATIC_PALETTES.MIDNIGHT_VOID;
      hasPursuitDrone = false;
      title = `Act ${actNumber}: Atmospheric Transcendence [Decay]`;
      narrativeArc = 'Decelerating cinematic glide through tunnel exit, fading into midnight horizon.';
    } else if (meanRms >= 0.68 || (actNumber === 3 && bassDominance > 0.45)) {
      personality = 'CLIMAX_BREAKDOWN';
      zoneType = 'REACTOR';
      palette = THEMATIC_PALETTES.CRIMSON_FURY;
      hasPursuitDrone = true;
      title = `Act ${actNumber}: Core Ignition [Peak Climax]`;
      narrativeArc = 'Peak audio intensity, strobe warning flashes, and underground reactor tunnel depth.';
    } else if (highDominance > 0.42 && actNumber === 2) {
      personality = 'VIRTUOSIC_MELODY';
      zoneType = 'BRIDGE';
      palette = THEMATIC_PALETTES.SUNSET_GOLD;
      hasPursuitDrone = true;
      title = `Act ${actNumber}: Sky-Bridge Pursuit [Virtuosic Lead]`;
      narrativeArc = 'Melodic elevation, sweeping suspension stay cables, and aerial drone confrontation.';
    } else {
      personality = 'DRIVING_RHYTHM';
      zoneType = 'HIGHWAY';
      palette = THEMATIC_PALETTES.VOLTAGE_ORANGE;
      hasPursuitDrone = actNumber >= 2;
      title = `Act ${actNumber}: High-Velocity Transit [Driving Rhythm]`;
      narrativeArc = 'Rapid roadway dash with flashing streetlamps, Jersey barriers, and overhead gantries.';
    }

    return {
      sectionIndex,
      sectionType: personality,
      title,
      narrativeArc,
      startFrame,
      endFrame,
      actNumber,
      palette,
      hasPursuitDrone,
      zoneType,
      acousticPersonality: personality,
      meanRms,
      peakRms: Number(peakRms.toFixed(3)),
      bassDominance,
      highDominance
    };
  }
}
