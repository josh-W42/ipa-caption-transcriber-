import { describe, it, expect } from 'vitest';
import { detectProcesses, unexplainedDivergences, PATTERN_THRESHOLD } from './processes';
import { fixtureAligned } from './fixture';
import { alignUtterance, type AlignedWord } from '../align/utterance';
import { splitPhones } from '../align/normalise';
import type { DecodedPhone } from '../phonetic/ctc';

/** Build a one-word utterance from a phonemic/phonetic pair. */
function one(word: string, phonemic: string, phonetic: string): AlignedWord[] {
  const decoded: DecodedPhone[] = splitPhones(phonetic).map((phone, i) => ({
    phone, start: i * 0.02, end: (i + 1) * 0.02, conf: 0.9,
  }));
  return alignUtterance([{ word, found: true, ipa: phonemic }], decoded);
}

const find = (words: AlignedWord[], id: string) =>
  detectProcesses(words).find((p) => p.id === id);

describe('flapping', () => {
  it('is detected between vowels', () => {
    const p = find(one('butter', 'bʌtɚ', 'bʌɾɚ'), 'flapping');
    expect(p?.count).toBe(1);
  });

  it('is NOT claimed when the tap is not intervocalic', () => {
    // A /t/ → [ɾ] with a consonant beside it is some other process. Naming it
    // flapping would be a false positive dressed as a finding.
    const p = find(one('fake', 'stɹɪ', 'sɾɹɪ'), 'flapping');
    expect(p).toBeUndefined();
  });

  it('finds exactly the fixture\'s five flaps, with their words', () => {
    const p = find(fixtureAligned(), 'flapping')!;
    expect(p.count).toBe(5);
    expect(p.examples).toEqual(['little', 'butter', 'water', 'city', 'Saturday']);
    expect(p.isPattern).toBe(true);
  });
});

describe('cot-caught merger', () => {
  it('is detected in both directions', () => {
    // water /wɔtɚ/ → [wɑɾɚ] and on /ɑn/ → [ɔn] are the same merger.
    const p = find(fixtureAligned(), 'cot-caught')!;
    expect(p.count).toBe(2);
    expect(p.examples).toEqual(['water', 'on']);
  });
});

describe('vowel processes', () => {
  it('detects an unreduced vowel', () => {
    // "and": dictionary /ənd/, produced [ænd].
    const p = find(fixtureAligned(), 'vowel-strengthening')!;
    expect(p.examples).toContain('and');
  });

  it('detects reduction toward schwa', () => {
    const p = find(one('typical', 'tɑpɪkəl', 'təpɪkəl'), 'vowel-reduction');
    expect(p?.count).toBe(1);
  });
});

describe('other authored rules', () => {
  it('detects t-glottalization', () => {
    expect(find(one('button', 'bʌtən', 'bʌʔən'), 'glottalization')?.count).toBe(1);
  });

  it('detects g-dropping', () => {
    expect(find(one('running', 'ɹʌnɪŋ', 'ɹʌnɪn'), 'g-dropping')?.count).toBe(1);
  });

  it('detects th-fronting', () => {
    expect(find(one('think', 'θɪŋk', 'fɪŋk'), 'th-fronting')?.count).toBe(1);
  });

  it('detects non-rhoticity as loss of r-colour', () => {
    expect(find(one('butter', 'bʌtɚ', 'bʌtə'), 'non-rhotic')?.count).toBe(1);
  });

  it('detects final stop deletion only word-finally', () => {
    expect(find(one('and', 'ænd', 'æn'), 'final-stop-deletion')?.count).toBe(1);
  });
});

describe('pattern vs instance', () => {
  it('marks a single occurrence as not yet a pattern', () => {
    // One instance is an observation. Calling it a property of the speaker needs
    // repetition, and the UI must be able to tell them apart.
    const p = find(one('butter', 'bʌtɚ', 'bʌɾɚ'), 'flapping')!;
    expect(p.count).toBe(1);
    expect(p.isPattern).toBe(false);
  });

  it('marks repetition as a pattern', () => {
    expect(find(fixtureAligned(), 'flapping')!.isPattern).toBe(true);
    expect(PATTERN_THRESHOLD).toBeGreaterThan(1);
  });
});

describe('evidence', () => {
  it('attaches example words to every detection', () => {
    for (const p of detectProcesses(fixtureAligned())) {
      expect(p.examples.length).toBeGreaterThan(0);
    }
  });

  it('deduplicates repeated example words', () => {
    const words = [...fixtureAligned(), ...fixtureAligned()];
    const p = find(words, 'flapping')!;
    expect(p.count).toBe(10);
    expect(p.examples).toHaveLength(5);
  });
});

describe('unexplainedDivergences', () => {
  it('reports divergences no rule accounted for', () => {
    // The fixture's /i/ → [eɪ] in Saturday and /ə/ → [ɪ] in market have no rule.
    const left = unexplainedDivergences(fixtureAligned());
    expect(left.length).toBeGreaterThan(0);
    expect(left.some((o) => o.from === 'i' && o.to === 'eɪ')).toBe(true);
  });

  it('does not report divergences a rule already explained', () => {
    const left = unexplainedDivergences(fixtureAligned());
    expect(left.some((o) => o.from === 't' && o.to === 'ɾ')).toBe(false);
  });
});
