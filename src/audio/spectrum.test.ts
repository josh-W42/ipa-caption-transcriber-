import { describe, it, expect } from 'vitest';
import { decodeTo16kMono } from './decode';
import { spectralCentroid, maxFrameRms, TARGET_SAMPLE_RATE } from './capture';

/**
 * The live-mic bug was invisible to every loudness statistic. Captured audio had a
 * speech-shaped envelope, healthy peak and RMS, a speech-like zero-crossing rate —
 * and was unintelligible to Whisper, because the voiced low-frequency band that
 * carries speech had been stripped out.
 *
 * Measured offline with a real FFT over 40 averaged loud windows:
 *   working fixture   56.5% of energy in 300-800Hz,  centroid  828 Hz
 *   failing capture    3.5% below 300Hz, 59% above 3kHz, centroid 3688 Hz
 *
 * These tests keep the FFT-free estimate honest. The degraded signal is derived from
 * the shipped sample rather than committing a second audio fixture.
 */
describe('spectralCentroid', () => {
  it('rises with frequency for synthetic tones', () => {
    const sr = TARGET_SAMPLE_RATE;
    const tone = (f: number) => {
      const b = new Float32Array(sr);
      for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * f * i) / sr);
      return b;
    };
    const low = spectralCentroid(tone(300), sr);
    const high = spectralCentroid(tone(3000), sr);
    expect(low).toBeLessThan(700);
    expect(high).toBeGreaterThan(2000);
    expect(high).toBeGreaterThan(low * 3);
  });

  it('puts healthy speech near the voiced band', async () => {
    const good = await decodeTo16kMono('/sample.wav');
    const centroid = spectralCentroid(good);
    // Offline FFT measured 828Hz; the estimate tracked it at 766Hz.
    expect(centroid).toBeGreaterThan(300);
    expect(centroid).toBeLessThan(1500);
  });

  it('detects speech whose voiced band has been stripped, at equal loudness', async () => {
    const good = await decodeTo16kMono('/sample.wav');

    // First difference is a high-pass: it suppresses the voiced low-frequency energy
    // and leaves high-frequency residue — the same shape the broken capture had.
    const stripped = new Float32Array(good.length);
    for (let i = 1; i < good.length; i++) stripped[i] = good[i] - good[i - 1];

    // Renormalise so the two differ in SPECTRUM only, not in level. This is the crux:
    // loudness cannot distinguish them, which is why the bug hid for so long.
    const scale = maxFrameRms(good) / (maxFrameRms(stripped) || 1);
    for (let i = 0; i < stripped.length; i++) stripped[i] *= scale;

    expect(maxFrameRms(stripped)).toBeCloseTo(maxFrameRms(good), 3);

    const cGood = spectralCentroid(good);
    const cStripped = spectralCentroid(stripped);
    console.log(`[diagnostic] centroid good=${cGood.toFixed(0)}Hz stripped=${cStripped.toFixed(0)}Hz`);

    expect(cStripped).toBeGreaterThan(cGood * 2);
    expect(cStripped).toBeGreaterThan(2000);
  });
});
