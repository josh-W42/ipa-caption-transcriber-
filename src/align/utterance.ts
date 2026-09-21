import { align, type AlignOp } from './align';
import { normalisePhonemic, normalisePhonetic } from './normalise';
import type { DecodedPhone } from '../phonetic/ctc';
import type { WordTranscription } from '../phonemic/lexicon';

/** A phone with its position in time, after normalisation. */
export interface TimedPhone {
  phone: string;
  start: number;
  end: number;
  conf: number;
}

export interface AlignedWord {
  word: string;
  /** Canonical IPA with stress marks, as the UI displays it. Null when out of vocab. */
  phonemic: string | null;
  /** What was actually said, for this word's span. */
  phonetic: TimedPhone[];
  /** Alignment operations belonging to this word. */
  ops: AlignOp[];
  start: number | null;
  end: number | null;
}

/**
 * Expand decoded CTC tokens into normalised, individually-timed phones.
 *
 * One CTC token is not one phone: the espeak vocab emits `əl` as a single token, and
 * `ɑː` normalises down to one phone once the length mark goes. Where a token expands
 * to several phones the span is divided evenly between them — an approximation, but
 * the alternative is claiming a precision the model never provided.
 */
export function expandPhonetic(decoded: DecodedPhone[]): TimedPhone[] {
  const out: TimedPhone[] = [];

  for (const d of decoded) {
    const phones = normalisePhonetic(d.phone);
    if (phones.length === 0) continue;

    const step = (d.end - d.start) / phones.length;
    phones.forEach((phone, i) => {
      out.push({
        phone,
        start: d.start + i * step,
        end: d.start + (i + 1) * step,
        conf: d.conf,
      });
    });
  }

  return out;
}

/**
 * Align a whole utterance and split the result back into words.
 *
 * The phonemic side is per-word; the phonetic side is one continuous stream. So the
 * phonemic phones are concatenated with a word index carried alongside, aligned as a
 * single sequence, and each operation is then attributed back to the word its phonemic
 * phone came from. Insertions, having no phonemic phone, inherit the previous
 * operation's word.
 *
 * This is also where WORD TIMINGS come from. M0 established that Whisper's word-level
 * timestamps are unavailable in this ONNX export; the design's answer was that the
 * alignment supplies them instead, at the CTC's 20ms resolution.
 */
export function alignUtterance(
  words: WordTranscription[],
  decoded: DecodedPhone[],
): AlignedWord[] {
  const phonetic = expandPhonetic(decoded);

  // Flatten the phonemic side, remembering which word each phone belongs to.
  const flatPhonemic: string[] = [];
  const wordOfPhone: number[] = [];
  words.forEach((w, wi) => {
    if (!w.found || !w.ipa) return;
    for (const p of normalisePhonemic(w.ipa)) {
      flatPhonemic.push(p);
      wordOfPhone.push(wi);
    }
  });

  const result: AlignedWord[] = words.map((w) => ({
    word: w.word,
    phonemic: w.ipa,
    phonetic: [],
    ops: [],
    start: null,
    end: null,
  }));

  // Nothing to align against: return the words with their phonemic side only.
  if (flatPhonemic.length === 0 || phonetic.length === 0) return result;

  const ops = align(
    flatPhonemic,
    phonetic.map((p) => p.phone),
  );

  let lastWord = wordOfPhone[0] ?? 0;
  for (const op of ops) {
    const wi = op.aIndex != null ? wordOfPhone[op.aIndex] : lastWord;
    lastWord = wi;

    const target = result[wi];
    if (!target) continue;

    target.ops.push(op);
    if (op.bIndex != null) target.phonetic.push(phonetic[op.bIndex]);
  }

  for (const w of result) {
    if (w.phonetic.length === 0) continue;
    w.start = w.phonetic[0].start;
    w.end = w.phonetic[w.phonetic.length - 1].end;
  }

  return result;
}

/** Render a word's phonetic phones as an IPA string. */
export const phoneticString = (w: AlignedWord): string => w.phonetic.map((p) => p.phone).join('');

/** Substitutions within a word, for highlighting and for M4's counts. */
export const divergences = (w: AlignedWord): AlignOp[] =>
  w.ops.filter((o) => o.type !== 'match');
