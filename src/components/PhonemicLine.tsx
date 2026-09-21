import { useMemo } from 'react';
import type { Lexicon } from '../phonemic/lexicon';

interface Props {
  text: string;
  lexicon: Lexicon | null;
  /** Interim text renders dimmed, as it does for the English line. */
  interim?: boolean;
}

/**
 * English above, phonemic IPA below, aligned word by word.
 *
 * Each pair is an inline-block so a word and its transcription can never be split
 * across a line break from one another.
 *
 * The slashes are notation, not decoration: /slashes/ mark a PHONEMIC transcription —
 * the dictionary's idea of the word. M3 adds [square brackets] alongside for the
 * phonetic reality, and the contrast between the two is the whole point of the app.
 */
export function PhonemicLine({ text, lexicon, interim = false }: Props) {
  const words = useMemo(() => (lexicon ? lexicon.transcribe(text) : []), [text, lexicon]);

  if (!lexicon) {
    // Lexicon failed or is still loading — show the English rather than nothing.
    return <p className={interim ? 'interim' : 'final'}>{text}</p>;
  }

  return (
    <p className={`wordline ${interim ? 'interim' : 'final'}`}>
      {words.map((w, i) => (
        <span className="wordpair" key={`${w.word}-${i}`}>
          <span className="orth">{w.word}</span>
          {w.found ? (
            <span className="ipa">/{w.ipa}/</span>
          ) : (
            // Marked, never guessed. A synthesised pronunciation would look identical
            // to a real one and would quietly corrupt M4's divergence measurements.
            <span className="ipa oov" title="not in dictionary">
              —
            </span>
          )}
        </span>
      ))}
    </p>
  );
}
