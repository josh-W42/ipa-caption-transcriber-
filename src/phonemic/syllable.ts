import { isVowel, type Phone } from './arpabet';

/**
 * Consonant clusters English permits at the start of a syllable.
 *
 * Maximum onset says push as many consonants as possible into the following
 * syllable — but only as far as the language actually allows. /kɹ/ is a legal onset
 * so "secret" is si.kɹət, while /pk/ is not, so "napkin" is næp.kɪn rather than
 * næ.pkɪn. Without this constraint the rule over-applies and produces syllables no
 * English speaker would say.
 *
 * Written in IPA to match the mapped phones.
 */
const LEGAL_ONSETS = new Set([
  // three-consonant
  'spl', 'spɹ', 'stɹ', 'skɹ', 'skw', 'spj', 'stj', 'skj',
  // s + stop / nasal / approximant
  'sp', 'st', 'sk', 'sm', 'sn', 'sl', 'sw',
  // stop + liquid
  'pl', 'pɹ', 'bl', 'bɹ', 'tɹ', 'dɹ', 'kl', 'kɹ', 'ɡl', 'ɡɹ',
  // fricative + liquid
  'fl', 'fɹ', 'θɹ', 'ʃɹ', 'θw', 'vɹ',
  // consonant + glide
  'tw', 'kw', 'dw', 'ɡw', 'pj', 'bj', 'kj', 'fj', 'hj', 'mj', 'vj',
  // affricate + liquid
  'tʃɹ', 'dʒɹ',
]);

/** Longest suffix of `cluster` that English allows as an onset. */
function longestLegalOnset(cluster: Phone[]): number {
  // A single consonant is always a legal onset, so start there and reach further.
  for (let take = Math.min(cluster.length, 3); take >= 1; take--) {
    const candidate = cluster.slice(cluster.length - take);
    const joined = candidate.map((p) => p.ipa).join('');
    if (take === 1 || LEGAL_ONSETS.has(joined)) return take;
  }
  return 0;
}

/**
 * Split a word's phones into syllables, one per vowel, by maximum onset.
 *
 * M2 needs this because IPA places the stress mark before the SYLLABLE rather than
 * before the vowel, and CMUdict provides no syllable boundaries. M4 needs it again
 * for syllable-shape statistics, so it is built once here.
 */
export function syllabify(phones: Phone[]): Phone[][] {
  if (phones.length === 0) return [];

  const nuclei: number[] = [];
  phones.forEach((p, i) => {
    if (isVowel(p)) nuclei.push(i);
  });

  // No vowel — an interjection like "hm". One syllable, whatever it contains.
  if (nuclei.length === 0) return [phones];

  /**
   * Index where syllable n begins.
   *
   * The first syllable starts at the word's start, taking every leading consonant
   * however unusual the cluster — it is simply what the word begins with. Every later
   * syllable claims as much of the preceding consonant run as English allows as an
   * onset; whatever it cannot claim stays as the previous syllable's coda.
   */
  const startOf = (n: number): number => {
    if (n === 0) return 0;
    const nucleus = nuclei[n];
    const cluster = phones.slice(nuclei[n - 1] + 1, nucleus);
    return nucleus - longestLegalOnset(cluster);
  };

  // Each syllable runs until the next one starts; the last takes the trailing coda.
  return nuclei.map((_, n) =>
    phones.slice(startOf(n), n === nuclei.length - 1 ? phones.length : startOf(n + 1)),
  );
}

const PRIMARY = 'ˈ'; // ˈ
const SECONDARY = 'ˌ'; // ˌ

/**
 * Render a word's phones as a phonemic IPA string with stress marks.
 *
 * Monosyllables carry no mark: stress has nowhere else to be, and IPA convention
 * omits it.
 */
export function transcribeWord(phones: Phone[]): string {
  const syllables = syllabify(phones);
  if (syllables.length === 0) return '';

  const single = syllables.length === 1;

  return syllables
    .map((syl) => {
      const nucleus = syl.find(isVowel);
      const body = syl.map((p) => p.ipa).join('');
      if (single || !nucleus) return body;

      if (nucleus.stress === 1) return PRIMARY + body;
      if (nucleus.stress === 2) return SECONDARY + body;
      return body;
    })
    .join('');
}
