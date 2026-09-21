# M3 — The `[phonetic]` Track and Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add what the speaker actually said, aligned against what the dictionary says
they should have, with the divergences visible inline. This is the milestone the project
exists for.

**Architecture:** A second worker runs wav2vec2 CTC over the same audio and decodes IPA
with 20 ms frame timings. Both tracks are normalised into one symbol inventory, then
aligned with Needleman-Wunsch whose substitution cost is the distance between distinctive
feature vectors. The alignment drives the UI and, in M4, every statistic.

**Tech Stack:** TypeScript, `@huggingface/transformers` (`AutoModelForCTC`), existing app.

---

## What M0 settled — do not rediscover

From [`docs/findings/2026-09-20-m0-spike-findings.md`](../findings/2026-09-20-m0-spike-findings.md):

- Model is **`onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX` at `q4f16`**, 197 MB,
  measured 114x realtime with 20.0 ms frames.
- **`pipeline()` does not work on this repo.** It ships `vocab.json` and
  `tokenizer_class: Wav2Vec2PhonemeCTCTokenizer` but no `tokenizer.json`, so
  `AutoTokenizer` throws. Use `AutoModelForCTC` + `AutoProcessor` and decode the logits
  directly — which is required anyway, since it is the only path that yields frame
  timings.
- Blank token is `<pad>`, **id 0** — computed with `indexOf`, never hardcoded, since the
  id is not guaranteed stable across repos.
- **Working decode code already exists** in `spike/src/probe-ctc.ts`, kept deliberately
  for this milestone. Port it; do not rewrite from scratch.
- The vocab contains **multi-character tokens** — `aɪ`, `iː`, `ɑː`, `əl`, `oʊ`, `aʊ`.
  One CTC token is not one phone.

---

## The problem this milestone has to solve first

The two tracks were built from different sources and **do not share an IPA convention.**
Comparing the M0 phonetic output against the M2 phonemic output for the same sentence:

```
phonetic (espeak CTC): aɪbɑːtɐlɪɾəlbʌɾɚændsʌmwɑːɾɚætðəsɪɾimɑːɹkɪtɔnsæɾɚdeɪ
phonemic (CMUdict):    aɪbɑtəˈlɪtəlˈbʌtɚəndsʌmˈwɔtɚætðəˈsɪtiˈmɑɹkətɑnˈsætɚdi

only in phonetic:  e  ɐ  ɾ  ː
only in phonemic:  ˈ
```

Three of those five are **notation**, and one is **the entire point of the project**:

| symbol | what it is | treatment |
| --- | --- | --- |
| `ː` | espeak marks vowel length; CMUdict does not | **normalise away** |
| `ɐ` | espeak's reduced vowel where CMUdict writes `ə` | **normalise to `ə`** |
| `ˈ` `ˌ` | stress marks; only the phonemic track has them | **strip before aligning** |
| `ɾ` | the flap — `/t/` realised as `[ɾ]` | **PRESERVE.** This is the finding. |
| `e` | genuine vowel difference (`deɪ` vs `di`) | **PRESERVE** |

Normalise too little and every word looks divergent because of spelling conventions.
Normalise too much and the real divergences disappear. Task 2 exists to get this exactly
right, and it is tested against the known sentence above.

---

## Task 1: Port the phoneme worker

**Files:**
- Create: `src/phonetic/worker.ts`, `src/phonetic/client.ts`, `src/phonetic/ctc.ts`
- Reference: `spike/src/probe-ctc.ts`

**Step 1: Extract the pure decode into `ctc.ts`**

`ctcDecode` from the spike is pure logic over logits and belongs outside the worker so it
can be unit-tested. It takes logits, frame count, vocab size, vocab, blank id and seconds
per frame; it returns `{ phone, start, end, conf }[]`.

Keep its two real behaviours: collapse repeated tokens, and drop blanks. Extend the
current phone's `end` when a token repeats, rather than emitting a second phone.

**Step 2: Write `ctc.test.ts` over synthetic logits**

