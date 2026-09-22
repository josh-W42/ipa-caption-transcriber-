/// <reference lib="webworker" />
import { extractVowels, clusterByVowel, type VowelMeasurement, type VowelCluster } from './vowels';
import { pitchContour, medianSmooth, pitchStats, type PitchPoint } from './yin';
import { rhythmMetrics, type RhythmMetrics } from './rhythm';
import type { AlignedWord } from '../align/utterance';

/**
 * DSP worker: formants, pitch and rhythm.
 *
 * Off the main thread because formant analysis over a long recording is heavy enough
 * to freeze the UI — root-finding an order-18 polynomial per vowel adds up.
 *
 * Pure CPU, so unlike the two model workers it does not contend for the GPU. M3
 * measured that contention at 11x, and the session still runs this after the model
 * passes rather than alongside them.
 */

export type ToWorker = {
  type: 'analyse';
  id: number;
  audio: Float32Array;
  words: AlignedWord[];
  sampleRate: number;
};

export type FromWorker =
  | {
      type: 'result';
      id: number;
      vowels: VowelMeasurement[];
      clusters: VowelCluster[];
      pitch: PitchPoint[];
      pitchSummary: ReturnType<typeof pitchStats>;
      rhythm: RhythmMetrics | null;
      seconds: number;
    }
  | { type: 'error'; id: number; message: string };

const post = (msg: FromWorker) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    const t0 = performance.now();

    const vowels = extractVowels(msg.audio, msg.words, msg.sampleRate);
    const clusters = clusterByVowel(vowels);

    // Smoothed before it leaves the worker: YIN's octave errors are a property of the
    // measurement, and no consumer should have to remember to filter them.
    const pitch = medianSmooth(pitchContour(msg.audio, msg.sampleRate));

    post({
      type: 'result',
      id: msg.id,
      vowels,
      clusters,
      pitch,
      pitchSummary: pitchStats(pitch),
      rhythm: rhythmMetrics(msg.words),
      seconds: (performance.now() - t0) / 1000,
    });
  } catch (err) {
    post({
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
