# Live IPA Captions — Design

**Date:** 2026-09-20
**Status:** Approved. **Amended 2026-09-20 after M0 — verdict GO.**
**Purpose:** Portfolio / interview piece

> **Amendment (2026-09-20).** M0 resolved all four risks; see
> [`docs/findings/2026-09-20-m0-spike-findings.md`](../findings/2026-09-20-m0-spike-findings.md).
> The phonetic track is viable and the design survives intact. Three changes, all
> simplifications:
>
> 1. **Cross-origin isolation is not needed** (R4). COOP/COEP, `SharedArrayBuffer` and the
>    `firebase.json` headers block are removed. Workers use transferable `ArrayBuffer`s.
>    R2 is moot.
> 2. **Whisper word timestamps are unavailable** in this ONNX export (R3) — and unnecessary.
>    All timing comes from CTC frames at 20 ms resolution; word timing falls out of the M3
>    alignment.
> 3. **The phoneme model loads via `AutoModelForCTC` + hand-rolled greedy CTC decode**, not
>    `pipeline()` (R1), because those repos ship no `tokenizer.json`. This is the better
>    path regardless: it is the only one that yields the frame timings the design depends on.
>
> Model pinned to `onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX` at **q4f16 (197 MB)**,
> measured at **114x realtime**. Sections below are left as approved; where they conflict
> with this banner, the banner wins.

## Summary

A browser application that records live microphone audio and renders it as three
parallel caption tracks — English orthography, canonical `/phonemic/` IPA, and actual
`[phonetic]` IPA — then analyzes the divergence between the last two across segmental,
distributional, and prosodic dimensions.

All inference runs client-side. No audio leaves the machine.

## Decisions

| Decision | Choice | Reasoning |
| --- | --- | --- |
| Purpose | Portfolio / interview piece | Demo story and polish outrank internal elegance |
| IPA depth | Phonemic **and** phonetic, side by side | The divergence between them is the product |
| Compute | 100% client-side, no server | Privacy claim is structural, deploys static, zero hosting cost |
| Liveness | Live rough pass + refined pass on stop | Real-time "wow" plus trustworthy analysis numbers |
| Language | English only | Lexicon, reference formants, and corpus baselines are all language-specific |
| Stack | React + Vite + TypeScript | Matches telemetry-viewer and whiteboard; best charting ecosystem |
| Hosting | Firebase Hosting | Supports the custom headers we may need; see Deployment |

## Architecture

Four threads. The main thread renders and never blocks.

```
mic -> AudioWorklet (capture, downsample to 16kHz mono f32, ring buffer)
         |
         +--> ASR worker      : Whisper (transformers.js / WebGPU) -> words + timestamps
         +--> Phoneme worker  : wav2vec2 CTC -> phone sequence + frame timings
         +--> DSP worker      : LPC formants, YIN pitch, energy/timing (pure TS, no model)
                                       |
                              Analysis module -> alignment, stats, process detection
                                       |
                                 React UI (render only)
```

### Why two speech models

Whisper produces words; words produce the canonical `/phonemic/` string via lexicon
lookup. The wav2vec2 CTC model produces the actual `[phonetic]` string directly from
audio. Both consume the same ring buffer in parallel.

### The alignment is the core

Aligning the two strings with plain edit distance would be linguistically wrong: it
would score `/t/ -> [flap]` as badly as `/t/ -> [i]`. Instead we use Needleman-Wunsch
with substitution cost derived from **distinctive-feature distance** — roughly 20
features (syllabic, consonantal, sonorant, continuant, nasal, strident, lateral, voice,
labial, round, coronal, anterior, dorsal, high, low, back, tense, ...) over ~60 English
phones and common allophones.

Effect: `/t/ -> [flap]` costs ~0.1; `/t/ -> [i]` costs ~0.8. Deletions carry
position-sensitive gap penalties, since final-stop and schwa deletion are ordinary.

The feature table is hand-authored. Tedious, but deterministic and unit-testable.

## Data model

