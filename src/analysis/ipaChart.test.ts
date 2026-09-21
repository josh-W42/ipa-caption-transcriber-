import { describe, it, expect } from 'vitest';
import { chartPhones, intensity, CONSONANT_GRID, VOWEL_GRID } from './ipaChart';
import { INVENTORY } from '../align/features';

describe('chart coverage', () => {
  it('has no duplicate phones across cells', () => {
    const phones = chartPhones();
    expect(new Set(phones).size).toBe(phones.length);
  });

  it('places every phone the feature table knows about', () => {
    // A phone the aligner can produce but the chart cannot show would be invisible
    // in the analysis — present in the data, absent from the picture.
    const charted = new Set(chartPhones());
    const missing = INVENTORY.filter((p) => !charted.has(p));
    expect(missing).toEqual([]);
  });

  it('puts the voiceless member of a pair first', () => {
    expect(CONSONANT_GRID.plosive!.bilabial).toEqual(['p', 'b']);
    expect(CONSONANT_GRID.fricative!.alveolar).toEqual(['s', 'z']);
  });

  it('places the flap where a phonetician expects it', () => {
    expect(CONSONANT_GRID.tap!.alveolar).toContain('ɾ');
  });

  it('places schwa as a mid central vowel', () => {
    expect(VOWEL_GRID.mid!.central).toContain('ə');
  });
});

describe('intensity', () => {
  it('is zero for an unused phone', () => {
    expect(intensity(0, 100)).toBe(0);
  });

  it('is one for the most used phone', () => {
    expect(intensity(100, 100)).toBe(1);
  });

  it('keeps the long tail visible', () => {
    // English phone frequencies are steeply skewed. On a linear scale a phone used
    // 1% as often as the most common would be indistinguishable from unused.
    expect(intensity(1, 100)).toBeGreaterThan(0.09);
  });

  it('is monotonic', () => {
    expect(intensity(5, 100)).toBeLessThan(intensity(20, 100));
  });

  it('handles an empty sample without dividing by zero', () => {
    expect(intensity(0, 0)).toBe(0);
  });
});
