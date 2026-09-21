/// <reference lib="webworker" />
import { pipeline } from '@huggingface/transformers';

/**
 * ASR worker — Whisper only. The phoneme model arrives in M3.
 *
 * Two constraints carried from the M0 spike:
 *  1. Warm up at load, or the first real utterance pays 0.3-3.8s of shader compilation.
 *  2. Never pass `return_timestamps: 'word'` — this ONNX export lacks the
 *     cross-attentions it requires and throws. See findings R3.
 */

const DEFAULT_MODEL = 'onnx-community/whisper-base.en';

export type ToWorker =
  | { type: 'load'; model?: string }
  | { type: 'transcribe'; id: number; audio: Float32Array; longForm?: boolean }
  | { type: 'dispose' };

export type FromWorker =
  | { type: 'progress'; file: string; progress: number }
  | { type: 'ready'; device: string; loadSeconds: number }
  | { type: 'result'; id: number; text: string; seconds: number }
  | { type: 'error'; id?: number; message: string };

let transcriber: any = null;
let device = 'unknown';

const post = (msg: FromWorker) => (self as unknown as Worker).postMessage(msg);

async function load(model: string = DEFAULT_MODEL) {
  const t0 = performance.now();

  const onProgress = (p: any) => {
    if (p?.status === 'progress' && p.file && typeof p.progress === 'number') {
      post({ type: 'progress', file: p.file, progress: p.progress });
    }
  };

  try {
    transcriber = await pipeline('automatic-speech-recognition', model, {
      device: 'webgpu',
      dtype: 'q8',
      progress_callback: onProgress,
    });
    device = 'webgpu';
  } catch {
    // WASM is slower but keeps the app usable on machines without WebGPU.
    transcriber = await pipeline('automatic-speech-recognition', model, {
      dtype: 'q8',
      progress_callback: onProgress,
    });
    device = 'wasm';
  }

  // Warmup: one second of silence, discarded. Without this the first real
  // utterance absorbs shader compilation and arrives seconds late.
  await transcriber(new Float32Array(16000));

  post({ type: 'ready', device, loadSeconds: (performance.now() - t0) / 1000 });
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await load(msg.model);
    } else if (msg.type === 'transcribe') {
      if (!transcriber) throw new Error('transcribe before load');
      const t0 = performance.now();

      // Whisper's encoder sees 30 seconds at a time. Handed a longer buffer it
      // silently transcribes only part of it -- a 57s recording came back with 5 of
      // its 7 sentences. chunk_length_s makes transformers.js window the audio and
      // stitch the results; stride_length_s overlaps the windows so words spanning a
      // boundary are not lost.
      const out: any = msg.longForm
        ? await transcriber(msg.audio, { chunk_length_s: 30, stride_length_s: 5 })
        : await transcriber(msg.audio);
      post({
        type: 'result',
        id: msg.id,
        text: (out?.text ?? '').trim(),
        seconds: (performance.now() - t0) / 1000,
      });
    } else if (msg.type === 'dispose') {
      await transcriber?.dispose?.();
      transcriber = null;
    }
  } catch (err) {
    post({
      type: 'error',
      id: msg.type === 'transcribe' ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
