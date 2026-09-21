# M2 — The `/phonemic/` Track Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render each recognised word's canonical pronunciation as IPA beneath the
English captions, so the app is honestly named and independently shippable.

**Architecture:** A build script converts CMUdict's ARPAbet entries into a compact
lexicon shipped as a static asset. At runtime the lexicon is lazily loaded, words are
normalised and looked up, ARPAbet is mapped to IPA, and stress marks are placed using a
maximum-onset syllabifier. Out-of-vocabulary words are marked unknown, never guessed.

**Tech Stack:** TypeScript, Node build script, existing React + Vite app.

---

## What M1 established

- Live capture works. Healthy baseline on the dev machine: spectral centroid
  ~800–1200 Hz, dropouts <1%. `micProbe.ts` bisects device faults from code faults.
- Whisper inference is **2–3 s per 5-second window** on WebGPU. The interim loop is
  self-pacing, so M2 must not add per-word work heavy enough to disturb it.
- **Nothing in M2 touches the capture path.** If live audio misbehaves during M2, run
  "Diagnose microphone" before suspecting this work.

M2 adds no model. The phoneme model arrives in M3.

---

## Verified before planning (2026-09-21)

Checked against the CMU repo rather than assumed:

- **`cmusphinx/cmudict`**, file `cmudict.dict`, **3.618 MB**, ~134k entries.
- **License is effectively BSD-2-Clause** — redistribution in source and binary form is
  permitted provided the copyright notice and disclaimer are retained. GitHub reports
  `NOASSERTION` only because the text is custom-worded. **The notice must ship with the
  built asset**; that is Task 1, Step 5, and it is not optional.
- **Phone set is 39 ARPAbet symbols.** Vowels carry a stress digit: `0` unstressed,
  `1` primary, `2` secondary — e.g. `excellent EH1 K S AH0 L AH0 N T`.
- Alternate pronunciations appear as `word(2)`, `word(3)`.

---

## Task 1: Build the lexicon asset

**Files:**
- Create: `scripts/build-lexicon.mjs`, `public/lexicon.txt`, `public/LEXICON-LICENSE.txt`

**Step 1: Fetch the source**

```bash
curl -sL https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict -o scripts/cmudict.dict
```

Add `scripts/cmudict.dict` to `.gitignore` — it is an input, regenerated on demand, not
a source file.

**Step 2: Write the converter**

`scripts/build-lexicon.mjs` reads `cmudict.dict` and emits one entry per line as
`word<TAB>ARPABET SPACE SEPARATED`. Keep ARPAbet rather than pre-converting to IPA: the
mapping is pure and tested in Task 2, the source stays inspectable, and ASCII compresses
better than multi-byte IPA.

Rules:
- Skip comment lines (`;;;`) and blank lines.
- Keep only the **first** pronunciation: drop any headword matching `/\(\d+\)$/`.
  Alternates are a real feature of English but they are M4 material; M2 shows one
  canonical form and says so.
- Lowercase headwords. CMUdict is already lowercase but do not rely on it.
- Preserve stress digits — Task 3 needs them.

**Step 3: Report the size, then decide how to ship**

```bash
node scripts/build-lexicon.mjs && ls -la public/lexicon.txt && gzip -c public/lexicon.txt | wc -c
```

Record both raw and gzipped sizes. Firebase serves gzip automatically, so **the gzipped
number is the one that matters.** If it exceeds ~1.5 MB, consider:
- dropping entries with non-alphabetic headwords (punctuation-only, abbreviations),
- or a phone-index encoding (39 phones + 3 stress values fits one byte per phone).

Do not optimise before measuring.

**Step 4: Verify the conversion did not lose anything**

```bash
wc -l scripts/cmudict.dict public/lexicon.txt
```

Line counts should differ only by the comments and alternate pronunciations removed.
Spot-check a known entry:

```bash
grep -P "^excellent\t" public/lexicon.txt
```

Expected: `excellent	EH1 K S AH0 L AH0 N T`

**Step 5: Ship the licence**

Copy CMU's `LICENSE` to `public/LEXICON-LICENSE.txt` and link it from the app footer and
the README. This is a redistribution condition, not a courtesy.

**Step 6: Commit**

```bash
git add scripts public/lexicon.txt public/LEXICON-LICENSE.txt .gitignore && git commit -m "Add CMUdict lexicon build script and asset"
```

---

## Task 2: ARPAbet to IPA

