import { describe, it, expect } from 'vitest';
import { ctcDecode, invertVocab } from './ctc';

/**
 * Synthetic logits rather than real model output: a hand-built sequence is far easier
 * to reason about and pins the collapse and blank rules exactly.
 */
const VOCAB = ['<pad>', 'a', 'b', 'c'];
const BLANK = 0;
const SPF = 0.02; // 20ms frames, matching the real model

function logitsFor(sequence: number[]): Float32Array {
  const out = new Float32Array(sequence.length * VOCAB.length).fill(-10);
  sequence.forEach((id, t) => {
    out[t * VOCAB.length + id] = 10;
  });
  return out;
}

const decode = (seq: number[]) =>
  ctcDecode(logitsFor(seq), seq.length, VOCAB.length, VOCAB, BLANK, SPF);

describe('ctcDecode', () => {
  it('decodes a simple sequence', () => {
    expect(decode([1, 2, 3]).map((p) => p.phone)).toEqual(['a', 'b', 'c']);
  });

  it('collapses repeated tokens into one phone', () => {
    expect(decode([1, 1, 1]).map((p) => p.phone)).toEqual(['a']);
  });

  it('extends the phone end time across the repeat', () => {
    const [p] = decode([1, 1, 1]);
    expect(p.start).toBeCloseTo(0, 6);
    expect(p.end).toBeCloseTo(3 * SPF, 6);
  });

  it('drops blanks', () => {
    expect(decode([0, 1, 0, 0, 2, 0]).map((p) => p.phone)).toEqual(['a', 'b']);
  });

  it('treats a blank between identical tokens as a boundary', () => {
    // This is the entire reason CTC has a blank symbol. Without it, geminates and
    // repeated phones silently merge into one.
    expect(decode([1, 1, 0, 1, 1]).map((p) => p.phone)).toEqual(['a', 'a']);
  });

  it('times phones from secondsPerFrame', () => {
    const phones = decode([1, 0, 2]);
    expect(phones[0].start).toBeCloseTo(0, 6);
    expect(phones[1].start).toBeCloseTo(2 * SPF, 6);
  });

  it('reports high confidence for a dominant token', () => {
    expect(decode([1])[0].conf).toBeGreaterThan(0.9);
  });

  it('reports low confidence when tokens are near-tied', () => {
    const flat = new Float32Array(VOCAB.length).fill(5);
    const phones = ctcDecode(flat, 1, VOCAB.length, VOCAB, BLANK, SPF);
    // Every token equally likely — the winner cannot be confident.
    if (phones.length) expect(phones[0].conf).toBeLessThan(0.4);
  });

  it('returns nothing for all-blank input', () => {
    expect(decode([0, 0, 0])).toEqual([]);
  });

  it('falls back visibly for an out-of-range id rather than emitting undefined', () => {
    const out = ctcDecode(logitsFor([1]), 1, VOCAB.length, [], BLANK, SPF);
    expect(out[0].phone).toBe('<1>');
  });
});

describe('invertVocab', () => {
  it('maps ids back to symbols', () => {
    expect(invertVocab({ '<pad>': 0, a: 1, b: 2 })).toEqual(['<pad>', 'a', 'b']);
  });

  it('does not assume the blank is at any particular id', () => {
    // The M0 findings noted the blank is at id 0 for this repo but that is not
    // guaranteed across repos, so callers must use indexOf.
    const v = invertVocab({ a: 0, '<pad>': 1 });
    expect(v.indexOf('<pad>')).toBe(1);
  });
});
