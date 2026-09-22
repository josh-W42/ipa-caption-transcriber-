import { REFERENCE_VOWELS } from '../dsp/synth';
import type { VowelMeasurement, VowelCluster } from '../dsp/vowels';

/**
 * The vowel quadrilateral: F1 vertical, F2 horizontal, BOTH INVERTED.
 *
 * The inversion is not stylistic. It is what makes the scatter fall into the shape
 * phoneticians read — close vowels at the top, front vowels at the left — so the plot
 * can be compared against every vowel chart ever printed.
 *
 * Every token is drawn as its own point. One dot per vowel category would claim a
 * precision the method does not have: measured against synthesised vowels, F1 error is
 * under 5% for open vowels but 5-32% for close ones. Tokens whose F1 is known to be
 * unreliable are drawn differently, and a category gets a dispersion ellipse only once
 * enough tokens exist to have observed a distribution.
 */

const F1_MIN = 200;
const F1_MAX = 1000;
const F2_MIN = 700;
const F2_MAX = 2600;

const W = 460;
const H = 340;
const PAD = 44;

/** F2 decreases left to right; F1 increases top to bottom. Both axes inverted. */
const x = (f2: number) => PAD + ((F2_MAX - clamp(f2, F2_MIN, F2_MAX)) / (F2_MAX - F2_MIN)) * (W - PAD * 2);
const y = (f1: number) => PAD + ((clamp(f1, F1_MIN, F1_MAX) - F1_MIN) / (F1_MAX - F1_MIN)) * (H - PAD * 2);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function VowelSpace({
  vowels,
  clusters,
}: {
  vowels: VowelMeasurement[];
  clusters: VowelCluster[];
}) {
  if (vowels.length === 0) {
    return (
      <p className="hint">
        No vowels passed the measurement gate. Vowels need to be voiced, above the
        energy floor, and at least 40&thinsp;ms long to have a steady state worth
        measuring.
      </p>
    );
  }

  return (
    <div className="vowelspace">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vowel space, F1 against F2">
        {/* Axes. Labels state the inversion so the reader is not left to infer it. */}
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#2a2f38" />
        <line x1={PAD} y1={PAD} x2={W - PAD} y2={PAD} stroke="#2a2f38" />
        <text x={W / 2} y={16} className="vs-axis" textAnchor="middle">
          F2 (Hz) — front ← → back
        </text>
        <text x={12} y={H / 2} className="vs-axis" textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>
          F1 (Hz) — close ↑ ↓ open
        </text>
        <text x={PAD} y={PAD - 6} className="vs-tick">{F2_MAX}</text>
        <text x={W - PAD} y={PAD - 6} className="vs-tick" textAnchor="end">{F2_MIN}</text>
        <text x={PAD - 6} y={PAD + 4} className="vs-tick" textAnchor="end">{F1_MIN}</text>
        <text x={PAD - 6} y={H - PAD} className="vs-tick" textAnchor="end">{F1_MAX}</text>

        {/* Reference positions, clearly marked as reference rather than measurement. */}
        {Object.entries(REFERENCE_VOWELS).map(([phone, [f1, f2]]) => (
          <text key={`ref-${phone}`} x={x(f2)} y={y(f1)} className="vs-ref" textAnchor="middle">
            {phone}
          </text>
        ))}

        {/* Dispersion ellipses, one SD, only where there are enough tokens. */}
        {clusters
          .filter((c) => c.enoughForEllipse)
          .map((c) => (
            <ellipse
              key={`el-${c.phone}`}
              cx={x(c.meanF2)}
              cy={y(c.meanF1)}
              rx={Math.max(6, Math.abs(x(c.meanF2 - c.sdF2) - x(c.meanF2)))}
              ry={Math.max(6, Math.abs(y(c.meanF1 + c.sdF1) - y(c.meanF1)))}
              className="vs-ellipse"
            />
          ))}

        {/* One point per token. */}
        {vowels.map((v, i) => (
          <g key={i}>
            <circle
              cx={x(v.f2)}
              cy={y(v.f1)}
              r={3.5}
              className={`vs-token ${v.f1Unreliable ? 'unreliable' : ''}`}
              opacity={0.35 + v.confidence * 0.55}
            >
              <title>
                {`${v.phone} in "${v.word}" — F1 ${v.f1.toFixed(0)}Hz, F2 ${v.f2.toFixed(0)}Hz` +
                  (v.f1Unreliable ? ' (F1 unreliable for close vowels)' : '')}
              </title>
            </circle>
            {/* Vertical whisker on unreliable tokens: F1 is the uncertain axis, so the
                uncertainty is drawn along it rather than as a symmetric halo. */}
            {v.f1Unreliable && (
              <line
                x1={x(v.f2)}
                y1={y(v.f1 * 0.8)}
                x2={x(v.f2)}
                y2={y(v.f1 * 1.2)}
                className="vs-whisker"
              />
            )}
          </g>
        ))}
      </svg>

      <p className="hint">
        Each point is one measured vowel; hollow points with a whisker are{' '}
        <strong>close vowels, whose F1 this method measures poorly</strong> — 5–32%
        error against under 5% for open vowels, because a close vowel&rsquo;s F1 sits
        among the voicing harmonics. Grey letters are reference positions, not your
        measurements. Ellipses show one standard deviation and appear only for vowels
        with at least three tokens.
      </p>
    </div>
  );
}
