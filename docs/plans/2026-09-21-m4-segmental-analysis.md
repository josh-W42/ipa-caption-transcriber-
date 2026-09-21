# M4 — Segmental Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the alignment M3 produces into linguistics — what sounds this speaker
uses and how often, where they diverge from the dictionary, and which named
phonological processes those divergences amount to.

**Architecture:** Pure functions over the existing `AlignedWord[]`. No new model, no new
audio path. A build script derives an English phone-frequency baseline; everything else
is computation over data already in memory.

**Tech Stack:** TypeScript, the existing React app, one Node build script.

---

## What M3 already provides

Every analysis in M4 reads `AlignedWord[]` from `src/align/utterance.ts`:

- `phonemic` — the dictionary's IPA for the word
- `phonetic` — `TimedPhone[]`, what was produced, with 20 ms timings
- `ops` — `AlignOp[]` carrying `type`, `from`, `to`, `aIndex`, `bIndex`, `cost`

**M4 adds no inference.** If anything here is slow, it is a bug, not a cost.

On the fixture sentence the alignment yields 36 matches and 10 substitutions: five
`/t/ → [ɾ]` flaps, `/ɔ/ → [ɑ]` and `/ɑ/ → [ɔ]` (the cot/caught merger, both directions),
`/ə/ → [æ]`, `/ə/ → [ɪ]`, and `/i/ → [eɪ]`. That is the test data for process detection.

---

## Verified before planning (2026-09-21)

The design flagged the frequency baseline as needing sourcing. Resolved:

- **`hermitdave/FrequencyWords`**, file `content/2018/en/en_50k.txt` — **MIT licensed**,
  50,000 words with real token counts.
- Derived from **OpenSubtitles**, which is *spoken* language. That matters: comparing a
  speaker's phone frequencies against a written-text corpus would build a mismatch into
  the baseline.
- Crossed with the shipped CMUdict lexicon it gives **96.07% token coverage** — 39,794
  of the 50,000 word types are in CMUdict, and the misses are rare words carrying 4% of
  tokens.
- Result: 41 distinct phones over 2.2 billion phone tokens. Top of the distribution is
  `/t/` 7.45%, `/n/` 6.34%, `/ɪ/` 5.67%, `/ə/` 5.52%, which matches published English
  phoneme frequencies.

---

## Task 1: Build the frequency baseline

**Files:**
- Create: `scripts/build-baseline.mjs`, `public/phone-baseline.json`,
  `public/BASELINE-LICENSE.txt`

**Step 1: Fetch the frequency list**

```bash
curl -sL https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt -o scripts/en_50k.txt
```

Gitignore it, as with `cmudict.dict` — an input, not a source file.

**Step 2: Write the converter**

Reuses the shipped `public/lexicon.txt` rather than re-parsing CMUdict, so the baseline
cannot drift from the lexicon the app actually uses. For each word: look up its ARPAbet,
map to IPA with the same stress-dependent rules (`AH0`→`ə`, `ER0`→`ɚ`), and add the
word's token count to each phone.

Output `{ phone: proportion }` plus the metadata needed to state provenance honestly:
token coverage, word counts, and the source.

**Step 3: Verify**

```bash
node scripts/build-baseline.mjs
```

Expected: ~96% coverage, 41 phones, and `/t/` around 7.4%. **If coverage drops below
90%, stop** — it means the lexicon and the frequency list have diverged and the baseline
is no longer representative.

**Step 4: Ship the licence**

Copy the MIT licence to `public/BASELINE-LICENSE.txt` and link it beside the CMUdict one.

**Step 5: Commit**

---

## Task 2: Phoneme statistics

**Files:**
- Create: `src/analysis/inventory.ts`, `src/analysis/inventory.test.ts`

**Step 1: Write the failing tests**

```ts
describe('phoneCounts', () => {
  it('counts what was actually produced, not what was expected', () => {
    // The phonetic track is the speaker's; the phonemic track is the dictionary's.
    // Counting the wrong one would make every speaker look identical.
  });

  it('returns proportions that sum to 1', () => { /* ... */ });

  it('handles an utterance with no phonetic track yet', () => { /* ... */ });
});

describe('compareToBaseline', () => {
  it('reports over- and under-use relative to conversational English', () => { /* ... */ });

  it('reports phones the speaker used that the baseline lacks', () => { /* ... */ });

  it('does not report a phone as absent when the sample is too small to tell', () => {
    // A ten-word utterance will be missing most of the inventory. Saying someone
    // "never uses /ʒ/" on that evidence is a lie of confidence.
  });
});
```

**Step 2: Implement**

`phoneCounts(words)` counts the **phonetic** phones. `compareToBaseline(counts, baseline)`
returns per-phone `{ observed, expected, ratio, delta }`.

**Sample-size honesty is a requirement, not a polish item.** A short utterance cannot
support claims about absence, and the UI must not make them. Carry a `sufficient` flag
per phone (expected count ≥ 5 is a reasonable floor) and let the UI suppress the rest.

**Step 3: Commit**

---

## Task 3: The IPA chart

**Files:**
- Create: `src/analysis/ipaChart.ts`, `src/components/IpaChart.tsx`

**Step 1: Author the chart layout**

The real IPA consonant grid — place across, manner down — restricted to English:

