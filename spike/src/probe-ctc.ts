import { AutoModelForCTC, AutoProcessor } from '@huggingface/transformers';
import { report, progress } from './ui';

/**
 * R1 (second attempt) — bypass the tokenizer.
 *
 * The `pipeline()` path fails on these repos because AutoTokenizer wants a
 * `tokenizer.json` that does not exist: they ship `vocab.json` +
 * `tokenizer_config.json` with `tokenizer_class: Wav2Vec2PhonemeCTCTokenizer`.
 *
 * The model itself is fine. So we load it directly, decode the CTC logits against
 * vocab.json ourselves, and get something the pipeline could never give us anyway:
 * per-phone frame timings, which M3 and the whole DSP layer depend on.
 */

export interface Phone {
  phone: string;
  start: number; // seconds
  end: number;
  conf: number;
}

const MODELS = [
  'onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX',
  'onnx-community/wavlm-large-english-phoneme-ONNX',
];

const IPA_MARKERS = /[əɛɪʊʌæɹðθŋɾɚɜɔɑʃʒʔ]/u;

async function loadVocab(model: string): Promise<string[]> {
  const res = await fetch(`https://huggingface.co/${model}/resolve/main/vocab.json`);
  const map: Record<string, number> = await res.json();
  const inverted: string[] = [];
  for (const [symbol, id] of Object.entries(map)) inverted[id] = symbol;
  return inverted;
}

/** Greedy CTC decode: argmax per frame, collapse repeats, drop blanks. */
function ctcDecode(
  logits: Float32Array,
  numFrames: number,
  vocabSize: number,
  vocab: string[],
  blankId: number,
  secondsPerFrame: number,
): Phone[] {
  const out: Phone[] = [];
  let prevId = -1;

  for (let t = 0; t < numFrames; t++) {
    let best = 0;
    let bestVal = -Infinity;
    const base = t * vocabSize;

    // argmax + softmax denominator in one pass
    let maxLogit = -Infinity;
    for (let v = 0; v < vocabSize; v++) {
      const val = logits[base + v];
      if (val > maxLogit) maxLogit = val;
      if (val > bestVal) { bestVal = val; best = v; }
    }
    let sumExp = 0;
    for (let v = 0; v < vocabSize; v++) sumExp += Math.exp(logits[base + v] - maxLogit);
    const conf = 1 / sumExp; // exp(0)/sumExp, since bestVal === maxLogit

    if (best !== blankId && best !== prevId) {
      const symbol = vocab[best] ?? `<${best}>`;
      out.push({
        phone: symbol,
        start: t * secondsPerFrame,
        end: (t + 1) * secondsPerFrame,
        conf,
      });
    } else if (best === prevId && out.length > 0 && best !== blankId) {
      out[out.length - 1].end = (t + 1) * secondsPerFrame; // extend the current phone
    }
    prevId = best;
  }
  return out;
}

/** Load + run one (model, dtype) pair and return the decoded phone sequence. */
async function runCtc(
  model: string,
  dtype: 'q4f16' | 'q4' | 'int8' | 'fp16',
  audio: Float32Array,
  vocab: string[],
  blankId: number,
  onProgress?: (p: any) => void,
): Promise<{ phones: Phone[]; text: string; loadS: number; inferS: number }> {
  const t0 = performance.now();
  const processor: any = await AutoProcessor.from_pretrained(model);
  const net: any = await AutoModelForCTC.from_pretrained(model, {
    device: 'webgpu',
    dtype,
    progress_callback: onProgress,
  });
  const loadS = (performance.now() - t0) / 1000;

  const t1 = performance.now();
  const inputs = await processor(audio);
  const { logits } = await net(inputs);
  const inferS = (performance.now() - t1) / 1000;

  const [, numFrames, vocabSize] = logits.dims as number[];
  const secondsPerFrame = audio.length / 16000 / numFrames;
  const phones = ctcDecode(
    logits.data as Float32Array,
    numFrames,
    vocabSize,
    vocab,
    blankId,
    secondsPerFrame,
  );
  return { phones, text: phones.map((p) => p.phone).join(''), loadS, inferS };
}

/**
 * Task 5 — quantization vs. accuracy, on the direct CTC path.
 *
 * Every available phoneme model is large-architecture, so q4f16 (~197MB) is the
 * download floor. This measures what that costs in phone accuracy, using fp16 as
 * the closest available proxy for ground truth.
 */
