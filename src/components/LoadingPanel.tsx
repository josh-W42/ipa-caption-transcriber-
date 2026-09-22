import {
  downloadedMegabytes, TOTAL_MEGABYTES, captionsReady, allSettled, type LoadStage,
} from '../session/stages';

/**
 * Cold-start panel.
 *
 * A first-time visitor waits through roughly 315MB before the app is fully armed.
 * Whether they keep waiting depends on knowing two things this panel exists to say:
 * how much is left, and that the app already works.
 */
export function LoadingPanel({ stages }: { stages: LoadStage[] }) {
  const done = downloadedMegabytes(stages);
  const usable = captionsReady(stages);
  const finished = allSettled(stages);

  // Nothing started, or everything came from cache: no download chrome at all.
  const anyDownloading = stages.some((s) => s.status === 'loading');
  if (!anyDownloading && (finished || done === 0)) return null;

  const pct = Math.min(100, (done / TOTAL_MEGABYTES) * 100);

  return (
    <div className="panel loading">
      <div className="row">
        <span>
          {usable ? (
            <>
              <strong className="ok-text">Captions ready.</strong> Still downloading the
              analysis models…
            </>
          ) : (
            'Preparing — everything runs in your browser, nothing is uploaded'
          )}
        </span>
        <span className="mono">
          {done.toFixed(0)} / {TOTAL_MEGABYTES} MB
        </span>
      </div>

      <div className="bar">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>

      <ul className="stages">
        {stages.map((s) => (
          <li key={s.id} className={`stage ${s.status}`}>
            <span className="stage-mark">
              {s.status === 'ready' || s.status === 'cached'
                ? '✓'
                : s.status === 'failed'
                  ? '×'
                  : s.status === 'loading'
                    ? '•'
                    : '·'}
            </span>
            <span className="stage-label">{s.label}</span>
            <span className="stage-unlocks">{s.unlocks}</span>
            <span className="stage-size">
              {s.status === 'cached'
                ? 'cached'
                : s.status === 'failed'
                  ? 'unavailable'
                  : s.status === 'loading'
                    ? `${s.progress.toFixed(0)}%`
                    : `${s.megabytes} MB`}
            </span>
          </li>
        ))}
      </ul>

      <p className="hint">
        Downloaded once, then cached — later visits start immediately.
      </p>
    </div>
  );
}
