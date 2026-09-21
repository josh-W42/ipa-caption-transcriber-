# M1 — Live Captions (Words Only) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Microphone in, live English captions out, deployed to Firebase — with no IPA
yet. Prove the hard real-time plumbing on its own before layering phonetics on top.

**Architecture:** An AudioWorklet captures at 16 kHz into a ring buffer. A worker runs
Whisper over a trailing window every ~1.5 s for interim captions, then re-transcribes the
complete recording once on stop for the final text. Pure logic (ring buffer, stitching,
energy gating) is unit-tested; model and audio glue is verified in a real browser.

**Tech Stack:** React + Vite + TypeScript, `@huggingface/transformers` 4.3.0, Web Audio
AudioWorklet, Vitest browser mode (Playwright), Firebase Hosting.

---

## What M0 already settled

Read [`docs/findings/2026-09-20-m0-spike-findings.md`](../findings/2026-09-20-m0-spike-findings.md)
before starting. The load-bearing conclusions:

- **No COOP/COEP, no `SharedArrayBuffer`.** WebGPU needs no cross-origin isolation.
  Workers exchange transferable `ArrayBuffer`s.
- **Whisper here is `onnx-community/whisper-base.en`, dtype `q8`.** Word-level timestamps
  are unavailable (the export lacks cross-attentions). M1 does not need them.
- **Run a warmup inference at model load.** First inference costs 0.3–3.8 s; steady state
  is far lower. Without a warmup the first utterance is the slow one.
- **The spike is a reference, not a dependency.** `spike/src/probe-ctc.ts` holds working
  model-loading and CTC-decode code to port. `spike/` is deleted in Task 9, after the
  code has moved.
- Fixture for tests: `fixtures/flapping-8s.wav`.

M1 uses Whisper only. The phoneme model arrives in M3.

---

## Task 1: Scaffold the application

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`,
  `src/App.tsx`

**Step 1: Scaffold at the repo root**

```bash
npm create vite@latest . -- --template react-ts
```

**Step 2: Install runtime and test dependencies**

```bash
npm install @huggingface/transformers
```

```bash
npm install -D vitest @vitest/browser playwright
```

**Step 3: Configure Vitest browser mode**

Web Audio and WebGPU do not exist in jsdom, so tests run in a real browser. Create
`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
      headless: true,
    },
  },
});
```

**Step 4: Verify the harness runs**

```bash
npx playwright install chromium
```

```bash
npm run dev
```

Expected: default React page at http://localhost:5173 with no console errors.

**Step 5: Commit**

```bash
git add -A && git commit -m "Scaffold M1 application with Vitest browser mode"
```

---

## Task 2: Ring buffer

A fixed-capacity circular buffer of `Float32` samples. Pure logic, no browser APIs — the
easiest thing in the project to get subtly wrong, and the easiest to test.

**Files:**
- Create: `src/audio/ringBuffer.ts`, `src/audio/ringBuffer.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from './ringBuffer';

describe('RingBuffer', () => {
  it('reads back what was written', () => {
    const rb = new RingBuffer(10);
    rb.write(Float32Array.from([1, 2, 3]));
    expect(Array.from(rb.readLast(3))).toEqual([1, 2, 3]);
    expect(rb.length).toBe(3);
  });

  it('returns only what exists when asked for more than was written', () => {
    const rb = new RingBuffer(10);
    rb.write(Float32Array.from([1, 2]));
    expect(Array.from(rb.readLast(5))).toEqual([1, 2]);
  });

  it('overwrites oldest samples once capacity is exceeded', () => {
    const rb = new RingBuffer(4);
    rb.write(Float32Array.from([1, 2, 3, 4, 5, 6]));
    expect(rb.length).toBe(4);
    expect(Array.from(rb.readLast(4))).toEqual([3, 4, 5, 6]);
  });

  it('reads correctly across the wrap point', () => {
    const rb = new RingBuffer(5);
    rb.write(Float32Array.from([1, 2, 3]));
    rb.write(Float32Array.from([4, 5, 6, 7]));   // wraps
    expect(Array.from(rb.readLast(5))).toEqual([3, 4, 5, 6, 7]);
  });

  it('handles a single write larger than capacity', () => {
    const rb = new RingBuffer(3);
    rb.write(Float32Array.from([1, 2, 3, 4, 5]));
    expect(Array.from(rb.readLast(3))).toEqual([3, 4, 5]);
  });

  it('readAll returns everything in order', () => {
    const rb = new RingBuffer(100);
    rb.write(Float32Array.from([1, 2, 3]));
    rb.write(Float32Array.from([4, 5]));
    expect(Array.from(rb.readAll())).toEqual([1, 2, 3, 4, 5]);
  });
});
```

**Step 2: Run to verify they fail**

```bash
npx vitest run src/audio/ringBuffer.test.ts
```

Expected: FAIL — `RingBuffer` is not defined.

**Step 3: Implement**

```ts
/**
 * Fixed-capacity circular buffer of audio samples.
 *
 * Capacity bounds memory during long recordings. The full-recording pass on stop
 * reads from a separate growing buffer, not this one — this holds only the trailing
 * window the live pass needs.
 */
