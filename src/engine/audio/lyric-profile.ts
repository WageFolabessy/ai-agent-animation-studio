import type { EmotionalTone } from '../../schemas/story-spec.contract.js';

export const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as',
  'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
  'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had',
  'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that',
  'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

export const NEGATION_TOKENS = new Set([
  'not', 'no', 'never', 'neither', 'nor', 'none', 'hardly', 'scarcely', 'barely',
  'without', 'cannot', 'cant', 'dont', 'wont', 'isnt', 'arent', 'wasnt', 'werent',
  'didnt', 'aint', 'nothing', 'nowhere'
]);

export const EMOTIONAL_LEXICON: Record<EmotionalTone, readonly string[]> = {
  defiant: [
    'fight', 'rise', 'stand', 'break', 'free', 'proud', 'fire', 'roar',
    'resist', 'strike', 'strong', 'rage', 'alive', 'scream', 'conquer', 'rebel',
    'blaze', 'warrior', 'brave', 'defeat', 'fearless', 'scars', 'unbroken', 'burn',
    'fury', 'victorious', 'triumph', 'unyielding', 'shatter', 'crush', 'shield',
    'armor', 'defend', 'courage', 'ignite', 'overcome', 'persist', 'endure', 'power',
    'invincible', 'unshakable', 'battle', 'prevail', 'refuse', 'challenge', 'bold'
  ],
  melancholic: [
    'sorrow', 'lonely', 'cry', 'tear', 'tears', 'weep', 'weeping', 'sad', 'lost', 'fade',
    'pain', 'bleed', 'dark', 'shadow', 'cold', 'gone', 'hurt', 'broken', 'hollow',
    'grief', 'wound', 'alone', 'goodbye', 'despair', 'empty', 'mourn', 'gray',
    'hopeless', 'regret', 'abandoned', 'silence', 'forgotten', 'aches', 'bleak', 'ashes',
    'burden', 'drowning', 'missed', 'vanished', 'sorrows', 'distress', 'sorrowful', 'weary'
  ],
  tender: [
    'love', 'hold', 'gentle', 'soft', 'warm', 'whisper', 'touch', 'heart', 'safe',
    'sweet', 'stay', 'kiss', 'beauty', 'peace', 'care', 'cherish', 'quiet', 'dream',
    'embrace', 'light', 'kind', 'heals', 'comfort', 'precious', 'affection', 'protect',
    'calm', 'breathe', 'soothing', 'solace', 'graceful', 'blossom', 'beloved', 'fond',
    'serene', 'devotion', 'tenderness', 'cuddle', 'shelter', 'pure', 'delicate'
  ],
  euphoric: [
    'shine', 'fly', 'high', 'joy', 'glow', 'dance', 'gold', 'golden', 'magic', 'star',
    'stars', 'heavens', 'wild', 'celebrate', 'victory', 'bliss', 'spark', 'electric',
    'wonder', 'paradise', 'radiant', 'heaven', 'ecstasy', 'sunshine', 'forever',
    'dazzling', 'ecstatic', 'delight', 'soaring', 'infinite', 'jubilant', 'luminous',
    'thrive', 'exhilarated', 'gleam', 'beam', 'bright', 'glory', 'triumphant', 'sparkle'
  ],
  menacing: [
    'fear', 'crawl', 'blood', 'kill', 'teeth', 'doom', 'poison', 'demon', 'nightmare',
    'dread', 'stalk', 'curse', 'venom', 'rot', 'horror', 'monster', 'death', 'choke',
    'prey', 'abyss', 'trap', 'fang', 'shadows', 'wicked', 'creeping', 'sinister',
    'devour', 'lurking', 'haunt', 'terror', 'vicious', 'lethal', 'ominous', 'malice',
    'threat', 'claw', 'stalker', 'grim', 'ruthless', 'deadly', 'darkness'
  ],
  reflective: [
    'remember', 'time', 'mirror', 'silent', 'silence', 'think', 'slowly', 'yesterday',
    'wander', 'wonder', 'trace', 'echo', 'echoes', 'memory', 'memories', 'breath',
    'horizon', 'still', 'road', 'look', 'past', 'soul', 'story', 'path', 'waiting',
    'pondering', 'distant', 'observe', 'season', 'passage', 'contemplate', 'stillness',
    'searching', 'timeless', 'introspective', 'glance', 'ponder', 'drifting', 'vision'
  ],
  chaotic: [
    'burn', 'crash', 'chaos', 'madness', 'storm', 'shatter', 'fall', 'explode', 'run',
    'blind', 'twisted', 'furious', 'noise', 'panic', 'wreck', 'clash', 'violent',
    'blast', 'riot', 'frenzy', 'distort', 'insane', 'shaking', 'anarchy', 'erupt',
    'turbulence', 'collide', 'rupture', 'disarray', 'disorder', 'avalanche', 'inferno',
    'spiral', 'tempest', 'havoc', 'fracture', 'whirlwind', 'static', 'uncontrolled'
  ]
};

