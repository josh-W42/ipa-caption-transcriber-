/**
 * Decode an audio file to 16kHz mono Float32Array — the format both Whisper and
 * the wav2vec2 phoneme model expect.
 *
 * Resampling is done by rendering through an OfflineAudioContext at the target
 * rate, which uses the browser's own resampler rather than a hand-rolled one.
 */
export async function decodeTo16kMono(url: string): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fixture not found at ${url} (HTTP ${res.status})`);
  }
  const bytes = await res.arrayBuffer();

  // Vite's dev server serves index.html for unknown paths, so a missing fixture
  // arrives as a 200 full of HTML. Check the RIFF magic rather than trusting the status.
  const magic = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)));
  if (magic !== 'RIFF') {
    throw new Error(`no WAV at ${url} — got ${bytes.byteLength} bytes starting "${magic}" (file is missing)`);
  }

  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } finally {
    await ctx.close();
  }

  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();

  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

export function describe(audio: Float32Array): { seconds: number; peak: number; rms: number } {
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < audio.length; i++) {
    const v = Math.abs(audio[i]);
    if (v > peak) peak = v;
    sumSq += audio[i] * audio[i];
  }
  return {
    seconds: audio.length / 16000,
    peak,
    rms: Math.sqrt(sumSq / audio.length),
  };
}
