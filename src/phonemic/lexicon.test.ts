import { describe, it, expect } from 'vitest';
import { normaliseWord, Lexicon } from './lexicon';

describe('normaliseWord', () => {
  it('lowercases', () => expect(normaliseWord('Butter')).toBe('butter'));

  it('strips the punctuation Whisper attaches to words', () => {
    expect(normaliseWord('butter.')).toBe('butter');
    expect(normaliseWord('butter,')).toBe('butter');
    expect(normaliseWord('"butter,"')).toBe('butter');
    expect(normaliseWord('(butter)')).toBe('butter');
    expect(normaliseWord('butter?!')).toBe('butter');
  });

  it('keeps word-internal apostrophes, which CMUdict has entries for', () => {
    expect(normaliseWord("don't")).toBe("don't");
    expect(normaliseWord("Don't.")).toBe("don't");
    expect(normaliseWord("'cause")).toBe("'cause");
  });

  it('keeps internal hyphens', () => {
    expect(normaliseWord('well-known')).toBe('well-known');
  });

  it('returns empty for punctuation-only tokens', () => {
    expect(normaliseWord('—')).toBe('');
    expect(normaliseWord('...')).toBe('');
    expect(normaliseWord('')).toBe('');
  });
});

describe('Lexicon', () => {
  const lex = Lexicon.fromText(
    ['butter\tB AH1 T ER0', "don't\tD OW1 N T", 'about\tAH0 B AW1 T', "'cause\tK AH0 Z"].join('\n'),
  );

  it('looks up a known word and transcribes it', () => {
    expect(lex.lookup('Butter.')).toEqual({ word: 'Butter.', found: true, ipa: 'ˈbʌtɚ' });
  });

  it('places stress correctly through the full pipeline', () => {
    expect(lex.lookup('about').ipa).toBe('əˈbaʊt');
  });

  it('handles contractions and leading apostrophes', () => {
    expect(lex.lookup("don't").found).toBe(true);
    expect(lex.lookup("'cause").found).toBe(true);
  });

  it('reports out-of-vocabulary words rather than guessing', () => {
    // Guessing would be dishonest: a wrong phonemic reference silently corrupts
    // every divergence measurement M4 makes against it.
    expect(lex.lookup('kerfuffleization')).toEqual({
      word: 'kerfuffleization',
      found: false,
      ipa: null,
    });
  });

  it('treats punctuation-only tokens as not found without crashing', () => {
    expect(lex.lookup('—').found).toBe(false);
  });

  it('reports its size', () => expect(lex.size).toBe(4));

  it('transcribes a whole line, preserving token order', () => {
    const out = lex.transcribe("I bought butter, don't ask");
    expect(out.map((t) => t.word)).toEqual(['I', 'bought', 'butter,', "don't", 'ask']);
    expect(out[2].ipa).toBe('ˈbʌtɚ');
    expect(out[0].found).toBe(false); // 'I' is not in this miniature lexicon
  });

  it('caches repeated lookups', () => {
    const a = lex.lookup('butter');
    const b = lex.lookup('butter');
    expect(a.ipa).toBe(b.ipa);
  });
});