**Files:**
- Create: `src/phonemic/arpabet.ts`, `src/phonemic/arpabet.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { arpaToIpa } from './arpabet';

describe('arpaToIpa', () => {
  it('maps consonants', () => {
    expect(arpaToIpa(['B', 'T', 'K'])).toEqual(['b', 't', 'k']);
  });

  it('maps the digraph consonants English spelling hides', () => {
    expect(arpaToIpa(['CH', 'JH', 'SH', 'ZH', 'TH', 'DH', 'NG'])).toEqual([
      'tʃ', 'dʒ', 'ʃ', 'ʒ', 'θ', 'ð', 'ŋ',
    ]);
  });

  it('uses the IPA rhotic and velar, not the ASCII lookalikes', () => {
    // English /r/ is an approximant ɹ, not a trill r; and ɡ is U+0261, not Latin g.
    expect(arpaToIpa(['R'])).toEqual(['ɹ']);
    expect(arpaToIpa(['G'])).toEqual(['ɡ']);
  });

  it('maps diphthongs as single units', () => {
    expect(arpaToIpa(['AY', 'AW', 'OY', 'EY', 'OW'])).toEqual(['aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ']);
  });

  it('strips stress digits from the phone itself', () => {
    expect(arpaToIpa(['IY1', 'IH0', 'EH2'])).toEqual(['i', 'ɪ', 'ɛ']);
  });

  it('distinguishes stressed AH from unstressed schwa', () => {
    // The single most audible reduction in English: AH1 is ʌ, AH0 is ə.
    expect(arpaToIpa(['AH1'])).toEqual(['ʌ']);
    expect(arpaToIpa(['AH0'])).toEqual(['ə']);
  });

  it('distinguishes stressed ER from unstressed rhotic schwa', () => {
    expect(arpaToIpa(['ER1'])).toEqual(['ɝ']);
    expect(arpaToIpa(['ER0'])).toEqual(['ɚ']);
  });

  it('transcribes a whole word', () => {
    // butter -> B AH1 T ER0
    expect(arpaToIpa(['B', 'AH1', 'T', 'ER0']).join('')).toBe('bʌtɚ');
  });

  it('throws on an unknown symbol rather than emitting something plausible', () => {
    expect(() => arpaToIpa(['QQ'])).toThrow(/QQ/);
  });
});
```

**Step 2: Run to verify they fail**

```bash
npx vitest run src/phonemic/arpabet.test.ts
```

**Step 3: Implement**

```ts
/** CMUdict's 39 ARPAbet phones mapped to General American IPA. */
const MAP: Record<string, string> = {
  AA: 'ɑ', AE: 'æ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð',
  EH: 'ɛ', EY: 'eɪ', F: 'f', G: 'ɡ', HH: 'h',
  IH: 'ɪ', IY: 'i', JH: 'dʒ', K: 'k', L: 'l', M: 'm',
  N: 'n', NG: 'ŋ', OW: 'oʊ', OY: 'ɔɪ', P: 'p',
  R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ',
  UH: 'ʊ', UW: 'u', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

/**
 * Two phones depend on stress, and both differences are clearly audible:
 * AH is ʌ when stressed but reduces to schwa when not, and ER likewise.
 */
const STRESS_DEPENDENT: Record<string, [stressed: string, reduced: string]> = {
  AH: ['ʌ', 'ə'],
  ER: ['ɝ', 'ɚ'],
};

export interface Phone {
  arpa: string;
  ipa: string;
  /** 0 unstressed, 1 primary, 2 secondary; null for consonants. */
  stress: 0 | 1 | 2 | null;
}

export function splitStress(symbol: string): { base: string; stress: 0 | 1 | 2 | null } {
  const m = /^([A-Z]+)([012])$/.exec(symbol);
  if (!m) return { base: symbol, stress: null };
  return { base: m[1], stress: Number(m[2]) as 0 | 1 | 2 };
}

export function arpaToPhones(symbols: string[]): Phone[] {
  return symbols.map((symbol) => {
    const { base, stress } = splitStress(symbol);

    const pair = STRESS_DEPENDENT[base];
    if (pair) {
      return { arpa: symbol, ipa: stress === 0 ? pair[1] : pair[0], stress };
    }

    const ipa = MAP[base];
    if (!ipa) throw new Error(`unknown ARPAbet symbol: ${symbol}`);
    return { arpa: symbol, ipa, stress };
  });
}

export function arpaToIpa(symbols: string[]): string[] {
  return arpaToPhones(symbols).map((p) => p.ipa);
}

export const isVowel = (p: Phone) => p.stress !== null;
```

**Step 4: Run to verify they pass**

```bash
npx vitest run src/phonemic/arpabet.test.ts
```

**Step 5: Commit**

```bash
git add src/phonemic && git commit -m "Add ARPAbet to IPA mapping"
```

---

## Task 3: Syllabification and stress marks

IPA places the stress mark before the **syllable**, not before the vowel. Getting that
right needs syllable boundaries, which CMUdict does not provide. M4 needs syllable
shapes anyway, so this is built once and used twice.

