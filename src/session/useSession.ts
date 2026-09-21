import { useCallback, useEffect, useRef, useState } from 'react';
import { AsrClient, type LoadProgress } from '../asr/client';
import { RingBuffer } from '../audio/ringBuffer';
import { startCapture, rms, TARGET_SAMPLE_RATE, type Capture } from '../audio/capture';
import { decodeTo16kMono } from '../audio/decode';
import { stitch } from '../transcript/stitch';

/** Trailing window handed to Whisper for each interim pass. */
const WINDOW_SECONDS = 5;
/** How often an interim pass runs. Inference is ~70-300ms, so this is not tight. */
const TICK_MS = 1500;
/**
 * Silence gate. Whisper hallucinates text from silence, so windows below this are
 * skipped. The M0 fixture measured 0.0156 RMS while quiet but clearly audible and
 * transcribed correctly, so this sits well below that.
 */
const SILENCE_RMS = 0.005;

export type Status = 'idle' | 'loading' | 'ready' | 'recording' | 'finalizing' | 'error';

export function useSession() {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [device, setDevice] = useState<string>('');
  const [interim, setInterim] = useState('');
  const [final, setFinal] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const asr = useRef<AsrClient | null>(null);
  const ring = useRef(new RingBuffer(TARGET_SAMPLE_RATE * WINDOW_SECONDS));
  const recording = useRef<Float32Array[]>([]);
  const capture = useRef<Capture | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const interimRef = useRef('');

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
    if (inFlight.current || !asr.current) return;

    const window = ring.current.readLast(TARGET_SAMPLE_RATE * WINDOW_SECONDS);
    const loudness = rms(window);
    setLevel(loudness);
    if (loudness < SILENCE_RMS) return;

    inFlight.current = true;
    try {
      // readLast returns a fresh copy, so transferring it is safe.
      const { text } = await asr.current.transcribe(window);
      if (text) {
        interimRef.current = stitch(interimRef.current, text);
        setInterim(interimRef.current);
      }
    } catch {
      // A dropped interim pass is not worth surfacing; the refined pass still runs.
    } finally {
      inFlight.current = false;
    }
  }, []);

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
      });
      setStatus('recording');
      timer.current = window.setInterval(tick, TICK_MS);
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
  }, [load, tick]);

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
      setStatus('ready');
      return;
    }
    const full = new Float32Array(total);
    let offset = 0;
    for (const frame of recording.current) {
      full.set(frame, offset);
      offset += frame.length;
    }

    try {
      const { text } = await asr.current!.transcribe(full);
      setFinal(text);
      setInterim('');
      interimRef.current = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStatus('ready');
  }, []);

  const loadSample = useCallback(async () => {
    if (!asr.current) await load();
    if (!asr.current) return;

    setInterim('');
    setFinal('');
    interimRef.current = '';
    setStatus('finalizing');
    try {
      const audio = await decodeTo16kMono('/sample.wav');
      const { text } = await asr.current.transcribe(audio);
      setFinal(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStatus('ready');
  }, [load]);

  return { status, progress, device, interim, final, level, error, load, start, stop, loadSample };
}