```ts
// A hand-built logits array is far easier to reason about than a real model's output,
// and it pins the collapse/blank rules exactly.
function logitsFor(sequence: number[], vocabSize: number): Float32Array {
  const out = new Float32Array(sequence.length * vocabSize).fill(-10);
  sequence.forEach((id, t) => { out[t * vocabSize + id] = 10; });
  return out;
}
```

Cover: repeats collapse to one phone with an extended end time; blanks are dropped;
a blank *between* two identical tokens produces two phones, not one (this is the whole
reason CTC has a blank symbol, and getting it wrong silently merges geminates);
timings follow `secondsPerFrame`.

**Step 3: Write the worker**

Mirrors `src/asr/worker.ts`: messages `load`, `transcribe`, `dispose`; replies
`progress`, `ready`, `result`, `error`. Loads with `AutoModelForCTC` +
`AutoProcessor`, `device: 'webgpu'`, `dtype: 'q4f16'`, and fetches `vocab.json` from the
model repo to build the id→symbol table.

**Warm up at load**, as the ASR worker does — one second of silence, discarded.

`secondsPerFrame` is computed as `audio.length / 16000 / numFrames` rather than assuming
20 ms, so a model swap cannot silently corrupt every timing downstream.

**Step 4: Verify against the sample**

Temporary button; expected output is the M0 string:
`aɪbɑːtɐlɪɾəlbʌɾɚændsʌmwɑːɾɚætðəsɪɾimɑːɹkɪtɔnsæɾɚdeɪ` with five `ɾ`.

**Step 5: Commit**

---

## Task 2: Normalise both tracks into one inventory

**Files:**
- Create: `src/align/normalise.ts`, `src/align/normalise.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { normalisePhonetic, normalisePhonemic, splitPhones } from './normalise';

describe('splitPhones', () => {
  it('splits multi-character vocab tokens into phones', () => {
    // The espeak vocab emits aɪ and əl as single CTC tokens; they are two phones.
    expect(splitPhones('aɪ')).toEqual(['aɪ']);      // diphthong stays one phone
    expect(splitPhones('əl')).toEqual(['ə', 'l']);  // schwa + lateral is two
  });
});

describe('normalisePhonetic', () => {
  it('strips length marks, which CMUdict has no equivalent for', () => {
    expect(normalisePhonetic('bɑːt')).toEqual(['b', 'ɑ', 't']);
  });

  it('maps espeak ɐ to schwa', () => {
    expect(normalisePhonetic('ɐ')).toEqual(['ə']);
  });

  it('PRESERVES the flap — this is the finding, not noise', () => {
    expect(normalisePhonetic('bʌɾɚ')).toEqual(['b', 'ʌ', 'ɾ', 'ɚ']);
  });
});

describe('normalisePhonemic', () => {
  it('strips stress marks, which the phonetic track has none of', () => {
    expect(normalisePhonemic('ˈbʌtɚ')).toEqual(['b', 'ʌ', 't', 'ɚ']);
    expect(normalisePhonemic('ˌʌndɚˈstænd')).not.toContain('ˌ');
  });
});

describe('the two tracks after normalisation', () => {
  it('agrees on everything except the real divergences', () => {
    const phonetic = normalisePhonetic('bʌɾɚ');
    const phonemic = normalisePhonemic('ˈbʌtɚ');
    expect(phonetic).toHaveLength(phonemic.length);
    // Identical but for the flap in position 2.
    expect(phonetic.filter((p, i) => p !== phonemic[i])).toEqual(['ɾ']);
  });
});
```

**Step 2: Implement**

Order matters: strip diacritics first, then map symbols, then segment into phones. The
phone segmenter needs the set of legitimate multi-character phones — diphthongs
(`aɪ aʊ ɔɪ eɪ oʊ`) and affricates (`tʃ dʒ`) — and splits anything else per code point.

**Never normalise `ɾ`, `ʔ`, `ɹ` or vowel quality.** Those carry the signal.

**Step 3: Commit**

---

## Task 3: Distinctive feature table

**Files:**
- Create: `src/align/features.ts`, `src/align/features.test.ts`

