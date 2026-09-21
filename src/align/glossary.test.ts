import { describe, it, expect } from 'vitest';
import { buildGlossary, divergentRows, describeChange } from './glossary';
import type { AlignedWord } from './utterance';
import type { AlignOp } from './align';

const sub = (from: string, to: string): AlignOp => ({
  type: 'substitute', from, to, aIndex: 0, bIndex: 0, cost: 0.13,
});
const match = (p: string): AlignOp => ({
  type: 'match', from: p, to: p, aIndex: 0, bIndex: 0, cost: 0,
});

const w = (
  word: string,
  phonemic: string | null,
  phonetic: string,
  ops: AlignOp[] = [],
): AlignedWord => ({
  word,
  phonemic,
  phonetic: [...phonetic].map((phone, i) => ({
    phone, start: i * 0.02, end: (i + 1) * 0.02, conf: 0.9,
  })),
  ops,
  start: 0,
  end: 0.1,
});

describe('buildGlossary', () => {
  it('keeps words in order of first appearance', () => {
    const rows = buildGlossary([w('the', 'ðə', 'ðə'), w('butter', 'ˈbʌtɚ', 'bʌɾɚ')]);
    expect(rows.map((r) => r.word)).toEqual(['the', 'butter']);
  });

  it('collapses repeats and counts them', () => {
    const rows = buildGlossary([w('the', 'ðə', 'ðə'), w('cat', 'kæt', 'kæt'), w('the', 'ðə', 'ðə')]);
    expect(rows).toHaveLength(2);
    expect(rows[0].count).toBe(2);
  });

  it('treats differing case and punctuation as the same word', () => {
    const rows = buildGlossary([w('The', 'ðə', 'ðə'), w('the.', 'ðə', 'ðə')]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it('drops punctuation-only tokens', () => {
    expect(buildGlossary([w('—', null, '')])).toHaveLength(0);
  });

  it('carries the expected and actual pronunciations', () => {
    const rows = buildGlossary([w('butter', 'ˈbʌtɚ', 'bʌɾɚ', [sub('t', 'ɾ')])]);
    expect(rows[0].expected).toBe('ˈbʌtɚ');
    expect(rows[0].actual).toBe('bʌɾɚ');
  });

  it('keeps out-of-vocabulary words with a null expectation', () => {
    const rows = buildGlossary([w('kerfuffle', null, 'kɚfʌfəl')]);
    expect(rows[0].expected).toBeNull();
    expect(rows[0].actual).toBe('kɚfʌfəl');
  });

  it('records only the non-match operations as changes', () => {
    const rows = buildGlossary([w('butter', 'ˈbʌtɚ', 'bʌɾɚ', [match('b'), sub('t', 'ɾ')])]);
    expect(rows[0].changes).toHaveLength(1);
  });

  it('leaves actual empty before the phoneme model has run', () => {
    const rows = buildGlossary([w('butter', 'ˈbʌtɚ', '')]);
    expect(rows[0].actual).toBe('');
    expect(rows[0].changes).toHaveLength(0);
  });
});

describe('divergentRows', () => {
  it('selects only the words that differ from the dictionary', () => {
    const rows = buildGlossary([
      w('the', 'ðə', 'ðə', [match('ð')]),
      w('butter', 'ˈbʌtɚ', 'bʌɾɚ', [sub('t', 'ɾ')]),
    ]);
    expect(divergentRows(rows).map((r) => r.word)).toEqual(['butter']);
  });
});

describe('describeChange', () => {
  it('reads like a phonetics textbook', () => {
    expect(describeChange(sub('t', 'ɾ'))).toBe('/t/ → [ɾ]');
    expect(describeChange({ ...sub('t', 'ɾ'), type: 'delete', to: null })).toBe('/t/ dropped');
    expect(describeChange({ ...sub('t', 'ɾ'), type: 'insert', from: null })).toBe('[ɾ] added');
  });
});
