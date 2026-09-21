import {
  CONSONANT_GRID, CONSONANT_MANNERS, CONSONANT_PLACES,
  VOWEL_GRID, VOWEL_HEIGHTS, VOWEL_BACKNESS,
  DIPHTHONGS, intensity,
} from '../analysis/ipaChart';
import type { PhoneCount } from '../analysis/inventory';

/**
 * The IPA chart, shaded by how much this speaker used each sound.
 *
 * Accessibility is a correctness matter here, not a nicety: a colour-only heatmap is
 * unreadable to a colour-blind viewer and dies in a greyscale screenshot. Every cell
 * carries its count as text alongside the shading.
 */
function Cell({
  phones,
  counts,
  max,
  span,
}: {
  phones: string[];
  counts: Map<string, number>;
  max: number;
  span?: number;
}) {
  return (
    <td className="chart-cell" colSpan={span}>
      {phones.map((p) => {
        const n = counts.get(p) ?? 0;
        const a = intensity(n, max);
        return (
          <span
            key={p}
            className={`chart-phone ${n > 0 ? 'used' : 'unused'}`}
            style={n > 0 ? { background: `rgba(110, 168, 254, ${a * 0.55})` } : undefined}
            title={n > 0 ? `${p}: ${n} occurrence${n === 1 ? '' : 's'}` : `${p}: not used`}
          >
            <span className="chart-sym">{p}</span>
            {n > 0 && <span className="chart-n">{n}</span>}
          </span>
        );
      })}
    </td>
  );
}

export function IpaChart({ counts }: { counts: PhoneCount[] }) {
  const map = new Map(counts.map((c) => [c.phone, c.count]));
  const max = counts.length ? counts[0].count : 0;

  const usedPlaces = CONSONANT_PLACES.filter((place) =>
    CONSONANT_MANNERS.some((m) => CONSONANT_GRID[m]?.[place]?.length),
  );

  return (
    <div className="ipachart">
      <h4>Consonants</h4>
      <table className="chart">
        <thead>
          <tr>
            <th />
            {usedPlaces.map((p) => (
              <th key={p}>{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CONSONANT_MANNERS.map((manner) => (
            <tr key={manner}>
              <th className="rowhead">{manner}</th>
              {usedPlaces.map((place) => {
                const phones = CONSONANT_GRID[manner]?.[place];
                // Empty cells are left empty on purpose: English having no bilabial
                // fricative is a fact about the language, not missing data.
                return phones ? (
                  <Cell key={place} phones={phones} counts={map} max={max} />
                ) : (
                  <td key={place} className="chart-cell empty" />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Vowels</h4>
      <table className="chart">
        <thead>
          <tr>
            <th />
            {VOWEL_BACKNESS.map((b) => (
              <th key={b}>{b}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VOWEL_HEIGHTS.map((height) => (
            <tr key={height}>
              <th className="rowhead">{height}</th>
              {VOWEL_BACKNESS.map((back) => {
                const phones = VOWEL_GRID[height]?.[back];
                return phones ? (
                  <Cell key={back} phones={phones} counts={map} max={max} />
                ) : (
                  <td key={back} className="chart-cell empty" />
                );
              })}
            </tr>
          ))}
          {/* Diphthongs have no single chart position, so they span the row rather
              than claiming a height and backness they do not have. */}
          <tr>
            <th className="rowhead">diphthongs</th>
            <Cell phones={DIPHTHONGS} counts={map} max={max} span={VOWEL_BACKNESS.length} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
