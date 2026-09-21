import { describe, it, expect } from 'vitest';
import { arpaToIpa, arpaToPhones, splitStress } from './arpabet';

describe('splitStress', () => {
  it('separates the stress digit from the phone', () => {
    expect(splitStress('AH1')).toEqual({ base: 'AH', stress: 1 });
    expect(splitStress('IY0')).toEqual({ base: 'IY', stress: 0 });
  });

  it('reports null stress for consonants', () => {
    expect(splitStress('T')).toEqual({ base: 'T', stress: null });
  });
});

describe('arpaToIpa', () => {
  it('maps consonants', () => {
    expect(arpaToIpa(['B', 'T', 'K'])).toEqual(['b', 't', 'k']);
  });

  it('maps the digraph consonants English spelling hides', () => {
    expect(arpaToIpa(['CH', 'JH', 'SH', 'ZH', 'TH', 'DH', 'NG'])).toEqual([
      'tʃ', 'dʒ', 'ʃ', 'ʒ', 'θ', 'ð', 'ŋ',
    ]);
  });

  it('uses the IPA rhotic and velar, not their ASCII lookalikes', () => {
    // English /r/ is the approximant ɹ, not the trill r; ɡ is U+0261, not Latin g.
    expect(arpaToIpa(['R'])).toEqual(['ɹ']);
    expect(arpaToIpa(['G'])).toEqual(['ɡ']);
  });

  it('maps diphthongs as single units', () => {
    expect(arpaToIpa(['AY', 'AW', 'OY', 'EY', 'OW'])).toEqual(['aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ']);
  });

  it('strips stress digits from the phone itself', () => {
    expect(arpaToIpa(['IY1', 'IH0', 'EH2'])).toEqual(['i', 'ɪ', 'ɛ']);
  });

  it('distinguishes stressed AH from unstressed schwa', () => {
    // The most audible reduction in English: AH1 is ʌ, AH0 reduces to ə.
    expect(arpaToIpa(['AH1'])).toEqual(['ʌ']);
    expect(arpaToIpa(['AH2'])).toEqual(['ʌ']);
    expect(arpaToIpa(['AH0'])).toEqual(['ə']);
  });

  it('distinguishes stressed ER from unstressed rhotic schwa', () => {
    expect(arpaToIpa(['ER1'])).toEqual(['ɝ']);
    expect(arpaToIpa(['ER0'])).toEqual(['ɚ']);
  });

  it('transcribes whole words', () => {
    // butter -> B AH1 T ER0, straight from the shipped lexicon
    expect(arpaToIpa('B AH1 T ER0'.split(' ')).join('')).toBe('bʌtɚ');
    expect(arpaToIpa('AH0 B AW1 T'.split(' ')).join('')).toBe('əbaʊt');
  });

  it('covers all 39 phones in the CMUdict set', () => {
    const all = ('AA AE AH AO AW AY B CH D DH EH ER EY F G HH IH IY JH K L M N NG ' +
      'OW OY P R S SH T TH UH UW V W Y Z ZH').split(' ');
    expect(all).toHaveLength(39);
    for (const p of all) {
      const symbol = 'AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW'.includes(p) ? `${p}1` : p;
      expect(() => arpaToIpa([symbol])).not.toThrow();
    }
  });

  it('throws on an unknown symbol rather than emitting something plausible', () => {
    expect(() => arpaToIpa(['QQ'])).toThrow(/QQ/);
  });
});

describe('arpaToPhones', () => {
  it('carries stress through for the syllabifier', () => {
    const phones = arpaToPhones('B AH1 T ER0'.split(' '));
    expect(phones.map((p) => p.stress)).toEqual([null, 1, null, 0]);
  });
});
