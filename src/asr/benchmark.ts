import { AsrClient } from './client';
import { decodeTo16kMono } from '../audio/decode';
import { TARGET_SAMPLE_RATE } from '../audio/capture';

/**
 * Measure inference cost against window length and model size, so the interim
 * latency is tuned on evidence rather than on a guess.
 *
 * Method carried from the M0 quantisation sweep, where single-run timings were badly
 * misleading: discard a warmup run, then take the median of several. The first
 * inference on a freshly loaded model pays shader compilation and is not
 * representative of the steady state the live loop actually runs in.
 */
const MODELS = [
  { id: 'onnx-community/whisper-tiny.en', label: 'tiny.en' },
  { id: 'onnx-community/whisper-base.en', label: 'base.en' },
];

const WINDOWS = [2, 3, 5, 8];
const RUNS = 3;

export interface BenchRow {
  model: string;
  windowSeconds: number;
  medianSeconds: number;
  realtimeFactor: number;
  text: string;
}

export async function benchmarkAsr(log: (s: string) => void): Promise<BenchRow[]> {
  const sample = await decodeTo16kMono('/sample.wav');
  const rows: BenchRow[] = [];

  for (const model of MODELS) {
    const client = new AsrClient();
    try {
      const info = await client.load(model.id);
      log(`${model.label}: loaded on ${info.device} in ${info.loadSeconds.toFixed(1)}s`);

      for (const win of WINDOWS) {
        const n = Math.min(sample.length, win * TARGET_SAMPLE_RATE);
        const slice = () => sample.slice(sample.length - n);

        await client.transcribe(slice()); // warmup, discarded

        const times: number[] = [];
        let text = '';
        for (let i = 0; i < RUNS; i++) {
          const r = await client.transcribe(slice());
          times.push(r.seconds);
          text = r.text;
        }
        times.sort((a, b) => a - b);
        const median = times[Math.floor(RUNS / 2)];
        const actual = n / TARGET_SAMPLE_RATE;

        rows.push({
          model: model.label,
          windowSeconds: actual,
          medianSeconds: median,
          realtimeFactor: actual / median,
          text,
        });
        log(
          `  ${model.label} ${actual.toFixed(1)}s window -> ${median.toFixed(2)}s ` +
            `(${(actual / median).toFixed(1)}x realtime) "${text.slice(0, 60)}"`,
        );
      }
    } catch (err) {
      log(`${model.label}: FAILED ${err}`);
    } finally {
      client.dispose();
    }
  }

  return rows;
}
