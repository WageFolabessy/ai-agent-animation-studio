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

export const EMOTIONAL_LEXICON: Record<EmotionalTone, readonly string[]> = {
  defiant: [
    'fight', 'rise', 'stand', 'never', 'break', 'free', 'proud', 'fire', 'roar',
    'resist', 'strike', 'strong', 'rage', 'alive', 'scream', 'conquer', 'rebel',
    'blaze', 'warrior', 'brave', 'defeat', 'fearless', 'scars', 'unbroken', 'burn'
  ],
  melancholic: [
    'sorrow', 'lonely', 'cry', 'tear', 'tears', 'weep', 'sad', 'lost', 'fade',
    'pain', 'bleed', 'dark', 'shadow', 'cold', 'gone', 'hurt', 'broken', 'hollow',
    'grief', 'wound', 'alone', 'goodbye', 'despair', 'empty', 'mourn', 'gray'
  ],
  tender: [
    'love', 'hold', 'gentle', 'soft', 'warm', 'whisper', 'touch', 'heart', 'safe',
    'sweet', 'stay', 'kiss', 'beauty', 'peace', 'care', 'cherish', 'quiet', 'dream',
    'embrace', 'light', 'kind', 'heals', 'comfort', 'precious'
  ],
  euphoric: [
    'shine', 'fly', 'high', 'joy', 'glow', 'dance', 'gold', 'golden', 'magic', 'star',
    'stars', 'heavens', 'wild', 'celebrate', 'victory', 'bliss', 'spark', 'electric',
    'wonder', 'paradise', 'radiant', 'heaven', 'ecstasy', 'sunshine', 'forever'
  ],
  menacing: [
    'fear', 'crawl', 'blood', 'kill', 'teeth', 'doom', 'poison', 'demon', 'nightmare',
    'dread', 'stalk', 'curse', 'venom', 'rot', 'horror', 'monster', 'death', 'choke',
    'prey', 'abyss', 'trap', 'fang', 'shadows', 'wicked', 'creeping'
  ],
  reflective: [
    'remember', 'time', 'mirror', 'silent', 'silence', 'think', 'slowly', 'yesterday',
    'wander', 'wonder', 'trace', 'echo', 'echoes', 'memory', 'memories', 'breath',
    'horizon', 'still', 'road', 'look', 'past', 'soul', 'story', 'path', 'waiting'
  ],
  chaotic: [
    'burn', 'crash', 'chaos', 'madness', 'storm', 'shatter', 'fall', 'explode', 'run',
    'blind', 'twisted', 'furious', 'noise', 'panic', 'wreck', 'clash', 'violent',
    'blast', 'riot', 'frenzy', 'distort', 'insane', 'shaking'
  ]
};

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
 */
export function extractLyricKeywords(text: string, topK = 5): string[] {
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

/**
 * Classifies the emotional tone of text into one of 7 canonical tags using the embedded compact lexicon.
 */
export function classifyEmotionalTone(
  text: string,
  defaultTone: EmotionalTone = 'reflective'
): EmotionalTone {
  const tokens = tokenizeLyrics(text);
  if (tokens.length === 0) return defaultTone;

  const tokenSet = new Map<string, number>();
  for (const t of tokens) {
    tokenSet.set(t, (tokenSet.get(t) ?? 0) + 1);
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

  const tones: EmotionalTone[] = [
    'defiant',
    'chaotic',
    'menacing',
    'euphoric',
    'melancholic',
    'tender',
    'reflective'
  ];

  for (const tone of tones) {
    const words = EMOTIONAL_LEXICON[tone];
    for (const word of words) {
      if (tokenSet.has(word)) {
        scores[tone] += tokenSet.get(word)!;
      }
    }
  }

  let bestTone = defaultTone;
  let maxScore = 0;

  for (const tone of tones) {
    if (scores[tone] > maxScore) {
      maxScore = scores[tone];
      bestTone = tone;
    }
  }

  return bestTone;
}

export interface LyricAnalysisResult {
  emotionalTone: EmotionalTone;
  lyricMotifs: string[];
  valenceScore: number;
  intensityScore: number;
}

/**
 * Analyzes section or song lyrics to produce structured sentiment and motif metrics.
 */
export function analyzeSectionLyrics(
  lyricsText: string,
  defaultTone: EmotionalTone = 'reflective'
): LyricAnalysisResult {
  const emotionalTone = classifyEmotionalTone(lyricsText, defaultTone);
  const lyricMotifs = extractLyricKeywords(lyricsText, 5);

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
    intensityScore: intensityMap[emotionalTone] ?? 0.5
  };
}