export class RingBuffer {
  private buf: Float32Array;
  private writeIdx = 0;
  private filled = 0;

  constructor(public readonly capacity: number) {
    this.buf = new Float32Array(capacity);
  }

  get length(): number {
    return this.filled;
  }

  write(samples: Float32Array): void {
    // A write larger than capacity: only the tail can survive.
    const src = samples.length > this.capacity
      ? samples.subarray(samples.length - this.capacity)
      : samples;

    const firstChunk = Math.min(src.length, this.capacity - this.writeIdx);
    this.buf.set(src.subarray(0, firstChunk), this.writeIdx);
    if (firstChunk < src.length) {
      this.buf.set(src.subarray(firstChunk), 0);
    }

    this.writeIdx = (this.writeIdx + src.length) % this.capacity;
    this.filled = Math.min(this.filled + src.length, this.capacity);
  }

  /** Most recent `n` samples in chronological order. */
  readLast(n: number): Float32Array {
    const count = Math.min(n, this.filled);
    const out = new Float32Array(count);
    const start = (this.writeIdx - count + this.capacity) % this.capacity;

    const firstChunk = Math.min(count, this.capacity - start);
    out.set(this.buf.subarray(start, start + firstChunk), 0);
    if (firstChunk < count) {
      out.set(this.buf.subarray(0, count - firstChunk), firstChunk);
    }
    return out;
  }

  readAll(): Float32Array {
    return this.readLast(this.filled);
  }

  clear(): void {
    this.writeIdx = 0;
    this.filled = 0;
  }
}
```

**Step 4: Run to verify they pass**

```bash
npx vitest run src/audio/ringBuffer.test.ts
```

Expected: 6 passed.

**Step 5: Commit**

```bash
git add src/audio && git commit -m "Add ring buffer for trailing audio window"
```

---

## Task 3: Microphone capture at 16 kHz

**Files:**
- Create: `src/audio/worklet-processor.ts`, `src/audio/capture.ts`

**Step 1: Verify the sample-rate shortcut before building on it**

Browsers can resample microphone input natively if the `AudioContext` is constructed at
the target rate, which would remove the need for a hand-rolled downsampler. Confirm this
actually holds before relying on it — add a temporary check in `App.tsx`:

```ts
const ctx = new AudioContext({ sampleRate: 16000 });
console.log('actual sampleRate:', ctx.sampleRate);
```

Expected: `16000`. **If it reports the hardware rate (typically 48000) instead, stop and
add a downsampling step in the worklet** — decimate by the integer ratio after a low-pass
filter. Record which happened; it is a portability finding worth keeping.

**Step 2: Write the worklet processor**

AudioWorklet runs on the audio render thread, so it must stay allocation-light. It only
forwards frames; all buffering happens on the main thread.

```ts
// src/audio/worklet-processor.ts — loaded via addModule(), not imported.
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      // Copy: the input buffer is reused by the audio thread after this returns.
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
```

**Step 3: Write the capture wrapper**

`src/audio/capture.ts` exposes `startCapture(onFrame)` returning a `stop()` function. It
must:

- Request the mic with `getUserMedia({ audio: { channelCount: 1, echoCancellation: true,
  noiseSuppression: true } })`
- Create `new AudioContext({ sampleRate: 16000 })`
- `await ctx.audioWorklet.addModule(...)` using Vite's `?url` import for the processor
- Connect source → worklet, forward `port.onmessage` frames to `onFrame`
- On stop: disconnect the node, stop every track on the stream, close the context

**Every one of those teardown steps matters** — a live `MediaStream` keeps the browser's
recording indicator on, which looks broken in a demo.

**Step 4: Verify manually**

Add a temporary button that starts capture and logs cumulative sample count. Speak for
five seconds. Expected: roughly 80,000 samples (5 × 16000), and the recording indicator
disappears when stopped.

**Step 5: Commit**

```bash
git add src/audio && git commit -m "Add microphone capture via AudioWorklet at 16kHz"
```

---

## Task 4: Sample-audio path

Pulled forward deliberately: it makes every later task testable without speaking, and
visitors in quiet offices will never use a microphone.

**Files:**
- Create: `src/audio/decode.ts`
- Copy: `fixtures/flapping-8s.wav` → `public/sample.wav`

**Step 1: Port the decoder from the spike**

`spike/src/audio.ts` has a working `decodeTo16kMono`. Port it, keeping the RIFF magic-byte
check — it exists because Vite's dev server serves `index.html` for missing paths, so a
missing fixture arrives as a 200 full of HTML and fails confusingly inside
`decodeAudioData`.

**Step 2: Feed the same pipeline as the mic**

The decoded `Float32Array` must enter through the identical path live audio uses, so the
two modes cannot diverge. Sample playback pushes into the same buffers the worklet feeds.

**Step 3: Commit**

```bash
git add src/audio public/sample.wav && git commit -m "Add sample-audio path sharing the live pipeline"
```

---

## Task 5: ASR worker

**Files:**
- Create: `src/asr/worker.ts`, `src/asr/client.ts`

**Step 1: Write the worker**

Port the model-loading pattern from `spike/src/probe-whisper.ts`. The worker handles three
messages — `load`, `transcribe`, `dispose` — and posts back `ready`, `progress`, `result`,
`error`.

Two requirements carried from M0:

```ts
// 1. Warm up at load, or the first real utterance pays 0.3-3.8s of shader compilation.
const silence = new Float32Array(16000);
await transcriber(silence);
postMessage({ type: 'ready' });
```

```ts
// 2. Do NOT pass return_timestamps: 'word' — this export lacks the cross-attentions
//    it requires and it throws. M0/R3.
const out = await transcriber(audio);
```

Report download progress through `progress_callback`; a 200 MB silent wait is the single
worst first impression this app can make.

**Step 2: Write the typed client**

`src/asr/client.ts` wraps the worker in a promise-based API: `load()`, `transcribe(audio)`,
`dispose()`. Transfer audio buffers rather than copying:

```ts
worker.postMessage({ type: 'transcribe', audio }, [audio.buffer]);
```

Note that transferring **neuters the source buffer** — the caller must not reuse it
afterwards. Pass a copy when the caller still needs the samples.

**Step 3: Verify**

Temporary button: load the sample, transcribe, log the text. Expected: *"I bought a little
butter and some water at the city market on Saturday."*

**Step 4: Commit**

```bash
git add src/asr && git commit -m "Add ASR worker with warmup and progress reporting"
```

---

## Task 6: Transcript stitcher

Overlapping windows produce overlapping text. Merging them is pure string logic and the
part most likely to produce visibly wrong output, so it gets thorough tests.

**Files:**
- Create: `src/transcript/stitch.ts`, `src/transcript/stitch.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { stitch } from './stitch';

