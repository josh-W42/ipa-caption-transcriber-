import { AutoModelForCTC, AutoProcessor } from '@huggingface/transformers';
import { report, progress } from './ui';

/**
 * The quantization sweep produced inconsistent inference times for the same dtype
 * (q4f16 measured 1.01s in the gate probe, 3.80s in the sweep). Single-run numbers
 * are not good enough to pick a model on, so this re-measures properly: discard a
 * warmup run, then take the median of several.
 *
 * Models are already in Cache Storage at this point, so load time here reflects
 * warm-start, not download.
 */
const RUNS = 5;

export async function benchmark(model: string, audio: Float32Array) {
  report('BENCH', 'info', `${RUNS} runs per dtype (+1 discarded warmup), ${(audio.length / 16000).toFixed(2)}s audio`);

  for (const dtype of ['fp16', 'q4f16', 'q4', 'int8'] as const) {
    const onProgress = progress(`BENCH loading ${dtype}`);
    try {
      const t0 = performance.now();
      const processor: any = await AutoProcessor.from_pretrained(model);
      const net: any = await AutoModelForCTC.from_pretrained(model, {
        device: 'webgpu',
        dtype,
        progress_callback: onProgress,
      });
      const warmLoadS = (performance.now() - t0) / 1000;

      const inputs = await processor(audio);

      await net(inputs); // warmup — shader compilation, buffer allocation

      const times: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const t = performance.now();
        await net(inputs);
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      const median = times[Math.floor(RUNS / 2)] / 1000;
      const min = times[0] / 1000;
      const max = times[RUNS - 1] / 1000;
      const realtime = audio.length / 16000 / median;

      report(
        `BENCH ${dtype}`,
        'info',
        `warm load ${warmLoadS.toFixed(2)}s\n` +
          `infer median ${median.toFixed(3)}s (min ${min.toFixed(3)} / max ${max.toFixed(3)})\n` +
          `${realtime.toFixed(1)}x realtime`,
      );
    } catch (err) {
      report(`BENCH ${dtype}`, 'fail', `${err}`.split('\n')[0]);
    }
  }
}
