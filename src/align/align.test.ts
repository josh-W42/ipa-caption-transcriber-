import { describe, it, expect } from 'vitest';
import { align, errorRate } from './align';
import { normalisePhonemic, normalisePhonetic } from './normalise';

/** Real output from both tracks for the fixture sentence. */
const PHONEMIC_RAW =
  'aɪ bɑt ə ˈlɪtəl ˈbʌtɚ ənd sʌm ˈwɔtɚ æt ðə ˈsɪti ˈmɑɹkət ɑn ˈsætɚdi';
const PHONETIC_RAW =
  'aɪbɑːtɐlɪɾəlbʌɾɚændsʌmwɑːɾɚætðəsɪɾimɑːɹkɪtɔnsæɾɚdeɪ';

const PHONEMIC = normalisePhonemic(PHONEMIC_RAW.replace(/ /g, ''));
const PHONETIC = normalisePhonetic(PHONETIC_RAW);

describe('align', () => {
  it('aligns identical sequences with no operations', () => {
    const ops = align(['k', 'æ', 't'], ['k', 'æ', 't']);
    expect(ops).toHaveLength(3);
    expect(ops.every((o) => o.type === 'match')).toBe(true);
  });

  it('records the flap as a substitution, not a delete plus insert', () => {
    // butter: /bʌtɚ/ against [bʌɾɚ]. If the gap penalty were cheaper than the
    // feature distance this would come back as two operations and M4 would never
    // see a /t/ -> [ɾ] pair at all.
    const ops = align(['b', 'ʌ', 't', 'ɚ'], ['b', 'ʌ', 'ɾ', 'ɚ']);
    expect(ops.filter((o) => o.type === 'substitute')).toHaveLength(1);
    expect(ops.filter((o) => o.type === 'delete' || o.type === 'insert')).toHaveLength(0);
  });

  it('records a deletion when a phone is dropped', () => {
    const ops = align(['m', 'ɑ', 'ɹ', 'k', 'ɪ', 't'], ['m', 'ɑ', 'ɹ', 'k', 'ɪ']);
    expect(ops.filter((o) => o.type === 'delete')).toHaveLength(1);
  });

  it('records an insertion when a phone appears', () => {
    const ops = align(['k', 'æ', 't'], ['k', 'æ', 't', 's']);
    expect(ops.filter((o) => o.type === 'insert')).toHaveLength(1);
  });

  it('carries indices into both sequences', () => {
    const ops = align(['b', 'ʌ', 't'], ['b', 'ʌ', 'ɾ']);
    const sub = ops.find((o) => o.type === 'substitute')!;
    expect(sub.aIndex).toBe(2);
    expect(sub.bIndex).toBe(2);
  });

  it('handles empty input on either side', () => {
    expect(align([], ['a'])).toHaveLength(1);
    expect(align(['a'], [])).toHaveLength(1);
    expect(align([], [])).toHaveLength(0);
  });

  it('aligns the whole fixture with a low error rate', () => {
    const ops = align(PHONEMIC, PHONETIC);
    expect(errorRate(ops)).toBeLessThan(0.25);
  });

  it('finds exactly the five flaps in the fixture', () => {
    // THE acceptance criterion for this milestone: little, butter, water, city,
    // Saturday all flap; at and market do not, because their /t/ is word-final.
    const ops = align(PHONEMIC, PHONETIC);
    const flaps = ops.filter((o) => o.type === 'substitute' && o.from === 't' && o.to === 'ɾ');
    expect(flaps).toHaveLength(5);
  });

  it('leaves the unflapped /t/ of at and market as matches', () => {
    const ops = align(PHONEMIC, PHONETIC);
    const tMatches = ops.filter((o) => o.type === 'match' && o.from === 't');
    expect(tMatches.length).toBeGreaterThanOrEqual(2);
  });
});
