import type { AlignedWord } from '../align/utterance';
import type { AlignOp } from '../align/align';

/**
 * Three rows per word: English, /phonemic/, [phonetic].
 *
 * The bracket conventions are how a linguist reads at a glance which row is which —
 * /slashes/ for the dictionary's phonemes, [brackets] for what was actually produced.
 * They are notation, not decoration.
 */

/** Describe a divergence the way a phonetics textbook would. */
function describe(op: AlignOp): string {
  if (op.type === 'substitute') return `/${op.from}/ → [${op.to}]`;
  if (op.type === 'delete') return `/${op.from}/ not produced`;
  return `[${op.to}] inserted`;
}

function PhoneticRow({ word }: { word: AlignedWord }) {
  // Only operations that produced a phone line up with the rendered phones — a
  // deletion has no phonetic phone at all, so indexing ops by phone position would
  // shift every highlight after the first dropped phone.
  const producing = word.ops.filter((op) => op.bIndex != null);

  // Deletions still deserve a mention, since "the dictionary has a phone you did not
  // say" is exactly as interesting as a substitution.
  const deletions = word.ops.filter((op) => op.type === 'delete');

  return (
    <span className="ipa phonetic">
      [
      {word.phonetic.map((p, idx) => {
        const op = producing[idx];
        return op && op.type !== 'match' ? (
          <span key={idx} className="diverged" title={describe(op)}>
            {p.phone}
          </span>
        ) : (
          <span key={idx}>{p.phone}</span>
        );
      })}
      ]
      {deletions.length > 0 && (
        <span className="dropped" title={deletions.map(describe).join('; ')}>
          {'∅'.repeat(deletions.length)}
        </span>
      )}
    </span>
  );
}

export function AlignedCaptions({ words }: { words: AlignedWord[] }) {
  return (
    <p className="wordline final">
      {words.map((w, i) => (
        <span className="wordpair" key={`${w.word}-${i}`}>
          <span className="orth">{w.word}</span>

          {w.phonemic ? (
            <span className="ipa">/{w.phonemic}/</span>
          ) : (
            <span className="ipa oov" title="not in dictionary">
              —
            </span>
          )}

          {/* Absent before the phoneme model loads. Not an error state — the app is
              simply behaving as it did in M2 until the 197MB asset arrives. */}
          {w.phonetic.length > 0 && <PhoneticRow word={w} />}
        </span>
      ))}
    </p>
  );
}
