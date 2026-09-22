# M6 — Demo Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the app survive first contact with a stranger on unknown hardware, and
ship it to a URL.

**Architecture:** No new analysis. Everything here is about the paths a first-time
visitor takes that a developer with warm caches never sees.

**Tech Stack:** The existing app, plus Firebase Hosting.

---

## What this milestone is actually for

Every milestone so far was tested by someone who already had three models cached, a
working microphone, a WebGPU-capable GPU, and knowledge of what the buttons do. **A
recruiter opening the link has none of those.**

They arrive to a blank page that will download ~315 MB before anything happens. That
first minute is the entire impression, and right now it is unhandled.

The M1 bug is the precedent: the live-mic failure turned out to be the machine's
microphone, and the app gave no indication of that. Strangers will hit the same class of
problem with no way to tell whether the app is broken or their hardware is.

---

## Task 1: Cold-start experience

**Files:**
- Modify: `src/App.tsx`, `src/session/useSession.ts`

Three models load in sequence: tiny.en (41 MB), base.en (77 MB), the phoneme model
(197 MB). Right now the progress bar reports only whichever is in front, and the app
looks idle while 197 MB downloads in the background.

Required:

- **A staged indicator** naming what is loading and what it unlocks — "captions ready",
  "phonetic analysis in 197 MB". A visitor who knows the app is already usable will wait;
  one watching an unexplained bar will not.
- **Total bytes, not just percent of the current file.** "43% of model 2 of 3" is
  meaningless; "68 MB of 315 MB" is not.
- **The app is usable as soon as tiny.en lands.** Make that visible rather than leaving
  the Start button looking equally dead throughout.
- **Cached state says so.** A returning visitor should not see a download bar at all.

---

## Task 2: Hardware and permission states

**Files:**
- Modify: `src/App.tsx`, `src/audio/capture.ts`

Each of these is reachable by a first-time visitor and currently unhandled or terse:

| state | requirement |
| --- | --- |
| No WebGPU | Say so, say it will be slow, continue on WASM. Do not fail silently. |
| Microphone denied | Explain, and point at the sample audio, which needs no mic. |
| No microphone present | Same. |
| Microphone broken | **Point at "Diagnose microphone".** This happened during M1 and cost a long debugging session; a stranger has no such recourse. |
| Everything cached | No loading UI at all. |

The mic diagnostic already exists and already bisects device faults from code faults. M6
is about surfacing it to someone who does not know it is there.

---

## Task 3: First-run guidance

**Files:**
- Modify: `src/App.tsx`

The app currently opens with nine controls and no explanation of what it does or what to
try. A visitor should not have to infer the premise.

- **A one-line statement of what the three caption rows mean**, visible before any audio
  has been processed rather than buried in the footer.
- **The sample-audio button as the obvious first action**, since it needs no microphone
  and no permission prompt and demonstrates the whole pipeline.
- **Move the developer controls** — Diagnose microphone, Benchmark ASR, the capture
  config selector — behind a "developer tools" disclosure. They are genuinely useful and
  they make the primary interface look like a debug console.

---

## Task 4: Deploy

**Files:**
- Modify: `firebase.json`, `.firebaserc`

```bash
npx firebase-tools login
```

```bash
npm run build && npx firebase-tools hosting:channel:deploy m6 --expires 7d
```

Verify on the preview URL **with a cold cache**, which is the only test that matters
here: open a private window, watch the whole first-run sequence, and confirm the staged
loading actually reads sensibly rather than just not crashing.

Then promote:

```bash
npx firebase-tools deploy --only hosting
```

**Check after deploying:** `firebase.json` sets immutable caching on hashed assets and
`no-cache` on `index.html`. Confirm both landed — M0 found Firebase overrides
`Strict-Transport-Security` on default subdomains, so header behaviour is worth
verifying rather than assuming.

---

## Task 5: README architecture diagram and final pass

**Files:**
- Modify: `README.md`

The README carries the engineering story; it needs the diagram the design promised and a
statement of what the project is for.

Also: the live URL, at the top, where someone deciding whether to read further will see
it.

---

## Exit criteria

1. A cold first run explains what is downloading, how much remains, and what already works
2. No-WebGPU, mic-denied, no-mic and broken-mic states each say something useful
3. A returning visitor with warm caches sees no loading UI
4. Developer controls are behind a disclosure
5. The app is live on a URL, verified in a private window
6. All 266 tests still pass

**Explicitly not in M6:** new analysis, new models, live phonetic captions. The
temptation at the end of a project is to add one more feature instead of making the
existing ones survive a stranger. Everything here serves the first sixty seconds.
