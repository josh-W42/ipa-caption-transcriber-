import { describe, it, expect } from 'vitest';
import { RingBuffer } from './ringBuffer';
import { decodeTo16kMono } from './decode';
import { maxFrameRms, rms, TARGET_SAMPLE_RATE } from './capture';

/**
 * Does the capture plumbing preserve audio?
 *
 * Live mic produced loud, correctly-sized audio that Whisper read as non-speech
 * ("you" / "I"), while the same model transcribes sample.wav perfectly. The audio
 * content is therefore suspect somewhere between worklet and model.
 *
 * This replays a KNOWN-GOOD file through the exact path live audio takes — 128-sample
 * frames, ring buffer, recording array, reassembly — and checks the bytes survive.
 * No microphone and no running AudioContext required, so it runs headlessly.
 */

/** The worklet posts one render quantum at a time. */
const QUANTUM = 128;

function intoFrames(audio: Float32Array): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let i = 0; i + QUANTUM <= audio.length; i += QUANTUM) {
    // slice() to mirror the copy the worklet makes before postMessage.
    frames.push(audio.slice(i, i + QUANTUM));
  }
  return frames;
}

describe('capture plumbing round-trip', () => {
  it('reassembles the recording array sample-for-sample', async () => {
    const original = await decodeTo16kMono('/sample.wav');
    const frames = intoFrames(original);

    // Exactly what onFrame does.
    const recording: Float32Array[] = [];
    const ring = new RingBuffer(TARGET_SAMPLE_RATE * 5);
    for (const f of frames) {
      ring.write(f);
      recording.push(f);
    }

    // Exactly what stop() does.
    const total = recording.reduce((n, f) => n + f.length, 0);
    const full = new Float32Array(total);
    let offset = 0;
    for (const frame of recording) {
      full.set(frame, offset);
      offset += frame.length;
    }

    expect(total).toBe(frames.length * QUANTUM);

    // Byte-identical to the original over the reassembled span.
    let maxDelta = 0;
    for (let i = 0; i < total; i++) {
      const d = Math.abs(full[i] - original[i]);
      if (d > maxDelta) maxDelta = d;
    }
    expect(maxDelta).toBe(0);

    // And the loudness statistics survive.
    expect(rms(full)).toBeCloseTo(rms(original.subarray(0, total)), 6);
    expect(maxFrameRms(full)).toBeCloseTo(maxFrameRms(original.subarray(0, total)), 6);
  });

  it('preserves the trailing window read from the ring buffer', async () => {
    const original = await decodeTo16kMono('/sample.wav');
    const ring = new RingBuffer(TARGET_SAMPLE_RATE * 5);
    for (const f of intoFrames(original)) ring.write(f);

    const window = ring.readLast(TARGET_SAMPLE_RATE * 5);
    const tail = original.subarray(original.length - window.length - (original.length % QUANTUM));

    expect(window.length).toBeGreaterThan(TARGET_SAMPLE_RATE * 4);
    // The window must be real audio, not zeros.
    expect(maxFrameRms(window)).toBeGreaterThan(0.01);
    // And it must match the corresponding slice of the source.
    let maxDelta = 0;
    for (let i = 0; i < window.length; i++) {
      const d = Math.abs(window[i] - tail[i]);
      if (d > maxDelta) maxDelta = d;
    }
    expect(maxDelta).toBe(0);
  });
});
