import { describe, it, expect } from 'vitest';
import { detectPitch, pitchContour, medianSmooth, pitchStats, type PitchPoint } from './yin';
import { synthVowel, synthTone, synthNoise, synthSilence } from './synth';

const err = (got: number, want: number) => Math.abs(got - want) / want;

describe('detectPitch', () => {
  it('recovers the pitch of a synthetic vowel within 2%', () => {
    const f0 = detectPitch(synthVowel({ f0: 120, formants: [730, 1090, 2440] }))!;
    expect(err(f0, 120)).toBeLessThan(0.02);
  });

  it('recovers the pitch of a pure tone', () => {
    expect(err(detectPitch(synthTone(200))!, 200)).toBeLessThan(0.02);
  });

  it('tracks pitch across the human speech range', () => {
    for (const target of [85, 120, 165, 220, 300]) {
      const f0 = detectPitch(synthVowel({ f0: target, formants: [730, 1090, 2440] }));
      expect(f0, `F0=${target}`).not.toBeNull();
      expect(err(f0!, target), `F0=${target}`).toBeLessThan(0.03);
    }
  });

  it('returns null for silence rather than a number', () => {
    expect(detectPitch(synthSilence())).toBeNull();
  });

  it('returns null for white noise, which has no pitch', () => {
    // A tracker that always answers will draw a confident line through noise.
    expect(detectPitch(synthNoise())).toBeNull();
  });

  it('returns null for a frame too short to hold a period', () => {
    expect(detectPitch(new Float32Array(16))).toBeNull();
  });
});

describe('pitchContour', () => {
  it('produces a point per hop', () => {
    const audio = synthVowel({ f0: 120, formants: [730, 1090, 2440], seconds: 0.5 });
    const c = pitchContour(audio);
    expect(c.length).toBeGreaterThan(30);
    expect(c[1].time - c[0].time).toBeCloseTo(0.01, 6);
  });

  it('tracks a steady vowel consistently', () => {
    const audio = synthVowel({ f0: 150, formants: [730, 1090, 2440], seconds: 0.4 });
    const voiced = pitchContour(audio).map((p) => p.f0).filter((f): f is number => f !== null);
    expect(voiced.length).toBeGreaterThan(20);
    for (const f of voiced) expect(err(f, 150)).toBeLessThan(0.05);
  });

  it('leaves gaps rather than interpolating through silence', () => {
    const c = pitchContour(synthSilence(0.3));
    expect(c.every((p) => p.f0 === null)).toBe(true);
  });
});

describe('medianSmooth', () => {
  it('removes a single octave error from a steady contour', () => {
    // YIN halves or doubles on creaky voice. One bad frame must not reach the display.
    const pts: PitchPoint[] = [100, 100, 200, 100, 100].map((f0, i) => ({ time: i * 0.01, f0 }));
    expect(medianSmooth(pts)[2].f0).toBe(100);
  });

  it('preserves genuine pitch movement', () => {
    // A rising contour must not be flattened into its own median.
    const pts: PitchPoint[] = [100, 120, 140, 160, 180].map((f0, i) => ({ time: i * 0.01, f0 }));
    const out = medianSmooth(pts);
    expect(out[0].f0).toBeLessThan(out[4].f0!);
  });

  it('never fills an unvoiced gap', () => {
    const pts: PitchPoint[] = [
      { time: 0, f0: 100 }, { time: 0.01, f0: null }, { time: 0.02, f0: 100 },
    ];
    expect(medianSmooth(pts)[1].f0).toBeNull();
  });
});

describe('pitchStats', () => {
  it('summarises the voiced portion only', () => {
    const pts: PitchPoint[] = [
      { time: 0, f0: 100 }, { time: 0.01, f0: null }, { time: 0.02, f0: 200 },
      { time: 0.03, f0: 150 },
    ];
    const s = pitchStats(pts);
    expect(s.min).toBe(100);
    expect(s.max).toBe(200);
    expect(s.voicedFraction).toBeCloseTo(0.75, 6);
  });

  it('reports nulls for an entirely unvoiced signal', () => {
    const s = pitchStats([{ time: 0, f0: null }]);
    expect(s.median).toBeNull();
    expect(s.voicedFraction).toBe(0);
  });
});
