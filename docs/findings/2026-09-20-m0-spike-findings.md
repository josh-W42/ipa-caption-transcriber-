# M0 Spike Findings

**Date:** 2026-09-20
**Environment:** Claude desktop Browser pane (Chromium), Windows 11, NVIDIA Ampere GPU,
16 logical cores
**transformers.js:** `@huggingface/transformers` 4.3.0
**Fixture:** 8.14 s, mono, recorded at 44.1 kHz and resampled to 16 kHz
— *"I bought a little butter and some water at the city market on Saturday."*

## Verdict

**GO.** The phonetic track is viable. The model emits correct narrow IPA with accurate
20 ms frame timings, at ~114x realtime after warmup, from a 197 MB download.

The approved design survives intact. Two simplifications and one implementation change
fall out of the findings, detailed below.

---

## R1 — Phoneme model: PASS (via a different path than planned)

### The pipeline path fails, and it is not the model's fault

`pipeline('automatic-speech-recognition', model)` fails on **both** candidate repos:

```
ModelFileNotFoundError: Could not locate file:
  ".../wav2vec2-lv-60-espeak-cv-ft-ONNX/resolve/main/tokenizer.json"
```

The weights download to 100% first — this is a tokenizer-loading failure, not a model
failure. These repos ship `vocab.json` + `tokenizer_config.json` with
`tokenizer_class: Wav2Vec2PhonemeCTCTokenizer`; `tokenizer.json` returns **404**.
transformers.js's `AutoTokenizer` wants the fast-tokenizer file and gives up.

### The fix is the implementation we wanted anyway

Bypass the tokenizer: `AutoModelForCTC.from_pretrained()` + `AutoProcessor`, then greedy
CTC decode the logits against `vocab.json` directly — argmax per frame, collapse repeats,
drop the blank.

This is strictly better than the pipeline path, because it also yields **per-frame
timings**, which the pipeline's text output discards and which M3, M4 and M5 all require.
The workaround is not a compromise; it is the design.

- Logits shape: `[1, 406, 392]` for 8.14 s → **20.0 ms/frame**
- Blank token is `<pad>` at **id 0** (computed via `indexOf`, not hardcoded — worth
  keeping, since the id is not guaranteed stable across repos)
- Vocab is 392 symbols of literal IPA, confirmed at runtime

### Output

```
aɪbɑːtɐlɪɾəlbʌɾɚændsʌmwɑːɾɚætðəsɪɾimɑːɹkɪtɔnsæɾɚdeɪ
```

Segmented against the prompt:

| word | phonetic | note |
| --- | --- | --- |
| I | `aɪ` | |
| bought | `bɑːt` | |
| a | `ɐ` | reduced |
| li**tt**le | `lɪ**ɾ**əl` | **flap** |
| bu**tt**er | `bʌ**ɾ**ɚ` | **flap** |
| and | `ænd` | |
| some | `sʌm` | |
| wa**t**er | `wɑː**ɾ**ɚ` | **flap** |
| a**t** | `æ**t**` | *not* flapped — word-final |
| the | `ðə` | reduced |
| ci**t**y | `sɪ**ɾ**i` | **flap** |
| marke**t** | `mɑːɹkɪ**t**` | *not* flapped — word-final |
| on | `ɔn` | |
| Sa**t**urday | `sæ**ɾ**ɚdeɪ` | **flap** |

Five flaps, all in genuine intervocalic environments, with word-final `/t/` correctly
left unflapped in *at* and *market*. This is a linguistically correct narrow
transcription, not a coincidental string match — **the core premise of the project is
empirically proven.**

---

## Quantization: q4f16 wins outright

### Single-run numbers were misleading

The first sweep produced inference times of 0.35 s (fp16), 3.80 s (q4f16) and 17.22 s
(int8), which suggested fp16 was 10x faster and worth its 632 MB. **That was almost
entirely warmup** — shader compilation and buffer allocation on first inference.

Re-measured with a discarded warmup run and the median of 5:

| dtype | download | warm load | infer (median of 5) | realtime | drift vs fp16 |
| --- | ---: | ---: | ---: | ---: | ---: |
| fp16 | 632 MB | 32.70 s | 0.068 s | 120x | — (reference) |
| **q4f16** | **197 MB** | **0.43 s** | **0.071 s** | **114x** | 3 (5.8%) |
| q4 | 242 MB | 0.42 s | 0.086 s | 95x | 3 (5.8%) |
| int8 | 318 MB | 13.07 s | 15.012 s | 0.5x | 2 (3.8%) |

**Decision: q4f16.** It is the smallest download, its steady-state inference is
statistically tied with fp16 (0.071 vs 0.068 s), and its warm load is **76x faster**
(0.43 s vs 32.70 s) because there is a third of the data to move onto the GPU. fp16's
only advantage is marginal, and costs 3.2x the download plus a half-minute warm load.

**int8 is excluded.** It is genuinely slow — 15 s, below realtime — and this is not a
warmup artifact. ONNX Runtime's WebGPU backend appears to have no fast int8 path and
pays dequantization cost per operation. Larger than q4 *and* 200x slower.

### What the drift actually is

All four quantizations produce **44 phones** and preserve **all five flaps**. The entire
drift is vowel quality on one axis:

- *water*: `wɔːɾɚ` (fp16, int8) vs `wɑːɾɚ` (q4, q4f16)
- *on*: `ɑːn` (fp16) vs `ɔn` (everything else)