describe('stitch', () => {
  it('returns the incoming text when there is nothing yet', () => {
    expect(stitch('', 'hello world')).toBe('hello world');
  });

  it('splices at the overlap between old tail and new head', () => {
    expect(stitch('I bought a little', 'a little butter and')).toBe('I bought a little butter and');
  });

  it('concatenates when there is no overlap', () => {
    expect(stitch('I bought', 'some water')).toBe('I bought some water');
  });

  it('ignores case and punctuation when matching the overlap', () => {
    expect(stitch('I bought a Little,', 'a little butter')).toBe('I bought a Little, butter');
  });

  it('drops the new text entirely when it is wholly contained', () => {
    expect(stitch('I bought a little butter', 'a little')).toBe('I bought a little butter');
  });

  it('prefers the longest overlap when a short one also matches', () => {
    expect(stitch('the cat sat on the mat', 'on the mat today')).toBe('the cat sat on the mat today');
  });
});
```

**Step 2: Run to verify they fail**

```bash
npx vitest run src/transcript/stitch.test.ts
```

**Step 3: Implement**

```ts
const normalize = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/**
 * Merge an incoming transcript window into the accumulated text by finding the
 * longest suffix of `prev` that matches a prefix of `next`, on normalized words.
 *
 * Longest-first matters: with "the cat sat on the mat" + "on the mat today", a
 * greedy short match on "the" would splice in the wrong place and duplicate words.
 */
