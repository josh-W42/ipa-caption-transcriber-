import { describe, it, expect } from 'vitest';
import { stitch } from './stitch';

describe('stitch', () => {
  it('returns the incoming text when there is nothing yet', () => {
    expect(stitch('', 'hello world')).toBe('hello world');
  });

  it('returns existing text when the incoming window is empty', () => {
    expect(stitch('hello world', '')).toBe('hello world');
  });

  it('splices at the overlap between old tail and new head', () => {
    expect(stitch('I bought a little', 'a little butter and')).toBe(
      'I bought a little butter and',
    );
  });

  it('concatenates when there is no overlap', () => {
    expect(stitch('I bought', 'some water')).toBe('I bought some water');
  });

  it('ignores case and punctuation when matching the overlap', () => {
    expect(stitch('I bought a Little,', 'a little butter')).toBe('I bought a Little, butter');
  });

  it('drops the new text entirely when it is wholly contained', () => {
    expect(stitch('I bought a little butter', 'a little')).toBe('I bought a little butter');
  });

  it('prefers the longest overlap when a shorter one also matches', () => {
    // A greedy match on the first repeated "the" would splice in the wrong place
    // and duplicate words.
    expect(stitch('the cat sat on the mat', 'on the mat today')).toBe(
      'the cat sat on the mat today',
    );
  });

  it('does not splice on a coincidental single-word match mid-window', () => {
    expect(stitch('a bird flew', 'the sky was blue')).toBe('a bird flew the sky was blue');
  });

  it('is idempotent when the same window arrives twice', () => {
    const once = stitch('I bought a little', 'a little butter');
    expect(stitch(once, 'a little butter')).toBe(once);
  });

  it('handles the realistic sliding-window case end to end', () => {
    let acc = '';
    for (const window of [
      'I bought a little',
      'bought a little butter and',
      'little butter and some water',
      'and some water at the city',
    ]) {
      acc = stitch(acc, window);
    }
    expect(acc).toBe('I bought a little butter and some water at the city');
  });
});
