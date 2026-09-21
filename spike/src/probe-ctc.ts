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
