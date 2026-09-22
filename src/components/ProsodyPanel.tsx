import { VowelSpace } from './VowelSpace';
import type { DspResult } from '../dsp/client';

/** Pitch contour with gaps where the signal is unvoiced. */
function PitchContour({ result }: { result: DspResult }) {
  const pts = result.pitch;
  const voiced = pts.filter((p) => p.f0 !== null);
  if (voiced.length < 2) return <p className="hint">Not enough voiced audio to draw a contour.</p>;

  const W = 640;
  const H = 110;
  const PAD = 26;
  const tMax = pts[pts.length - 1].time || 1;
  const fMin = Math.min(...voiced.map((p) => p.f0!)) * 0.9;
  const fMax = Math.max(...voiced.map((p) => p.f0!)) * 1.1;

  const x = (t: number) => PAD + (t / tMax) * (W - PAD * 2);
  const y = (f: number) => H - PAD - ((f - fMin) / (fMax - fMin || 1)) * (H - PAD * 2);

  // Split into runs of voiced frames. Unvoiced frames break the line rather than being
  // interpolated across — a smooth pitch line through a voiceless stop is an invention.
  const runs: Array<Array<{ time: number; f0: number }>> = [];
  let run: Array<{ time: number; f0: number }> = [];
  for (const p of pts) {
    if (p.f0 === null) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else run.push({ time: p.time, f0: p.f0 });
  }
  if (run.length > 1) runs.push(run);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pitch contour over time">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#2a2f38" />
        <text x={PAD - 4} y={PAD} className="vs-tick" textAnchor="end">{fMax.toFixed(0)}</text>
        <text x={PAD - 4} y={H - PAD} className="vs-tick" textAnchor="end">{fMin.toFixed(0)}</text>
        {runs.map((r, i) => (
          <polyline
            key={i}
            className="pitch-line"
            points={r.map((p) => `${x(p.time)},${y(p.f0)}`).join(' ')}
          />
        ))}
      </svg>
      <p className="hint">
        Gaps are unvoiced stretches, left empty rather than interpolated. Median
        smoothing reduces YIN&rsquo;s octave errors on creaky voice but does not
        eliminate them.
      </p>
    </div>
  );
}

export function ProsodyPanel({ result }: { result: DspResult }) {
  const r = result.rhythm;

  return (
    <details className="analysis">
      <summary>
        Prosody &amp; vowel space
        <span className="pill">{result.vowels.length} vowels measured</span>
        {result.pitchSummary.median && (
          <span className="pill">{result.pitchSummary.median.toFixed(0)} Hz median</span>
        )}
      </summary>

      <div className="an-body">
        {r && (
          <section>
            <h3>Timing</h3>
            <div className="stats">
              <Stat label="speech rate" value={`${r.speechRate.toFixed(1)}/s`} note="phones incl. pauses" />
              <Stat
                label="articulation rate"
                value={`${r.articulationRate.toFixed(1)}/s`}
                note="phones excl. pauses"
              />
              <Stat label="pauses" value={String(r.pauses.length)} note={`${r.pausedSeconds.toFixed(1)}s total`} />
              <Stat
                label="nPVI"
                value={r.nPVI === null ? '—' : r.nPVI.toFixed(0)}
                note={`${r.vocalicIntervals} vocalic intervals`}
              />
            </div>
            <p className="hint">
              Speech rate counts pauses; articulation rate does not — the gap between
              them is how much of the time was silence. nPVI measures how much vowel
              durations alternate; it needs sustained speech to mean much, and{' '}
              {r.vocalicIntervals} intervals is {r.vocalicIntervals < 20 ? 'not many' : 'a reasonable sample'}.
            </p>
          </section>
        )}

        <section>
          <h3>Pitch</h3>
          {result.pitchSummary.median ? (
            <>
              <div className="stats">
                <Stat label="median" value={`${result.pitchSummary.median.toFixed(0)} Hz`} />
                <Stat
                  label="range"
                  value={`${result.pitchSummary.min!.toFixed(0)}–${result.pitchSummary.max!.toFixed(0)}`}
                  note="Hz"
                />
                <Stat
                  label="voiced"
                  value={`${(result.pitchSummary.voicedFraction * 100).toFixed(0)}%`}
                  note="of frames"
                />
              </div>
              <PitchContour result={result} />
            </>
          ) : (
            <p className="hint">No voiced audio found.</p>
          )}
        </section>

        <section>
          <h3>Vowel space</h3>
          <VowelSpace vowels={result.vowels} clusters={result.clusters} />
        </section>
      </div>
    </details>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
