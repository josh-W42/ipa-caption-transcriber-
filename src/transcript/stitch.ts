/** Strip case and punctuation so overlap matching is not defeated by formatting. */
const normalize = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/**
 * Merge an incoming transcript window into the accumulated text by finding the longest
 * suffix of `prev` that matches a prefix of `next`, compared on normalized words.
 *
 * Longest-first matters: with "the cat sat on the mat" + "on the mat today", a greedy
 * short match on "the" would splice in the wrong place and duplicate words.
 *
 * Only a true suffix/prefix overlap counts. A coincidental match in the middle of the
 * window is ignored, which is why "a bird flew" + "the sky was blue" concatenates.
 */
export function stitch(prev: string, next: string): string {
  const prevTrimmed = prev.trim();
  const nextTrimmed = next.trim();

  if (!prevTrimmed) return nextTrimmed;
  if (!nextTrimmed) return prevTrimmed;

  const prevWords = prevTrimmed.split(/\s+/);
  const nextWords = nextTrimmed.split(/\s+/);
  const prevNorm = prevWords.map(normalize);
  const nextNorm = nextWords.map(normalize);

  // Containment first. A window can re-transcribe already-covered audio and come back
  // shorter, in which case it is a contiguous run inside `prev` but NOT a suffix — so
  // the overlap scan below would miss it and duplicate the words.
  for (let start = 0; start + nextNorm.length <= prevNorm.length; start++) {
    if (nextNorm.every((w, i) => w === prevNorm[start + i])) return prevTrimmed;
  }

  const maxOverlap = Math.min(prevWords.length, nextWords.length);
  for (let n = maxOverlap; n > 0; n--) {
    const tail = prevNorm.slice(-n);
    const head = nextNorm.slice(0, n);

    if (tail.every((w, i) => w === head[i])) {
      const remainder = nextWords.slice(n);
      return remainder.length ? `${prevTrimmed} ${remainder.join(' ')}` : prevTrimmed;
    }
  }

  return `${prevTrimmed} ${nextTrimmed}`;
}
