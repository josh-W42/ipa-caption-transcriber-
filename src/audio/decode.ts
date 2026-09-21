import { TARGET_SAMPLE_RATE } from './capture';

/**
 * Decode an audio file to 16kHz mono Float32 — the same format the microphone path
 * produces, so sample audio and live audio cannot diverge downstream.
 *
 * Resampling goes through an OfflineAudioContext at the target rate, using the
 * browser's own resampler rather than a hand-rolled one.
 */
export async function decodeTo16kMono(url: string): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`audio not found at ${url} (HTTP ${res.status})`);
  }
  const bytes = await res.arrayBuffer();

  // Vite's dev server serves index.html for unknown paths, so a missing file arrives
  // as a 200 full of HTML and fails confusingly inside decodeAudioData. Check the
  // RIFF magic instead of trusting the status. (Carried from the M0 spike.)
  const magic = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)));
  if (magic !== 'RIFF') {
    throw new Error(
      `no WAV at ${url} — got ${bytes.byteLength} bytes starting "${magic}" (file likely missing)`,
    );
  }

  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } finally {
    await ctx.close();
  }

  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * TARGET_SAMPLE_RATE),
    TARGET_SAMPLE_RATE,
  );
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();

  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
