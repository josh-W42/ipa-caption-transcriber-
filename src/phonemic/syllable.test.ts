import { describe, it, expect } from 'vitest';
import { syllabify, transcribeWord } from './syllable';
import { arpaToPhones } from './arpabet';

const P = (s: string) => arpaToPhones(s.split(' '));
const show = (syl: ReturnType<typeof P>) => syl.map((p) => p.ipa).join('');

describe('syllabify', () => {
  it('gives one syllable per vowel', () => {
    expect(syllabify(P('B AH1 T ER0'))).toHaveLength(2);
    expect(syllabify(P('K AE1 T'))).toHaveLength(1);
    expect(syllabify(P('EH1 K S AH0 L AH0 N T'))).toHaveLength(3);
  });

  it('assigns a single medial consonant to the following onset', () => {
    // butter -> bʌ.tɚ, not bʌt.ɚ
    const s = syllabify(P('B AH1 T ER0'));
    expect(show(s[0])).toBe('bʌ');
    expect(show(s[1])).toBe('tɚ');
  });

  it('applies maximum onset for clusters English permits', () => {
    // secret -> si.kɹət, because /kɹ/ is a legal English onset
    const s = syllabify(P('S IY1 K R AH0 T'));
    expect(show(s[0])).toBe('si');
    expect(show(s[1])).toBe('kɹət');
  });

  it('splits a cluster English does not allow word-initially', () => {
    // napkin -> næp.kɪn, because /pk/ is not a legal onset
    const s = syllabify(P('N AE1 P K IH0 N'));
    expect(show(s[0])).toBe('næp');
    expect(show(s[1])).toBe('kɪn');
  });

  it('keeps leading consonants with the first syllable', () => {
    const s = syllabify(P('S T R IY1 T'));
    expect(s).toHaveLength(1);
    expect(show(s[0])).toBe('stɹit');
  });

  it('keeps trailing consonants with the last syllable', () => {
    const s = syllabify(P('B AH1 T ER0 D'));
    expect(show(s[1])).toBe('tɚd');
  });

  it('handles a word with no vowels without crashing', () => {
    const s = syllabify(P('HH M'));
    expect(s).toHaveLength(1);
    expect(show(s[0])).toBe('hm');
  });

  it('handles an empty input', () => {
    expect(syllabify([])).toEqual([]);
  });

  it('never loses or duplicates a phone', () => {
    for (const w of ['B AH1 T ER0', 'S IY1 K R AH0 T', 'N AE1 P K IH0 N', 'EH1 K S AH0 L AH0 N T']) {
      const phones = P(w);
      const flat = syllabify(phones).flat();
      expect(flat.map((p) => p.arpa)).toEqual(phones.map((p) => p.arpa));
    }
  });
});

describe('transcribeWord', () => {
  it('places primary stress before the syllable, not the vowel', () => {
    expect(transcribeWord(P('B AH1 T ER0'))).toBe('ˈbʌtɚ');
  });

  it('marks stress on a later syllable', () => {
    expect(transcribeWord(P('AH0 B AW1 T'))).toBe('əˈbaʊt');
  });

  it('omits the mark on monosyllables, as IPA convention does', () => {
    expect(transcribeWord(P('K AE1 T'))).toBe('kæt');
    expect(transcribeWord(P('S T R IY1 T'))).toBe('stɹit');
  });

  it('transcribes a polysyllabic word', () => {
    expect(transcribeWord(P('EH1 K S AH0 L AH0 N T'))).toBe('ˈɛksələnt');
  });

  it('uses the IPA stress marks, not ASCII apostrophes', () => {
    const out = transcribeWord(P('AH0 B AW1 T'));
    expect(out).toContain('\u02c8'); // ˈ modifier letter vertical line
    expect(out).not.toContain("'");
  });

  it('marks secondary stress with the correct symbol', () => {
    // understand -> AH2 N D ER0 S T AE1 N D
    const out = transcribeWord(P('AH2 N D ER0 S T AE1 N D'));
    expect(out).toContain('\u02cc'); // ˌ modifier letter low vertical line
    expect(out).toContain('\u02c8');
  });
});
