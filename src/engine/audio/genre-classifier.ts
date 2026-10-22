import type { GenreProfile, EmotionalTone } from '../../schemas/story-spec.contract.js';
import type { AudioAnalysisManifest } from '../../schemas/audio.contract.js';
import { analyzeSectionLyrics } from './lyric-profile.js';

export interface GenreMetrics {
  tempoBpm: number;
  onsetDensity: number;
  spectralBalance: number;
  hasVocals: boolean;
  lyricTone: EmotionalTone;
  valenceScore: number;
  intensityScore: number;
}

export interface GenreClassificationResult {
  genre: GenreProfile;
  confidence: number;
  scores: Record<GenreProfile, number>;
  metrics: GenreMetrics;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Classifies the music video genre profile using multi-factor acoustic and lyric metrics.
 * Weights:
 * - tempoBpm: 0.30
 * - onsetDensity: 0.25
 * - spectralBalance: 0.20
 * - hasVocals: 0.15
 * - lyricProfile: 0.10
 */
export function classifyGenreProfile(manifest: AudioAnalysisManifest): GenreClassificationResult {
  const duration = Math.max(1, manifest.metadata.durationSeconds);
  const tempo = manifest.metadata.tempoBpm ?? manifest.beatGrid?.tempoBpm ?? 120;

  // 1. Onset Density (onsets per second)
  const onsetCount =
    manifest.beatEvents.length > 0
      ? manifest.beatEvents.length
      : manifest.beatGrid?.beatFrameIndices.length ?? 0;
  const onsetDensity = onsetCount / duration;

  // 2. Spectral Balance (ratio of highMid+presence+brilliance to total energy)
  const sections = manifest.sections ?? [];
  let trebleCount = 0;
  let bassCount = 0;
  let midCount = 0;

  for (const sec of sections) {
    const b = sec.dominantBand;
    if (b === 'presence' || b === 'highMid' || b === 'brilliance') {
      trebleCount++;
    } else if (b === 'subBass' || b === 'bass') {
      bassCount++;
    } else {
      midCount++;
    }
  }

  const totalSecs = Math.max(1, sections.length);
  const trebleRatio = trebleCount / totalSecs;
  const bassRatio = bassCount / totalSecs;
  const midRatio = midCount / totalSecs;

  // 3. Vocals
  const hasVocals = manifest.lyrics.length > 0 || sections.some((s) => s.hasVocals);

  // 4. Lyric Profile
  const allLyricText = manifest.lyrics.map((l) => l.text).join(' ');
  const lyricAnalysis = analyzeSectionLyrics(allLyricText);
  const lyricTone = lyricAnalysis.emotionalTone;
  const intensityScore = lyricAnalysis.intensityScore;
  const valenceScore = lyricAnalysis.valenceScore;

  // Half-time tempo resolution for aggressive music
  const isAggressiveLyrics =
    lyricTone === 'defiant' || lyricTone === 'chaotic' || lyricTone === 'menacing';
  const hasTempo = manifest.metadata.tempoBpm !== undefined || manifest.beatGrid?.tempoBpm !== undefined;
  const effectiveTempo =
    tempo >= 70 && tempo <= 95 && (onsetDensity >= 1.5 || intensityScore >= 0.7 || isAggressiveLyrics)
      ? tempo * 2
      : tempo;

  // 5. Multi-factor Scoring
  // Candidate 1: rock_metal
  const rockTempo = hasTempo
    ? clamp01((effectiveTempo - 118) / 45)
    : isAggressiveLyrics
      ? 0.75
      : 0.5;
  const rockOnsets = clamp01((onsetDensity - 1.2) / 1.8);
  const rockSpectral =
    trebleRatio > 0 ? trebleRatio : bassRatio >= 0.4 ? 0.8 : tempo >= 140 ? 0.8 : 0.3;
  const rockVocals = hasVocals ? 0.9 : 0.5;
  const rockLyrics = isAggressiveLyrics ? 1.0 : lyricTone === 'melancholic' ? 0.6 : 0.3;
  const rockScore =
    0.25 * rockTempo +
    0.20 * rockOnsets +
    0.20 * rockSpectral +
    0.15 * rockVocals +
    0.20 * rockLyrics;

  // Candidate 2: electronic_synth
  const electronicTempo = tempo >= 105 && tempo <= 145 ? 1.0 : clamp01(1 - Math.abs(tempo - 125) / 35);
  const electronicOnsets = clamp01((onsetDensity - 1.0) / 1.8);
  const electronicBass = bassRatio >= 0.4 ? 1.0 : bassRatio > 0 ? bassRatio * 1.5 : tempo >= 110 && tempo <= 135 ? 0.7 : 0.3;
  const electronicVocals = !hasVocals ? 1.0 : isAggressiveLyrics ? 0.4 : 0.85;
  const electronicLyrics =
    isAggressiveLyrics
      ? 0.2
      : lyricTone === 'euphoric' || lyricTone === 'reflective' || manifest.lyrics.length === 0
        ? 1.0
        : 0.4;
  const electronicScore =
    0.30 * electronicTempo +
    0.25 * electronicOnsets +
    0.20 * electronicBass +
    0.15 * electronicVocals +
    0.10 * electronicLyrics;

  // Candidate 3: pop_dance (typically 118 - 132 BPM with prominent vocals and mid/presence)
  const popTempo = hasTempo
    ? tempo >= 118 && tempo <= 132
      ? 1.0
      : clamp01(1 - Math.abs(tempo - 125) / 16)
    : 0.6;
  const popOnsets = onsetDensity >= 1.4 && onsetDensity <= 3.2 ? 1.0 : 0.5;
  const popMid = midRatio >= 0.35 && bassRatio < 0.5 ? 1.0 : midRatio > 0 ? midRatio : 0.4;
  const popVocals = hasVocals ? 1.0 : 0.2;
  const popLyrics =
    lyricTone === 'euphoric' || lyricTone === 'tender'
      ? 1.0
      : lyricTone === 'reflective'
        ? 0.5
        : 0.1;
  const popValencePenalty = isAggressiveLyrics && valenceScore < 0.1 ? 0.35 : 1.0;
  const popScore =
    (0.30 * popTempo +
      0.25 * popOnsets +
      0.20 * popMid +
      0.15 * popVocals +
      0.10 * popLyrics) *
    popValencePenalty;

  // Candidate 4: ballad_acoustic
  const balladTempo = clamp01((105 - tempo) / 35);
  const balladOnsets = clamp01((2.0 - onsetDensity) / 1.5);
  const balladSpectral = midRatio > 0 ? midRatio : 0.6;
  const balladVocals = hasVocals ? 0.9 : 0.5;
  const balladLyrics =
    lyricTone === 'melancholic' || lyricTone === 'reflective' || lyricTone === 'tender' ? 1.0 : 0.3;
  const balladScore =
    0.30 * balladTempo +
    0.25 * balladOnsets +
    0.20 * balladSpectral +
    0.15 * balladVocals +
    0.10 * balladLyrics;

  const scores: Record<GenreProfile, number> = {
    rock_metal: Number(rockScore.toFixed(4)),
    electronic_synth: Number(electronicScore.toFixed(4)),
    pop_dance: Number(popScore.toFixed(4)),
    ballad_acoustic: Number(balladScore.toFixed(4)),
    neutral: 0.40
  };

  let bestGenre: GenreProfile = 'neutral';
  let bestScore = 0.45; // Threshold for confident classification

  const genres: GenreProfile[] = ['rock_metal', 'electronic_synth', 'pop_dance', 'ballad_acoustic'];
  for (const g of genres) {
    if (scores[g] > bestScore) {
      bestScore = scores[g];
      bestGenre = g;
    }
  }

  return {
    genre: bestGenre,
    confidence: Number(bestScore.toFixed(2)),
    scores,
    metrics: {
      tempoBpm: tempo,
      onsetDensity: Number(onsetDensity.toFixed(2)),
      spectralBalance: Number(trebleRatio.toFixed(2)),
      hasVocals,
      lyricTone,
      valenceScore: lyricAnalysis.valenceScore,
      intensityScore: lyricAnalysis.intensityScore
    }
  };
}