**Step 1: Write the failing tests**

The table is data, so the tests assert *relationships* rather than transcribing the table
back at itself:

```ts
import { describe, it, expect } from 'vitest';
import { featureDistance } from './features';

describe('featureDistance', () => {
  it('is zero for identical phones', () => {
    expect(featureDistance('t', 't')).toBe(0);
  });

  it('is small for a flap and the /t/ it replaces', () => {
    // The single most common English reduction. If this is not cheap, the aligner
    // will prefer to delete and insert rather than substitute, and every flapping
    // measurement in M4 breaks.
    expect(featureDistance('t', 'ɾ')).toBeLessThan(0.25);
  });

  it('is small for voicing-only pairs', () => {
    expect(featureDistance('t', 'd')).toBeLessThan(0.15);
    expect(featureDistance('s', 'z')).toBeLessThan(0.15);
  });

  it('is small for schwa and its rhotic counterpart', () => {
    expect(featureDistance('ə', 'ɚ')).toBeLessThan(0.25);
  });

  it('is large between a consonant and a vowel', () => {
    expect(featureDistance('t', 'i')).toBeGreaterThan(0.5);
  });

  it('is larger for distant vowels than near ones', () => {
    expect(featureDistance('i', 'ɪ')).toBeLessThan(featureDistance('i', 'ɑ'));
  });

  it('is symmetric', () => {
    expect(featureDistance('t', 'ɾ')).toBe(featureDistance('ɾ', 't'));
  });

  it('covers every phone both tracks can produce', () => {
    // A missing entry must fail loudly rather than defaulting to some distance.
    for (const p of INVENTORY) expect(() => featureDistance(p, 't')).not.toThrow();
  });
});
```

**Step 2: Author the table**

~21 features over the English inventory: syllabic, consonantal, sonorant, continuant,
nasal, strident, lateral, delayedRelease, voice, spreadGlottis, labial, round, coronal,
anterior, distributed, dorsal, high, low, back, tense, rhotic.

Values are `+1`, `-1`, or `0` for undefined. Distance is the count of differing defined
features divided by the count compared — undefined features on either side are skipped so
a vowel/consonant comparison is not dominated by inapplicable features.

**Step 3: Commit**

---

## Task 4: Feature-weighted alignment

**Files:**
- Create: `src/align/align.ts`, `src/align/align.test.ts`

**Step 1: Write the failing tests**

```ts
describe('align', () => {
  it('aligns identical sequences with no operations', () => {
    const a = align(['k', 'æ', 't'], ['k', 'æ', 't']);
    expect(a.every((op) => op.type === 'match')).toBe(true);
  });

  it('records a substitution for the flap rather than a delete plus insert', () => {
    // butter: /bʌtɚ/ vs [bʌɾɚ]
    const a = align(['b', 'ʌ', 't', 'ɚ'], ['b', 'ʌ', 'ɾ', 'ɚ']);
    expect(a.filter((o) => o.type === 'substitute')).toHaveLength(1);
    expect(a.filter((o) => o.type === 'delete' || o.type === 'insert')).toHaveLength(0);
  });

  it('records a deletion when a phone is dropped', () => {
    const a = align(['m', 'ɑ', 'ɹ', 'k', 'ɪ', 't'], ['m', 'ɑ', 'ɹ', 'k', 'ɪ']);
    expect(a.filter((o) => o.type === 'delete')).toHaveLength(1);
  });

  it('aligns the whole fixture sentence with a low error rate', () => {
    // The end-to-end check: real phonemic against real phonetic.
    const ops = align(PHONEMIC_FIXTURE, PHONETIC_FIXTURE);
    const errors = ops.filter((o) => o.type !== 'match').length;
    expect(errors / ops.length).toBeLessThan(0.25);
  });

  it('finds exactly the five flaps in the fixture', () => {
    const ops = align(PHONEMIC_FIXTURE, PHONETIC_FIXTURE);
    const flaps = ops.filter((o) => o.type === 'substitute' && o.to === 'ɾ' && o.from === 't');
    expect(flaps).toHaveLength(5);
  });
});
```

