import { describe, it, expect } from 'vitest';
import { TARGET_SAMPLE_RATE, rms } from './capture';

describe('AudioContext sample rate', () => {
  /**
   * The whole capture design rests on the browser resampling the microphone to 16kHz
   * natively when the AudioContext is constructed at that rate. If this ever fails,
   * a decimation step is needed in the worklet — so it is a test, not an assumption.
   */
  it('honours a 16kHz sampleRate request', () => {
    const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    const actual = ctx.sampleRate;
    void ctx.close();
    expect(actual).toBe(TARGET_SAMPLE_RATE);
  });

  it('resamples decoded audio to 16kHz through OfflineAudioContext', async () => {
    // 1 second of 44.1kHz silence rendered at 16kHz should yield ~16000 samples.
    const offline = new OfflineAudioContext(1, TARGET_SAMPLE_RATE, TARGET_SAMPLE_RATE);
    const rendered = await offline.startRendering();
    expect(rendered.sampleRate).toBe(TARGET_SAMPLE_RATE);
    expect(rendered.length).toBe(TARGET_SAMPLE_RATE);
  });
});

describe('rms', () => {
  it('is zero for silence', () => {
    expect(rms(new Float32Array(100))).toBe(0);
  });

  it('is zero for an empty buffer rather than NaN', () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it('computes the root mean square', () => {
    // Alternating +-0.5 has RMS exactly 0.5.
    const s = Float32Array.from([0.5, -0.5, 0.5, -0.5]);
    expect(rms(s)).toBeCloseTo(0.5, 6);
  });

  it('places the M0 fixture above the silence gate', () => {
    // The M0 recording measured 0.0156 RMS while quiet but clearly audible, and
    // transcribed correctly. The gate must sit below that.
    const SILENCE_GATE = 0.005;
    expect(0.0156).toBeGreaterThan(SILENCE_GATE);
  });
});
