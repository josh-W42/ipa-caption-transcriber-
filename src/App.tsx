import { useSession } from './session/useSession';
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
          <strong> M1: English captions only.</strong>
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
        {s.device && <span className="badge">{s.device}</span>}
      </div>

      {recording && (
        <div className="meter" aria-label="input level">
          <div className="meter-fill" style={{ width: `${Math.min(100, s.level * 1200)}%` }} />
        </div>
      )}

      <section className="captions">
        {s.final && <p className="final">{s.final}</p>}
        {s.interim && <p className="interim">{s.interim}</p>}

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
          Interim text is shown dimmed while you speak. On stop, the whole recording is
          re-transcribed in one pass — more accurate than any 5-second window.
        </p>
      </footer>
    </main>
  );
}
