import type { AlignedWord } from './utterance';
import type { AlignOp } from './align';

/**
 * One row of the reference panel: a word, what the dictionary expects, what was
 * actually said, and the differences between them.
 *
 * The captions show the utterance as it flowed; this shows it as a glossary, which is
 * the view you want when reviewing rather than watching.
 */
export interface GlossaryRow {
  word: string;
  /** Dictionary pronunciation. Null when the word is not in the lexicon. */
  expected: string | null;
  /** What was produced. Empty before the phoneme model has run. */
  actual: string;
  /** Non-match operations, deduplicated for display. */
  changes: AlignOp[];
  /** How many times this word occurred in the utterance. */
  count: number;
}

/** Key for deduplication: same spelling ignoring case and trailing punctuation. */
const key = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

export function describeChange(op: AlignOp): string {
  if (op.type === 'substitute') return `/${op.from}/ → [${op.to}]`;
  if (op.type === 'delete') return `/${op.from}/ dropped`;
  return `[${op.to}] added`;
}

/**
 * Collapse an utterance into unique words, in order of first appearance.
 *
 * Order of appearance rather than alphabetical: the panel is for reviewing what you
 * just said, and the sentence's own order is the order you remember it in.
 *
 * Repeats are counted rather than listed. Where a word occurs more than once its
 * first pronunciation is shown — the alternative is a row per occurrence, which
 * buries the interesting words in duplicates.
 */
export function buildGlossary(words: AlignedWord[]): GlossaryRow[] {
  const rows = new Map<string, GlossaryRow>();

  for (const w of words) {
    const k = key(w.word);
    if (!k) continue; // punctuation-only token

    const existing = rows.get(k);
    if (existing) {
      existing.count++;
      continue;
    }

    rows.set(k, {
      word: w.word,
      expected: w.phonemic,
      actual: w.phonetic.map((p) => p.phone).join(''),
      changes: w.ops.filter((o) => o.type !== 'match'),
      count: 1,
    });
  }

  return [...rows.values()];
}

/** Rows where the speaker diverged from the dictionary — the interesting ones. */
export const divergentRows = (rows: GlossaryRow[]): GlossaryRow[] =>
  rows.filter((r) => r.changes.length > 0);
