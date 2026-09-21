import type { AlignedWord } from '../align/utterance';
import type { AlignOp } from '../align/align';

/**
 * Named phonological processes, detected from the alignment.
 *
 * These are AUTHORED RULES, not learned patterns. The detector finds exactly what it
 * was told to look for and nothing else — absence of a process here means the rule
 * did not match, not that the speaker does not do it. The UI states this.
 *
 * Every detection carries its examples. "flapping: 5" is an assertion; "flapping: 5 —
 * butter, little, water, city, Saturday" is something the reader can check.
 */

export interface ProcessContext {
  op: AlignOp;
  /** The word the operation belongs to. */
  word: string;
  /** Phonemic phone before the one aligned here, if any. */
  prev: string | null;
  /** Phonemic phone after, if any. */
  next: string | null;
  /** True when this is the last phonemic phone of its word. */
  wordFinal: boolean;
  /** True when this is the first phonemic phone of its word. */
  wordInitial: boolean;
}

export interface ProcessDefinition {
  id: string;
  name: string;
  description: string;
  matches: (ctx: ProcessContext) => boolean;
}

export interface ProcessDetection {
  id: string;
  name: string;
  description: string;
  count: number;
  /** Words in which it occurred, deduplicated, in order of occurrence. */
  examples: string[];
  /**
   * Whether this looks like a pattern rather than a one-off.
   *
   * A single occurrence is an observation; calling it a property of the speaker needs
   * repetition. The UI distinguishes the two rather than presenting both as findings.
   */
  isPattern: boolean;
}

const VOWELS = new Set([
  'i', 'ɪ', 'e', 'ɛ', 'æ', 'a', 'ə', 'ɜ', 'ʌ', 'ɑ', 'ɔ', 'o', 'ʊ', 'u', 'ɚ', 'ɝ',
  'aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ',
]);
const REDUCED = new Set(['ə', 'ɪ', 'ɐ', 'ɚ']);
const STOPS = new Set(['p', 'b', 't', 'd', 'k', 'ɡ']);

const isVowel = (p: string | null): boolean => p !== null && VOWELS.has(p);

/** Minimum occurrences before a process is called a pattern rather than an instance. */
export const PATTERN_THRESHOLD = 2;

