# Live IPA Captions

Speech to English orthography, canonical `/phonemic/` IPA, and actual `[phonetic]` IPA —
running entirely in the browser, with linguistic analysis of the divergence between the
last two.

No audio leaves your machine. There is no server.

**Status: M3 complete.** Three caption rows — English, the dictionary's `/phonemic/`
IPA, and the `[phonetic]` IPA of what was actually said — with the divergences between
the last two marked inline. Analysis of those divergences arrives in M4.

## Why two transcription tracks

The phonemic track is what the dictionary says a word *should* sound like. The phonetic
track is what you actually said. The gap between them is the interesting part — it is
where accent, vowel reduction, and connected-speech processes live.

On the M0 test recording — *"I bought a little butter and some water at the city market
on Saturday"* — the phonetic model returned:

```
aɪbɑːtɐlɪɾəlbʌɾɚændsʌmwɑːɾɚætðəsɪɾimɑːɹkɪtɔnsæɾɚdeɪ
```

Five instances of `/t/` surfaced as the flap `[ɾ]` — in *little, butter, water, city,
Saturday* — while the `/t/` in *at* and *market* did not, because those are word-final
rather than intervocalic. That distinction is the whole premise of the project, and it
is what the analysis layer measures.

## Architecture

```
mic -> AudioWorklet (16kHz mono) -> ring buffer
         |
         +--> ASR worker      : Whisper           -> words          [M1]
         |      + CMUdict lexicon -> /phonemic/ IPA                  [M2]
         +--> Phoneme worker  : wav2vec2 CTC      -> phones + timings [M3]
         |      + feature-weighted alignment -> divergences            [M3]
         +--> DSP worker      : LPC formants, YIN pitch              [M5]
                                       |
                              alignment + analysis
                                       |
                                  React UI
```

Captions stream while you speak from a 5-second trailing window; on stop the whole
recording is re-transcribed in one pass, which is more accurate because the model sees
full context rather than a keyhole.

## Running it

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

Tests run in headless Chromium via Vitest browser mode — Web Audio and WebGPU do not
exist in jsdom, so a real browser is not optional here.

## The phonemic track, and what it is not

The IPA under each word is the **dictionary's** pronunciation, in General American. It
is not yours. That is the entire point: M3 adds what was actually said, and M4 measures
the gap between them.

Specifically:

- **One pronunciation per word.** CMUdict lists alternates; this shows the first.
- **General American.** Speakers of other varieties will see a reference that does not
  match them, which is a limitation to state rather than to paper over.
- **Out-of-vocabulary words show `—`, never a guess.** A synthesised pronunciation would
  be indistinguishable from a real entry and would silently corrupt every divergence
  measurement made against this track.
- **The `/slashes/` are notation.** They mark a phonemic transcription; M3's phonetic
  line uses `[square brackets]`.

