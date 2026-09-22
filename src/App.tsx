import { useSession } from './session/useSession';
import { PhonemicLine } from './components/PhonemicLine';
import { AlignedCaptions } from './components/AlignedCaptions';
import { ReferencePanel } from './components/ReferencePanel';
import { AnalysisPanel } from './components/AnalysisPanel';
import { ProsodyPanel } from './components/ProsodyPanel';
import { LoadingPanel } from './components/LoadingPanel';
import { captionsReady } from './session/stages';
import './App.css';

export default function App() {
  const s = useSession();
  const busy = s.status === 'loading' || s.status === 'finalizing';
  const recording = s.status === 'recording';
  const started = s.status !== 'idle';
  const usable = captionsReady(s.stages);

  // A microphone fault is the one error a visitor cannot diagnose unaided — and it
  // happened during development, where it cost a long session before the cause turned
  // out to be the device rather than the code.
  const micProblem =
    s.error !== null && /microphone|mic\b|permission|NotAllowed|NotFound/i.test(s.error);

  return (
    <main className="app">
      <header>
        <h1>Live IPA Captions</h1>
        <p className="sub">
          Speak, and see three things at once: <strong>what you said</strong>, the{' '}
          <strong>/dictionary pronunciation/</strong> of those words, and the{' '}
          <strong>[phonetic transcription]</strong> of how you actually said them — then
          an analysis of where the last two differ.
        </p>
        <p className="sub quiet">
          Everything runs in your browser. No audio is uploaded, and there is no server.
        </p>
      </header>

      <LoadingPanel stages={s.stages} />

      {s.webgpu === false && (
        <div className="panel warn">
          <strong>No WebGPU in this browser.</strong> Everything still works, but
          inference runs on WASM and will be several times slower. Chrome or Edge on a
          desktop gives the best results.
        </div>
      )}

      {s.error && (
        <div className="panel error">
          <strong>{s.error}</strong>
          {micProblem && (
            <p className="hint">
              If the microphone seems connected but captions come out as nonsense, run{' '}
              <button className="linkish" onClick={s.probeMic}>
                Diagnose microphone
              </button>{' '}
              — it records through a second, independent path and reports whether the
              device itself is dropping audio. During development this turned out to be a
              faulty microphone rather than a bug, and nothing else revealed it.
            </p>
          )}
        </div>
      )}

      <div className="controls">
        {!recording ? (
          <button className="primary" onClick={s.start} disabled={busy}>
            Start recording
          </button>
        ) : (
          <button className="stop" onClick={s.stop}>
            Stop
          </button>
        )}

        <button
          className={started ? '' : 'suggested'}
          onClick={s.loadSample}
          disabled={busy || recording}
        >
          Try the sample
        </button>

        {s.final && s.status === 'ready' && (
          <button onClick={s.exportRecording} disabled={recording}>
            Download recording
          </button>
        )}

        {s.device && <span className="badge">{s.device}</span>}
        {s.phoneticReady && <span className="badge ok">phonetic ready</span>}
      </div>

      {!started && (
        <p className="hint firstrun">
          <strong>No microphone needed to look around</strong> — “Try the sample” runs a
          recorded sentence through the whole pipeline. Recording asks for microphone
          permission and keeps the audio on your machine.
        </p>
      )}

      {recording && (
        <div className="meter" aria-label="input level">
          <div className="meter-fill" style={{ width: `${Math.min(100, s.level * 1200)}%` }} />
        </div>
      )}

      <section className="captions">
        {s.aligned ? (
          <AlignedCaptions words={s.aligned} />
        ) : (
          s.final && <PhonemicLine text={s.final} lexicon={s.lexicon} />
        )}
        {s.interim && <PhonemicLine text={s.interim} lexicon={s.lexicon} interim />}

        {!s.final && !s.interim && (
          <p className="idle">
            {recording
              ? 'Listening…'
              : s.status === 'finalizing'
                ? 'Transcribing…'
                : usable
                  ? 'Ready. Press record, or try the sample.'
                  : started
                    ? 'Loading the speech model…'
                    : 'Captions will appear here.'}
          </p>
        )}
      </section>

      {s.aligned && <ReferencePanel words={s.aligned} />}
      {s.aligned && <AnalysisPanel words={s.aligned} baseline={s.baseline} />}
      {s.dsp && <ProsodyPanel result={s.dsp} />}

      <footer>
        <p className="hint">
          Interim text is dimmed while you speak; on stop the whole recording is
          re-transcribed in one pass. <code>/Slashes/</code> mark the dictionary&rsquo;s
          pronunciation, <code>[brackets]</code> what was actually produced, and a marked
          phone is one that differs — hover it to see the change. Words absent from the
          dictionary show <code>—</code> rather than a guess.
        </p>

        {/* Genuinely useful, but on the front page they make this look like a debug
            console rather than an instrument. */}
        <details className="devtools">
          <summary>Developer tools</summary>
          <div className="devtools-body">
            <div className="controls">
              <button onClick={s.probeMic} disabled={busy || recording}>
                Diagnose microphone
              </button>
              <button onClick={s.runBenchmark} disabled={busy || recording}>
                Benchmark ASR
              </button>
              <label className="cfg">
                capture
                <select onChange={(e) => s.setConfig(e.target.value)} disabled={recording}>
                  <option value="native">native rate + offline resample (fixed)</option>
                  <option value="A">A — forced 16kHz, processing on</option>
                  <option value="B">B — forced 16kHz, processing off, routed</option>
                  <option value="C">C — forced 16kHz, processing off</option>
                </select>
              </label>
            </div>

            {s.diagnostics.length > 0 && (
              <details className="diag" open>
                <summary>Diagnostics ({s.diagnostics.length})</summary>
                <pre>{s.diagnostics.join('\n')}</pre>
              </details>
            )}
          </div>
        </details>

        <p className="hint credits">
          Pronunciations from{' '}
          <a href="/LEXICON-LICENSE.txt" target="_blank" rel="noreferrer">
            CMUdict
          </a>
          ; frequency baseline from{' '}
          <a href="/BASELINE-LICENSE.txt" target="_blank" rel="noreferrer">
            FrequencyWords
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
