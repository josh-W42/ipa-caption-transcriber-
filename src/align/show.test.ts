import { describe, it, expect } from 'vitest';
import { align, errorRate } from './align';
import { normalisePhonemic, normalisePhonetic } from './normalise';

/**
 * Prints the fixture alignment. Not an assertion of correctness — the real checks live
 * in align.test.ts — but a readable rendering catches alignments that pass their
 * counts while pairing phones nonsensically.
 */
describe('alignment diagnostic', () => {
  it('prints the fixture alignment', () => {
    const phonemic = normalisePhonemic('aɪbɑtəˈlɪtəlˈbʌtɚəndsʌmˈwɔtɚætðəˈsɪtiˈmɑɹkətɑnˈsætɚdi');
    const phonetic = normalisePhonetic('aɪbɑːtɐlɪɾəlbʌɾɚændsʌmwɑːɾɚætðəsɪɾimɑːɹkɪtɔnsæɾɚdeɪ');
    const ops = align(phonemic, phonetic);

    const rendered = ops
      .map((o) => {
        if (o.type === 'match') return o.from;
        if (o.type === 'substitute') return `[${o.from}→${o.to}]`;
        if (o.type === 'delete') return `[${o.from}→∅]`;
        return `[∅→${o.to}]`;
      })
      .join(' ');

    const counts = ops.reduce<Record<string, number>>((acc, o) => {
      acc[o.type] = (acc[o.type] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`[diagnostic] ${rendered}`);
    console.log(`[diagnostic] ${JSON.stringify(counts)} errorRate=${(errorRate(ops) * 100).toFixed(1)}%`);
    console.log(
      `[diagnostic] substitutions: ${ops
        .filter((o) => o.type === 'substitute')
        .map((o) => `${o.from}→${o.to}`)
        .join(', ')}`,
    );

    expect(ops.length).toBeGreaterThan(0);
  });
});
