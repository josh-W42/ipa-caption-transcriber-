# Live IPA Captions

Speech to English orthography, canonical `/phonemic/` IPA, and actual `[phonetic]` IPA —
running entirely in the browser, with linguistic analysis of the divergence between the
last two.

No audio leaves your machine. There is no server.

**Status: M1 complete.** English captions work end to end. IPA arrives in M2 and M3.

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
         +--> Phoneme worker  : wav2vec2 CTC      -> phones + timings [M3]
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
- First load downloads ~250 MB of model weights, then caches.

## Documents

- [Design](docs/plans/2026-09-20-ipa-captions-design.md)
- [M0 spike findings](docs/findings/2026-09-20-m0-spike-findings.md)
- [M1 plan](docs/plans/2026-09-20-m1-live-captions.md)
