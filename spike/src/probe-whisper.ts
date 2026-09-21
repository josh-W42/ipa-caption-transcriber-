import { pipeline } from '@huggingface/transformers';
import { report, progress } from './ui';

/**
 * R3 — does Whisper give us word-level timestamps in transformers.js?
 *
 * Word timestamps are what let M3 align each phone to the word that produced it.
 * Without them we fall back to chunk-level alignment, which is coarser but not fatal.
 */
export async function probeWhisper(audio: Float32Array) {
  const onProgress = progress('R3 loading whisper-base.en');

  let asr: any;
  const t0 = performance.now();
  try {
    asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', {
      device: 'webgpu',
      dtype: 'q8',
      progress_callback: onProgress,
    });
  } catch (err) {
    report('R3 load', 'fail', `WebGPU load failed: ${err}\nRetrying on WASM...`);
    try {
      asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', {
        dtype: 'q8',
        progress_callback: onProgress,
      });
      report('R3 load', 'info', 'Loaded on WASM fallback — record this, it changes the M1 budget.');
    } catch (err2) {
      report('R3 load', 'fail', String(err2));
      return null;
    }
  }

  report('R3 load', 'info', `loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // Try word-level first, then degrade. Some ONNX exports omit the cross-attentions
  // that word-level timestamp extraction requires.
  let out: any;
  let granularity: 'word' | 'segment' | 'none' = 'word';
  const t1 = performance.now();
  try {
    out = await asr(audio, { return_timestamps: 'word' });
  } catch (err) {
    report('R3 word timestamps', 'fail', `${err}`.split('\n')[0]);
    granularity = 'segment';
    try {
      out = await asr(audio, { return_timestamps: true });
    } catch (err2) {
      report('R3 segment timestamps', 'fail', `${err2}`.split('\n')[0]);
      granularity = 'none';
      out = await asr(audio);
    }
  }
  const inferS = ((performance.now() - t1) / 1000).toFixed(2);
  report('R3 granularity', granularity === 'none' ? 'fail' : 'info', `best available: ${granularity}`);

  const text: string = (out.text ?? '').trim();
  report('R3 transcribe', text ? 'pass' : 'fail', `${inferS}s\n${text || '(no text)'}`);

  const chunks: any[] = out.chunks ?? [];
  const timed = chunks.filter((c) => Array.isArray(c.timestamp) && c.timestamp[0] != null);

  report(
    `R3 ${granularity} timestamps`,
    timed.length > 0 ? 'pass' : 'fail',
    timed.length === 0
      ? 'No timestamps at all — M3 must derive word timing from CTC phone timings via the alignment.'
      : `${timed.length} ${granularity}(s) timed\n` +
        timed
          .slice(0, 10)
          .map((c) => `  ${c.text.trim().padEnd(12)} [${c.timestamp[0]} – ${c.timestamp[1]}]`)
          .join('\n'),
  );

  return { text, chunks: timed, inferSeconds: Number(inferS) };
}