export interface LyricLanguageDetection {
  readonly isEnglish: boolean;
  readonly language: 'en' | 'unknown/non-english';
  readonly stopwordRatio: number;
}

/**
 * Cheap stopword-heuristic language detector.
 * Identifies whether lyric text is English or non-English without network or heavy dependencies.
 */
export function detectLyricLanguage(text: string): LyricLanguageDetection {
  const rawTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (rawTokens.length === 0) {
    return { isEnglish: false, language: 'unknown/non-english', stopwordRatio: 0 };
  }

  let stopwordHits = 0;
  for (const t of rawTokens) {
    if (STOPWORDS.has(t)) {
      stopwordHits++;
    }
  }

  const stopwordRatio = stopwordHits / rawTokens.length;

  if (rawTokens.length >= 4) {
    // In natural English lyrics, stopwords comprise 20%-60% of all tokens.
    // A threshold of 0.12 reliably separates non-English lyrics (ratio ~0.00-0.05) from English.
    const isEnglish = stopwordRatio >= 0.12;
    return {
      isEnglish,
      language: isEnglish ? 'en' : 'unknown/non-english',
      stopwordRatio
    };
  }

  // Short phrases (< 4 words):
  if (stopwordHits >= 1) {
    return { isEnglish: true, language: 'en', stopwordRatio };
  }

  let hasLexiconMatch = false;
  for (const t of rawTokens) {
    for (const words of Object.values(EMOTIONAL_LEXICON)) {
      if (words.includes(t)) {
        hasLexiconMatch = true;
        break;
      }
    }
    if (hasLexiconMatch) break;
  }

  return {
    isEnglish: hasLexiconMatch,
    language: hasLexiconMatch ? 'en' : 'unknown/non-english',
    stopwordRatio
  };
}

/**
 * Tokenizes arbitrary lyric text into clean lowercase word stems.
 */
