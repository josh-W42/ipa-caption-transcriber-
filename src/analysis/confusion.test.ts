import { describe, it, expect } from 'vitest';
import { confusionMatrix, cellCount, topConfusions, NULL_PHONE } from './confusion';
import { fixtureAligned } from './fixture';
import { alignUtterance, type AlignedWord } from '../align/utterance';
import { splitPhones } from '../align/normalise';
import type { DecodedPhone } from '../phonetic/ctc';

function one(word: string, phonemic: string, phonetic: string): AlignedWord[] {
  const decoded: DecodedPhone[] = splitPhones(phonetic).map((phone, i) => ({
    phone, start: i * 0.02, end: (i + 1) * 0.02, conf: 0.9,
  }));
  return alignUtterance([{ word, found: true, ipa: phonemic }], decoded);
}

describe('confusionMatrix', () => {
  it('collects matches on the diagonal', () => {
    const m = confusionMatrix(one('cat', 'kæt', 'kæt'));
    expect(cellCount(m, 'k', 'k')).toBe(1);
    expect(m.totalDivergent).toBe(0);
    expect(m.phoneErrorRate).toBe(0);
  });

  it('places a substitution in the right cell', () => {
    const m = confusionMatrix(one('butter', 'bʌtɚ', 'bʌɾɚ'));
    expect(cellCount(m, 't', 'ɾ')).toBe(1);
  });

  it('gives deletions an explicit null column rather than dropping them', () => {
    // A phone expected and not produced is a finding. Omitting it would understate
    // divergence, which is the one direction an analysis tool must not err in.
    const m = confusionMatrix(one('and', 'ænd', 'æn'));
    expect(cellCount(m, 'd', NULL_PHONE)).toBe(1);
    expect(m.columns).toContain(NULL_PHONE);
  });

  it('counts the fixture\'s five flaps in one cell', () => {
    expect(cellCount(confusionMatrix(fixtureAligned()), 't', 'ɾ')).toBe(5);
  });

  it('computes a phone error rate over aligned operations', () => {
    const m = confusionMatrix(fixtureAligned());
    expect(m.totalAligned).toBeGreaterThan(40);
    expect(m.phoneErrorRate).toBeGreaterThan(0);
    expect(m.phoneErrorRate).toBeLessThan(0.3);
  });

  it('orders rows and columns by frequency', () => {
    const m = confusionMatrix(fixtureAligned());
    const firstTotal = m.cells.filter((c) => c.expected === m.rows[0]).reduce((n, c) => n + c.count, 0);
    const lastTotal = m.cells
      .filter((c) => c.expected === m.rows[m.rows.length - 1])
      .reduce((n, c) => n + c.count, 0);
    expect(firstTotal).toBeGreaterThanOrEqual(lastTotal);
  });

  it('handles an utterance with no phonetic track', () => {
    const m = confusionMatrix([
      { word: 'x', phonemic: 'x', phonetic: [], ops: [], start: null, end: null },
    ]);
    expect(m.cells).toEqual([]);
    expect(m.phoneErrorRate).toBe(0);
  });
});

describe('topConfusions', () => {
  it('excludes the diagonal and ranks by count', () => {
    const top = topConfusions(confusionMatrix(fixtureAligned()));
    expect(top.every((c) => c.expected !== c.produced)).toBe(true);
    expect(top[0]).toMatchObject({ expected: 't', produced: 'ɾ', count: 5 });
  });
});
