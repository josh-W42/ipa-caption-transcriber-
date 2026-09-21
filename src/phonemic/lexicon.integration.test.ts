import { describe, it, expect } from 'vitest';
import { Lexicon } from './lexicon';

/**
 * Exercises the real shipped asset rather than a miniature fixture. Catches build
 * script regressions, encoding problems, and the parse cost of 126k entries.
 */
describe('shipped lexicon', () => {
  it('loads and transcribes real words', async () => {
    const t0 = performance.now();
    const lex = await Lexicon.load('/lexicon.txt');
    const loadMs = performance.now() - t0;

    console.log(`[diagnostic] parsed ${lex.size.toLocaleString()} entries in ${loadMs.toFixed(0)}ms`);
    expect(lex.size).toBeGreaterThan(120000);

    // The M0 fixture sentence, which is also the M3 flapping demo.
    expect(lex.lookup('butter').ipa).toBe('ˈbʌtɚ');
    expect(lex.lookup('little').ipa).toBe('ˈlɪtəl');
    expect(lex.lookup('water').ipa).toBe('ˈwɔtɚ');
    expect(lex.lookup('city').ipa).toBe('ˈsɪti');
  });

  it('transcribes the fixture sentence with every word found', async () => {
    const lex = await Lexicon.load('/lexicon.txt');
    const out = lex.transcribe('I bought a little butter and some water at the city market on Saturday.');

    const missing = out.filter((t) => !t.found).map((t) => t.word);
    expect(missing).toEqual([]);
    console.log(`[diagnostic] ${out.map((t) => `/${t.ipa}/`).join(' ')}`);
  });

  it('marks a genuine non-word as out of vocabulary', async () => {
    const lex = await Lexicon.load('/lexicon.txt');
    expect(lex.lookup('kerfuffleization').found).toBe(false);
  });

  it('every entry transcribes without throwing', async () => {
    // Guards against an ARPAbet symbol in the data that the mapping does not cover.
    const lex = await Lexicon.load('/lexicon.txt');
    const text = await (await fetch('/lexicon.txt')).text();
    const words = text.split('\n').map((l) => l.slice(0, l.indexOf('\t'))).filter(Boolean);

    let failures = 0;
    let firstFailure = '';
    for (const w of words) {
      try {
        lex.lookup(w);
      } catch (err) {
        if (!failures) firstFailure = `${w}: ${err}`;
        failures++;
      }
    }
    expect(`${failures} failures${failures ? `, first: ${firstFailure}` : ''}`).toBe('0 failures');
  }, 60000);
});
