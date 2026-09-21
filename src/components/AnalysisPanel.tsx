import { useMemo } from 'react';
import { IpaChart } from './IpaChart';
import { phoneCounts, compareToBaseline, notableDeviations, totalPhones, type Baseline } from '../analysis/inventory';
import { confusionMatrix, topConfusions } from '../analysis/confusion';
import { detectProcesses, unexplainedDivergences } from '../analysis/processes';
import { describeChange } from '../align/glossary';
import type { AlignedWord } from '../align/utterance';

/**
 * Segmental analysis of the utterance.
 *
 * Every figure states its sample size. A percentage from a twelve-word utterance and
 * one from ten minutes of speech look identical on screen and mean entirely different
 * things, and this panel is the place that distinction is most easily lost.
 */
export function AnalysisPanel({ words, baseline }: { words: AlignedWord[]; baseline: Baseline | null }) {
  const counts = useMemo(() => phoneCounts(words), [words]);
  const matrix = useMemo(() => confusionMatrix(words), [words]);
  const processes = useMemo(() => detectProcesses(words), [words]);
  const unexplained = useMemo(() => unexplainedDivergences(words), [words]);
  const comparisons = useMemo(
    () => (baseline ? compareToBaseline(counts, baseline) : []),
    [counts, baseline],
  );
  const notable = useMemo(() => notableDeviations(comparisons), [comparisons]);

  const total = totalPhones(counts);
  if (total === 0) return null;

  const patterns = processes.filter((p) => p.isPattern);
  const singles = processes.filter((p) => !p.isPattern);

  return (
    <details className="analysis">
      <summary>
        Segmental analysis
        <span className="pill">{total} phones</span>
        {patterns.length > 0 && <span className="pill">{patterns.length} processes</span>}
      </summary>

      <div className="an-body">
        <section>
          <h3>Summary</h3>
          <div className="stats">
            <Stat label="phones produced" value={String(total)} />
            <Stat label="distinct phones" value={String(counts.length)} />
            <Stat
              label="divergence rate"
              value={`${(matrix.phoneErrorRate * 100).toFixed(1)}%`}
              note={`${matrix.totalDivergent} of ${matrix.totalAligned} aligned`}
            />
          </div>
          <p className="hint">
            Divergence is distance from the dictionary&rsquo;s General American
            pronunciation, not error. A different dialect diverges more, and is not
            worse.
          </p>
        </section>

        <section>
          <h3>Processes detected</h3>
          {processes.length === 0 ? (
            <p className="hint">No authored process matched this utterance.</p>
          ) : (
            <ul className="processes">
              {patterns.concat(singles).map((p) => (
                <li key={p.id} className={p.isPattern ? 'pattern' : 'single'}>
                  <div className="proc-head">
                    <strong>{p.name}</strong>
                    <span className="proc-count">
                      {p.count}
                      {!p.isPattern && <span className="once"> — once, not yet a pattern</span>}
                    </span>
                  </div>
                  <p className="proc-desc">{p.description}</p>
                  {/* Evidence, always. A claim the reader cannot check is worth less
                      than no claim. */}
                  <p className="proc-examples">{p.examples.join(', ')}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            These are <strong>authored rules</strong>, not learned patterns. The
            detector finds what it was told to look for — absence here means no rule
            matched, not that it did not happen.
            {unexplained.length > 0 && (
              <>
                {' '}
                {unexplained.length} divergence{unexplained.length === 1 ? '' : 's'} matched
                no rule: {unexplained.slice(0, 6).map(describeChange).join(', ')}.
              </>
            )}
          </p>
        </section>

        <section>
          <h3>Sounds used</h3>
          <IpaChart counts={counts} />
        </section>

        {baseline && (
          <section>
            <h3>Compared with conversational English</h3>
            {notable.length === 0 ? (
              <p className="hint">
                Nothing stands out, or the sample is too short to tell. Reliable
                comparison needs a few hundred phones; this one has {total}.
              </p>
            ) : (
              <table className="glossary">
                <thead>
                  <tr>
                    <th>phone</th>
                    <th>you</th>
                    <th>baseline</th>
                    <th>ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {notable.slice(0, 10).map((c) => (
                    <tr key={c.phone}>
                      <td className="ipa">{c.phone}</td>
                      <td>{(c.proportion * 100).toFixed(1)}%</td>
                      <td>{(c.expected * 100).toFixed(1)}%</td>
                      <td className={c.ratio > 1 ? 'over' : 'under'}>
                        {c.ratio === Infinity ? 'not in baseline' : `${c.ratio.toFixed(1)}×`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="hint">
              Baseline: {baseline.source}. Only phones with enough expected occurrences
              to be meaningful are shown.
            </p>
          </section>
        )}

        <section>
          <h3>Most frequent substitutions</h3>
          {topConfusions(matrix).length === 0 ? (
            <p className="hint">Every phone matched its dictionary form.</p>
          ) : (
            <table className="glossary">
              <thead>
                <tr>
                  <th>expected</th>
                  <th>produced</th>
                  <th>count</th>
                </tr>
              </thead>
              <tbody>
                {topConfusions(matrix).map((c) => (
                  <tr key={`${c.expected}-${c.produced}`}>
                    <td className="ipa">/{c.expected}/</td>
                    <td className="ipa phonetic">
                      {c.produced === '∅' ? 'not produced' : `[${c.produced}]`}
                    </td>
                    <td>{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
