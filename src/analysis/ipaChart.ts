/**
 * The IPA chart, restricted to English.
 *
 * Laid out as the real thing is — consonants by place across and manner down, vowels
 * by backness across and height down — because that arrangement IS the analysis. Where
 * a speaker's sounds cluster on the chart says something a bar chart cannot.
 *
 * Empty cells are meaningful. English has no bilabial fricative, and that gap is a
 * fact about the language, not missing data, so the chart renders it as empty rather
 * than omitting the column.
 */

export const CONSONANT_PLACES = [
  'bilabial', 'labiodental', 'dental', 'alveolar', 'postalveolar', 'palatal', 'velar', 'glottal',
] as const;

export const CONSONANT_MANNERS = [
  'plosive', 'nasal', 'tap', 'fricative', 'affricate', 'approximant', 'lateral',
] as const;

export type Place = (typeof CONSONANT_PLACES)[number];
export type Manner = (typeof CONSONANT_MANNERS)[number];

/** [manner][place] -> phones, voiceless first where the pair exists. */
export const CONSONANT_GRID: Partial<Record<Manner, Partial<Record<Place, string[]>>>> = {
  plosive: {
    bilabial: ['p', 'b'],
    alveolar: ['t', 'd'],
    velar: ['k', 'ɡ'],
    glottal: ['ʔ'],
  },
  nasal: {
    bilabial: ['m'],
    alveolar: ['n'],
    velar: ['ŋ'],
  },
  tap: {
    alveolar: ['ɾ'],
  },
  fricative: {
    labiodental: ['f', 'v'],
    dental: ['θ', 'ð'],
    alveolar: ['s', 'z'],
    postalveolar: ['ʃ', 'ʒ'],
    glottal: ['h'],
  },
  affricate: {
    postalveolar: ['tʃ', 'dʒ'],
  },
  approximant: {
    alveolar: ['ɹ'],
    palatal: ['j'],
    velar: ['w'],
  },
  lateral: {
    alveolar: ['l'],
  },
};

export const VOWEL_HEIGHTS = ['close', 'close-mid', 'mid', 'open-mid', 'open'] as const;
export const VOWEL_BACKNESS = ['front', 'central', 'back'] as const;

export type Height = (typeof VOWEL_HEIGHTS)[number];
export type Backness = (typeof VOWEL_BACKNESS)[number];

export const VOWEL_GRID: Partial<Record<Height, Partial<Record<Backness, string[]>>>> = {
  close: { front: ['i', 'ɪ'], back: ['u', 'ʊ'] },
  'close-mid': { front: ['e'], back: ['o'] },
  mid: { central: ['ə', 'ɚ'] },
  // ɜ sits here with ʌ and ɝ: the cross-check against the feature inventory caught
  // it missing, which would have made it invisible on the chart while still alignable.
  'open-mid': { front: ['ɛ'], central: ['ʌ', 'ɜ', 'ɝ'], back: ['ɔ'] },
  open: { front: ['æ', 'a'], back: ['ɑ'] },
};

/** Diphthongs have no single chart position, so they get their own row. */
export const DIPHTHONGS = ['aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ'];

/** Every phone the chart can display, for coverage checks. */
export function chartPhones(): string[] {
  const out: string[] = [];
  for (const manner of Object.values(CONSONANT_GRID)) {
    for (const phones of Object.values(manner)) out.push(...phones);
  }
  for (const height of Object.values(VOWEL_GRID)) {
    for (const phones of Object.values(height)) out.push(...phones);
  }
  out.push(...DIPHTHONGS);
  return out;
}

/**
 * Shading intensity for a phone, on a 0-1 scale relative to the most used phone.
 *
 * Square-rooted so the long tail stays visible: English phone frequencies are steeply
 * skewed, and a linear scale renders everything below the top few as indistinguishable
 * from unused.
 */
export function intensity(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  return Math.sqrt(count / max);
}
