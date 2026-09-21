export const TARGET_SAMPLE_RATE = 16000;

export interface Capture {
  /** The rate actually granted by the browser. Verify against TARGET_SAMPLE_RATE. */
  readonly sampleRate: number;
  /** Frames delivered by the worklet. Zero means the graph never ran. */
  readonly frameCount: number;
  /** Loudest sample observed. Zero with a non-zero frameCount means a silent device. */
  readonly peakSeen: number;
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
export async function startCapture(
  onFrame: (frame: Float32Array) => void,
  log: (line: string) => void = () => {},
): Promise<Capture> {
  // Created before awaiting getUserMedia so it sits as close to the user gesture as
  // possible. An AudioContext can start suspended, and a suspended context never runs
  // the worklet — which looks exactly like a dead microphone.
  const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  log(`AudioContext created: state=${ctx.state} rate=${ctx.sampleRate}`);

  if (ctx.state === 'suspended') {
    // Raced: without user activation resume() can never settle, and a hung promise
    // would stall silently rather than surfacing a diagnosable error.
    await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 2000))]);
    log(`after resume(): state=${ctx.state}`);
  }

  if (ctx.state !== 'running') {
    await ctx.close();
    throw new Error(
      `AudioContext stuck in "${ctx.state}" — the browser is blocking audio until a ` +
        `user gesture. Click Start again.`,
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const track = stream.getAudioTracks()[0];
  log(`mic: "${track?.label ?? 'unknown'}" settings=${JSON.stringify(track?.getSettings?.() ?? {})}`);

  try {
    await ctx.audioWorklet.addModule('/capture-processor.js');
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw new Error(`failed to load capture worklet: ${err}`);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'capture-processor');

  let frames = 0;
  let peak = 0;
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    frames++;
    if (frames <= 400 || frames % 400 === 0) {
      for (let i = 0; i < e.data.length; i++) {
        const v = Math.abs(e.data[i]);
        if (v > peak) peak = v;
      }
    }
    onFrame(e.data);
  };

  source.connect(node);
  // Routed to the destination through a muted gain rather than left dangling. The
  // graph is pulled from the destination, so an unreachable node is not guaranteed to
  // be processed; the zero gain keeps the mic from echoing to the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute);
  mute.connect(ctx.destination);

  let stopped = false;

  return {
    sampleRate: ctx.sampleRate,
    get frameCount() {
      return frames;
    },
    get peakSeen() {
      return peak;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      log(`capture stopped after ${frames} frames, peak ${peak.toFixed(4)}`);

      // All of these matter. A surviving MediaStream track keeps the browser's
      // recording indicator lit, which reads as a broken app.
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

/**
 * Silence gate. Whisper hallucinates text from silence, so windows below this are
 * skipped. The M0 fixture measured 0.0156 RMS while quiet but clearly audible, so
 * this sits well below that.
 */
export const SILENCE_RMS = 0.005;

/** Root-mean-square amplitude over the whole buffer. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  return Math.sqrt(sumSq / samples.length);
}

/**
 * Loudest short frame in the buffer — the correct gate for "does this window contain
 * speech anywhere".
 *
 * Mean RMS over a 5-second window averages speech against the pauses around it: one
 * second of quiet speech spread over five seconds sinks to roughly a third of its
 * true level, landing on the wrong side of the gate. Taking the max over ~100ms
 * frames measures the speech itself instead of the silence surrounding it.
 */
export function maxFrameRms(samples: Float32Array, frameSize = TARGET_SAMPLE_RATE / 10): number {
  if (samples.length === 0) return 0;
  if (samples.length <= frameSize) return rms(samples);

  let max = 0;
  for (let start = 0; start + frameSize <= samples.length; start += frameSize) {
    let sumSq = 0;
    for (let i = start; i < start + frameSize; i++) sumSq += samples[i] * samples[i];
    const frame = Math.sqrt(sumSq / frameSize);
    if (frame > max) max = frame;
  }
  return max;
}
