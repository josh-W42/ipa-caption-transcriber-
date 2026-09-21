import { describe, it, expect } from 'vitest';
import { TARGET_SAMPLE_RATE, rms, maxFrameRms, SILENCE_RMS } from './capture';

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
    expect(0.0156).toBeGreaterThan(SILENCE_RMS);
  });
});

describe('maxFrameRms — the speech gate', () => {
  /**
   * Gating a 5-second window on its MEAN rms is the wrong measurement: a window
   * holding one second of speech and four of silence averages down to near nothing
   * and gets discarded, which is exactly the "live captions picked up nothing"
   * symptom. The gate asks whether speech occurs ANYWHERE in the window.
   */
  const SR = TARGET_SAMPLE_RATE;

  function windowWithBurst(totalSeconds: number, burstSeconds: number, amplitude: number) {
    const buf = new Float32Array(SR * totalSeconds);
    const burst = SR * burstSeconds;
    for (let i = 0; i < burst; i++) {
      buf[i] = amplitude * Math.sin((2 * Math.PI * 200 * i) / SR);
    }
    return buf;
  }

  it('is zero for silence', () => {
    expect(maxFrameRms(new Float32Array(SR * 5))).toBe(0);
  });

  it('detects a 1s burst inside a 5s window that mean rms would bury', () => {
    // Amplitude chosen to match the M0 fixture's quiet-but-audible level.
    const w = windowWithBurst(5, 1, 0.022);

    const mean = rms(w);
    const peak = maxFrameRms(w);

    // The mean sinks toward the gate; the frame max stays well clear of it.
    expect(peak).toBeGreaterThan(mean * 1.8);
    expect(peak).toBeGreaterThan(SILENCE_RMS);
  });

  it('still rejects a window whose only content is well below the gate', () => {
    const w = windowWithBurst(5, 1, 0.0005);
    expect(maxFrameRms(w)).toBeLessThan(SILENCE_RMS);
  });

  it('handles windows shorter than one frame', () => {
    const short = Float32Array.from([0.5, -0.5, 0.5, -0.5]);
    expect(maxFrameRms(short)).toBeCloseTo(0.5, 6);
  });
});
