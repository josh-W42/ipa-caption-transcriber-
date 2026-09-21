/// <reference lib="webworker" />
import { AutoModelForCTC, AutoProcessor } from '@huggingface/transformers';
import { ctcDecode, invertVocab, type DecodedPhone } from './ctc';

/**
 * Phoneme worker — wav2vec2 CTC, producing IPA with frame timings.
 *
 * Constraints carried from the M0 spike:
 *  1. `pipeline()` does NOT work on this repo. It ships vocab.json and
 *     tokenizer_class Wav2Vec2PhonemeCTCTokenizer but no tokenizer.json, so
 *     AutoTokenizer throws. Load the model directly and decode the logits.
 *  2. The blank is `<pad>`, found with indexOf rather than hardcoded — its id is not
 *     guaranteed stable across repos.
 *  3. Warm up at load, or the first real utterance absorbs shader compilation.
 */

const MODEL = 'onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX';
const DTYPE = 'q4f16'; // 197MB, measured at 114x realtime in M0

export type ToWorker =
  | { type: 'load' }
  | { type: 'transcribe'; id: number; audio: Float32Array }
  | { type: 'dispose' };

export type FromWorker =
  | { type: 'progress'; file: string; progress: number }
  | { type: 'ready'; device: string; loadSeconds: number; vocabSize: number }
  | { type: 'result'; id: number; phones: DecodedPhone[]; seconds: number; msPerFrame: number }
  | { type: 'error'; id?: number; message: string };

let model: any = null;
let processor: any = null;
let vocab: string[] = [];
let blankId = 0;
let device = 'unknown';

const post = (msg: FromWorker) => (self as unknown as Worker).postMessage(msg);

async function loadVocab(): Promise<string[]> {
  const res = await fetch(`https://huggingface.co/${MODEL}/resolve/main/vocab.json`);
  if (!res.ok) throw new Error(`vocab.json unavailable (HTTP ${res.status})`);
  return invertVocab(await res.json());
}

async function load() {
  const t0 = performance.now();

  const onProgress = (p: any) => {
    if (p?.status === 'progress' && p.file && typeof p.progress === 'number') {
      post({ type: 'progress', file: p.file, progress: p.progress });
    }
  };

  vocab = await loadVocab();
  blankId = vocab.indexOf('<pad>');
  if (blankId < 0) throw new Error('no <pad> in vocab — cannot identify the CTC blank');

  processor = await AutoProcessor.from_pretrained(MODEL);

  try {
    model = await AutoModelForCTC.from_pretrained(MODEL, {
      device: 'webgpu',
      dtype: DTYPE,
      progress_callback: onProgress,
    });
    device = 'webgpu';
  } catch {
    model = await AutoModelForCTC.from_pretrained(MODEL, {
      dtype: DTYPE,
      progress_callback: onProgress,
    });
    device = 'wasm';
  }

  // Warmup on a second of silence, discarded.
  const silence = await processor(new Float32Array(16000));
  await model(silence);

  post({
    type: 'ready',
    device,
    loadSeconds: (performance.now() - t0) / 1000,
    vocabSize: vocab.length,
  });
}

async function transcribe(audio: Float32Array) {
  const inputs = await processor(audio);
  const { logits } = await model(inputs);

  const [, numFrames, vocabSize] = logits.dims as number[];

  // Derived, never assumed to be 20ms: a model swap would otherwise silently corrupt
  // every timing the analysis layer depends on.
  const secondsPerFrame = audio.length / 16000 / numFrames;

  const phones = ctcDecode(
    logits.data as Float32Array,
    numFrames,
    vocabSize,
    vocab,
    blankId,
    secondsPerFrame,
  );
  return { phones, msPerFrame: secondsPerFrame * 1000 };
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await load();
    } else if (msg.type === 'transcribe') {
      if (!model) throw new Error('transcribe before load');
      const t0 = performance.now();
      const { phones, msPerFrame } = await transcribe(msg.audio);
      post({
        type: 'result',
        id: msg.id,
        phones,
        seconds: (performance.now() - t0) / 1000,
        msPerFrame,
      });
    } else if (msg.type === 'dispose') {
      await model?.dispose?.();
      model = null;
      processor = null;
    }
  } catch (err) {
    post({
      type: 'error',
      id: msg.type === 'transcribe' ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
