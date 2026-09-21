import { featureDistance, hasPhone } from './features';

/**
 * Needleman-Wunsch alignment between the phonemic and phonetic tracks, with
 * substitution cost taken from distinctive-feature distance.
 *
 * Plain edit distance would be linguistically wrong here: it scores /t/ -> [ɾ] exactly
 * as badly as /t/ -> [i], so an ordinary flapped "butter" would look as divergent as
 * noise. Feature distance makes a flap cost ~0.13 and a vowel-for-stop ~0.57, which is
 * what lets M4 distinguish a systematic reduction from a recognition error.
 */

export type OpType = 'match' | 'substitute' | 'delete' | 'insert';

export interface AlignOp {
  type: OpType;
  /** Phonemic phone, null for insertions. */
  from: string | null;
  /** Phonetic phone, null for deletions. */
  to: string | null;
  /** Index into the phonemic sequence, null for insertions. */
  aIndex: number | null;
  /** Index into the phonetic sequence, null for deletions. */
  bIndex: number | null;
  /** Feature distance for substitutions; 0 for matches, GAP for indels. */
  cost: number;
}

/**
 * Cost of leaving a phone unaligned.
 *
 * Tuned against the tests rather than by taste. It must sit ABOVE a near substitution
 * (a flap, ~0.13) so the aligner substitutes instead of deleting-and-inserting, and
 * BELOW a distant one (~0.57) so a genuinely dropped phone is recorded as a deletion
 * rather than forced into a nonsense pairing.
 */
export const GAP = 0.7;

/** Unknown phones are maximally distant rather than silently free to substitute. */
function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  if (!hasPhone(a) || !hasPhone(b)) return 1;
  return featureDistance(a, b);
}

export function align(phonemic: string[], phonetic: string[]): AlignOp[] {
  const n = phonemic.length;
  const m = phonetic.length;

  // dp[i][j] = cheapest cost aligning the first i phonemic and j phonetic phones.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) dp[0][j] = j * GAP;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + substitutionCost(phonemic[i - 1], phonetic[j - 1]),
        dp[i - 1][j] + GAP, // delete: phonemic phone not realised
        dp[i][j - 1] + GAP, // insert: phonetic phone with no phonemic source
      );
    }
  }

  // Traceback. Ties prefer the diagonal, so an equal-cost pairing is reported as a
  // substitution rather than as an indel pair — substitutions carry more information.
  const ops: AlignOp[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = substitutionCost(phonemic[i - 1], phonetic[j - 1]);
      if (Math.abs(dp[i][j] - (dp[i - 1][j - 1] + cost)) < 1e-9) {
        ops.push({
          type: cost === 0 ? 'match' : 'substitute',
          from: phonemic[i - 1],
          to: phonetic[j - 1],
          aIndex: i - 1,
          bIndex: j - 1,
          cost,
        });
        i--;
        j--;
        continue;
      }
    }

    if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + GAP)) < 1e-9) {
      ops.push({
        type: 'delete',
        from: phonemic[i - 1],
        to: null,
        aIndex: i - 1,
        bIndex: null,
        cost: GAP,
      });
      i--;
      continue;
    }

    ops.push({
      type: 'insert',
      from: null,
      to: phonetic[j - 1],
      aIndex: null,
      bIndex: j - 1,
      cost: GAP,
    });
    j--;
  }

  return ops.reverse();
}

/** Proportion of operations that are not exact matches. */
export function errorRate(ops: AlignOp[]): number {
  if (ops.length === 0) return 0;
  return ops.filter((o) => o.type !== 'match').length / ops.length;
}
