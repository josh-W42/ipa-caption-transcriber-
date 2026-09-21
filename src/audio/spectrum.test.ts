import { describe, it, expect } from 'vitest';
import { decodeTo16kMono, } from './decode';
import { spectralCentroid, maxFrameRms } from './capture';

/**
 * Validates the FFT-free centroid estimate against two files whose spectra were
 * measured offline with a real FFT:
 *
 *   good.wav   (the working fixture)  centroid 828 Hz, 73% of energy below 800Hz
 *   speech.wav (a failing mic capture) centroid 3688 Hz, 59% above 3kHz
 *
 * Both are loud, both have speech-shaped envelopes, and every loudness statistic
 * says they are fine. Only the spectrum separates them — which is exactly why the
 * bug survived so long.
 */
describe('spectralCentroid', () => {
  it('rises with frequency for synthetic tones', () => {
    const sr = 16000;
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

  it('separates healthy speech from the voiced-band-stripped capture', async () => {
    const good = await decodeTo16kMono('/t/good.wav');
    const bad = await decodeTo16kMono('/t/speech.wav');

    // Both are loud — the loudness statistics cannot tell them apart.
    expect(maxFrameRms(good)).toBeGreaterThan(0.03);
    expect(maxFrameRms(bad)).toBeGreaterThan(0.03);

    const cGood = spectralCentroid(good);
    const cBad = spectralCentroid(bad);
    console.log(`[diagnostic] centroid good=${cGood.toFixed(0)}Hz bad=${cBad.toFixed(0)}Hz`);

    expect(cGood).toBeLessThan(1500);
    expect(cBad).toBeGreaterThan(2500);
  });
});
