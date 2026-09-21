/**
 * Bring both transcription tracks into one symbol inventory before aligning them.
 *
 * The tracks come from different sources and do not share an IPA convention. For the
 * fixture sentence the symbols unique to each are:
 *
 *   only in phonetic (espeak CTC):  e  ɐ  ɾ  ː
 *   only in phonemic (CMUdict):     ˈ
 *
 * Three of those are notation and must be normalised away; two are the entire point of
 * the project and must survive:
 *
 *   ː   espeak marks vowel length, CMUdict does not   -> strip
 *   ɐ   espeak's reduced vowel where CMUdict has ə    -> map to ə
 *   ˈ ˌ stress marks, phonemic only                   -> strip
 *   ɾ   the flap: /t/ realised as [ɾ]                 -> PRESERVE
 *   e   a genuine vowel difference                    -> PRESERVE
 *
 * Normalise too little and every word looks divergent for spelling reasons. Normalise
 * too much and the real divergences disappear. Both failures are silent.
 */

/** Sequences that are one phone despite being several code points. */
const MULTI_CHAR_PHONES = [
  // diphthongs
  'aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ', 'ɪə', 'eə', 'ʊə',
  // affricates
  'tʃ', 'dʒ',
];

/**
 * Split an IPA string into phones, keeping diphthongs and affricates whole.
 *
 * Needed because the espeak vocab emits multi-character tokens: `aɪ` is one phone but
 * `əl` is two, and a naive per-code-point split would break the first while a naive
 * per-token approach would merge the second.
 */
export function splitPhones(ipa: string): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < ipa.length) {
    const two = ipa.slice(i, i + 2);
    if (MULTI_CHAR_PHONES.includes(two)) {
      out.push(two);
      i += 2;
      continue;
    }
    // Use code points, not UTF-16 units, so anything outside the BMP stays intact.
    const cp = String.fromCodePoint(ipa.codePointAt(i)!);
    out.push(cp);
    i += cp.length;
  }

  return out;
}

/** Notation-only symbols carrying no phonemic content of their own. */
const LENGTH_MARK = /[ːˑ]/g;
const STRESS_MARKS = /[ˈˌ]/g;
/** Ties and syllable dots, which only ever indicate grouping. */
const JOINERS = /[͡‿.]/g;

/** Convention differences between the espeak inventory and CMUdict's. */
const PHONETIC_SUBSTITUTIONS: Record<string, string> = {
  // espeak writes the near-open central vowel where CMUdict writes schwa.
  'ɐ': 'ə',
  // espeak's ᵻ is a reduced high vowel; CMUdict has no separate symbol for it.
  'ᵻ': 'ɪ',
  // Some espeak variants use the IPA trill; English has the approximant.
  'r': 'ɹ',
  // ɡ vs Latin g, which different sources disagree about.
  'g': 'ɡ',
};

/**
 * Normalise the phonetic (espeak CTC) track.
 *
 * Strips length marks and joiners and maps convention-only symbols. Deliberately does
 * NOT touch ɾ, ʔ, ɹ or vowel quality — those carry the signal the whole app measures.
 */
export function normalisePhonetic(ipa: string): string[] {
  const cleaned = ipa.replace(LENGTH_MARK, '').replace(JOINERS, '').replace(STRESS_MARKS, '');
  return splitPhones(cleaned).map((p) => PHONETIC_SUBSTITUTIONS[p] ?? p);
}

/**
 * Normalise the phonemic (CMUdict) track.
 *
 * Only stress marks need removing: the phonetic track has none, so leaving them in
 * would produce a spurious insertion at the start of every stressed syllable.
 */
export function normalisePhonemic(ipa: string): string[] {
  const cleaned = ipa.replace(STRESS_MARKS, '').replace(JOINERS, '');
  return splitPhones(cleaned);
}