Pronunciation data from [CMUdict](https://github.com/cmusphinx/cmudict), Copyright (C)
1993-2015 Carnegie Mellon University, redistributed under its BSD-style licence — see
[`public/LEXICON-LICENSE.txt`](public/LEXICON-LICENSE.txt). The lexicon ships as 126,052
entries, 0.87 MB gzipped.

## The alignment, and what it is not

The two rows are compared with Needleman-Wunsch whose substitution cost is the distance
between **distinctive feature vectors**, not plain edit distance. Plain edit distance
would score /t/ → [ɾ] exactly as badly as /t/ → [i], so an ordinary flapped "butter"
would look as divergent as noise.

On the fixture sentence that yields 36 matches, 10 substitutions and zero insertions or
deletions. Every substitution is a real phenomenon: five flaps, the cot/caught merger
firing in both directions (`water` → [wɑɾɚ], `on` → [ɔn]), an unreduced "and", and the
Saturd-**ay** against Saturd-**ee** variant.

Caveats worth stating:

- **The feature table is hand-authored.** It encodes one analyst's judgements, not a
  learned or corpus-derived metric.
- **The phonetic model is multilingual espeak**, not English-specific, so it can emit
  symbols outside the General American inventory.
- **The two tracks are normalised into a shared inventory first.** They do not share an
  IPA convention: espeak writes length marks and `ɐ` where CMUdict writes `ə`, and only
  the phonemic side carries stress marks. Those are stripped as notation. The flap and
  the vowel differences are preserved, because they are the finding. That line is drawn
  in `src/align/normalise.ts` and is tested, so nobody later mistakes it for hiding
  divergences.
- **Still describing, not grading.**

## Notable engineering decisions

**The phoneme model is loaded with `AutoModelForCTC`, not `pipeline()`.** The ONNX repos
ship `vocab.json` + `Wav2Vec2PhonemeCTCTokenizer` but no `tokenizer.json`, which
`AutoTokenizer` requires. Decoding CTC logits directly is necessary anyway: it is the only
path that yields the 20 ms frame timings the analysis layer depends on.

**q4f16 (197 MB) over fp16 (632 MB).** Single-run benchmarks suggested fp16 was 10x
faster. Re-measuring with a discarded warmup and median of five showed that gap was almost
entirely shader compilation — steady state they are tied (0.071 s vs 0.068 s), while
q4f16 loads 76x faster warm. The accuracy difference is 5.8% edit distance concentrated
entirely on the `ɑː`/`ɔː` contrast, which is merged for many North American speakers.

**Two Whisper models, not one.** Benchmarked on real hardware at a 5s window, median of
three with the warmup discarded: tiny.en runs 1.20s for 40.8MB, base.en runs 2.54s for
76.9MB. So tiny.en drives the live pass and base.en the refined pass on stop — which is
what "live rough, refined on stop" always implied, and which a single model never
delivered. tiny.en loads first, so captions start after ~41MB instead of ~77MB.

**The interim window stays at 5 seconds.** Shorter is faster but truncates mid-phrase:
at 2-3s a full sentence degrades to "Saturday." Latency was bought with a smaller model
instead.

**Stress marks are placed by syllable, not by vowel.** IPA puts the mark before the
syllable, and CMUdict provides no syllable boundaries, so the app syllabifies by maximum
onset constrained to clusters English actually permits — "secret" is si.kɹət because
/kɹ/ is a legal onset, "napkin" is næp.kɪn because /pk/ is not.

**The ASR and phoneme models run sequentially, not concurrently.** `Promise.all` looked
like the obvious optimisation and cost an order of magnitude: 24.68s for the ASR pass
against 2.74s when awaited in turn, because both workers contend for a single GPU. Run
sequentially the phonetic pass costs 0.12s for 8s of audio.

**No cross-origin isolation.** WebGPU does not require it, so there are no COOP/COEP
headers and no `SharedArrayBuffer`. Workers exchange transferable `ArrayBuffer`s.

**ONNX Runtime's WASM binary stays bundled** rather than served from a CDN. It is on the
critical path for WebGPU too — the WebGPU execution provider runs through the JSEP WASM
build — so offloading it would make the whole app depend on a third party's uptime.

## Limitations

- English only. The lexicon, reference formants, and corpus baselines are language-specific.
- **It describes; it does not grade.** Scoring pronunciation would mean measuring
  divergence from one dialect's dictionary and calling it correctness.
- Requires WebGPU for good performance; falls back to WASM, much more slowly.
- First load downloads ~41 MB before captions start, then ~77 MB for the refined pass
  and ~197 MB for the phoneme model, both in the background. Until the phoneme model
  arrives the app shows two rows rather than three.
- Audio capture depends on a working microphone, which is less of a given than it
  sounds. The **Diagnose microphone** button records through a second, independent path
  and reports whether the device itself is dropping audio.

## Documents

- [Design](docs/plans/2026-09-20-ipa-captions-design.md)
- [M0 spike findings](docs/findings/2026-09-20-m0-spike-findings.md)
- [M1 plan](docs/plans/2026-09-20-m1-live-captions.md)
- [M2 plan](docs/plans/2026-09-21-m2-phonemic-track.md)
- [M3 plan](docs/plans/2026-09-21-m3-phonetic-track.md)