**Files:**
- Create: `src/phonemic/syllable.ts`, `src/phonemic/syllable.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { syllabify, transcribeWord } from './syllable';
import { arpaToPhones } from './arpabet';

const P = (s: string) => arpaToPhones(s.split(' '));

describe('syllabify', () => {
  it('gives one syllable per vowel', () => {
    expect(syllabify(P('B AH1 T ER0'))).toHaveLength(2);
    expect(syllabify(P('K AE1 T'))).toHaveLength(1);
  });

  it('assigns a single medial consonant to the following onset', () => {
    // butter -> bʌ.tɚ, not bʌt.ɚ
    const syls = syllabify(P('B AH1 T ER0'));
    expect(syls[0].map((p) => p.ipa).join('')).toBe('bʌ');
    expect(syls[1].map((p) => p.ipa).join('')).toBe('tɚ');
  });

  it('applies maximum onset only for clusters English permits', () => {
    // secret -> si.kɹɪt: /kɹ/ is a legal onset, so it goes with the second syllable.
    const syls = syllabify(P('S IY1 K R AH0 T'));
    expect(syls[0].map((p) => p.ipa).join('')).toBe('si');
    expect(syls[1].map((p) => p.ipa).join('')).toBe('kɹət');
  });

  it('splits a cluster English does not allow word-internally', () => {
    // napkin -> næp.kɪn: /pk/ is not a legal onset, so the p closes syllable one.
    const syls = syllabify(P('N AE1 P K IH0 N'));
    expect(syls[0].map((p) => p.ipa).join('')).toBe('næp');
    expect(syls[1].map((p) => p.ipa).join('')).toBe('kɪn');
  });

  it('puts leading consonants on the first syllable', () => {
    const syls = syllabify(P('S T R IY1 T'));
    expect(syls).toHaveLength(1);
    expect(syls[0].map((p) => p.ipa).join('')).toBe('stɹit');
  });

  it('handles a word with no vowels without crashing', () => {
    expect(syllabify(P('HH M'))).toHaveLength(1);
  });
});

describe('transcribeWord', () => {
  it('places the primary stress mark before the syllable, not the vowel', () => {
    // butter: stress on the first syllable -> ˈbʌ.tɚ, rendered without the dot
    expect(transcribeWord(P('B AH1 T ER0'))).toBe('ˈbʌtɚ');
  });

  it('marks stress on a later syllable', () => {
    // about -> ə.ˈbaʊt
    expect(transcribeWord(P('AH0 B AW1 T'))).toBe('əˈbaʊt');
  });

  it('marks secondary stress', () => {
    // excellent: EH1 K S AH0 L AH0 N T
    expect(transcribeWord(P('EH1 K S AH0 L AH0 N T'))).toBe('ˈɛksələnt');
  });

  it('omits the mark on monosyllables, as IPA convention does', () => {
    expect(transcribeWord(P('K AE1 T'))).toBe('kæt');
  });
});
```

**Step 2: Run to verify they fail**

**Step 3: Implement**

Key points for the implementation:

- **Onsets that English permits.** Maximum onset says push as many consonants as
  possible into the following syllable, but only clusters English actually allows.
  Encode the legal two- and three-consonant onsets as a set — `/st/ /sp/ /sk/ /pl/
  /pɹ/ /bl/ /bɹ/ /tɹ/ /dɹ/ /kl/ /kɹ/ /ɡl/ /ɡɹ/ /fl/ /fɹ/ /θɹ/ /ʃɹ/ /sl/ /sm/ /sn/
  /sw/ /tw/ /kw/ /dw/ /spl/ /spɹ/ /stɹ/ /skɹ/ /skw/` — and take the longest suffix of
  the consonant run that is a member.
- **Monosyllables take no mark.** A single syllable has nowhere else for stress to be,
  and marking it is noise.
- **Secondary stress** uses `ˌ` (U+02CC), primary uses `ˈ` (U+02C8). Neither is an
  ASCII apostrophe; using `'` would be wrong and would break the M3 alignment.

**Step 4: Run to verify they pass**

**Step 5: Commit**

```bash
git add src/phonemic && git commit -m "Add syllabification and IPA stress placement"
```

---

## Task 4: Lexicon loading and lookup

