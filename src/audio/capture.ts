export const TARGET_SAMPLE_RATE = 16000;

/**
 * Rough spectral centroid, without an FFT.
 *
 * For a sinusoid at frequency f, rms(diff(x))/rms(x) == 2·sin(πf/fs), so inverting
 * that gives a usable centre-of-mass estimate. Cheap, and more than accurate enough
 * to tell voiced speech (~800Hz) from the high-frequency residue left behind when
 * something strips the voiced band out (~3700Hz).
 */
export function spectralCentroid(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): number {
  if (samples.length < 2) return 0;

  let sumSq = 0;
  let diffSq = 0;
  for (let i = 1; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
    const d = samples[i] - samples[i - 1];
    diffSq += d * d;
  }
  if (sumSq === 0) return 0;

  const ratio = Math.sqrt(diffSq / sumSq);
  const clamped = Math.min(2, Math.max(0, ratio)) / 2;
  return (Math.asin(clamped) * sampleRate) / Math.PI;
}

/**
 * Fraction of samples lost to dropouts — runs of exact zeros long enough that they
 * cannot be ordinary zero crossings.
 *
 * Chopped capture keeps a speech-shaped envelope and a normal RMS, so no loudness
 * metric detects it. This does. A healthy capture reads ~0; the broken one read 0.29.
 */
export function dropoutRatio(samples: Float32Array, minRun = 32): number {
  if (samples.length === 0) return 1;

  let lost = 0;
  let run = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] === 0) {
      run++;
    } else {
      if (run >= minRun) lost += run;
      run = 0;
    }
  }
  if (run >= minRun) lost += run;

  return lost / samples.length;
}

/** Capture configurations under test while diagnosing the spectral problem. */
export interface CaptureConfig {
  /** Browser DSP: echoCancellation / noiseSuppression / autoGainControl. */
  processing: boolean;
  /** Route the worklet to ctx.destination through a zero gain. */
  routeToDestination: boolean;
  /** Open the context at 16kHz, rather than the device's native rate. */
  forceSampleRate: boolean;
}

export const CAPTURE_CONFIGS: Record<string, CaptureConfig> = {
  /**
   * DEFAULT. Capture at the device's native rate and resample offline.
   *
   * Forcing the context to 16kHz makes Chrome resample a live MediaStream on the
   * audio thread, where it starves: ~30% of samples arrived as zero-filled render
   * quanta, chopping speech into 8ms fragments. Native rate avoids that path.
   */
  native: { processing: false, routeToDestination: false, forceSampleRate: false },

  // Retained so the diagnosis stays reproducible.
  A: { processing: true, routeToDestination: true, forceSampleRate: true },
  B: { processing: false, routeToDestination: true, forceSampleRate: true },
  C: { processing: false, routeToDestination: false, forceSampleRate: true },
  D: { processing: false, routeToDestination: false, forceSampleRate: false },
};

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
 * Capture microphone audio as mono Float32 frames at the context's sample rate.
 *
 * By default the context runs at the DEVICE's native rate and the caller resamples to
 * 16kHz offline. Forcing the context to 16kHz instead makes Chrome resample a live
 * MediaStream on the audio thread, where it starves and delivers ~30% of render
 * quanta zero-filled — audio that keeps a normal envelope and RMS while being
 * unintelligible. `sampleRate` reports the rate actually granted; the caller must
 * resample from it.
 */
export async function startCapture(
  onFrame: (frame: Float32Array) => void,
  log: (line: string) => void = () => {},
  config: CaptureConfig = CAPTURE_CONFIGS.native,
): Promise<Capture> {
  // Created before awaiting getUserMedia so it sits as close to the user gesture as
  // possible. An AudioContext can start suspended, and a suspended context never runs
  // the worklet — which looks exactly like a dead microphone.
  const ctx = config.forceSampleRate
    ? new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
    : new AudioContext();
  log(
    `AudioContext created: state=${ctx.state} rate=${ctx.sampleRate} ` +
      `config={processing:${config.processing} route:${config.routeToDestination} ` +
      `force16k:${config.forceSampleRate}}`,
  );

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
      // Off by default: none of it helps transcription, and AGC in particular fights
      // the level normalisation the model already does. Tested and found NOT to be
      // the cause of the dropout bug, but there is no reason to leave it on.
      echoCancellation: config.processing,
      noiseSuppression: config.processing,
      autoGainControl: config.processing,
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
  let mute: GainNode | null = null;
  if (config.routeToDestination) {
    mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
  }

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
      mute?.disconnect();
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
