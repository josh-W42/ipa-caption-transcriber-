import type { AlignedWord } from '../align/utterance';

export interface Baseline {
  source: string;
  note: string;
  tokenCoverage: number;
  totalPhoneTokens: number;
  proportions: Record<string, number>;
}

export interface PhoneCount {
  phone: string;
  count: number;
  proportion: number;
}

export interface PhoneComparison extends PhoneCount {
  /** Baseline proportion for conversational English. */
  expected: number;
  /** observed / expected. >1 means used more than the baseline. */
  ratio: number;
  /**
   * Whether the sample is large enough to say anything about this phone.
   *
   * A short utterance is missing most of the inventory. Reporting "never uses /ʒ/"
   * from twelve words is not a rounding error, it is a claim the data cannot support,
   * so the UI must be able to suppress it.
   */
  sufficient: boolean;
}

/** Minimum EXPECTED occurrences before a phone's rate means anything. */
export const MIN_EXPECTED = 5;

/**
 * Count the phones the speaker actually produced.
 *
 * Deliberately the PHONETIC track: counting the phonemic side would count the
 * dictionary's phones and make every speaker look identical.
 */
export function phoneCounts(words: AlignedWord[]): PhoneCount[] {
  const counts = new Map<string, number>();
  for (const w of words) {
    for (const p of w.phonetic) counts.set(p.phone, (counts.get(p.phone) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];

  return [...counts.entries()]
    .map(([phone, count]) => ({ phone, count, proportion: count / total }))
    .sort((a, b) => b.count - a.count);
}

export const totalPhones = (counts: PhoneCount[]): number =>
  counts.reduce((n, c) => n + c.count, 0);

/**
 * Compare observed phone use against the conversational-English baseline.
 *
 * Covers every phone in EITHER the sample or the baseline, so phones the speaker used
 * that the baseline lacks are reported rather than silently dropped.
 */
export function compareToBaseline(
  counts: PhoneCount[],
  baseline: Baseline,
): PhoneComparison[] {
  const total = totalPhones(counts);
  if (total === 0) return [];

  const observed = new Map(counts.map((c) => [c.phone, c]));
  const phones = new Set([...observed.keys(), ...Object.keys(baseline.proportions)]);

  return [...phones]
    .map((phone) => {
      const c = observed.get(phone);
      const count = c?.count ?? 0;
      const proportion = c?.proportion ?? 0;
      const expected = baseline.proportions[phone] ?? 0;

      return {
        phone,
        count,
        proportion,
        expected,
        // A phone absent from the baseline but present in the sample has no meaningful
        // ratio; report Infinity rather than dividing by zero.
        ratio: expected === 0 ? (count > 0 ? Infinity : 1) : proportion / expected,
        sufficient: expected * total >= MIN_EXPECTED,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** Phones used markedly more or less than the baseline, where the sample supports it. */
export function notableDeviations(
  comparisons: PhoneComparison[],
  factor = 1.5,
): PhoneComparison[] {
  return comparisons
    .filter((c) => c.sufficient && (c.ratio >= factor || c.ratio <= 1 / factor))
    .sort((a, b) => Math.abs(Math.log(b.ratio || 1)) - Math.abs(Math.log(a.ratio || 1)));
}
