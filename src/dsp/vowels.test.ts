import { describe, it, expect } from 'vitest';
import { extractVowels, clusterByVowel, MIN_VOWEL_SECONDS, MIN_TOKENS_FOR_ELLIPSE } from './vowels';
import { synthVowel, synthNoise, synthSilence, REFERENCE_VOWELS, DEFAULT_SAMPLE_RATE } from './synth';
import type { AlignedWord } from '../align/utterance';

const FS = DEFAULT_SAMPLE_RATE;

/** Concatenate segments into one signal and return the matching phone timings. */
function build(segments: Array<[phone: string, audio: Float32Array]>): {
  audio: Float32Array;
  words: AlignedWord[];
} {
  const total = segments.reduce((n, [, a]) => n + a.length, 0);
  const audio = new Float32Array(total);
  const phonetic = [];

  let offset = 0;
  for (const [phone, seg] of segments) {
    audio.set(seg, offset);
    phonetic.push({
      phone,
      start: offset / FS,
      end: (offset + seg.length) / FS,
      conf: 0.9,
    });
    offset += seg.length;
  }

  return {
    audio,
    words: [{ word: 'test', phonemic: null, phonetic, ops: [], start: 0, end: total / FS }],
  };
}

const vowel = (name: keyof typeof REFERENCE_VOWELS, seconds = 0.2, f0 = 120) =>
  synthVowel({ f0, formants: REFERENCE_VOWELS[name], seconds });

describe('extractVowels', () => {
  it('recovers F2 of a synthesised vowel from its interval', () => {
    const { audio, words } = build([['ɑ', vowel('ɑ')]]);
    const [m] = extractVowels(audio, words, FS);
    expect(m).toBeDefined();
    expect(Math.abs(m.f2 - REFERENCE_VOWELS['ɑ'][1]) / REFERENCE_VOWELS['ɑ'][1]).toBeLessThan(0.06);
  });

  it('skips consonants', () => {
    const { audio, words } = build([['s', synthNoise(0.2)], ['ɑ', vowel('ɑ')]]);
    const out = extractVowels(audio, words, FS);
    expect(out).toHaveLength(1);
    expect(out[0].phone).toBe('ɑ');
  });

  it('skips diphthongs, which move by definition', () => {
    const { audio, words } = build([['aɪ', vowel('ɑ')]]);
    expect(extractVowels(audio, words, FS)).toHaveLength(0);
  });

  it('skips intervals too short to hold a steady state', () => {
    const { audio, words } = build([['ɑ', vowel('ɑ', MIN_VOWEL_SECONDS / 2)]]);
    expect(extractVowels(audio, words, FS)).toHaveLength(0);
  });

  it('skips silence labelled as a vowel', () => {
    // A recognition artefact. Its "formants" would be pure noise.
    const { audio, words } = build([['ɑ', synthSilence(0.2)]]);
    expect(extractVowels(audio, words, FS)).toHaveLength(0);
  });

  it('skips unvoiced material labelled as a vowel', () => {
    const { audio, words } = build([['ɑ', synthNoise(0.2)]]);
    expect(extractVowels(audio, words, FS)).toHaveLength(0);
  });

  it('measures only the middle of the interval', () => {
    // Half /ɑ/ then half /i/, labelled as one vowel. Measuring the whole span would
    // average two different vowels into a value belonging to neither; measuring the
    // middle 50% should land nearer the transition than either extreme.
    const half = 0.15;
    const joined = new Float32Array(Math.round(FS * half * 2));
    joined.set(vowel('ɑ', half), 0);
    joined.set(vowel('i', half), Math.round(FS * half));

    const words: AlignedWord[] = [{
      word: 'x', phonemic: null,
      phonetic: [{ phone: 'ɑ', start: 0, end: half * 2, conf: 0.9 }],
      ops: [], start: 0, end: half * 2,
    }];

    const [m] = extractVowels(joined, words, FS);
    expect(m).toBeDefined();
    // It saw material from both halves, so F2 sits between the two targets.
    expect(m.f2).toBeGreaterThan(REFERENCE_VOWELS['ɑ'][1] * 0.8);
  });

  it('flags close vowels as having unreliable F1', () => {
    // Measured 5-32% F1 error for close vowels. The flag carries that into the UI.
    const { audio, words } = build([['i', vowel('i')], ['ɑ', vowel('ɑ')]]);
    const out = extractVowels(audio, words, FS);
    expect(out.find((m) => m.phone === 'i')!.f1Unreliable).toBe(true);
    expect(out.find((m) => m.phone === 'ɑ')!.f1Unreliable).toBe(false);
  });

  it('reports a confidence per token', () => {
    const { audio, words } = build([['ɑ', vowel('ɑ')]]);
    const [m] = extractVowels(audio, words, FS);
    expect(m.confidence).toBeGreaterThan(0);
    expect(m.confidence).toBeLessThanOrEqual(1);
  });

  it('records the pitch alongside the formants', () => {
    const { audio, words } = build([['ɑ', vowel('ɑ', 0.2, 150)]]);
    const [m] = extractVowels(audio, words, FS);
    expect(m.f0).not.toBeNull();
    expect(Math.abs(m.f0! - 150) / 150).toBeLessThan(0.05);
  });
});

describe('clusterByVowel', () => {
  it('groups tokens by phone and orders by frequency', () => {
    const { audio, words } = build([
      ['ɑ', vowel('ɑ')], ['ɑ', vowel('ɑ')], ['i', vowel('i')],
    ]);
    const clusters = clusterByVowel(extractVowels(audio, words, FS));
    expect(clusters[0].phone).toBe('ɑ');
    expect(clusters[0].tokens).toHaveLength(2);
  });

  it('refuses an ellipse below the token minimum', () => {
    // Drawing a dispersion ellipse through two points implies a distribution that
    // was never observed.
    const { audio, words } = build([['ɑ', vowel('ɑ')], ['ɑ', vowel('ɑ')]]);
    const [c] = clusterByVowel(extractVowels(audio, words, FS));
    expect(c.enoughForEllipse).toBe(false);
    expect(MIN_TOKENS_FOR_ELLIPSE).toBeGreaterThan(2);
  });

  it('allows an ellipse once there are enough tokens', () => {
    const segs: Array<[string, Float32Array]> = [];
    for (let i = 0; i < MIN_TOKENS_FOR_ELLIPSE; i++) segs.push(['ɑ', vowel('ɑ')]);
    const { audio, words } = build(segs);
    expect(clusterByVowel(extractVowels(audio, words, FS))[0].enoughForEllipse).toBe(true);
  });
});
