import type { FromWorker } from './worker';
import type { VowelMeasurement, VowelCluster } from './vowels';
import type { PitchPoint } from './yin';
import type { RhythmMetrics } from './rhythm';
import type { AlignedWord } from '../align/utterance';

export interface DspResult {
  vowels: VowelMeasurement[];
  clusters: VowelCluster[];
  pitch: PitchPoint[];
  pitchSummary: { median: number | null; min: number | null; max: number | null; voicedFraction: number };
  rhythm: RhythmMetrics | null;
  seconds: number;
}

/**
 * Promise-based wrapper around the DSP worker.
 *
 * Unlike the model clients this does NOT transfer the audio buffer. The caller
 * generally still needs those samples — for the WAV export, or a second analysis — and
 * a neutered buffer is an unpleasant thing to debug. Structured clone costs a copy;
 * for a minute of 16kHz audio that is under 4MB and happens once per recording.
 */
export class DspClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: DspResult) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);

      if (msg.type === 'error') entry.reject(new Error(msg.message));
      else
        entry.resolve({
          vowels: msg.vowels,
          clusters: msg.clusters,
          pitch: msg.pitch,
          pitchSummary: msg.pitchSummary,
          rhythm: msg.rhythm,
          seconds: msg.seconds,
        });
    };
    this.worker.onerror = (e) => {
      const err = new Error(`DSP worker failed: ${e.message}`);
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
    };
  }

  analyse(audio: Float32Array, words: AlignedWord[], sampleRate: number): Promise<DspResult> {
    const id = this.nextId++;
    const p = new Promise<DspResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.worker.postMessage({ type: 'analyse', id, audio, words, sampleRate });
    return p;
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.forEach((p) => p.reject(new Error('DSP client disposed')));
    this.pending.clear();
  }
}