export function tokenizeLyrics(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Extracts top-K recurring motifs / emotional keywords from text, ranked by frequency then alphabetically.
 * If text is detected as non-English, returns empty array to prevent extracting English stopword false positives.
 */
export function extractLyricKeywords(text: string, topK = 5): string[] {
  const lang = detectLyricLanguage(text);
  if (!lang.isEnglish) {
    return [];
  }
  const tokens = tokenizeLyrics(text);
  if (tokens.length === 0) return [];

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  return sorted.slice(0, topK).map(([word]) => word);
}

export interface AudioToneContext {
  readonly energy?: number;
  readonly tempoBpm?: number;
  readonly dominantBand?: string;
  readonly spectralBalance?: number;
}

/**
 * Derives emotional tone directly from physical audio features (energy, tempo, spectral balance)
 * when lyrics provide no clear signal or are non-English.
 */
export function deriveToneFromAudio(context?: AudioToneContext): EmotionalTone {
  const energy = context?.energy ?? 0.5;
  const tempo = context?.tempoBpm ?? 120;
  const band = context?.dominantBand ?? 'mid';

  if (energy >= 0.78) {
    if (tempo >= 145 || band === 'subBass' || band === 'bass') {
      return 'chaotic';
    }
    if (band === 'presence' || band === 'highMid' || band === 'brilliance') {
      return 'euphoric';
    }
    return 'defiant';
  } else if (energy >= 0.55) {
    if (band === 'presence' || band === 'brilliance' || tempo >= 125) {
      return 'euphoric';
    }
    if (band === 'subBass' || band === 'bass') {
      return 'menacing';
    }
    return 'defiant';
  } else if (energy >= 0.32) {
    if (band === 'presence' || band === 'highMid') {
      return 'tender';
    }
    return 'reflective';
  } else {
    // Low energy (< 0.32)
    if (band === 'presence' || band === 'highMid' || band === 'mid') {
      return 'tender';
    }
    return 'melancholic';
  }
}

/**
 * Classifies the emotional tone of text into one of 7 canonical tags.
 * Incorporates negation handling (3-token lookback window), minimum score margin,
 * and audio feature fallback when lyrics give no clear signal.
 *
 * Negation Rule:
 * When an emotional lexicon word is preceded within 3 tokens by a negator ('not', 'no', 'never', 'without', etc.):
 * - Positive valence tones (tender, euphoric) invert to melancholic (+1.0).
 * - Negative valence tones (melancholic, menacing) invert to defiant (+1.0).
 * - Active / defiant / chaotic tones cancel their contribution (0.0).
 * - Reflective tone cancels (0.0).
 */
export function classifyEmotionalTone(
  text: string,
  fallback?: EmotionalTone | AudioToneContext,
  audioContext?: AudioToneContext
): EmotionalTone {
  const lang = detectLyricLanguage(text);
  const effectiveAudioCtx: AudioToneContext | undefined =
    audioContext ?? (typeof fallback === 'object' && fallback !== null ? fallback : undefined);

  if (!lang.isEnglish) {
    return deriveToneFromAudio(effectiveAudioCtx);
  }

  // Tokenize preserving word sequence for negation analysis
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 0);

  if (words.length === 0) {
    if (typeof fallback === 'string') return fallback;
    return deriveToneFromAudio(effectiveAudioCtx);
  }

  const scores: Record<EmotionalTone, number> = {
    defiant: 0,
    chaotic: 0,
    menacing: 0,
    euphoric: 0,
    melancholic: 0,
    tender: 0,
    reflective: 0
  };

  const tones: readonly EmotionalTone[] = [
    'defiant',
    'chaotic',
    'menacing',
    'euphoric',
    'melancholic',
    'tender',
    'reflective'
  ] as const;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Check if preceded by a negator in the prior 1-3 tokens
    let isNegated = false;
    const windowStart = Math.max(0, i - 3);
    for (let k = windowStart; k < i; k++) {
      if (NEGATION_TOKENS.has(words[k])) {
        isNegated = true;
        break;
      }
    }

    for (const tone of tones) {
      if (EMOTIONAL_LEXICON[tone].includes(word)) {
        if (!isNegated) {
          scores[tone] += 1;
        } else {
          // Negation inversion & cancellation rules
          if (tone === 'tender' || tone === 'euphoric') {
            scores['melancholic'] += 1;
          } else if (tone === 'melancholic' || tone === 'menacing') {
            scores['defiant'] += 1;
          }
          // Defiant, chaotic, reflective canceled on negation
        }
      }
    }
  }

  let topTone: EmotionalTone = 'reflective';
  let maxScore = 0;
  let runnerUpScore = 0;

  for (const tone of tones) {
    const score = scores[tone];
    if (score > maxScore) {
      runnerUpScore = maxScore;
      maxScore = score;
      topTone = tone;
    } else if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  }

  const MIN_SCORE_THRESHOLD = 1.0;
  const MIN_SCORE_MARGIN = 0.5;

  if (maxScore >= MIN_SCORE_THRESHOLD && maxScore - runnerUpScore >= MIN_SCORE_MARGIN) {
    return topTone;
  }

  // Lyrics gave no clear signal (tie, low hit count, or missing)
  if (typeof fallback === 'string') {
    if (!effectiveAudioCtx) return fallback;
  }
  return deriveToneFromAudio(effectiveAudioCtx);
}

export interface LyricAnalysisResult {
  emotionalTone: EmotionalTone;
  lyricMotifs: string[];
  valenceScore: number;
  intensityScore: number;
  detectedLanguage?: string;
  isEnglish?: boolean;
}

/**
 * Analyzes section or song lyrics to produce structured sentiment and motif metrics.
 */
export function analyzeSectionLyrics(
  lyricsText: string,
  fallback?: EmotionalTone | AudioToneContext,
  audioContext?: AudioToneContext
): LyricAnalysisResult {
  const lang = detectLyricLanguage(lyricsText);
  const effectiveAudioCtx: AudioToneContext | undefined =
    audioContext ?? (typeof fallback === 'object' && fallback !== null ? fallback : undefined);

  let emotionalTone: EmotionalTone;
  let lyricMotifs: string[] = [];

  if (!lang.isEnglish) {
    emotionalTone = deriveToneFromAudio(effectiveAudioCtx);
    lyricMotifs = [];
  } else {
    emotionalTone = classifyEmotionalTone(lyricsText, fallback, effectiveAudioCtx);
    lyricMotifs = extractLyricKeywords(lyricsText, 5);
  }

  const valenceMap: Record<EmotionalTone, number> = {
    euphoric: 0.8,
    tender: 0.6,
    reflective: 0.1,
    defiant: -0.1,
    chaotic: -0.4,
    melancholic: -0.7,
    menacing: -0.9
  };

  const intensityMap: Record<EmotionalTone, number> = {
    defiant: 0.9,
    chaotic: 0.95,
    menacing: 0.85,
    euphoric: 0.8,
    melancholic: 0.45,
    tender: 0.35,
    reflective: 0.25
  };

  return {
    emotionalTone,
    lyricMotifs,
    valenceScore: valenceMap[emotionalTone] ?? 0,
    intensityScore: intensityMap[emotionalTone] ?? 0.5,
    detectedLanguage: lang.language,
    isEnglish: lang.isEnglish
  };
}
