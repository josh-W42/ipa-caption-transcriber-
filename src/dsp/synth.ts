/**
 * Synthesise speech-like signals whose correct answer is known in advance.
 *
 * This is test infrastructure, and it is the entire basis for trusting any number the
 * DSP produces. A formant tracker checked only against real speech can be confidently
 * wrong and nobody notices — there is no ground truth to compare against. Checked
 * against a signal built from resonators at frequencies WE chose, it either recovers
 * them or it does not.
 */

export const DEFAULT_SAMPLE_RATE = 16000;

export interface VowelOptions {
  /** Fundamental frequency in Hz — the voice pitch. */
  f0: number;
  /** Formant centre frequencies in Hz, ascending. */
  formants: number[];
  /** Formant bandwidths in Hz. Defaults widen with frequency, as real ones do. */
  bandwidths?: number[];
  seconds?: number;
  sampleRate?: number;
}

/**
 * Source-filter synthesis: an impulse train through cascaded two-pole resonators.
 *
 * This is the classic model of voiced speech — the glottis produces a periodic pulse
 * train, the vocal tract filters it, and the filter's resonances are the formants.
 */
export function synthVowel(opts: VowelOptions): Float32Array {
  const fs = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const seconds = opts.seconds ?? 0.2;
  const bandwidths = opts.bandwidths ?? opts.formants.map((_, i) => 60 + i * 30);

  const n = Math.round(fs * seconds);
  let x = new Float32Array(n);

  // Glottal source: an impulse every pitch period.
  const period = Math.max(1, Math.round(fs / opts.f0));
  for (let i = 0; i < n; i += period) x[i] = 1;

  // Vocal tract: one two-pole resonator per formant, in cascade.
  for (let k = 0; k < opts.formants.length; k++) {
    const f = opts.formants[k];
    const bw = bandwidths[k] ?? 80;
    const r = Math.exp((-Math.PI * bw) / fs);
    const a1 = 2 * r * Math.cos((2 * Math.PI * f) / fs);
    const a2 = -r * r;

    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      y[i] = x[i] + (i >= 1 ? a1 * y[i - 1] : 0) + (i >= 2 ? a2 * y[i - 2] : 0);
    }
    x = y;
  }

  // Normalise so tests can use absolute energy thresholds.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak > 0) for (let i = 0; i < n; i++) x[i] /= peak;

  return x;
}

/** A pure tone — the simplest case a pitch tracker must get right. */
export function synthTone(freq: number, seconds = 0.2, sampleRate = DEFAULT_SAMPLE_RATE): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/** White noise — has no pitch, and a tracker must say so rather than guess. */
export function synthNoise(seconds = 0.2, sampleRate = DEFAULT_SAMPLE_RATE, seed = 1): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  // Deterministic, so a failure is reproducible.
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (s / 0x3fffffff) - 1;
  }
  return out;
}

export function synthSilence(seconds = 0.2, sampleRate = DEFAULT_SAMPLE_RATE): Float32Array {
  return new Float32Array(Math.round(sampleRate * seconds));
}

/** Reference formant values for General American vowels (Hillenbrand-style means). */
export const REFERENCE_VOWELS: Record<string, [f1: number, f2: number, f3: number]> = {
  i: [270, 2290, 3010],
  ɪ: [390, 1990, 2550],
  ɛ: [530, 1840, 2480],
  æ: [660, 1720, 2410],
  ɑ: [730, 1090, 2440],
  ɔ: [570, 840, 2410],
  ʊ: [440, 1020, 2240],
  u: [300, 870, 2240],
  ʌ: [640, 1190, 2390],
  ɚ: [490, 1350, 1690],
};
