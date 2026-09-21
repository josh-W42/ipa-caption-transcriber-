import { report } from './ui';
import { decodeTo16kMono, describe } from './audio';
import { probeIsolation } from './probe-isolation';
import { probeWhisper } from './probe-whisper';
import { probePhoneme, sweepQuantization } from './probe-phoneme';

const FIXTURE = '/fixture.wav';

// Task 5 downloads >1GB across four quantizations. Opt in explicitly via ?sweep
const RUN_SWEEP = new URLSearchParams(location.search).has('sweep');

async function main() {
  report('M0 spike', 'info', `transformers.js probes · ${new Date().toISOString()}`);

  // R4 first — needs no fixture, and its answer determines whether R2 matters at all.
  await probeIsolation();

  // Everything below needs the audio fixture.
  let audio: Float32Array;
  try {
    audio = await decodeTo16kMono(FIXTURE);
  } catch (err) {
    report(
      'P0 fixture',
      'blocked',
      `${err}\n\n` +
        'Record ~8-12s of 16-bit WAV saying:\n' +
        '  "I bought a little butter and some water at the city market on Saturday."\n' +
        `Save to spike/public${FIXTURE} and reload.\n\n` +
        'Every /t/ there is between vowels, so the phonetic track should show [ɾ] where\n' +
        'the phonemic track shows /t/ — that contrast is what R1 verifies.',
    );
    return;
  }

  const { seconds, peak, rms } = describe(audio);
  const ok = seconds > 1 && peak > 0.01;
  report(
    'P0 fixture',
    ok ? 'pass' : 'fail',
    `${audio.length} samples · ${seconds.toFixed(2)}s · peak ${peak.toFixed(3)} · rms ${rms.toFixed(4)}` +
      (ok ? '' : '\nRecording appears silent or too short — re-record before continuing.'),
  );
  if (!ok) return;

  // R3 — Whisper and word-level timestamps.
  await probeWhisper(audio);

  // R1 — the gate.
  const phoneme = await probePhoneme(audio);

  if (phoneme && RUN_SWEEP) {
    await sweepQuantization(audio, phoneme.model);
  } else if (phoneme) {
    report(
      'R1 quant sweep',
      'info',
      'Skipped. Append ?sweep to the URL to measure quantization drift (downloads >1GB).',
    );
  }

  report('M0 spike', 'info', 'Probes complete. Record results in docs/findings/.');
}

main().catch((err) => report('M0 spike', 'fail', `Unhandled: ${err?.stack ?? err}`));