**Files:**
- Create: `src/phonemic/lexicon.ts`, `src/phonemic/lexicon.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { normaliseWord, Lexicon } from './lexicon';

describe('normaliseWord', () => {
  it('lowercases', () => expect(normaliseWord('Butter')).toBe('butter'));

  it('strips surrounding punctuation from Whisper output', () => {
    expect(normaliseWord('butter.')).toBe('butter');
    expect(normaliseWord('"butter,"')).toBe('butter');
  });

  it('keeps word-internal apostrophes, which CMUdict has entries for', () => {
    expect(normaliseWord("don't")).toBe("don't");
    expect(normaliseWord("Don't.")).toBe("don't");
  });

  it('keeps internal hyphens', () => expect(normaliseWord('well-known')).toBe('well-known'));

  it('returns empty for punctuation-only tokens', () => expect(normaliseWord('—')).toBe(''));
});

describe('Lexicon', () => {
  const lex = Lexicon.fromText(['butter\tB AH1 T ER0', "don't\tD OW1 N T"].join('\n'));

  it('looks up a known word', () => {
    expect(lex.lookup('Butter.')).toEqual({ found: true, ipa: 'ˈbʌtɚ' });
  });

  it('reports out-of-vocabulary words rather than guessing', () => {
    // Guessing would be dishonest: a wrong /phonemic/ reference silently corrupts
    // every divergence measurement M4 makes against it.
    expect(lex.lookup('kerfuffleization')).toEqual({ found: false, ipa: null });
  });

  it('handles contractions', () => {
    expect(lex.lookup("don't").found).toBe(true);
  });

  it('reports its size', () => expect(lex.size).toBe(2));
});
```

**Step 2: Implement**

- `Lexicon.load(url)` fetches `/lexicon.txt`, parses into a `Map<string, string[]>`,
  and reports progress via a callback. ~134k entries in a Map is a few MB of heap —
  acceptable, but measure it rather than assuming.
- Parse once at load; cache `transcribeWord` results in a second Map, since caption
  windows repeat the same words constantly.
- `lookup` returns `{ found: false, ipa: null }` for OOV. **Never synthesise a
  pronunciation in M2.** The UI marks these visibly.

**Step 3: Commit**

```bash
git add src/phonemic && git commit -m "Add lexicon loading and word lookup"
```

---

## Task 5: Wire into the session

**Files:**
- Modify: `src/session/useSession.ts`

**Step 1: Load the lexicon alongside the model**

Load it during `load()`, in parallel with the ASR model — both are one-off startup costs
and overlapping them hides the lexicon's latency entirely behind the much larger model
download. Report failure distinctly: a missing lexicon must not take down captions.

**Step 2: Produce a phonemic line per transcript**

Tokenise the transcript on whitespace, look each token up, and build an array of
`{ word, ipa, found }`. Do this for both the interim and refined transcripts.

Keep this synchronous and cheap — it is a Map lookup per word against a 2–3 s inference
budget, so it must not become the thing that makes captions feel slow. If profiling ever
says otherwise, cache harder before moving it to a worker.

**Step 3: Commit**

---

## Task 6: Dual-line captions

**Files:**
- Modify: `src/App.tsx`, `src/App.css`
- Create: `src/components/PhonemicLine.tsx`

**Step 1: Render word-aligned pairs**

Each word renders as a stacked pair — English above, `/IPA/` below — so the two lines
stay visually associated as the caption wraps. Use `display: inline-block` per word so a
word and its transcription never break apart across lines.

**Step 2: Mark out-of-vocabulary words honestly**

Render OOV words with a dotted underline and `—` in the IPA slot, plus a title attribute
saying "not in dictionary". **Do not hide them and do not guess.** An interviewer asking
"what happens with a word it doesn't know" should get a good answer.

**Step 3: Wrap the IPA in slashes**

`/ˈbʌtɚ/`. The slashes are not decoration — they mark this as a *phonemic* transcription,
and M3 adds `[square brackets]` for the phonetic line beside it. Getting the notation
right is the cheapest possible signal that the linguistics is taken seriously.

**Step 4: Commit**

---

## Task 7: README and honesty pass

**Files:**
- Modify: `README.md`

Document what the phonemic track is and is not:

- It is the **dictionary's** pronunciation, not the speaker's. That is the entire point:
  M3 adds what was actually said, and M4 measures the gap.
- It is **one** pronunciation. CMUdict lists alternates; M2 shows the first.
- It is **General American**, so speakers of other varieties will see a reference that
  does not match them. That is a limitation to state, not to paper over.
- Out-of-vocabulary words are marked, never guessed.

Include the CMU copyright notice and link `LEXICON-LICENSE.txt`.

---

## Exit criteria

1. Speaking produces English captions with `/phonemic/` IPA beneath each word
2. Stress marks sit before the syllable, using `ˈ` and `ˌ`, and monosyllables carry none
3. `AH0` renders `ə` while `AH1` renders `ʌ`; `ER0` renders `ɚ` while `ER1` renders `ɝ`
4. Out-of-vocabulary words are visibly marked rather than guessed
5. The lexicon's gzipped size is recorded, and the CMU licence ships with it
6. All existing tests still pass; capture behaviour is untouched

**Explicitly not in M2:** the phoneme model, the phonetic track, alignment, and any
analysis. Those are M3 and M4. The temptation will be to start comparing the two
transcriptions as soon as the phonemic line appears — that comparison is the whole of
M3, and it needs the feature-distance table to be done properly.