One central immutable record. Every analysis is a pure derivation of it, which makes the
entire analysis layer testable without a microphone.

```ts
Utterance {
  audio:     Float32Array                     // 16kHz mono
  words:     [{ text, start, end }]           // Whisper
  phonemic:  [{ phone, wordIdx, stress }]     // lexicon lookup  -> /canonical/
  phonetic:  [{ phone, start, end, conf }]    // wav2vec2 CTC    -> [actual]
  alignment: [{ pIdx, fIdx, op, cost }]       // the join
  f0: Float32Array
  formants:  [{ phoneIdx, f1, f2, f3 }]
}
```

## Analyses

### 1. Phoneme statistics and distribution

Inventory and frequency against an English baseline. Primary visualization: the real IPA
consonant and vowel charts with cells heatmapped by the speaker's usage frequency. Also
syllable-shape patterns (CVC, CCVC, ...) and onset/coda inventories.

*Caveat:* the baseline table must be derived offline from CMUdict crossed with word
frequency data, and shipped as static JSON.

### 2. Phonemic/phonetic divergence

Reads the alignment path directly. Produces a confusion matrix (expected phoneme x
produced phone), phone error rate, and substitution/deletion/insertion rates.

Named process detection: flapping, vowel reduction, t-glottalization, final-stop
deletion, g-dropping, th-fronting, non-rhoticity. Each detected process reports a count
and examples — the speaker's "accent fingerprint."

*Caveat:* these are **rules we author**, not learned patterns. The UI must say so.

### 3. Vowel space (formants)

Uses CTC frame timings to locate vowel intervals, takes the steady-state middle 50%, then
pre-emphasis -> autocorrelation -> Levinson-Durbin -> LPC polynomial roots -> F1/F2/F3.
Root finding via companion matrix eigenvalues or Bairstow; LPC order ~18 at 16kHz. No
external dependency required.

Plots the classic inverted F1 x F2 vowel quadrilateral, per-vowel confidence ellipses,
overlaid on reference positions.

*Caveat:* LPC formant estimation is genuinely noisy — worst for high vowels and high-F0
voices. Render ellipses, never single authoritative dots. Requires aggressive gating:
voiced only, above an energy floor, transitions excluded. This is the component most
likely to produce garbage if rushed.

### 4. Prosody and timing

YIN pitch tracking at ~10ms hop, drawn as an intonation contour beneath the caption
stream. Speech rate vs. **articulation rate** (pause-excluded), pause structure, and nPVI
rhythm computed from phone timings already available.

*Caveat:* YIN produces octave errors on creaky voice; needs median smoothing.

## Deployment

Firebase Hosting. Verified against the Firebase documentation on 2026-09-20:

- **Custom headers are supported** via `firebase.json` -> `headers[]` with glob `source`
  and `{key, value}` pairs. COOP/COEP are therefore settable.
- Firebase **overwrites `Strict-Transport-Security`** on default `*.web.app` subdomains.
  Different header, but it proves Firebase overrides some — smoke-test that COOP/COEP
  actually land after the first deploy.
- **Storage:** 10 GB free, 2 GB max per individual file. Not a constraint for us.
- **Data transfer:** 10 GB/month free. Exceeding it on the Spark plan means a short grace
  period and then **the site is disabled until the next month.**

### Bandwidth strategy

A dead link is the worst possible failure for a portfolio piece. At ~200 MB of weights per
cold visitor, 10 GB/month allows only ~50 first-time visits.

Therefore: **do not self-host the model weights.** transformers.js fetches from the Hugging
Face CDN by default and caches into browser Cache Storage. Firebase then serves only the
app bundle (a few hundred KB) and the transfer quota becomes irrelevant.

~~If cross-origin isolation is required, set COOP/COEP headers.~~ **Not required** — M0/R4
confirmed WebGPU works without isolation. No custom headers are needed.

**Amended by M0:** ONNX Runtime's WASM binary bundles into `dist/` at **26.8 MB** (6.7 MB
gzipped) and *is* self-hosted, so Firebase transfer is roughly 1,500 cold visits/month,
not "effectively unlimited" as stated above. Since threads are unnecessary, M1 should
check whether the threaded asyncify build can be dropped from the bundle.

