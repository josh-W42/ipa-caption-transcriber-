import { describe, it, expect } from 'vitest';
import {
  phoneCounts,
  compareToBaseline,
  notableDeviations,
  totalPhones,
  MIN_EXPECTED,
  type Baseline,
} from './inventory';
import type { AlignedWord } from '../align/utterance';

const w = (word: string, phonetic: string, phonemic = phonetic): AlignedWord => ({
  word,
  phonemic,
  phonetic: [...phonetic].map((phone, i) => ({
    phone, start: i * 0.02, end: (i + 1) * 0.02, conf: 0.9,
  })),
  ops: [],
  start: 0,
  end: 0.1,
});

const baseline: Baseline = {
  source: 'test',
  note: 'test',
  tokenCoverage: 1,
  totalPhoneTokens: 100,
  proportions: { t: 0.25, a: 0.25, s: 0.25, ʒ: 0.25 },
};

describe('phoneCounts', () => {
  it('counts what was produced, not what was expected', () => {
    // Phonemic says /t/, phonetic says [ɾ]. The speaker said [ɾ].
    const counts = phoneCounts([w('butter', 'bʌɾɚ', 'bʌtɚ')]);
    expect(counts.find((c) => c.phone === 'ɾ')?.count).toBe(1);
    expect(counts.find((c) => c.phone === 't')).toBeUndefined();
  });

  it('sorts by frequency', () => {
    const counts = phoneCounts([w('x', 'aaab')]);
    expect(counts[0].phone).toBe('a');
    expect(counts[0].count).toBe(3);
  });

  it('returns proportions summing to 1', () => {
    const counts = phoneCounts([w('x', 'abcd')]);
    const sum = counts.reduce((n, c) => n + c.proportion, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('returns nothing when the phonetic track has not run', () => {
    const word: AlignedWord = { ...w('x', ''), phonetic: [] };
    expect(phoneCounts([word])).toEqual([]);
  });
});

describe('compareToBaseline', () => {
  it('reports over-use relative to the baseline', () => {
    // 'a' is half the sample but a quarter of the baseline.
    const counts = phoneCounts([w('x', 'aatt'.repeat(20))]);
    const cmp = compareToBaseline(counts, baseline);
    expect(cmp.find((c) => c.phone === 'a')!.ratio).toBeCloseTo(2, 1);
  });

  it('reports phones the speaker used that the baseline lacks', () => {
    const counts = phoneCounts([w('x', 'ɾ')]);
    const cmp = compareToBaseline(counts, baseline);
    const flap = cmp.find((c) => c.phone === 'ɾ')!;
    expect(flap.count).toBe(1);
    expect(flap.ratio).toBe(Infinity);
  });

  it('includes baseline phones the speaker never used', () => {
    const cmp = compareToBaseline(phoneCounts([w('x', 'ttt')]), baseline);
    expect(cmp.find((c) => c.phone === 'ʒ')?.count).toBe(0);
  });

  it('marks a short sample as insufficient rather than claiming absence', () => {
    // Three phones cannot support "this speaker never uses /ʒ/".
    const cmp = compareToBaseline(phoneCounts([w('x', 'ttt')]), baseline);
    expect(cmp.find((c) => c.phone === 'ʒ')!.sufficient).toBe(false);
  });

  it('marks a long enough sample as sufficient', () => {
    // 25% expected rate needs 20 phones to expect MIN_EXPECTED of them.
    const long = 'tasʒ'.repeat(MIN_EXPECTED * 2);
    const cmp = compareToBaseline(phoneCounts([w('x', long)]), baseline);
    expect(cmp.find((c) => c.phone === 'ʒ')!.sufficient).toBe(true);
  });

  it('returns nothing for an empty sample', () => {
    expect(compareToBaseline([], baseline)).toEqual([]);
  });
});

describe('notableDeviations', () => {
  it('reports only phones the sample can support a claim about', () => {
    const cmp = compareToBaseline(phoneCounts([w('x', 'ttt')]), baseline);
    // Everything here is under-sampled, so nothing is notable.
    expect(notableDeviations(cmp)).toEqual([]);
  });

  it('surfaces a genuine over-use in a sufficient sample', () => {
    const counts = phoneCounts([w('x', 'aaat'.repeat(15))]);
    const notable = notableDeviations(compareToBaseline(counts, baseline));
    expect(notable.map((n) => n.phone)).toContain('a');
  });
});

describe('totalPhones', () => {
  it('sums the counts', () => {
    expect(totalPhones(phoneCounts([w('x', 'abc')]))).toBe(3);
  });
});
