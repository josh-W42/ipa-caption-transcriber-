/**
 * Greedy CTC decoding, extracted from the M0 spike so it can be unit-tested.
 *
 * This exists instead of `pipeline()` because the phoneme repos ship `vocab.json` and
 * `tokenizer_class: Wav2Vec2PhonemeCTCTokenizer` but no `tokenizer.json`, so
 * `AutoTokenizer` throws. Decoding the logits directly is required anyway: it is the
 * only path that yields per-phone frame timings, which the analysis layer depends on.
 */

export interface DecodedPhone {
  /** The raw vocab symbol. May be multi-character — see normalise.ts. */
  phone: string;
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
  /** Softmax probability of the winning token at its first frame. */
  conf: number;
}

/**
 * Argmax per frame, collapse repeats, drop blanks.
 *
 * The blank is what lets CTC represent two identical phones in a row: `a a` collapses
 * to one phone, but `a <blank> a` is two. Losing that distinction silently merges
 * geminates, so it is pinned by test.
 */
export function ctcDecode(
  logits: Float32Array,
  numFrames: number,
  vocabSize: number,
  vocab: string[],
  blankId: number,
  secondsPerFrame: number,
): DecodedPhone[] {
  const out: DecodedPhone[] = [];
  let prevId = -1;

  for (let t = 0; t < numFrames; t++) {
    const base = t * vocabSize;

    let best = 0;
    let maxLogit = -Infinity;
    for (let v = 0; v < vocabSize; v++) {
      const val = logits[base + v];
      if (val > maxLogit) {
        maxLogit = val;
        best = v;
      }
    }

    // Softmax probability of the winner. Since its logit is the max, exp(0) = 1 over
    // the shifted sum.
    let sumExp = 0;
    for (let v = 0; v < vocabSize; v++) sumExp += Math.exp(logits[base + v] - maxLogit);
    const conf = 1 / sumExp;

    if (best !== blankId && best !== prevId) {
      out.push({
        phone: vocab[best] ?? `<${best}>`,
        start: t * secondsPerFrame,
        end: (t + 1) * secondsPerFrame,
        conf,
      });
    } else if (best === prevId && best !== blankId && out.length > 0) {
      // Same token still winning: extend the current phone rather than emitting again.
      out[out.length - 1].end = (t + 1) * secondsPerFrame;
    }

    prevId = best;
  }

  return out;
}

/** Invert a vocab.json map of symbol -> id into an id-indexed array. */
export function invertVocab(map: Record<string, number>): string[] {
  const inverted: string[] = [];
  for (const [symbol, id] of Object.entries(map)) inverted[id] = symbol;
  return inverted;
}
