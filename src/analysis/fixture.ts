import { alignUtterance, type AlignedWord } from '../align/utterance';
import { splitPhones } from '../align/normalise';
import type { DecodedPhone } from '../phonetic/ctc';
import type { WordTranscription } from '../phonemic/lexicon';

/**
 * The fixture sentence, as both tracks actually produce it.
 *
 * Phonemic is the CMUdict lookup shipped in M2; phonetic is the espeak CTC output
 * measured in M0. Using the real strings rather than invented ones keeps the analysis
 * tests honest — they assert against what the system genuinely produces.
 */
export const FIXTURE_WORDS: Array<[word: string, phonemic: string, phonetic: string]> = [
  ['I', 'aɪ', 'aɪ'],
  ['bought', 'bɑt', 'bɑːt'],
  ['a', 'ə', 'ɐ'],
  ['little', 'ˈlɪtəl', 'lɪɾəl'],
  ['butter', 'ˈbʌtɚ', 'bʌɾɚ'],
  ['and', 'ənd', 'ænd'],
  ['some', 'sʌm', 'sʌm'],
  ['water', 'ˈwɔtɚ', 'wɑːɾɚ'],
  ['at', 'æt', 'æt'],
  ['the', 'ðə', 'ðə'],
  ['city', 'ˈsɪti', 'sɪɾi'],
  ['market', 'ˈmɑɹkət', 'mɑːɹkɪt'],
  ['on', 'ɑn', 'ɔn'],
  ['Saturday.', 'ˈsætɚdi', 'sæɾɚdeɪ'],
];

/** Build the aligned utterance the analysis functions consume. */
export function fixtureAligned(): AlignedWord[] {
  const words: WordTranscription[] = FIXTURE_WORDS.map(([word, phonemic]) => ({
    word,
    found: true,
    ipa: phonemic,
  }));

  const decoded: DecodedPhone[] = [];
  let t = 0;
  for (const [, , phonetic] of FIXTURE_WORDS) {
    for (const phone of splitPhones(phonetic)) {
      decoded.push({ phone, start: t, end: t + 0.02, conf: 0.9 });
      t += 0.02;
    }
  }

  return alignUtterance(words, decoded);
}
