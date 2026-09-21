import { describe, it, expect } from 'vitest';
import { dropoutRatio } from './capture';

/**
 * The live capture was dropping ~30% of audio in ~8ms chunks — roughly every other
 * 128-sample render quantum arrived as zeros. The signal kept a speech-shaped
 * envelope and normal RMS, so no loudness metric could see it, but chopping speech
 * into 8ms fragments makes it unintelligible and gives it a broadband HF spectrum.
 *
 * Measured on the real capture: 160 long zero-runs in 5s, gaps of 142-160 samples,
 * spaced 320 apart, 29.4% of samples lost.
 */
describe('dropoutRatio', () => {
  it('is zero for continuous audio', () => {
    const b = new Float32Array(16000);
    for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * 200 * i) / 16000);
    expect(dropoutRatio(b)).toBe(0);
  });

  it('ignores the brief zero crossings of ordinary waveforms', () => {
    // A slow sine passes through exact zero repeatedly; those are not dropouts.
    const b = new Float32Array(16000);
    for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * 50 * i) / 16000);
    expect(dropoutRatio(b)).toBeLessThan(0.02);
  });

  it('reports the fraction lost when quanta are zeroed', () => {
    // Reproduces the observed pattern: 128 zeros every 320 samples.
    const b = new Float32Array(16000);
    for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * 200 * i) / 16000);
    for (let start = 0; start + 128 < b.length; start += 320) {
      b.fill(0, start, start + 128);
    }
    const r = dropoutRatio(b);
    expect(r).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(0.5);
  });

  it('treats all-silence as fully dropped', () => {
    expect(dropoutRatio(new Float32Array(16000))).toBeGreaterThan(0.9);
  });
});