export const PROCESSES: ProcessDefinition[] = [
  {
    id: 'flapping',
    name: 'Flapping',
    description: '/t/ or /d/ becomes a tap [ɾ] between vowels — "butter" as [bʌɾɚ].',
    matches: ({ op, prev, next }) =>
      op.type === 'substitute' &&
      (op.from === 't' || op.from === 'd') &&
      op.to === 'ɾ' &&
      // Intervocalic is the defining condition. A /t/ → [ɾ] elsewhere is some other
      // process, and calling it flapping would be wrong.
      isVowel(prev) &&
      isVowel(next),
  },
  {
    id: 'glottalization',
    name: 'T-glottalization',
    description: '/t/ becomes a glottal stop [ʔ] — "button" as [bʌʔn̩].',
    matches: ({ op }) => op.type === 'substitute' && op.from === 't' && op.to === 'ʔ',
  },
  {
    id: 'cot-caught',
    name: 'Cot–caught merger',
    description:
      'The /ɔ/ and /ɑ/ vowels collapse together, so "cot" and "caught" rhyme. ' +
      'Detected in either direction.',
    matches: ({ op }) =>
      op.type === 'substitute' &&
      ((op.from === 'ɔ' && op.to === 'ɑ') || (op.from === 'ɑ' && op.to === 'ɔ')),
  },
  {
    id: 'vowel-reduction',
    name: 'Vowel reduction',
    description: 'A full vowel weakens toward schwa in an unstressed syllable.',
    matches: ({ op }) =>
      op.type === 'substitute' &&
      op.from !== null &&
      op.to !== null &&
      VOWELS.has(op.from) &&
      !REDUCED.has(op.from) &&
      REDUCED.has(op.to),
  },
  {
    id: 'vowel-strengthening',
    name: 'Unreduced vowel',
    description:
      'A vowel the dictionary reduces to schwa is produced in full — often careful ' +
      'or emphatic speech, as in "and" said as [ænd] rather than [ənd].',
    matches: ({ op }) =>
      op.type === 'substitute' &&
      op.from !== null &&
      op.to !== null &&
      REDUCED.has(op.from) &&
      VOWELS.has(op.to) &&
      !REDUCED.has(op.to),
  },
  {
    id: 'final-stop-deletion',
    name: 'Final stop deletion',
    description: 'A word-final stop is not released — "and" as [æn].',
    matches: ({ op, wordFinal }) =>
      op.type === 'delete' && op.from !== null && STOPS.has(op.from) && wordFinal,
  },
  {
    id: 'g-dropping',
    name: 'G-dropping',
    description: 'The velar nasal /ŋ/ fronts to [n] — "running" as [ɹʌnɪn].',
    matches: ({ op }) => op.type === 'substitute' && op.from === 'ŋ' && op.to === 'n',
  },
  {
    id: 'th-fronting',
    name: 'Th-fronting',
    description: '/θ/ becomes [f] or /ð/ becomes [v] — "think" as [fɪŋk].',
    matches: ({ op }) =>
      op.type === 'substitute' &&
      ((op.from === 'θ' && op.to === 'f') || (op.from === 'ð' && op.to === 'v')),
  },
  {
    id: 'non-rhotic',
    name: 'Non-rhoticity',
    description: '/ɹ/ is not produced, or rhotic schwa /ɚ/ loses its r-colour.',
    matches: ({ op }) =>
      (op.type === 'delete' && op.from === 'ɹ') ||
      (op.type === 'substitute' && op.from === 'ɚ' && op.to === 'ə'),
  },
];

/** Build the phonemic context for every operation in an utterance. */
function contexts(words: AlignedWord[]): ProcessContext[] {
  const out: ProcessContext[] = [];

  for (const w of words) {
    // Phonemic phones for this word, in order, as the ops reference them.
    const withPhoneme = w.ops.filter((o) => o.from !== null);

    withPhoneme.forEach((op, i) => {
      out.push({
        op,
        word: w.word,
        prev: i > 0 ? withPhoneme[i - 1].from : null,
        next: i < withPhoneme.length - 1 ? withPhoneme[i + 1].from : null,
        wordInitial: i === 0,
        wordFinal: i === withPhoneme.length - 1,
      });
    });
  }

  return out;
}

export function detectProcesses(words: AlignedWord[]): ProcessDetection[] {
  const ctxs = contexts(words);
  const results: ProcessDetection[] = [];

  for (const def of PROCESSES) {
    const hits = ctxs.filter((c) => def.matches(c));
    if (hits.length === 0) continue;

    const examples: string[] = [];
    for (const h of hits) {
      const clean = h.word.replace(/[^\p{L}\p{N}']/gu, '');
      if (clean && !examples.includes(clean)) examples.push(clean);
    }

    results.push({
      id: def.id,
      name: def.name,
      description: def.description,
      count: hits.length,
      examples,
      isPattern: hits.length >= PATTERN_THRESHOLD,
    });
  }

  return results.sort((a, b) => b.count - a.count);
}

/**
 * Divergences no authored rule accounted for.
 *
 * Reported rather than hidden: an unexplained difference is more interesting than a
 * named one, and quietly dropping it would make the rule set look more complete than
 * it is.
 */
export function unexplainedDivergences(words: AlignedWord[]): AlignOp[] {
  const ctxs = contexts(words);
  const explained = new Set<AlignOp>();

  for (const def of PROCESSES) {
    for (const c of ctxs) if (def.matches(c)) explained.add(c.op);
  }

  return words
    .flatMap((w) => w.ops)
    .filter((op) => op.type !== 'match' && !explained.has(op));
}