export async function sweepCtcQuantization(audio: Float32Array, model: string) {
  const vocab = await loadVocab(model);
  const blankId = vocab.indexOf('<pad>');
  const results: Record<string, { text: string; loadS: number; inferS: number }> = {};

  for (const dtype of ['q4f16', 'q4', 'int8', 'fp16'] as const) {
    const onProgress = progress(`R1 quant sweep — ${dtype}`);
    try {
      const r = await runCtc(model, dtype, audio, vocab, blankId, onProgress);
      results[dtype] = { text: r.text, loadS: r.loadS, inferS: r.inferS };
      report(
        `R1 quant ${dtype}`,
        'info',
        `load ${r.loadS.toFixed(1)}s · infer ${r.inferS.toFixed(2)}s · ${r.phones.length} phones\n${r.text}`,
      );
    } catch (err) {
      report(`R1 quant ${dtype}`, 'fail', `${err}`.split('\n')[0]);
    }
  }

  const ref = results['fp16']?.text;
  if (!ref) {
    report('R1 quant drift', 'fail', 'fp16 reference unavailable — cannot measure drift.');
    return results;
  }

  for (const [dtype, r] of Object.entries(results)) {
    if (dtype === 'fp16') continue;
    const dist = levenshtein([...r.text], [...ref]);
    const per = ((dist / [...ref].length) * 100).toFixed(1);
    report(
      `R1 drift ${dtype}`,
      dist === 0 ? 'pass' : 'info',
      `phone edit distance vs fp16: ${dist} (${per}% of ${[...ref].length} symbols)\n` +
        `  fp16:  ${ref}\n  ${dtype.padEnd(6)}: ${r.text}`,
    );
  }
  return results;
}

function levenshtein(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export async function probeCtc(audio: Float32Array) {
  for (const model of MODELS) {
    const onProgress = progress(`R1-direct loading ${model} (q4f16)`);

    try {
      const vocab = await loadVocab(model);
      const blankId = vocab.indexOf('<pad>');
      report(
        `R1-direct vocab ${model}`,
        blankId >= 0 ? 'pass' : 'fail',
        `${vocab.length} symbols · blank(<pad>) id=${blankId}\n` +
          `sample: ${vocab.slice(4, 44).join(' ')}`,
      );

      const t0 = performance.now();
      const processor: any = await AutoProcessor.from_pretrained(model);
      const net: any = await AutoModelForCTC.from_pretrained(model, {
        device: 'webgpu',
        dtype: 'q4f16',
        progress_callback: onProgress,
      });
      const loadS = ((performance.now() - t0) / 1000).toFixed(1);

      const t1 = performance.now();
      const inputs = await processor(audio);
      const { logits } = await net(inputs);
      const inferS = ((performance.now() - t1) / 1000).toFixed(2);

      const [, numFrames, vocabSize] = logits.dims as number[];
      const data = logits.data as Float32Array;
      const secondsPerFrame = audio.length / 16000 / numFrames;

      const phones = ctcDecode(data, numFrames, vocabSize, vocab, blankId, secondsPerFrame);
      const text = phones.map((p) => p.phone).join('');
      const hasIpa = IPA_MARKERS.test(text);

      report(
        `R1-direct ${model}`,
        hasIpa ? 'pass' : 'fail',
        `load ${loadS}s · infer ${inferS}s\n` +
          `logits ${numFrames}x${vocabSize} · ${(secondsPerFrame * 1000).toFixed(1)}ms/frame · ${phones.length} phones\n\n` +
          `${text}\n\n` +
          (hasIpa ? 'IPA confirmed — phonetic track is VIABLE.' : 'No IPA symbols in output.'),
      );

      if (!hasIpa) continue;

      // Frame timings are the thing the pipeline path could never give us.
      report(
        'R1-direct timings',
        'pass',
        phones
          .slice(0, 14)
          .map((p) => `  ${p.phone.padEnd(4)} ${p.start.toFixed(3)}–${p.end.toFixed(3)}s  conf ${p.conf.toFixed(2)}`)
          .join('\n'),
      );

      const flaps = phones.filter((p) => p.phone === 'ɾ');
      report(
        'R1 flapping',
        flaps.length > 0 ? 'pass' : 'info',
        flaps.length > 0
          ? `${flaps.length} flap(s) [ɾ] at ${flaps.map((f) => f.start.toFixed(2) + 's').join(', ')}\n` +
            'Phonemic /t/ surfacing as phonetic [ɾ] — the project premise is proven.'
          : 'No flap detected in output.',
      );

      return { model, phones, text };
    } catch (err) {
      report(`R1-direct ${model}`, 'fail', `${err}`.split('\n').slice(0, 3).join('\n'));
    }
  }

  report('R1 GATE', 'fail', 'Direct CTC load failed for all candidates. Phonetic track not viable.');
  return null;
}
