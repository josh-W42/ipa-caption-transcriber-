import { describe, it, expect } from 'vitest';
import { splitPhones, normalisePhonetic, normalisePhonemic } from './normalise';

/**
 * The two tracks come from different sources and do not share an IPA convention.
 * Comparing the M0 phonetic output against the M2 phonemic output for the same
 * sentence, the symbols unique to each are:
 *
 *   only in phonetic:  e  ɐ  ɾ  ː
 *   only in phonemic:  ˈ
 *
 * Three are notation (ː length, ɐ for schwa, ˈ stress) and must be normalised away.
 * Two are the actual finding (ɾ the flap, e a real vowel difference) and must survive.
 * Normalise too little and every word looks divergent; too much and the findings vanish.
 */
describe('splitPhones', () => {
  it('keeps diphthongs as single phones', () => {
    expect(splitPhones('aɪ')).toEqual(['aɪ']);
    expect(splitPhones('oʊ')).toEqual(['oʊ']);
  });

  it('keeps affricates as single phones', () => {
    expect(splitPhones('tʃ')).toEqual(['tʃ']);
    expect(splitPhones('dʒ')).toEqual(['dʒ']);
  });

  it('splits multi-character vocab tokens that are really two phones', () => {
    // The espeak vocab emits əl as one CTC token; it is a schwa plus a lateral.
    expect(splitPhones('əl')).toEqual(['ə', 'l']);
  });

  it('splits a plain sequence per phone', () => {
    expect(splitPhones('bʌtɚ')).toEqual(['b', 'ʌ', 't', 'ɚ']);
  });

  it('handles an empty string', () => {
    expect(splitPhones('')).toEqual([]);
  });
});

describe('normalisePhonetic', () => {
  it('strips length marks, which CMUdict has no equivalent for', () => {
    expect(normalisePhonetic('bɑːt')).toEqual(['b', 'ɑ', 't']);
    expect(normalisePhonetic('iː')).toEqual(['i']);
  });

  it('maps espeak ɐ to schwa', () => {
    expect(normalisePhonetic('ɐ')).toEqual(['ə']);
  });

  it('PRESERVES the flap — this is the finding, not noise', () => {
    expect(normalisePhonetic('bʌɾɚ')).toEqual(['b', 'ʌ', 'ɾ', 'ɚ']);
  });

  it('PRESERVES the glottal stop', () => {
    expect(normalisePhonetic('bʌʔn')).toContain('ʔ');
  });

  it('PRESERVES vowel quality differences', () => {
    expect(normalisePhonetic('wɑːɾɚ')).toEqual(['w', 'ɑ', 'ɾ', 'ɚ']);
  });
});

describe('normalisePhonemic', () => {
  it('strips primary stress', () => {
    expect(normalisePhonemic('ˈbʌtɚ')).toEqual(['b', 'ʌ', 't', 'ɚ']);
  });

  it('strips secondary stress', () => {
    expect(normalisePhonemic('ˌʌndɚˈstænd')).not.toContain('ˌ');
    expect(normalisePhonemic('ˌʌndɚˈstænd')).not.toContain('ˈ');
  });

  it('leaves the phones themselves untouched', () => {
    expect(normalisePhonemic('ˈsɪti')).toEqual(['s', 'ɪ', 't', 'i']);
  });
});

describe('the two tracks after normalisation', () => {
  it('agrees on butter except for the flap', () => {
    const phonetic = normalisePhonetic('bʌɾɚ');
    const phonemic = normalisePhonemic('ˈbʌtɚ');
    expect(phonetic).toHaveLength(phonemic.length);
    expect(phonetic.filter((p, i) => p !== phonemic[i])).toEqual(['ɾ']);
  });

  it('agrees on bought once the length mark is gone', () => {
    expect(normalisePhonetic('bɑːt')).toEqual(normalisePhonemic('bɑt'));
  });

  it('agrees on the reduced article once ɐ maps to schwa', () => {
    expect(normalisePhonetic('ɐ')).toEqual(normalisePhonemic('ə'));
  });

  it('still disagrees where the speaker genuinely differs from the dictionary', () => {
    // city: dictionary /sɪti/, spoken [sɪɾi] — a real flap, must not be normalised away.
    expect(normalisePhonetic('sɪɾi')).not.toEqual(normalisePhonemic('ˈsɪti'));
  });
});