## Risk register

M0 exists to resolve these before any application code is written.

**All four resolved by M0 on 2026-09-20.**

| # | Unknown | Outcome |
| --- | --- | --- |
| R1 | Does a phoneme-level CTC model exist as a working transformers.js/ONNX build? | **RESOLVED — PASS.** `pipeline()` fails (no `tokenizer.json`), but `AutoModelForCTC` + greedy CTC decode against `vocab.json` yields correct narrow IPA at 20 ms resolution, plus the frame timings the pipeline path discards. Five flaps correctly placed. |
| R2 | Does COEP `require-corp` break cross-origin model fetches from the HF CDN? | **MOOT.** R4 removed the need for isolation. |
| R3 | Are word-level timestamps available from Whisper in transformers.js? | **RESOLVED — NO.** Export lacks the required cross-attentions; segment level is the ceiling and is too coarse. Does not matter: CTC frame timings supersede it. |
| R4 | Do we need `SharedArrayBuffer` at all? | **RESOLVED — NO.** Everything passed at 114x realtime on WebGPU with `crossOriginIsolated: false`. COOP/COEP leaves the design. |

R4 is the cheapest possible outcome: WebGPU does not require cross-origin isolation — only
multithreaded WASM does.

### Explicitly unverified

These are assumptions, not established facts, and M0 must confirm them:

- That `@huggingface/transformers` runs Whisper under WebGPU in current browsers
- That any phoneme-level CTC architecture is supported by transformers.js
- That CMUdict licensing permits redistribution in a deployed bundle
- That public reference formant data (Hillenbrand / Peterson-Barney means) is available
  under terms permitting inclusion

## Testing strategy

Built deliberately, because an interviewer will look at it.

- **Golden fixtures:** a handful of WAV files, snapshot-tested end to end
- **Alignment:** unit-tested against hand-written phone strings with known expected paths
- **DSP:** tested against **synthesized signals with known resonances** — generate a vowel
  at a known F1/F2, assert LPC recovers it within tolerance. This is how we prove the
  formant code is not lying.

## Milestones

**M0 — Spike (a gate, not a milestone).** Timeboxed and throwaway. One scratch page
answering R1-R4. Exit criteria: a findings document in `docs/findings/` and an explicit
go/no-go on the phonetic track. If R1 fails, redesign here.

**M1 — Live captions, words only.** Mic -> AudioWorklet -> 16kHz ring buffer -> ASR worker
with overlapping sliding windows and stitching. Live word stream, refined full pass on
stop. Includes a **"load sample audio" button** — pulled forward deliberately, because it
makes later milestones testable without speaking and because visitors in quiet offices will
not use a microphone. Deployed to Firebase. No IPA yet.

**M2 — The `/phonemic/` track.** CMUdict -> ARPAbet -> IPA mapping, shipped compressed.
Out-of-vocabulary words flagged as unknown rather than faked. Dual-line captions.
**The project is honestly titled and independently shippable at this point.**

**M3 — The `[phonetic]` track and alignment.** Phoneme CTC worker, feature table, weighted
Needleman-Wunsch. Three-line captions with divergences highlighted inline.

**M4 — Segmental analysis.** Nearly free once M3 lands: phoneme statistics, IPA chart
heatmap, confusion matrix, process detection.

**M5 — DSP analysis.** Expensive and risky, isolated and last: YIN pitch, LPC formants,
vowel space plot, rhythm metrics, synthesized-signal test suite.

**M6 — Demo polish.** Cold-start model download progress (the first thing any visitor sees),
no-WebGPU messaging, microphone-denial states, README with architecture diagram and an
explicit limitations section.

## Out of scope

- **Multilingual support.** English only.
- **Pronunciation scoring or grading.** Tempting and dishonest: we would be measuring
  divergence from one dialect's dictionary, not correctness. The application describes, it
  does not grade. This is both defensible and a better interview answer.
