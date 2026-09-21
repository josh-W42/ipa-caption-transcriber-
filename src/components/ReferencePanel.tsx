import { useMemo, useState } from 'react';
import { buildGlossary, describeChange, divergentRows } from '../align/glossary';
import type { AlignedWord } from '../align/utterance';

/**
 * The utterance as a glossary rather than as flowing captions.
 *
 * The caption rows show what was said in the order it was said; this shows each word
 * once, with what the dictionary expects beside what was actually produced. It is the
 * view for reviewing afterwards rather than watching live.
 */
export function ReferencePanel({ words }: { words: AlignedWord[] }) {
  const [onlyDivergent, setOnlyDivergent] = useState(false);

  const all = useMemo(() => buildGlossary(words), [words]);
  const rows = onlyDivergent ? divergentRows(all) : all;
  const divergentCount = useMemo(() => divergentRows(all).length, [all]);

  if (all.length === 0) return null;

  return (
    <details className="reference" open>
      <summary>
        Dictionary reference — {all.length} words
        {divergentCount > 0 && <span className="pill">{divergentCount} diverged</span>}
      </summary>

      <label className="filter">
        <input
          type="checkbox"
          checked={onlyDivergent}
          onChange={(e) => setOnlyDivergent(e.target.checked)}
        />
        show only words that differed from the dictionary
      </label>

      <table className="glossary">
        <thead>
          <tr>
            <th>word</th>
            <th>expected</th>
            <th>actual</th>
            <th>difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.word} className={r.changes.length ? 'diverged-row' : undefined}>
              <td className="gl-word">
                {r.word}
                {r.count > 1 && <span className="count">×{r.count}</span>}
              </td>
              <td className="ipa">
                {r.expected ? `/${r.expected}/` : <span className="oov">not in dictionary</span>}
              </td>
              <td className="ipa phonetic">{r.actual ? `[${r.actual}]` : '—'}</td>
              <td className="gl-change">
                {r.changes.length === 0
                  ? ''
                  : r.changes.map(describeChange).join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="hint">Every word matched its dictionary pronunciation.</p>
      )}
    </details>
  );
}
