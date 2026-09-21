# M5 — DSP Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the suprasegmental layer — vowel formants plotted in the classic F1×F2
space, pitch contour, and rhythm metrics — measured from the audio signal itself.

**Architecture:** A DSP worker operating on the recorded audio plus the phone timings
M3 already produces. Pure TypeScript numerics, no new model, no external dependency.
Every routine is verified against synthesised signals whose correct answer is known in
advance.

**Tech Stack:** TypeScript, Web Worker, the existing React app.

---

## Prototyped before planning (2026-09-21)

The design called LPC formant estimation "the component most likely to produce garbage
if rushed". So the method was prototyped first, against synthetic vowels built by passing
an impulse train through cascaded two-pole resonators at chosen frequencies.

**The method works.** LPC order 18 at 16 kHz, autocorrelation plus Levinson-Durbin, roots
by Durand-Kerner. No dependency needed.

**Accuracy, measured:**

| vowel | true F1/F2/F3 | recovered | F1 error | F2 error |
| --- | --- | --- | ---: | ---: |
| i (heed) | 270 / 2290 / 3010 | 301 / 2284 / 3013 | **11.4%** | 0.3% |
| ɑ (hod) | 730 / 1090 / 2440 | 726 / 1078 / 2420 | 0.6% | 1.1% |
| u (who'd) | 300 / 870 / 2240 | 358 / 864 / 2247 | **19.4%** | 0.7% |
| æ (had) | 660 / 1720 / 2410 | 677 / 1718 / 2402 | 2.5% | 0.1% |

**F2 and F3 are reliable everywhere — under 1.5% error.**

**F1 is unreliable for close vowels.** Across F0 from 85 Hz to 300 Hz, F1 error for /i/
ranged 5.1% to 31.7% while /ɑ/ stayed between 0.6% and 4.2%. It is not a simple pitch
effect: a close vowel's F1 is low enough to sit among the voicing harmonics, and LPC
cannot cleanly separate them.

**This drives the design of the plot, not just a footnote.** Close vowels must be drawn
with visibly greater uncertainty than open ones, because they genuinely are.

---

## Task 1: LPC formant estimation

**Files:**
- Create: `src/dsp/lpc.ts`, `src/dsp/lpc.test.ts`, `src/dsp/synth.ts`

**Step 1: Write the signal synthesiser first**

`src/dsp/synth.ts` produces a vowel with known formants: an impulse train at F0 through
cascaded two-pole resonators. **This is test infrastructure, and it is the whole basis
for trusting any of the numbers.** Without it, a formant tracker can only be checked
against intuition, which is how DSP code ends up confidently wrong.

```ts
export function synthVowel(opts: {
  f0: number; formants: number[]; bandwidths?: number[];
  seconds?: number; sampleRate?: number;
}): Float32Array;
```

**Step 2: Write the failing tests, with thresholds from the prototype**

```ts
it('recovers F1 and F2 of an open vowel within 5%', () => { /* ɑ: 730, 1090 */ });
it('recovers F2 of a close vowel within 3%', () => { /* i: 2290 */ });

it('is documented as unreliable for F1 of close vowels', () => {
  // Measured 5-32% error across F0 85-300Hz. The test asserts the LOOSE bound that
  // matches reality rather than a tight one that would fail intermittently — and
  // the looseness is the finding, carried into the UI as wider uncertainty.
});

it('returns formants in ascending order', () => { /* ... */ });
it('rejects candidates with implausible bandwidth', () => { /* ... */ });
it('returns nothing for silence rather than inventing resonances', () => { /* ... */ });
```

**Step 3: Implement**

Pipeline: pre-emphasis (0.97) → Hamming window → autocorrelation → Levinson-Durbin →
Durand-Kerner roots → keep upper-half-plane roots with 90 Hz < f < 7900 Hz and
bandwidth < 500 Hz, sorted ascending.

Durand-Kerner rather than a companion-matrix eigensolver: about forty lines, no matrix
library, and adequate for order 18.

**Step 4: Commit**

---

## Task 2: YIN pitch detection

**Files:**
- Create: `src/dsp/yin.ts`, `src/dsp/yin.test.ts`

**Step 1: Write the failing tests**

```ts
it('recovers the pitch of a synthetic vowel within 2%', () => { /* 120Hz */ });
it('tracks pitch across the human range', () => { /* 80-300Hz */ });
it('returns null for silence rather than a number', () => { /* ... */ });
it('returns null for white noise, which has no pitch', () => { /* ... */ });
it('median-smooths octave errors out of a contour', () => {
  // YIN halves or doubles on creaky voice. A single wrong frame in an otherwise
  // steady contour must not survive into the displayed line.
});
```

**Step 2: Implement**

Difference function → cumulative mean normalised difference → absolute threshold (0.15)
→ parabolic interpolation for sub-sample accuracy. 10 ms hop. Median filter of width 5
over the contour.

**Step 3: Commit**

---

## Task 3: Vowel extraction and gating

**Files:**
- Create: `src/dsp/vowels.ts`, `src/dsp/vowels.test.ts`

Uses the phone timings M3 produces to locate vowel intervals in the audio, then gates
hard before measuring. **The gating is what separates a vowel plot from a scatter of
noise:**

- vowels only, by phone identity
- **middle 50% of the interval**, so formant transitions into neighbouring consonants
  are excluded
- minimum duration 40 ms; shorter intervals do not contain a steady state
- voiced only, by YIN returning a pitch
- above an energy floor

Each measurement carries its own confidence, derived from duration, voicing strength and
formant bandwidth, so the plot can draw uncertain tokens differently rather than
pretending they are equal.

**Commit.**

---

## Task 4: Rhythm and timing

**Files:**
- Create: `src/dsp/rhythm.ts`, `src/dsp/rhythm.test.ts`

Pure functions over phone timings — no signal processing, and the cheapest genuinely
linguistic metrics in the project:

- **speech rate** — phones per second including pauses
- **articulation rate** — excluding pauses. The distinction is the point: the two differ
  by how much someone pauses, and reporting only one hides that.
- **pause structure** — count, total, mean, longest
- **nPVI** over vocalic intervals — the standard stress- vs syllable-timed rhythm metric

Test nPVI against constructed sequences: even intervals must approach 0, strongly
alternating ones must approach 100.

**Commit.**

---

## Task 5: The DSP worker

**Files:**
- Create: `src/dsp/worker.ts`, `src/dsp/client.ts`

Formant analysis over a long recording is heavy enough to freeze the UI, and M3 already
established that **two GPU workers running concurrently cost 11x**. This one is pure CPU,
so it does not contend for the GPU — but it still runs after the model passes, not
alongside them.

Input: audio plus phone intervals. Output: formant measurements, pitch contour, rhythm.

**Commit.**

---

## Task 6: Vowel space plot and pitch contour

**Files:**
- Create: `src/components/VowelSpace.tsx`, `src/components/PitchContour.tsx`

**The vowel plot is the showpiece.** F1 on the vertical axis and F2 on the horizontal,
**both inverted**, which is what makes the scatter fall into the shape of the vowel
quadrilateral — close vowels at the top, front vowels at the left, as every phonetics
textbook draws it.

Requirements that follow directly from the measured accuracy:

- **Every token is a point.** Never one dot per vowel category: that would claim a
  precision the method does not have.
- **Confidence ellipses per category**, drawn from the token spread, once there are
  enough tokens to compute one.
- **Close vowels drawn with visibly greater uncertainty**, because F1 error there is
  5-32% against under 5% for open vowels.
- Reference positions underneath, clearly marked as reference rather than measurement.
- A stated minimum: below a handful of tokens for a category, plot the points and draw
  no ellipse.

Pitch contour renders under the caption stream, aligned in time, with unvoiced regions
as gaps rather than interpolated lines — an interpolated pitch through a voiceless stop
is an invention.

**Commit.**

---

## Task 7: README and honesty pass

State the measured accuracy, in numbers:

- F2 and F3 within ~1.5%; F1 within ~5% for open vowels but **5-32% for close vowels**.
- Verified against synthesised signals with known resonances — the only way to know a
  formant tracker is not lying.
- Pitch tracking suffers octave errors on creaky voice; median smoothing reduces but
  does not eliminate them.
- nPVI over a short utterance is noisy; it needs sustained speech to mean anything.
- **Still describing, not grading.**

---

## Exit criteria

1. The synthesised-signal suite passes: F2 within 3%, open-vowel F1 within 5%
2. The vowel plot renders tokens as points with per-category ellipses, inverted axes
3. Close vowels are visibly more uncertain than open ones
4. Pitch contour shows gaps at unvoiced regions rather than interpolating
5. Speech rate and articulation rate are reported separately
6. The DSP worker does not block the UI, and runs after the model passes
7. All existing tests pass

**Explicitly not in M5:** any scoring or grading of vowel placement. A vowel plot with a
"target" overlay and a distance score is the most tempting version of the thing this
project has refused at every milestone, and the temptation is strongest here because the
geometry makes it look objective.
