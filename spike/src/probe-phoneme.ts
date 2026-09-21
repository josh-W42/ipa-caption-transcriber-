import { pipeline } from '@huggingface/transformers';
import { report, progress } from './ui';

/**
 * R1 — THE GATE.
 *
 * Does a phoneme-level CTC model load and emit IPA in the browser?
 *
 * Prior research (2026-09-20) confirmed onnx-community ships a transformers.js-tagged
 * ONNX export of facebook/wav2vec2-lv-60-espeak-cv-ft whose vocab.json is 392 literal
 * IPA symbols — flap and rhotic schwa included. So the model should emit IPA directly,
 * with no ARPAbet conversion layer. This probe verifies that at runtime.
 *
 * If every candidate fails to load, the phonetic half of the design is not viable and
 * we fall back to phonemic-only plus rule-based allophony.
 */
const CANDIDATES = [
  'onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX', // primary — IPA vocab confirmed
  'onnx-community/wavlm-large-english-phoneme-ONNX', // fallback — English-specific
];

// Symbols that cannot appear in plain ASCII output — proof we got real IPA back.
const IPA_MARKERS = /[əɛɪʊʌæɹðθŋɾɚɜɔɑʃʒʔˈˌ]/u;

export async function probePhoneme(audio: Float32Array) {
  for (const model of CANDIDATES) {
    const onProgress = progress(`R1 loading ${model} (q4f16, ~197MB)`);

    try {
      const t0 = performance.now();
      const rec: any = await pipeline('automatic-speech-recognition', model, {
        device: 'webgpu',
        dtype: 'q4f16', // smallest available; Task 5 measures whether it is good enough
        progress_callback: onProgress,
      });
      const loadS = ((performance.now() - t0) / 1000).toFixed(1);

      const t1 = performance.now();
      const out: any = await rec(audio);
      const inferS = ((performance.now() - t1) / 1000).toFixed(2);

      const text: string = (out.text ?? '').trim();
      const hasIpa = IPA_MARKERS.test(text);

      report(
        `R1 ${model}`,
        hasIpa ? 'pass' : 'fail',
        `load ${loadS}s · infer ${inferS}s\n\noutput: ${text}\n\n` +
          (hasIpa
            ? 'Contains IPA symbols — phonetic track is viable.'
            : 'No IPA symbols. Model loaded but decoding is wrong — inspect tokenizer_config.json ' +
              'and try decoding token IDs manually against vocab.json. Not a gate failure.'),
      );

      if (hasIpa) {
        // The money check. /t/ between vowels should surface as the flap [ɾ] in
        // butter, little, water, city, Saturday.
        const flaps = (text.match(/ɾ/gu) ?? []).length;
        report(
          'R1 flapping',
          flaps > 0 ? 'pass' : 'info',
          flaps > 0
            ? `${flaps} flap(s) [ɾ] detected.\n` +
              'The phonemic/phonetic divergence is real and measurable — this is the project premise proven.'
            : 'No flap detected. Either your dialect does not flap these, or decoding needs review.',
        );

        return { model, text, loadSeconds: Number(loadS), inferSeconds: Number(inferS) };
      }
    } catch (err) {
      report(`R1 ${model}`, 'fail', String(err));
    }
  }

  report(
    'R1 GATE',
    'fail',
    'No phoneme model loaded. Phonetic track is NOT viable.\n' +
      'STOP. Return to the design and adopt the fallback: phonemic-only + rule-based allophony.',
  );
  return null;
}

/**
 * Task 5 — quantization vs. accuracy.
 *
 * Every available phoneme model is large-architecture; q4f16 at ~197MB is the floor.
 * This measures whether that quantization degrades the phone string, using fp16 as
 * the closest available proxy for ground truth.
 *
 * Only run after the gate passes. This downloads well over a gigabyte in total.
 */
export async function sweepQuantization(audio: Float32Array, model: string) {
  const results: Record<string, string> = {};

  for (const dtype of ['q4f16', 'q4', 'int8', 'fp16'] as const) {
    const onProgress = progress(`R1 quant sweep — ${dtype}`);
    try {
      const t0 = performance.now();
      const rec: any = await pipeline('automatic-speech-recognition', model, {
        device: 'webgpu',
        dtype,
        progress_callback: onProgress,
      });
      const out: any = await rec(audio);
      results[dtype] = (out.text ?? '').trim();
      report(
        `R1 quant ${dtype}`,
        'info',
        `${((performance.now() - t0) / 1000).toFixed(1)}s total\n${results[dtype]}`,
      );
    } catch (err) {
      report(`R1 quant ${dtype}`, 'fail', String(err));
    }
  }

  const ref = results['fp16'];
  if (ref) {
    for (const [dtype, text] of Object.entries(results)) {
      if (dtype === 'fp16') continue;
      report(
        `R1 drift ${dtype}`,
        text === ref ? 'pass' : 'info',
        `identical to fp16: ${text === ref}\n  fp16: ${ref}\n  ${dtype}: ${text}`,
      );
    }
  }

  return results;
}
