import type { AlignedWord } from '../align/utterance';
import type { TimedPhone } from '../align/utterance';

/**
 * Rhythm and timing, computed from phone timings alone — no signal processing.
 *
 * The cheapest genuinely linguistic measurements in the project, and the ones most
 * often reported carelessly. Speech rate and articulation rate are routinely conflated,
 * and they differ by exactly how much someone pauses.
 */

/** A silence longer than this counts as a pause rather than a closure. */
export const PAUSE_SECONDS = 0.18;

const VOWELS = new Set([
  'i', 'ɪ', 'e', 'ɛ', 'æ', 'a', 'ə', 'ʌ', 'ɑ', 'ɔ', 'o', 'ʊ', 'u', 'ɚ', 'ɝ', 'ɜ',
  'aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ',
]);

export interface Pause {
  start: number;
  end: number;
  duration: number;
}

export interface RhythmMetrics {
  totalSeconds: number;
  phoneCount: number;
  /** Phones per second INCLUDING pauses. */
  speechRate: number;
  /** Phones per second EXCLUDING pauses — how fast they talk when talking. */
  articulationRate: number;
  pauses: Pause[];
  pausedSeconds: number;
  /**
   * Normalised Pairwise Variability Index over vocalic intervals.
   *
   * The standard stress-timed vs syllable-timed measure. Near 0 means evenly spaced
   * vowels; higher means alternating long and short. Noisy on short utterances.
   */
  nPVI: number | null;
  /** Vocalic intervals the nPVI was computed from. */
  vocalicIntervals: number;
}

function allPhones(words: AlignedWord[]): TimedPhone[] {
  return words
    .flatMap((w) => w.phonetic)
    .slice()
    .sort((a, b) => a.start - b.start);
}

export function findPauses(words: AlignedWord[], threshold = PAUSE_SECONDS): Pause[] {
  const phones = allPhones(words);
  const out: Pause[] = [];

  for (let i = 1; i < phones.length; i++) {
    const gap = phones[i].start - phones[i - 1].end;
    if (gap >= threshold) {
      out.push({ start: phones[i - 1].end, end: phones[i].start, duration: gap });
    }
  }
  return out;
}

/**
 * nPVI over successive vocalic intervals.
 *
 * Each adjacent pair contributes |d1-d2| / ((d1+d2)/2); the mean, times 100. Normalising
 * by the local mean is what makes it robust to someone speaking faster or slower
 * overall — it measures the alternation, not the tempo.
 */
export function nPVI(durations: number[]): number | null {
  if (durations.length < 2) return null;

  let total = 0;
  let pairs = 0;
  for (let i = 1; i < durations.length; i++) {
    const a = durations[i - 1];
    const b = durations[i];
    const mean = (a + b) / 2;
    if (mean <= 0) continue;
    total += Math.abs(a - b) / mean;
    pairs++;
  }

  return pairs === 0 ? null : (total / pairs) * 100;
}

export function rhythmMetrics(words: AlignedWord[], threshold = PAUSE_SECONDS): RhythmMetrics | null {
  const phones = allPhones(words);
  if (phones.length === 0) return null;

  const start = phones[0].start;
  const end = phones[phones.length - 1].end;
  const totalSeconds = end - start;
  if (totalSeconds <= 0) return null;

  const pauses = findPauses(words, threshold);
  const pausedSeconds = pauses.reduce((n, p) => n + p.duration, 0);
  const speaking = totalSeconds - pausedSeconds;

  const vocalic = phones.filter((p) => VOWELS.has(p.phone)).map((p) => p.end - p.start);

  return {
    totalSeconds,
    phoneCount: phones.length,
    speechRate: phones.length / totalSeconds,
    // Guard: an utterance that is nearly all pause would divide by ~0.
    articulationRate: speaking > 0.05 ? phones.length / speaking : phones.length / totalSeconds,
    pauses,
    pausedSeconds,
    nPVI: nPVI(vocalic),
    vocalicIntervals: vocalic.length,
  };
}
