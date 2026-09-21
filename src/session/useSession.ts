import { useCallback, useEffect, useRef, useState } from 'react';
import { AsrClient, type LoadProgress } from '../asr/client';
import { RingBuffer } from '../audio/ringBuffer';
import {
  startCapture,
  rms,
  maxFrameRms,
  spectralCentroid,
  SILENCE_RMS,
  TARGET_SAMPLE_RATE,
  CAPTURE_CONFIGS,
  type Capture,
} from '../audio/capture';
import { decodeTo16kMono } from '../audio/decode';
import { stitch } from '../transcript/stitch';
import { downloadWav } from '../audio/wav';

/** Trailing window handed to Whisper for each interim pass. */
const WINDOW_SECONDS = 5;
/** How often an interim pass runs. Inference is ~70-300ms, so this is not tight. */
const TICK_MS = 1500;

export type Status = 'idle' | 'loading' | 'ready' | 'recording' | 'finalizing' | 'error';

export function useSession() {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [device, setDevice] = useState<string>('');
  const [interim, setInterim] = useState('');
  const [final, setFinal] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  const log = useCallback((line: string) => {
    const stamped = `${new Date().toISOString().slice(11, 19)}  ${line}`;
    // eslint-disable-next-line no-console
    console.log('[ipa]', line);
    setDiagnostics((d) => [...d.slice(-80), stamped]);
  }, []);

  const asr = useRef<AsrClient | null>(null);
  const ring = useRef(new RingBuffer(TARGET_SAMPLE_RATE * WINDOW_SECONDS));
  const recording = useRef<Float32Array[]>([]);
  const capture = useRef<Capture | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);
  const interimRef = useRef('');
  const lastRecording = useRef<Float32Array | null>(null);
  const configKey = useRef<keyof typeof CAPTURE_CONFIGS>('A');

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      void capture.current?.stop();
      asr.current?.dispose();
    };
  }, []);

  const load = useCallback(async () => {
    if (asr.current) return;
    setStatus('loading');
    setError(null);
    try {
      const client = new AsrClient();
      client.onProgress = setProgress;
      asr.current = client;
      const info = await client.load();
      log(`model ready on ${info.device} in ${info.loadSeconds.toFixed(1)}s`);
      setDevice(info.device);
      setProgress(null);
      setStatus('ready');
    } catch (err) {
      asr.current = null;
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);

  /** One interim pass over the trailing window. */
  const tick = useCallback(async () => {
    // Skip rather than queue. A queue under sustained load grows without bound and
    // the captions fall progressively further behind — worse than a dropped update.
    if (inFlight.current || !asr.current) {
      if (inFlight.current) log('tick skipped — previous pass still in flight');
      return;
    }

    const buf = ring.current.readLast(TARGET_SAMPLE_RATE * WINDOW_SECONDS);
    const meanRms = rms(buf);
    const speechRms = maxFrameRms(buf);
    const centroid = spectralCentroid(buf);
    setLevel(speechRms);

    // Gate on the loudest short frame, not the window mean: averaging speech against
    // the surrounding pauses systematically under-measures it.
    if (speechRms < SILENCE_RMS) {
      log(
        `tick gated — ${(buf.length / TARGET_SAMPLE_RATE).toFixed(1)}s ` +
          `speechRms=${speechRms.toFixed(5)} meanRms=${meanRms.toFixed(5)} < ${SILENCE_RMS}`,
      );
      return;
    }

    inFlight.current = true;
    try {
      // readLast returns a fresh copy, so transferring it is safe.
      const { text, seconds } = await asr.current.transcribe(buf);
      log(
        `tick ok — speechRms=${speechRms.toFixed(5)} centroid=${centroid.toFixed(0)}Hz ` +
          `infer=${seconds.toFixed(2)}s text="${text}"`,
      );
      if (text) {
        interimRef.current = stitch(interimRef.current, text);
        setInterim(interimRef.current);
      }
    } catch (err) {
      log(`tick failed — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      inFlight.current = false;
    }
  }, [log]);

  const start = useCallback(async () => {
    if (!asr.current) await load();
    if (!asr.current) return;

    setInterim('');
    setFinal('');
    interimRef.current = '';
    ring.current.clear();
    recording.current = [];
    setError(null);

    try {
      capture.current = await startCapture((frame) => {
        ring.current.write(frame);
        recording.current.push(frame);
      }, log, CAPTURE_CONFIGS[configKey.current]);
      log(`capture running at ${capture.current.sampleRate}Hz`);
      setStatus('recording');
      timer.current = globalThis.setInterval(tick, TICK_MS);

      // If the worklet never runs, everything downstream looks like a dead mic.
      // Surface that distinctly rather than letting it read as silence.
      globalThis.setTimeout(() => {
        const c = capture.current;
        if (!c) return;
        if (c.frameCount === 0) {
          log('WARNING: no frames from the worklet after 2s — the audio graph is not running');
        } else {
          log(`frames flowing: ${c.frameCount} frames, peak ${c.peakSeen.toFixed(4)}`);
        }
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /denied|NotAllowed/i.test(message)
          ? 'Microphone permission denied. Try the sample audio instead.'
          : /NotFound|no audio/i.test(message)
            ? 'No microphone found. Try the sample audio instead.'
            : message,
      );
      setStatus('error');
    }
  }, [load, tick, log]);

  const stop = useCallback(async () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    await capture.current?.stop();
    capture.current = null;
    setLevel(0);
    setStatus('finalizing');

    // Refined pass: Whisper sees the whole recording rather than a 5-second keyhole,
    // so this is more accurate than any interim result.
    const total = recording.current.reduce((n, f) => n + f.length, 0);
    if (total === 0) {
      log('ERROR: recording is empty — no audio ever reached the ring buffer');
      setStatus('ready');
      return;
    }
    const full = new Float32Array(total);
    let offset = 0;
    for (const frame of recording.current) {
      full.set(frame, offset);
      offset += frame.length;
    }
    // Kept so it can be exported and listened to: when the model disagrees with the
    // loudness statistics, the bytes are the only arbiter.
    lastRecording.current = full.slice(0);
    const centroid = spectralCentroid(full);
    log(
      `refined pass over ${(total / TARGET_SAMPLE_RATE).toFixed(2)}s — ` +
        `speechRms=${maxFrameRms(full).toFixed(5)} centroid=${centroid.toFixed(0)}Hz`,
    );
    // Healthy voiced speech sits near 800Hz. Around 3500Hz means the voiced band has
    // been stripped out and only high-frequency residue remains.
    log(
      centroid < 1500
        ? `VERDICT config ${configKey.current}: spectrum looks like speech (${centroid.toFixed(0)}Hz)`
        : `VERDICT config ${configKey.current}: VOICED BAND MISSING (${centroid.toFixed(0)}Hz, expected ~800Hz)`,
    );

    try {
      const { text } = await asr.current!.transcribe(full);
      log(`refined result: "${text}"`);
      setFinal(text);
      setInterim('');
      interimRef.current = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStatus('ready');
  }, [log]);

  const loadSample = useCallback(async () => {
    if (!asr.current) await load();
    if (!asr.current) return;

    setInterim('');
    setFinal('');
    interimRef.current = '';
    setStatus('finalizing');
    try {
      const audio = await decodeTo16kMono('/sample.wav');
      log(
        `sample: ${(audio.length / TARGET_SAMPLE_RATE).toFixed(2)}s ` +
          `speechRms=${maxFrameRms(audio).toFixed(5)} meanRms=${rms(audio).toFixed(5)}`,
      );
      const { text, seconds } = await asr.current.transcribe(audio);
      log(`sample result in ${seconds.toFixed(2)}s: "${text}"`);
      setFinal(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStatus('ready');
  }, [load, log]);

  const exportRecording = useCallback(() => {
    const rec = lastRecording.current;
    if (!rec) return;
    downloadWav(rec, `ipa-captions-mic-${Date.now()}.wav`);
    log(`exported ${(rec.length / TARGET_SAMPLE_RATE).toFixed(2)}s of captured audio`);
  }, [log]);

  const setConfig = useCallback(
    (k: string) => {
      if (k in CAPTURE_CONFIGS) {
        configKey.current = k as keyof typeof CAPTURE_CONFIGS;
        log(`capture config set to ${k}: ${JSON.stringify(CAPTURE_CONFIGS[k])}`);
      }
    },
    [log],
  );

  return {
    status, progress, device, interim, final, level, error, diagnostics,
    hasRecording: lastRecording.current !== null,
    load, start, stop, loadSample, exportRecording, setConfig,
  };
}