That last test is the milestone's acceptance criterion in one line.

**Step 2: Implement Needleman-Wunsch**

Standard dynamic programme, with substitution cost from `featureDistance` and a fixed gap
penalty. **Tune the gap penalty against the tests, not by taste:** it must exceed a near
substitution (flap, ~0.1) so the aligner substitutes rather than deleting-and-inserting,
but stay below a distant substitution (~0.8) so genuinely dropped phones are recorded as
deletions. Start at 0.7.

Return operations carrying the indices into both sequences, so the UI and M4 can map back
to words and to frame timings.

**Step 3: Commit**

---

## Task 5: Wire the phonetic track into the session

**Files:**
- Modify: `src/session/useSession.ts`

**Step 1: Load the phoneme model in the background**

197 MB is the largest asset in the app. Load it **after** the live ASR model, like
base.en, so captions start early. Report progress distinctly.

Until it arrives, the app behaves exactly as M2 did — this is a strict addition, and a
failure to load must degrade to the M2 experience rather than breaking captions.

**Step 2: Run it on the refined pass only, at first**

The phoneme model runs on the full recording when recording stops, alongside the refined
ASR pass. **Do not add it to the interim loop yet** — the live budget is already
1.2 s per window, and correctness of the alignment matters more than live phonetics.
Live phonetic captions are a polish item for M6 if the budget allows.

**Step 3: Build the aligned result**

Concatenate the phonemic phones across words, keeping a word index per phone. Align
against the phonetic stream. Each phonetic phone inherits the word index of the phonemic
phone it aligned with; insertions inherit from their neighbour.

**This is also where word timings come from** — M0/R3 established Whisper's word
timestamps are unavailable, and the design's answer was that alignment supplies them at
20 ms resolution instead. This step realises that.

**Step 4: Commit**

---

## Task 6: Three-line captions

**Files:**
- Modify: `src/components/PhonemicLine.tsx` → generalise, or add `AlignedCaptions.tsx`

**Step 1: Render three rows per word**

```
   butter
  /ˈbʌtɚ/      <- phonemic, the dictionary
  [bʌɾɚ]       <- phonetic, what was said
```

Square brackets for phonetic, slashes for phonemic. The notation is not decoration: it
is how a linguist reads at a glance which is which.

**Step 2: Highlight divergences inline**

Within the phonetic line, mark substituted phones. Use colour **plus** a non-colour cue
(underline or weight) so the distinction survives colour blindness and greyscale
screenshots. A tooltip naming the change — "/t/ → [ɾ]" — makes the demo self-explaining.

**Step 3: Handle the unaligned cases honestly**

Out-of-vocabulary words have no phonemic reference, so they get a phonetic line and a
dash above it. Words recognised before the phoneme model finished loading get no
phonetic line. Neither should look like an error.

**Step 4: Commit**

---

## Task 7: README and honesty pass

State what the alignment is and is not:

- Substitution costs come from a **hand-authored** feature table, not a learned metric.
- The phonetic model is **multilingual espeak**, not English-specific, so it occasionally
  emits symbols outside the General American inventory.
- The two tracks are normalised into a shared inventory first; length marks and `ɐ` are
  notation differences, and the normalisation is documented so nobody later mistakes it
  for hiding divergences.
- **Still describing, not grading.**

---

## Exit criteria

1. Three caption lines: English, `/phonemic/`, `[phonetic]`
2. The fixture sentence produces **exactly five `/t/` → `[ɾ]` substitutions**, and `at`
   and `market` are not among them
3. Divergences are marked with a non-colour cue and an explanatory tooltip
4. The phoneme model loads in the background; its absence degrades to M2 behaviour
5. Alignment operations carry indices into both sequences and into frame timings
6. All existing tests pass; M1 capture and M2 lexicon behaviour unchanged

**Explicitly not in M3:** confusion matrices, process detection, phoneme statistics,
formants, pitch. M3 produces the alignment; M4 reads it. The temptation to start counting
things the moment the alignment works is the main way this milestone sprawls.
