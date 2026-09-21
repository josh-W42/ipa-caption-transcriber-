import { useCallback, useEffect, useRef, useState } from 'react';
import { AsrClient, type LoadProgress } from '../asr/client';
import { RingBuffer } from '../audio/ringBuffer';
import {
  startCapture,
  rms,
  maxFrameRms,
  spectralCentroid,
  dropoutRatio,
  SILENCE_RMS,
  TARGET_SAMPLE_RATE,
  CAPTURE_CONFIGS,
  type Capture,
} from '../audio/capture';
import { decodeTo16kMono } from '../audio/decode';
import { stitch } from '../transcript/stitch';
import { downloadWav } from '../audio/wav';
import { resampleTo16k } from '../audio/resample';
import { probeMediaRecorder, formatProbe, verdict } from '../audio/micProbe';
import { Lexicon } from '../phonemic/lexicon';
import { benchmarkAsr } from '../asr/benchmark';
import { PhoneticClient } from '../phonetic/client';
import { alignUtterance, type AlignedWord } from '../align/utterance';
import type { Baseline } from '../analysis/inventory';

/**
 * Trailing window handed to Whisper for each interim pass.
 *
 * Benchmarked against 2s, 3s, 5s and 8s: shorter windows are faster but truncate
 * mid-phrase, degrading a full sentence to "Saturday." Five seconds is where the
 * interim text stays coherent, and the speed is bought with a smaller model instead.
 */
const WINDOW_SECONDS = 5;

/**
 * Two models, which is what "live rough, refined on stop" actually requires.
 *
 * Benchmarked on this hardware, 5s window, median of 3 with warmup discarded:
 *   tiny.en  1.20s  40.8MB   -- fast enough to feel live
 *   base.en  2.54s  76.9MB   -- twice the cost, better on hard audio
 *
 * The live model loads first so captions start after ~41MB rather than ~77MB, and
 * the refined model downloads in the background afterwards. If it has not arrived by
 * the time recording stops, the refined pass falls back to the live model.
 */
const LIVE_MODEL = 'onnx-community/whisper-tiny.en';
const REFINED_MODEL = 'onnx-community/whisper-base.en';
/**
 * Pause between interim passes.
 *
 * This is a gap between passes, not a fixed interval: the loop waits, runs a pass to
 * completion, then waits again. A fixed 1500ms interval skipped every other tick,
 * because inference on a 5s window measured 2-3s — half the timers fired into a busy
 * pass and were discarded. Self-pacing removes the wasted wakeups and the log noise.
 */
