import { dropoutRatio, spectralCentroid, maxFrameRms, TARGET_SAMPLE_RATE } from './capture';
import { resampleTo16k } from './resample';

/**
 * Bisects "is the MediaStream broken?" from "is my Web Audio graph breaking it?".
 *
 * Three fixes aimed at the Web Audio path all failed, and the dropout pattern does
 * not align to 128-sample render quanta (gaps of 142-160 spaced 320 apart), which it
 * would if the graph were dropping quanta. So the graph may not be at fault at all.
 *
 * MediaRecorder takes a completely different route out of the same MediaStream — no
 * AudioContext, no worklet, no realtime resampling — and its output is decoded by
 * decodeAudioData, the path that has always produced clean audio from files.
 *
 *   MediaRecorder clean + worklet broken -> the fault is in the Web Audio graph
 *   both broken                          -> the fault is upstream: device, driver,
 *                                           or another application holding the mic
 */
export interface ProbeResult {
  path: string;
  seconds: number;
  /** Seconds of wall clock the recording covered. */
  expectedSeconds: number;
  dropouts: number;
  centroid: number;
  speechRms: number;
}

/**
 * Audio can be lost two ways, and a check for one is blind to the other.
 *
 * Web Audio holds duration constant and zero-fills gaps, so loss shows up as
 * dropouts. MediaRecorder simply does not encode the gaps, so the same loss shows up
 * as a SHORT recording with zero dropouts. Checking only dropouts called a recording
 * that had lost a third of its duration "clean".
 */
export function verdict(r: ProbeResult): { healthy: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const shortfall = 1 - r.seconds / r.expectedSeconds;
  if (r.dropouts >= 0.05) reasons.push(`${(r.dropouts * 100).toFixed(1)}% zero-filled`);
  if (shortfall >= 0.1) reasons.push(`${(shortfall * 100).toFixed(1)}% of duration missing`);
  if (r.centroid >= 1500) reasons.push(`centroid ${r.centroid.toFixed(0)}Hz (speech is ~800Hz)`);
  return { healthy: reasons.length === 0, reasons };
}

const summarise = (path: string, audio: Float32Array, expectedSeconds: number): ProbeResult => ({
  path,
  seconds: audio.length / TARGET_SAMPLE_RATE,
  expectedSeconds,
  dropouts: dropoutRatio(audio),
  centroid: spectralCentroid(audio),
  speechRms: maxFrameRms(audio),
});

/** Record via MediaRecorder, then decode with the known-good file path. */
export async function probeMediaRecorder(
  seconds: number,
  log: (s: string) => void,
): Promise<ProbeResult | null> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  try {
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const done = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });

    rec.start();
    log(`MediaRecorder started (${rec.mimeType}) — speak for ${seconds}s`);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    rec.stop();
    await done;

    const blob = new Blob(chunks, { type: rec.mimeType });
    log(`MediaRecorder produced ${(blob.size / 1024).toFixed(0)}KB`);

    // Decode exactly as the file path does — this route has never been affected.
    const ctx = new AudioContext();
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    } finally {
      await ctx.close();
    }

    const mono = decoded.getChannelData(0);
    const at16k = await resampleTo16k(new Float32Array(mono), decoded.sampleRate);
    return summarise('MediaRecorder', at16k, seconds);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function formatProbe(r: ProbeResult): string {
  const v = verdict(r);
  return (
    `${r.path}: got ${r.seconds.toFixed(2)}s of ${r.expectedSeconds.toFixed(2)}s ` +
    `dropouts=${(r.dropouts * 100).toFixed(1)}% centroid=${r.centroid.toFixed(0)}Hz ` +
    `speechRms=${r.speechRms.toFixed(4)}
  -> ${v.healthy ? 'HEALTHY' : `BROKEN: ${v.reasons.join('; ')}`}`
  );
}
