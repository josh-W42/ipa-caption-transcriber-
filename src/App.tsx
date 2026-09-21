import { useSession } from './session/useSession';
import { PhonemicLine } from './components/PhonemicLine';
import { AlignedCaptions } from './components/AlignedCaptions';
import './App.css';

export default function App() {
  const s = useSession();
  const busy = s.status === 'loading' || s.status === 'finalizing';
  const recording = s.status === 'recording';

  return (
    <main className="app">
      <header>
        <h1>Live IPA Captions</h1>
        <p className="sub">
          Speech to English, phonemic IPA and phonetic IPA — entirely in your browser.
          <strong> M3: English, phonemic and phonetic IPA.</strong>
        </p>
      </header>

      {s.status === 'loading' && (
        <div className="panel">
          <div className="row">
            <span>Downloading speech model…</span>
            <span className="mono">{s.progress ? `${s.progress.progress.toFixed(0)}%` : ''}</span>
          </div>
          <div className="bar">
            <div className="fill" style={{ width: `${s.progress?.progress ?? 0}%` }} />
          </div>
          <p className="hint">
            {s.progress?.file ?? 'Fetching…'} — this happens once, then it is cached.
          </p>
        </div>
      )}

      {s.error && (
        <div className="panel error">
          <strong>{s.error}</strong>
        </div>
      )}

      <div className="controls">
        {!recording ? (
          <button className="primary" onClick={s.start} disabled={busy}>
            {s.status === 'idle' ? 'Start (downloads model)' : 'Start recording'}
          </button>
        ) : (
          <button className="stop" onClick={s.stop}>
            Stop
          </button>
        )}
        <button onClick={s.loadSample} disabled={busy || recording}>
          Use sample audio
        </button>
        {s.final !== null && s.status === 'ready' && (
          <button onClick={s.exportRecording} disabled={recording}>
            Download last recording
          </button>
        )}
        {s.device && <span className="badge">{s.device}</span>}
        {s.phoneticReady && <span className="badge ok">phonetic ready</span>}

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

      {recording && (
        <div className="meter" aria-label="input level">
          <div className="meter-fill" style={{ width: `${Math.min(100, s.level * 1200)}%` }} />
        </div>
      )}

      <section className="captions">
        {/* Once the phoneme model has run there is a third row to show, so the
            aligned view replaces the two-row one. */}
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
                : 'Press start, or try the sample audio.'}
          </p>
        )}
      </section>

      <footer>
        <p className="hint">
          Interim text is dimmed while you speak; on stop the whole recording is
          re-transcribed in one pass. The <code>/slashes/</code> mark this as a{' '}
          <strong>phonemic</strong> transcription — the dictionary's pronunciation, not
          yours. Words absent from the dictionary show <code>—</code> rather than a
          guess. Where the phonetic row differs from the dictionary, the phone is
          marked — hover it to see the change.{' '}
          <a href="/LEXICON-LICENSE.txt" target="_blank" rel="noreferrer">
            CMUdict licence
          </a>
        </p>

        {s.diagnostics.length > 0 && (
          <details className="diag" open>
            <summary>Diagnostics ({s.diagnostics.length})</summary>
            <pre>{s.diagnostics.join('\n')}</pre>
          </details>
        )}
      </footer>
    </main>
  );
}
