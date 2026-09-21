import { TARGET_SAMPLE_RATE } from './capture';

/**
 * Resample arbitrary-rate mono audio to 16kHz using the browser's own resampler.
 *
 * Why this exists: opening an AudioContext at 16kHz while the microphone runs at
 * 48kHz makes Chrome resample a live MediaStream in the audio thread, and it starves
 * — roughly every other 128-sample render quantum arrives zero-filled, dropping ~30%
 * of the audio in ~8ms fragments. Loudness statistics stay healthy, but the result is
 * unintelligible.
 *
 * Capturing at the device's native rate avoids that path entirely, and
 * OfflineAudioContext then does the rate conversion offline, where it has no realtime
 * deadline to miss. This is the same conversion the file path uses, which was never
 * affected by the bug.
 */
export async function resampleTo16k(
  samples: Float32Array,
  fromRate: number,
): Promise<Float32Array> {
  if (fromRate === TARGET_SAMPLE_RATE) return samples;
  if (samples.length === 0) return samples;

  const targetLength = Math.max(1, Math.round((samples.length * TARGET_SAMPLE_RATE) / fromRate));
  const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);

  const src = offline.createBufferSource();
  const buf = offline.createBuffer(1, samples.length, fromRate);
  // copyToChannel's typing requires a plain ArrayBuffer-backed view.
  buf.copyToChannel(new Float32Array(samples), 0);
  src.buffer = buf;
  src.connect(offline.destination);
  src.start();

  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
