export const TARGET_SAMPLE_RATE = 16000;

export interface Capture {
  /** The rate actually granted by the browser. Verify against TARGET_SAMPLE_RATE. */
  readonly sampleRate: number;
  stop(): Promise<void>;
}

/**
 * Capture microphone audio as 16kHz mono Float32 frames.
 *
 * Requests the AudioContext at 16kHz so the browser resamples natively rather than
 * us hand-rolling a decimator. `capture.test.ts` asserts the browser honours this;
 * if a platform ever refuses, `sampleRate` reports what was actually granted and the
 * caller must resample.
 */
export async function startCapture(onFrame: (frame: Float32Array) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

  try {
    await ctx.audioWorklet.addModule('/capture-processor.js');
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw new Error(`failed to load capture worklet: ${err}`);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'capture-processor');
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data);

  source.connect(node);
  // Not connected to ctx.destination on purpose — that would echo the mic to speakers.

  let stopped = false;

  return {
    sampleRate: ctx.sampleRate,
    async stop() {
      if (stopped) return;
      stopped = true;

      // All four steps matter. A surviving MediaStream track keeps the browser's
      // recording indicator lit, which reads as a broken app.
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

/** Root-mean-square amplitude — used to gate silence before transcribing. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  return Math.sqrt(sumSq / samples.length);
}