```
            bilabial labiodental dental alveolar postalveolar palatal velar glottal
plosive     p b                         t d                           k ɡ    ʔ
nasal       m                           n                             ŋ
tap                                     ɾ
fricative            f v        θ ð      s z      ʃ ʒ                        h
approximant                              ɹ                     j
lateral                                  l
```

And the vowel quadrilateral by height × backness, with rounding noted.

**Step 2: Render as a heatmap**

Cells shade by the speaker's usage frequency. Empty cells stay visibly empty — the gaps
in the chart are linguistically meaningful, not missing data.

**This is the showpiece.** It is the one view where the app stops looking like a
transcription tool and looks like a phonetics instrument.

Accessibility: shade **and** print the number. A colour-only heatmap is unreadable to a
colour-blind viewer and dies in a greyscale screenshot.

**Step 3: Commit**

---

## Task 4: Confusion matrix

**Files:**
- Create: `src/analysis/confusion.ts`, `src/analysis/confusion.test.ts`

**Step 1: Write the failing tests**

Expected phoneme down, produced phone across, counts in the cells. Test that the
diagonal collects matches, that `/t/ → [ɾ]` lands in the right cell, and that deletions
get an explicit `∅` column rather than being dropped — a phone that was expected and not
produced is a finding, and silently omitting it would understate divergence.

**Step 2: Implement and render**

Only rows and columns that occur should render; a full 40×40 grid of mostly zeros hides
the signal. Sort by frequency so the interesting cells sit at the top left.

**Step 3: Commit**

---

## Task 5: Process detection

The linguistically interesting task, and the one most able to mislead.

**Files:**
- Create: `src/analysis/processes.ts`, `src/analysis/processes.test.ts`

**Step 1: Write the failing tests, using the fixture's known divergences**

```ts
describe('detectProcesses', () => {
  it('detects flapping only between vowels', () => {
    // butter /bʌtɚ/ -> [bʌɾɚ] is flapping.
    // A /t/ -> [ɾ] that is NOT intervocalic is something else, and calling it
    // flapping would be wrong.
  });

  it('finds the fixture\'s five flaps and names them', () => { /* ... */ });

  it('detects the cot/caught merger in both directions', () => {
    // water /wɔtɚ/ -> [wɑɾɚ] AND on /ɑn/ -> [ɔn] are the same merger.
  });

  it('does not report a process from a single instance as a pattern', () => {
    // One occurrence is an observation; a pattern needs repetition. The UI must
    // distinguish "happened once" from "this speaker does this".
  });

  it('reports the examples behind every detection', () => {
    // A claim with no evidence attached is not checkable by the person reading it.
  });
});
```

**Step 2: Implement the rules**

Each process is `{ id, name, description, test(op, context) }` where context gives the
neighbouring phonemic phones and position in word. Rules to author:

| process | rule |
| --- | --- |
| flapping | `/t/` or `/d/` → `[ɾ]`, intervocalic |
| t-glottalization | `/t/` → `[ʔ]` |
| vowel reduction | full vowel → `[ə]` or `[ɪ]`, unstressed |
| vowel unreduction | `/ə/` → full vowel |
| cot/caught merger | `/ɔ/` ↔ `[ɑ]` |
| final stop deletion | word-final stop → ∅ |
| g-dropping | `/ŋ/` → `[n]` |
| th-fronting | `/θ/` → `[f]`, `/ð/` → `[v]` |
| non-rhoticity | `/ɹ/` → ∅, or `/ɚ/` → `[ə]` |

**Every rule must carry its examples.** A detection that says "flapping: 5" is an
assertion; one that says "flapping: 5 — butter, little, water, city, Saturday" can be
checked by the reader, and an interviewer will check it.

**These are authored rules, not learned patterns**, and the UI says so plainly.

**Step 3: Commit**

---

## Task 6: The analysis panel

**Files:**
- Create: `src/components/AnalysisPanel.tsx`
- Modify: `src/App.tsx`

Sections, in order of how much they tell you:

1. **Summary** — phones produced, divergence rate, processes detected
2. **Processes** — each with count and examples
3. **IPA chart** — the heatmap
4. **Frequency vs. baseline** — over- and under-used phones
5. **Confusion matrix** — expected against produced

Collapsed by default below the reference panel, so the captions stay the primary view.

**Every number states its sample size.** A percentage from a ten-word utterance and one
from ten minutes of speech look identical on screen and mean entirely different things.

**Step 3: Commit**

---

## Task 7: README and honesty pass

- The baseline is **conversational English from subtitles**, not this speaker's dialect.
  Divergence from it is description, not error.
- Process detection uses **authored rules**, not learned patterns; it finds what it was
  told to look for and nothing else.
- Short utterances cannot support claims about absence or about rate.
- **Still describing, not grading.** M4 is where this is most tempting and most wrong —
  a "pronunciation score" is one small step from a confusion matrix, and it would be
  measuring distance from one dictionary's dialect.

---

## Exit criteria

1. The fixture reports five flaps, by name, with their five example words
2. The cot/caught merger is detected in both directions
3. The IPA chart renders with usage shading and legible numbers
4. The confusion matrix shows `/t/ → [ɾ]` with count 5
5. Every statistic states its sample size; nothing claims absence from a short sample
6. No new model, no measurable delay added to the existing pipeline
7. All existing tests pass

**Explicitly not in M4:** formants, pitch, rhythm, vowel-space plots. Those are M5 and
need real DSP. If a task here starts wanting the audio signal rather than the alignment,
it belongs in M5.