That is the `ɑː`/`ɔː` contrast — the cot/caught merger, which is merged in much of North
American English. fp16 is not obviously "right" here; it is a coin flip on a contrast the
speaker may not make. **A 5.8% edit distance concentrated entirely on a merged vowel pair
is not a reason to triple the download.**

### Implication for M1

First inference after load costs 0.3–3.8 s depending on dtype. **Run a throwaway warmup
inference during model load**, so the first real utterance is not the slow one.

---

## R3 — Whisper timestamps: word-level NOT available

```
Error: Model outputs must contain cross attentions to extract timestamps.
This is most likely because the model was not exported with `output_attentions=True`.
```

`onnx-community/whisper-base.en` does not ship the cross-attentions that word-level
timestamp extraction requires. Segment-level works but is useless at this granularity —
the entire 8.14 s utterance came back as **one segment**, timed `[0 – 6]` (itself wrong
by 2 s).

Transcription quality was perfect: *"I bought a little butter and some water at the city
market on Saturday."* — exact. Load 1.0 s warm, inference 8.66 s (not benchmarked
properly; treat as indicative only).

**This does not matter, and the design gets simpler because of it.** The CTC model
already gives 20 ms frame timings for every phone. Since M3 aligns the phonemic string
(derived from Whisper's words) against the phonetic string (which carries timings), word
timing falls out of the alignment for free — and at 20 ms resolution rather than
Whisper's coarse segments.

**Design change:** drop the word-timestamp requirement from Whisper entirely. Use it for
words only; take all timing from CTC.

---

## R4 — Cross-origin isolation: NOT needed

```
crossOriginIsolated   false
SharedArrayBuffer     NOT available
WebGPU                PASS — nvidia / ampere / shader-f16: yes / maxBuffer 2147 MB
hardwareConcurrency   16 cores
```

Every probe above passed at 114x realtime **without** cross-origin isolation, on the
WebGPU path. Multithreaded WASM is not needed.

**Design change: remove COOP/COEP from the design entirely.** This deletes the
`firebase.json` headers block, removes the risk that Firebase overrides them, and means
`SharedArrayBuffer` is not part of the architecture. Worker communication uses
transferable `ArrayBuffer`s over `postMessage`.

`shader-f16: yes` confirms q4f16 is usable on this hardware. Machines without it would
need q4 (242 MB, 95x realtime) — still fine. **M1 should detect `shader-f16` and pick
dtype accordingly.**

---

## R2 — COEP vs. HF CDN: N/A

Moot. R4 removed the need for isolation, so there is no `require-corp` to conflict with
cross-origin model fetches. **Task 7 of the M0 plan is cancelled.**

---

## Bandwidth

Model weights stream from the Hugging Face CDN and land in browser Cache Storage, as
designed — confirmed in the Network tab. Firebase never serves them.

**But:** ONNX Runtime's WASM binary bundles into `dist/` at **26.8 MB** (6.7 MB gzipped)
and *is* self-hosted. Against Firebase's 10 GB/month free transfer that is roughly 1,500
cold visits — fine for a portfolio piece, but not the "effectively unlimited" the design
claimed.

Since R4 says threads are unnecessary, the single-threaded ORT build should be smaller.
**M1 should check whether the threaded asyncify build can be excluded from the bundle.**

---

## Performance budget for M1

| quantity | measured |
| --- | --- |
| Cold download (phoneme q4f16 + whisper-base.en q8 + app) | ~250 MB |
| Warm load, phoneme model to GPU | 0.43 s |
| Phoneme inference, 8.14 s audio | 0.071 s median (114x realtime) |
| First inference after load (warmup) | 0.3–3.8 s — mitigate with a warmup pass |
| Frame resolution | 20.0 ms |

**Live captioning is comfortably feasible.** At 114x realtime, a 2 s sliding window costs
roughly 18 ms of GPU time per step, leaving ample headroom for Whisper, the DSP worker,
and rendering.

---

## Additional finding: multi-character vocab tokens

The vocab contains entries that are single CTC tokens but multiple IPA segments — `aɪ`,
`iː`, `ɑː`, `əl`, `oʊ`, `aʊ`. The decoder emitted `əl` as one unit with one timestamp
pair.

**M3 must not assume one token equals one phone.** The distinctive-feature table needs
entries for these units, or a splitting step before alignment. Diphthongs and length
marks are the common cases; `əl` (syllabic l) is the one to watch.

---

## Design changes required

1. **Remove COOP/COEP and `SharedArrayBuffer`** from the architecture (R4). Workers use
   transferable `ArrayBuffer`s.
2. **Drop the Whisper word-timestamp requirement** (R3). All timing comes from CTC frames;
   word timing is derived through the M3 alignment.
3. **Use `AutoModelForCTC` + hand-rolled greedy CTC decode**, not `pipeline()` (R1). Not a
   workaround — it is the only path that yields the frame timings the design depends on.
4. **Pin q4f16**, with q4 as the fallback when `shader-f16` is absent. Exclude int8.
5. **Add a warmup inference** at model load.
6. **Handle multi-character vocab tokens** in the feature table and alignment.

Items 1–3 make the design simpler than approved. None contradict it.

## Cancelled

- **M0 Task 7** (Firebase COOP/COEP deploy probe) — moot per R4.

## Not yet verified

- Microphone capture and the AudioWorklet path — M0 used a file fixture throughout.
- Streaming/chunked inference. All measurements are on a complete 8.14 s buffer; chunk
  boundary behaviour is unmeasured.
- Behaviour on hardware without `shader-f16`, and on the WASM fallback path.
- The fixture is quiet (peak 0.151, RMS 0.0156) and was still transcribed correctly, but
  no quiet/noisy robustness testing was done.