const TICK_MS = 800;

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
  const [lexicon, setLexicon] = useState<Lexicon | null>(null);
  const [aligned, setAligned] = useState<AlignedWord[] | null>(null);
  const [phoneticReady, setPhoneticReady] = useState(false);
  const [baseline, setBaseline] = useState<Baseline | null>(null);

  const log = useCallback((line: string) => {
    const stamped = `${new Date().toISOString().slice(11, 19)}  ${line}`;
    // eslint-disable-next-line no-console
    console.log('[ipa]', line);
    setDiagnostics((d) => [...d.slice(-80), stamped]);
  }, []);

  const asr = useRef<AsrClient | null>(null);
  const asrRefined = useRef<AsrClient | null>(null);
  const phonetic = useRef<PhoneticClient | null>(null);
  // Sized for the highest plausible device rate, since capture is now at native rate.
  const ring = useRef(new RingBuffer(48000 * WINDOW_SECONDS));
  const captureRate = useRef(TARGET_SAMPLE_RATE);
  const recording = useRef<Float32Array[]>([]);
  const capture = useRef<Capture | null>(null);
  const stopping = useRef(false);
  const inFlight = useRef(false);
  const interimRef = useRef('');
  const lastRecording = useRef<Float32Array | null>(null);
  const configKey = useRef<keyof typeof CAPTURE_CONFIGS>('native');
  // stop() is memoised on [log], so reading the `lexicon` STATE inside it would
  // capture null forever. The ref always holds the current value.
  const lexiconRef = useRef<Lexicon | null>(null);

  useEffect(() => {
    return () => {
      stopping.current = true;
      void capture.current?.stop();
      asr.current?.dispose();
      asrRefined.current?.dispose();
      phonetic.current?.dispose();
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

      // Loaded alongside the model: both are one-off startup costs, and overlapping
      // them hides the lexicon's ~0.9MB entirely behind the much larger model
      // download. A lexicon failure must not take captions down with it.
      // Tiny next to the models; a failure here costs the baseline comparison only.
      fetch('/phone-baseline.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b: Baseline) => {
          setBaseline(b);
          log(
            `baseline ready: ${Object.keys(b.proportions).length} phones, ` +
              `${(b.tokenCoverage * 100).toFixed(1)}% token coverage`,
          );
        })
        .catch((err) => log(`baseline failed (comparison unavailable): ${err}`));

      const lexiconPromise = Lexicon.load('/lexicon.txt')
        .then((lex) => {
          log(`lexicon ready: ${lex.size.toLocaleString()} entries`);
          lexiconRef.current = lex;
          setLexicon(lex);
        })
        .catch((err) => {
          log(`lexicon FAILED (captions will run without IPA): ${err}`);
        });

      const info = await client.load(LIVE_MODEL);
      log(`live model (tiny.en) ready on ${info.device} in ${info.loadSeconds.toFixed(1)}s`);
      await lexiconPromise;

      // Background: the bigger model for the refined pass. Deliberately not awaited —
      // captions must not wait on a download only needed when recording stops.
      const refined = new AsrClient();
      refined
        .load(REFINED_MODEL)
        .then((r) => {
          asrRefined.current = refined;
          log(`refined model (base.en) ready on ${r.device} in ${r.loadSeconds.toFixed(1)}s`);
        })
        .catch((err) => {
          log(`refined model failed, will reuse the live model on stop: ${err}`);
        });

      // The phoneme model is the largest asset in the app at 197MB, and is only
      // needed when recording stops. Loaded last and never awaited: until it arrives
      // the app behaves exactly as M2 did, which is the correct degraded state.
      const ph = new PhoneticClient();
      ph.load()
        .then((r) => {
          phonetic.current = ph;
          setPhoneticReady(true);
          log(
            `phoneme model ready on ${r.device} in ${r.loadSeconds.toFixed(1)}s ` +
              `(${r.vocabSize} IPA symbols)`,
          );
        })
        .catch((err) => {
          log(`phoneme model failed — phonetic track unavailable: ${err}`);
        });
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

    const raw = ring.current.readLast(captureRate.current * WINDOW_SECONDS);
    const drops = dropoutRatio(raw);
    const buf = await resampleTo16k(raw, captureRate.current);

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
          `drops=${(drops * 100).toFixed(1)}% infer=${seconds.toFixed(2)}s text="${text}"`,
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
    setAligned(null);
    interimRef.current = '';
    ring.current.clear();
    recording.current = [];
    setError(null);

    try {
      capture.current = await startCapture((frame) => {
        ring.current.write(frame);
        recording.current.push(frame);
      }, log, CAPTURE_CONFIGS[configKey.current]);
      captureRate.current = capture.current.sampleRate;
      log(`capture running at ${captureRate.current}Hz (resampling to ${TARGET_SAMPLE_RATE}Hz offline)`);
      setStatus('recording');

      // Self-pacing: wait, run a pass to completion, wait again. Never queues, and
      // never fires a timer into a pass that is still running.
      stopping.current = false;
      void (async () => {
        while (!stopping.current) {
          await new Promise((r) => setTimeout(r, TICK_MS));
          if (stopping.current) break;
          await tick();
        }
      })();

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
    stopping.current = true;

    // Let any in-flight interim pass finish before the refined pass starts. The
    // pipeline is not reentrant, and previously a late tick and the refined pass
    // called transcribe() concurrently — the tick's result arrived after the refined
    // one and overwrote it.
    for (let i = 0; i < 100 && inFlight.current; i++) {
      await new Promise((r) => setTimeout(r, 50));
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
    const native = new Float32Array(total);
    let offset = 0;
    for (const frame of recording.current) {
      native.set(frame, offset);
      offset += frame.length;
    }
    // Measured BEFORE resampling: dropouts are introduced during capture, and
    // resampling would smear them into non-zero values and hide them.
    const drops = dropoutRatio(native);
    const full = await resampleTo16k(native, captureRate.current);
    // Kept so it can be exported and listened to: when the model disagrees with the
    // loudness statistics, the bytes are the only arbiter.
    lastRecording.current = full.slice(0);
    const centroid = spectralCentroid(full);
    log(
      `refined pass over ${(total / captureRate.current).toFixed(2)}s — ` +
        `speechRms=${maxFrameRms(full).toFixed(5)} centroid=${centroid.toFixed(0)}Hz ` +
        `dropouts=${(drops * 100).toFixed(1)}%`,
    );
    // Healthy voiced speech sits near 800Hz. Around 3500Hz means the voiced band has
    // been stripped out and only high-frequency residue remains.
    log(
      centroid < 1500 && drops < 0.05
        ? `VERDICT ${configKey.current}: HEALTHY — centroid ${centroid.toFixed(0)}Hz, dropouts ${(drops * 100).toFixed(1)}%`
        : `VERDICT ${configKey.current}: BROKEN — centroid ${centroid.toFixed(0)}Hz (want <1500), ` +
          `dropouts ${(drops * 100).toFixed(1)}% (want <5%)`,
    );

    try {
      const engine = asrRefined.current ?? asr.current!;
      const which = asrRefined.current ? 'base.en' : 'tiny.en (refined model not ready)';

      // SEQUENTIAL, not concurrent. Both workers share one GPU, and running them
      // together measured 24.6s against 2.2s for the ASR alone -- an 11x penalty from
      // contention. Awaiting each in turn keeps both at their solo speed.
      const audioForPhonetic = full.slice(0);
      const interimWords = interimRef.current.trim().split(/\s+/).filter(Boolean).length;

      // longForm: Whisper's encoder sees 30s at a time, and the refined pass gets the
      // WHOLE recording. Without chunking it transcribes part of a long buffer and
      // drops the rest, so stopping showed fewer words than the interim already had.
      const { text, seconds } = await engine.transcribe(full, true);
      const phoneticResult = phonetic.current
        ? await phonetic.current.transcribe(audioForPhonetic).catch((err) => {
            log(`phonetic pass failed: ${err}`);
            return null;
          })
        : null;
      const refinedWords = text.trim().split(/\s+/).filter(Boolean).length;
      log(`refined result via ${which} in ${seconds.toFixed(2)}s: "${text}"`);
      log(`words: interim ${interimWords} -> refined ${refinedWords}`);

      // The refined pass sees more context than any interim window, so it should
      // never come back with substantially LESS. If it does, content was dropped and
      // the user is about to lose words they already watched appear.
      if (interimWords > 0 && refinedWords < interimWords * 0.8) {
        log(
          `WARNING: refined pass lost ${interimWords - refinedWords} words vs the ` +
            `interim transcript — long-form chunking may not be covering this recording`,
        );
      }

      if (phoneticResult && lexiconRef.current) {
        const words = lexiconRef.current.transcribe(text);
        const rows = alignUtterance(words, phoneticResult.phones);
        setAligned(rows);
        const subs = rows.flatMap((r) => r.ops).filter((o) => o.type === 'substitute');
        const flaps = subs.filter((o) => o.from === 't' && o.to === 'ɾ');
        log(
          `phonetic: ${phoneticResult.phones.length} phones in ` +
            `${phoneticResult.seconds.toFixed(2)}s at ${phoneticResult.msPerFrame.toFixed(1)}ms/frame`,
        );
        log(`alignment: ${subs.length} divergences, ${flaps.length} of them /t/ -> [ɾ] flaps`);
      }
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
    setAligned(null);
    interimRef.current = '';
    setStatus('finalizing');
    try {
      const audio = await decodeTo16kMono('/sample.wav');
      log(
        `sample: ${(audio.length / TARGET_SAMPLE_RATE).toFixed(2)}s ` +
          `speechRms=${maxFrameRms(audio).toFixed(5)} meanRms=${rms(audio).toFixed(5)}`,
      );
      const engine = asrRefined.current ?? asr.current;

      // Sequential for the same reason as stop(): the two workers contend for one GPU.
      const audioForPhonetic = audio.slice(0);
      const { text, seconds } = await engine.transcribe(audio, true);
      const phoneticResult = phonetic.current
        ? await phonetic.current.transcribe(audioForPhonetic).catch((err) => {
            log(`phonetic pass failed: ${err}`);
            return null;
          })
        : null;
      log(`sample result in ${seconds.toFixed(2)}s: "${text}"`);
      setFinal(text);

      if (phoneticResult && lexiconRef.current) {
        const rows = alignUtterance(lexiconRef.current.transcribe(text), phoneticResult.phones);
        setAligned(rows);
        const subs = rows.flatMap((r) => r.ops).filter((o) => o.type === 'substitute');
        const flaps = subs.filter((o) => o.from === 't' && o.to === 'ɾ');
        log(
          `phonetic: ${phoneticResult.phones.length} phones in ` +
            `${phoneticResult.seconds.toFixed(2)}s at ${phoneticResult.msPerFrame.toFixed(1)}ms/frame`,
        );
        log(`alignment: ${subs.length} divergences, ${flaps.length} of them /t/ -> [ɾ] flaps`);
      }
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

  /**
   * Records the same microphone through MediaRecorder instead of the Web Audio
   * graph. Tells us whether the dropouts come from my capture code or from the
   * stream itself.
   */
  const probeMic = useCallback(async () => {
    setStatus('finalizing');
    try {
      log('--- microphone probe: speak normally for 8 seconds ---');
      const r = await probeMediaRecorder(8, log);
      if (r) {
        log(formatProbe(r));
        log(
          verdict(r).healthy
            ? 'Microphone is healthy at the source. If live captions are still wrong, ' +
              'the fault is in the Web Audio capture path rather than the device.'
            : 'Microphone is BROKEN at the source, before any of this code touches it: ' +
              'the device, its driver, or another app holding it. Test it outside the ' +
              'browser — no Web Audio change will fix this.',
        );
      }
    } catch (err) {
      log(`probe failed — ${err instanceof Error ? err.message : String(err)}`);
    }
    setStatus('ready');
  }, [log]);

  const runBenchmark = useCallback(async () => {
    setStatus('finalizing');
    try {
      log('--- ASR benchmark: median of 3, warmup discarded ---');
      await benchmarkAsr(log);
      log('--- benchmark complete ---');
    } catch (err) {
      log(`benchmark failed — ${err instanceof Error ? err.message : String(err)}`);
    }
    setStatus('ready');
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
    status, progress, device, interim, final, level, error, diagnostics, lexicon,
    aligned, phoneticReady, baseline,
    hasRecording: lastRecording.current !== null,
    load, start, stop, loadSample, exportRecording, setConfig, probeMic, runBenchmark,
  };
}
