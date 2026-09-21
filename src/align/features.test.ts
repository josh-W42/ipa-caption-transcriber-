import { describe, it, expect } from 'vitest';
import { featureDistance, INVENTORY } from './features';

/**
 * Tests assert relationships between distances rather than transcribing the table
 * back at itself — a test that restates the data cannot catch an error in it.
 *
 * The thresholds matter: the aligner picks operations by comparing substitution cost
 * against the gap penalty, so these numbers decide whether a flap is recorded as a
 * substitution or as a deletion plus an insertion.
 */
describe('featureDistance', () => {
  it('is zero for identical phones', () => {
    expect(featureDistance('t', 't')).toBe(0);
    expect(featureDistance('i', 'i')).toBe(0);
  });

  it('is symmetric', () => {
    expect(featureDistance('t', 'ɾ')).toBeCloseTo(featureDistance('ɾ', 't'), 10);
    expect(featureDistance('i', 'ɑ')).toBeCloseTo(featureDistance('ɑ', 'i'), 10);
  });

  it('is small for a flap and the /t/ it replaces', () => {
    // The most common English reduction. If this is not cheap the aligner prefers
    // delete-plus-insert, and every flapping measurement in M4 breaks.
    expect(featureDistance('t', 'ɾ')).toBeLessThan(0.25);
  });

  it('is small for a flap and /d/ too', () => {
    // Flaps neutralise /t/ and /d/, so both should be near neighbours.
    expect(featureDistance('d', 'ɾ')).toBeLessThan(0.25);
  });

  it('is small for voicing-only pairs', () => {
    expect(featureDistance('t', 'd')).toBeLessThan(0.15);
    expect(featureDistance('s', 'z')).toBeLessThan(0.15);
    expect(featureDistance('f', 'v')).toBeLessThan(0.15);
  });

  it('is small for schwa and its rhotic counterpart', () => {
    expect(featureDistance('ə', 'ɚ')).toBeLessThan(0.25);
  });

  it('is large between a consonant and a vowel', () => {
    expect(featureDistance('t', 'i')).toBeGreaterThan(0.5);
    expect(featureDistance('s', 'ɑ')).toBeGreaterThan(0.5);
  });

  it('is larger for distant vowels than near ones', () => {
    expect(featureDistance('i', 'ɪ')).toBeLessThan(featureDistance('i', 'ɑ'));
    expect(featureDistance('ɛ', 'æ')).toBeLessThan(featureDistance('ɛ', 'u'));
  });

  it('is larger for distant consonants than near ones', () => {
    // /t/ and /d/ differ in voicing alone; /t/ and /m/ differ in manner and place.
    expect(featureDistance('t', 'd')).toBeLessThan(featureDistance('t', 'm'));
  });

  it('places the glottal stop near /t/, since it substitutes for it', () => {
    expect(featureDistance('t', 'ʔ')).toBeLessThan(featureDistance('t', 'i'));
  });

  it('never exceeds 1 or falls below 0', () => {
    for (const a of INVENTORY) {
      for (const b of INVENTORY) {
        const d = featureDistance(a, b);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it('covers every phone both tracks can produce', () => {
    // A missing entry must fail loudly rather than silently defaulting to a distance.
    expect(INVENTORY.length).toBeGreaterThan(35);
    for (const p of INVENTORY) expect(() => featureDistance(p, 't')).not.toThrow();
  });

  it('throws on an unknown phone rather than inventing a distance', () => {
    expect(() => featureDistance('QQ', 't')).toThrow(/QQ/);
  });
});
