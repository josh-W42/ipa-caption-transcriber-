import { describe, it, expect } from 'vitest';
import { formants, preEmphasis, polynomialRoots, levinsonDurbin, autocorrelate } from './lpc';
import { synthVowel, synthSilence, synthNoise, REFERENCE_VOWELS } from './synth';

/**
 * Verified against signals whose answer is known in advance. A formant tracker
 * checked only against real speech can be confidently wrong with nothing to catch it;
 * checked against resonators we placed ourselves, it either recovers them or it does not.
 *
 * Thresholds are the MEASURED accuracy of the method, not aspirational ones. Asserting
 * tighter bounds than LPC can deliver would produce a suite that fails intermittently
 * and teaches the reader to ignore it.
 */
const err = (got: number, want: number) => Math.abs(got - want) / want;

describe('formants — open vowels', () => {
  it('recovers F1 and F2 of /ɑ/ within 5%', () => {
    const [f1, f2] = REFERENCE_VOWELS['ɑ'];
    const f = formants(synthVowel({ f0: 120, formants: [f1, f2, 2440] }));
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(err(f[0].frequency, f1)).toBeLessThan(0.05);
    expect(err(f[1].frequency, f2)).toBeLessThan(0.05);
  });

  it('recovers F1 and F2 of /æ/ within 5%', () => {
    const [f1, f2, f3] = REFERENCE_VOWELS['æ'];
    const f = formants(synthVowel({ f0: 120, formants: [f1, f2, f3] }));
    expect(err(f[0].frequency, f1)).toBeLessThan(0.05);
    expect(err(f[1].frequency, f2)).toBeLessThan(0.05);
  });
});

describe('formants — close vowels', () => {
  it('recovers F2 of /i/ within 3%', () => {
    const [f1, f2, f3] = REFERENCE_VOWELS['i'];
    const f = formants(synthVowel({ f0: 120, formants: [f1, f2, f3] }));
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(err(f[1].frequency, f2)).toBeLessThan(0.03);
  });

  it('recovers F2 of /u/ within 3%', () => {
    const [f1, f2, f3] = REFERENCE_VOWELS['u'];
    const f = formants(synthVowel({ f0: 120, formants: [f1, f2, f3] }));
    expect(err(f[1].frequency, f2)).toBeLessThan(0.03);
  });

  it('is only loosely accurate for F1 of close vowels — the documented limit', () => {
    // Measured 5.1-31.7% across F0 85-300Hz. The loose bound IS the finding: it is
    // carried into the UI as visibly greater uncertainty for close vowels.
    const [f1, f2, f3] = REFERENCE_VOWELS['i'];
    const f = formants(synthVowel({ f0: 120, formants: [f1, f2, f3] }));
    expect(err(f[0].frequency, f1)).toBeLessThan(0.35);
  });
});

describe('formants — robustness', () => {
  it('returns formants in ascending order', () => {
    const f = formants(synthVowel({ f0: 120, formants: [730, 1090, 2440] }));
    for (let i = 1; i < f.length; i++) {
      expect(f[i].frequency).toBeGreaterThan(f[i - 1].frequency);
    }
  });

  it('returns nothing for silence rather than inventing resonances', () => {
    expect(formants(synthSilence())).toEqual([]);
  });

  it('returns nothing for a frame shorter than the model order', () => {
    expect(formants(new Float32Array(10))).toEqual([]);
  });

  it('rejects implausibly broad resonances', () => {
    // Noise has no narrow peaks; whatever survives must at least be formant-shaped.
    for (const f of formants(synthNoise())) expect(f.bandwidth).toBeLessThan(500);
  });

  it('tracks a formant when it moves', () => {
    const low = formants(synthVowel({ f0: 120, formants: [500, 1500, 2500] }));
    const high = formants(synthVowel({ f0: 120, formants: [800, 1500, 2500] }));
    expect(high[0].frequency).toBeGreaterThan(low[0].frequency);
  });

  it('works across the pitch range', () => {
    const [f1, f2] = REFERENCE_VOWELS['ɑ'];
    for (const f0 of [85, 120, 165, 220, 300]) {
      const f = formants(synthVowel({ f0, formants: [f1, f2, 2440] }));
      expect(err(f[1].frequency, f2), `F2 at F0=${f0}`).toBeLessThan(0.06);
    }
  });
});

describe('numeric building blocks', () => {
  it('pre-emphasis leaves the first sample and differences the rest', () => {
    const out = preEmphasis(Float32Array.from([1, 1, 1]), 0.97);
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[1]).toBeCloseTo(0.03, 6);
  });

  it('autocorrelation peaks at lag zero', () => {
    const r = autocorrelate(Float32Array.from([1, -1, 1, -1]), 3);
    expect(r[0]).toBeGreaterThanOrEqual(Math.abs(r[1]));
  });

  it('levinson-durbin returns a monic polynomial', () => {
    const r = autocorrelate(Float32Array.from([1, 0.5, 0.25, 0.1]), 3);
    expect(levinsonDurbin(r, 3)[0]).toBe(1);
  });

  it('finds the roots of a known polynomial', () => {
    // z^2 - 1 has roots at +1 and -1.
    const roots = polynomialRoots(Float64Array.from([1, 0, -1]));
    const reals = roots.map((r) => r[0]).sort((a, b) => a - b);
    expect(reals[0]).toBeCloseTo(-1, 6);
    expect(reals[1]).toBeCloseTo(1, 6);
  });

  it('finds complex conjugate roots', () => {
    // z^2 + 1 has roots at +i and -i.
    const roots = polynomialRoots(Float64Array.from([1, 0, 1]));
    const ims = roots.map((r) => r[1]).sort((a, b) => a - b);
    expect(ims[0]).toBeCloseTo(-1, 6);
    expect(ims[1]).toBeCloseTo(1, 6);
  });
});
