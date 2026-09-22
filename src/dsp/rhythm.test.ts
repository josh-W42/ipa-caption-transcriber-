import { describe, it, expect } from 'vitest';
import { rhythmMetrics, findPauses, nPVI, PAUSE_SECONDS } from './rhythm';
import type { AlignedWord } from '../align/utterance';

/** Build a word whose phones have explicit timings. */
function word(name: string, phones: Array<[phone: string, start: number, end: number]>): AlignedWord {
  return {
    word: name,
    phonemic: name,
    phonetic: phones.map(([phone, start, end]) => ({ phone, start, end, conf: 0.9 })),
    ops: [],
    start: phones[0]?.[1] ?? null,
    end: phones[phones.length - 1]?.[2] ?? null,
  };
}

describe('nPVI', () => {
  it('is near zero for evenly spaced intervals', () => {
    expect(nPVI([0.1, 0.1, 0.1, 0.1])!).toBeCloseTo(0, 6);
  });

  it('is high for strongly alternating intervals', () => {
    // Long-short-long-short is the signature of stress timing.
    expect(nPVI([0.2, 0.05, 0.2, 0.05])!).toBeGreaterThan(100);
  });

  it('is unaffected by overall tempo', () => {
    // Normalising by the local mean is what makes it measure alternation rather
    // than speed. Doubling every duration must not change the result.
    const slow = nPVI([0.2, 0.1, 0.2, 0.1])!;
    const fast = nPVI([0.1, 0.05, 0.1, 0.05])!;
    expect(slow).toBeCloseTo(fast, 6);
  });

  it('returns null when there is no pair to compare', () => {
    expect(nPVI([0.1])).toBeNull();
    expect(nPVI([])).toBeNull();
  });
});

describe('findPauses', () => {
  it('finds a gap longer than the threshold', () => {
    const words = [word('a', [['ɑ', 0, 0.1]]), word('b', [['b', 0.5, 0.6]])];
    const pauses = findPauses(words);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].duration).toBeCloseTo(0.4, 6);
  });

  it('ignores a gap shorter than the threshold', () => {
    // Short silences are stop closures, not pauses.
    const words = [word('a', [['ɑ', 0, 0.1]]), word('b', [['b', 0.15, 0.25]])];
    expect(findPauses(words)).toHaveLength(0);
    expect(PAUSE_SECONDS).toBeGreaterThan(0.1);
  });
});

describe('rhythmMetrics', () => {
  it('separates speech rate from articulation rate', () => {
    // THE distinction: 4 phones over 2s of wall clock, but only 0.4s of talking.
    // Reporting one number would hide that the speaker paused for most of it.
    const words = [
      word('a', [['ɑ', 0, 0.1], ['b', 0.1, 0.2]]),
      word('b', [['ɑ', 1.8, 1.9], ['b', 1.9, 2.0]]),
    ];
    const m = rhythmMetrics(words)!;
    expect(m.speechRate).toBeCloseTo(2, 1);
    expect(m.articulationRate).toBeGreaterThan(m.speechRate * 2);
  });

  it('reports the two as equal when nobody paused', () => {
    const words = [word('a', [['ɑ', 0, 0.1], ['b', 0.1, 0.2], ['ɑ', 0.2, 0.3]])];
    const m = rhythmMetrics(words)!;
    expect(m.articulationRate).toBeCloseTo(m.speechRate, 6);
  });

  it('counts only vocalic intervals for nPVI', () => {
    const words = [word('a', [['ɑ', 0, 0.1], ['b', 0.1, 0.2], ['i', 0.2, 0.35]])];
    expect(rhythmMetrics(words)!.vocalicIntervals).toBe(2);
  });

  it('returns null nPVI when there is too little to measure', () => {
    const words = [word('a', [['b', 0, 0.1]])];
    expect(rhythmMetrics(words)!.nPVI).toBeNull();
  });

  it('returns null for an utterance with no phones', () => {
    expect(rhythmMetrics([word('a', [])])).toBeNull();
  });

  it('does not divide by zero when an utterance is almost entirely pause', () => {
    const words = [word('a', [['ɑ', 0, 0.02]]), word('b', [['b', 9.98, 10.0]])];
    const m = rhythmMetrics(words)!;
    expect(Number.isFinite(m.articulationRate)).toBe(true);
  });
});