export function stitch(prev: string, next: string): string {
  if (!prev.trim()) return next.trim();
  if (!next.trim()) return prev;

  const prevWords = prev.trim().split(/\s+/);
  const nextWords = next.trim().split(/\s+/);

  const maxOverlap = Math.min(prevWords.length, nextWords.length);
  for (let n = maxOverlap; n > 0; n--) {
    const tail = prevWords.slice(-n).map(normalize);
    const head = nextWords.slice(0, n).map(normalize);
    if (tail.every((w, i) => w === head[i])) {
      const remainder = nextWords.slice(n);
      return remainder.length ? `${prev.trim()} ${remainder.join(' ')}` : prev.trim();
    }
  }
  return `${prev.trim()} ${next.trim()}`;
}
```

**Step 4: Run to verify they pass**

```bash
npx vitest run src/transcript/stitch.test.ts
```

Expected: 6 passed.

**Step 5: Commit**

```bash
git add src/transcript && git commit -m "Add transcript stitcher for overlapping windows"
```

---

## Task 7: Live loop and refined pass

**Files:**
- Create: `src/session/useSession.ts`

**Step 1: Define the two passes**

The design calls for "live rough, refined on stop." Concretely:

- **Live:** every 1500 ms, take the trailing 5 s from the ring buffer, transcribe, and
  `stitch()` the result into the interim transcript. Rendered in a muted style to signal
  provisional.
- **Refined:** on stop, transcribe the entire recording in one pass and **replace** the
  interim text. Rendered in the normal style.

The refined pass is more accurate because Whisper sees the full context rather than a
5-second keyhole.

**Step 2: Guard against overlap**

Inference takes ~70–300 ms but the interval is 1500 ms, so overlap is unlikely — not
impossible. Keep an `inFlight` flag and **skip** a tick rather than queueing. A queue
under sustained load grows without bound and the captions fall progressively further
behind, which looks far worse than a dropped update.

**Step 3: Skip silence**

Compute RMS over the window and skip transcription below a threshold (start at 0.005;
M0's fixture measured 0.0156 RMS while quiet-but-audible, so do not set this aggressively).
This avoids Whisper hallucinating text from silence — a well-known failure mode.

**Step 4: Verify**

Record 20 seconds of continuous speech. Expected: captions appear within ~2 s and extend
without duplicated or dropped words at window boundaries; the final text on stop is
equal or better.

**Step 5: Commit**

```bash
git add src/session && git commit -m "Add live transcription loop with refined pass on stop"
```

---

## Task 8: UI and states

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/Captions.tsx`, `src/components/ModelLoader.tsx`

**Step 1: Build the states**

Every one of these is reachable by a first-time visitor, and a portfolio piece is judged
on the broken paths as much as the happy one:

| state | requirement |
| --- | --- |
| Model downloading | Percentage and MB. ~250 MB with no feedback reads as a hang. |
| No WebGPU | Say so plainly and continue on WASM; do not fail silently. |
| Mic permission denied | Explain, and point at the sample-audio button. |
| No mic hardware | Same. |
| Recording | Visible level meter — proves the app is hearing something. |
| Silence | Do not render an empty caption box; say "listening". |

**Step 2: Render interim vs final distinctly**

Interim text muted or italic, final text normal. The visible switch on stop is what makes
the two-pass design legible to someone watching a demo.

**Step 3: Commit**

```bash
git add src && git commit -m "Add caption UI with loading, permission, and fallback states"
```

---

## Task 9: Deploy, and retire the spike

**Files:**
- Create: `firebase.json`, `.firebaserc`
- Delete: `spike/`

**Step 1: Configure hosting**

**No COOP/COEP headers** — M0/R4 established they are unnecessary.

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [{
      "source": "**/*.@(js|css|wasm)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }]
  }
}
```

**Step 2: Check the ORT bundle size**

M0 found ONNX Runtime's threaded WASM binary bundles at 26.8 MB. Since R4 established
threads are unnecessary, check whether the single-threaded build can be substituted:

```bash
npm run build && ls -la dist/assets/*.wasm
```

Record the size before and after any change. If it cannot be swapped without breaking
inference, leave it and note why.

**Step 3: Deploy to a preview channel first**

```bash
npx firebase-tools hosting:channel:deploy m1 --expires 7d
```

Open the preview URL and confirm on a cold profile: the model downloads with visible
progress, the sample button works, and the mic prompt appears.

**Step 4: Promote to production**

```bash
npx firebase-tools deploy --only hosting
```

**Step 5: Retire the spike**

The CTC decode is now the only thing worth keeping, and M3 will port it from git history
or from the file directly. Remove the scaffold:

```bash
git rm -r spike && git commit -m "Retire M0 spike; live captions shipped"
```

---

## Exit criteria

1. Speaking into the microphone produces captions within ~2 s
2. Stopping replaces interim text with a more accurate full-recording pass
3. The sample-audio button works with no microphone at all
4. Model download shows progress; no-WebGPU and permission-denied states are handled
5. Ring buffer and stitcher tests pass in browser mode
6. The production URL works on a cold profile
7. `spike/` is gone

**Explicitly not in M1:** any IPA, the phoneme model, alignment, or analysis. If those
start creeping in, stop — they are M2 and M3, and M1's value is proving the real-time
plumbing in isolation.
