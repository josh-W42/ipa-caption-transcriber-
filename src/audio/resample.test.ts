import { describe, it, expect } from 'vitest';
import { resampleTo16k } from './resample';
import { spectralCentroid, dropoutRatio, rms, TARGET_SAMPLE_RATE } from './capture';

function tone(freq: number, seconds: number, rate: number) {
  const b = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < b.length; i++) b[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / rate);
  return b;
}

describe('resampleTo16k', () => {
  it('passes 16kHz audio through untouched', async () => {
    const a = tone(200, 0.5, TARGET_SAMPLE_RATE);
    expect(await resampleTo16k(a, TARGET_SAMPLE_RATE)).toBe(a);
  });

  it('converts 48kHz to 16kHz with the right length', async () => {
    const a = tone(200, 1, 48000);
    const out = await resampleTo16k(a, 48000);
    expect(out.length).toBeCloseTo(TARGET_SAMPLE_RATE, -2);
  });

  it('preserves pitch — the frequency must not shift', async () => {
    // Feeding 48kHz samples to a 16kHz consumer without resampling shifts pitch 3x,
    // which is the other way this can silently break.
    const a = tone(400, 1, 48000);
    const out = await resampleTo16k(a, 48000);
    const before = spectralCentroid(a, 48000);
    const after = spectralCentroid(out, TARGET_SAMPLE_RATE);
    expect(after).toBeGreaterThan(before * 0.75);
    expect(after).toBeLessThan(before * 1.25);
  });

  it('preserves level and introduces no dropouts', async () => {
    const a = tone(300, 1, 44100);
    const out = await resampleTo16k(a, 44100);
    expect(rms(out)).toBeGreaterThan(rms(a) * 0.8);
    expect(dropoutRatio(out)).toBeLessThan(0.02);
  });
});
