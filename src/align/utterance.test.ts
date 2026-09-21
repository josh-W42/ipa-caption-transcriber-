import { describe, it, expect } from 'vitest';
import { alignUtterance, expandPhonetic, phoneticString, divergences } from './utterance';
import type { DecodedPhone } from '../phonetic/ctc';
import type { WordTranscription } from '../phonemic/lexicon';

const phone = (p: string, start: number, end: number): DecodedPhone => ({
  phone: p,
  start,
  end,
  conf: 0.9,
});

const word = (w: string, ipa: string | null): WordTranscription => ({
  word: w,
  found: ipa !== null,
  ipa,
});

describe('expandPhonetic', () => {
  it('passes single phones through', () => {
    expect(expandPhonetic([phone('b', 0, 0.02)]).map((p) => p.phone)).toEqual(['b']);
  });

  it('strips length marks without losing the phone', () => {
    const out = expandPhonetic([phone('ɑː', 0, 0.04)]);
    expect(out.map((p) => p.phone)).toEqual(['ɑ']);
    expect(out[0].end).toBeCloseTo(0.04, 6);
  });

  it('splits a multi-phone token and divides its span', () => {
    // əl is one CTC token but two phones.
    const out = expandPhonetic([phone('əl', 0, 0.04)]);
    expect(out.map((p) => p.phone)).toEqual(['ə', 'l']);
    expect(out[0].start).toBeCloseTo(0, 6);
    expect(out[0].end).toBeCloseTo(0.02, 6);
    expect(out[1].start).toBeCloseTo(0.02, 6);
    expect(out[1].end).toBeCloseTo(0.04, 6);
  });

  it('keeps diphthongs whole', () => {
    expect(expandPhonetic([phone('aɪ', 0, 0.06)]).map((p) => p.phone)).toEqual(['aɪ']);
  });
});

describe('alignUtterance', () => {
  it('attributes phones and operations to the right words', () => {
    // "the butter" -> [ðə] [bʌɾɚ]
    const words = [word('the', 'ðə'), word('butter', 'ˈbʌtɚ')];
    const decoded = [
      phone('ð', 0.0, 0.02), phone('ə', 0.02, 0.04),
      phone('b', 0.04, 0.06), phone('ʌ', 0.06, 0.08),
      phone('ɾ', 0.08, 0.10), phone('ɚ', 0.10, 0.12),
    ];

    const out = alignUtterance(words, decoded);
    expect(phoneticString(out[0])).toBe('ðə');
    expect(phoneticString(out[1])).toBe('bʌɾɚ');
  });

  it('finds the flap in the word it belongs to, and nowhere else', () => {
    const words = [word('the', 'ðə'), word('butter', 'ˈbʌtɚ')];
    const decoded = [
      phone('ð', 0.0, 0.02), phone('ə', 0.02, 0.04),
      phone('b', 0.04, 0.06), phone('ʌ', 0.06, 0.08),
      phone('ɾ', 0.08, 0.10), phone('ɚ', 0.10, 0.12),
    ];

    const out = alignUtterance(words, decoded);
    expect(divergences(out[0])).toHaveLength(0);

    const d = divergences(out[1]);
    expect(d).toHaveLength(1);
    expect(d[0].from).toBe('t');
    expect(d[0].to).toBe('ɾ');
  });

  it('derives word timings from the phone timings', () => {
    // Whisper cannot give word timestamps in this export, so they come from here.
    const words = [word('the', 'ðə'), word('butter', 'ˈbʌtɚ')];
    const decoded = [
      phone('ð', 0.0, 0.02), phone('ə', 0.02, 0.04),
      phone('b', 0.04, 0.06), phone('ʌ', 0.06, 0.08),
      phone('t', 0.08, 0.10), phone('ɚ', 0.10, 0.12),
    ];

    const out = alignUtterance(words, decoded);
    expect(out[0].start).toBeCloseTo(0.0, 6);
    expect(out[0].end).toBeCloseTo(0.04, 6);
    expect(out[1].start).toBeCloseTo(0.04, 6);
    expect(out[1].end).toBeCloseTo(0.12, 6);
  });

  it('keeps out-of-vocabulary words in the output without a phonemic side', () => {
    const words = [word('kerfuffle', null), word('the', 'ðə')];
    const decoded = [phone('ð', 0.0, 0.02), phone('ə', 0.02, 0.04)];

    const out = alignUtterance(words, decoded);
    expect(out).toHaveLength(2);
    expect(out[0].phonemic).toBeNull();
  });

  it('returns words unharmed when there is no phonetic track yet', () => {
    // Before the phoneme model finishes loading, the app must behave exactly as M2.
    const words = [word('the', 'ðə')];
    const out = alignUtterance(words, []);
    expect(out).toHaveLength(1);
    expect(out[0].phonemic).toBe('ðə');
    expect(out[0].phonetic).toEqual([]);
  });
});
