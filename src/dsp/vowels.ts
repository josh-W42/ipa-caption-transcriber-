import { formants } from './lpc';
import { detectPitch } from './yin';
import { DEFAULT_SAMPLE_RATE } from './synth';
import type { AlignedWord } from '../align/utterance';

/**
 * Extract formant measurements from the vowels in an utterance.
 *
 * The gating here is what separates a vowel plot from a scatter of noise. Every
 * rejection below exists because including that material demonstrably produces garbage:
 *
 *  - vowels only, by phone identity
 *  - a window CENTRED on the CTC label, grown toward the neighbours but never across
 *    them, so transitions into neighbouring phones are excluded
 *  - enough signal for an order-18 LPC fit
 *  - voiced only, confirmed by the pitch tracker
 *  - above an energy floor
 */

/** Vowels the chart can place. Diphthongs are excluded: they move by definition. */
const MONOPHTHONGS = new Set([
  'i', 'ɪ', 'e', 'ɛ', 'æ', 'ə', 'ʌ', 'ɑ', 'ɔ', 'o', 'ʊ', 'u', 'ɚ', 'ɝ', 'ɜ', 'a',
]);

/** Close vowels, whose F1 the method measures poorly. Carried into the UI. */
const CLOSE_VOWELS = new Set(['i', 'ɪ', 'u', 'ʊ']);

/**
 * Half-width of the analysis window, centred on the phone's label frame.
 *
 * CTC alignments are PEAKY: the model emits a label only at its most confident frame
 * and blanks around it, so a label's span is where the model was sure, not the phone's
 * acoustic extent. Measured on the fixture, the median label lasts 20ms (one frame)
 * while the median gap between labels is 80ms. Trusting label duration rejected 36 of
 * 44 phones as "too short" on a false premise.
 *
 * So the window is centred on the label and grown toward the neighbours instead.
 */
export const WINDOW_HALF_SECONDS = 0.025;

/** Below this there is not enough signal for an order-18 LPC fit to mean anything. */
export const MIN_HALF_SECONDS = 0.012;

export interface VowelMeasurement {
  phone: string;
  word: string;
  start: number;
  end: number;
  f1: number;
  f2: number;
  f3: number | null;
  f0: number | null;
  /**
   * 0-1, from duration, voicing and formant bandwidth.
   *
   * Not decoration: the plot draws low-confidence tokens differently rather than
   * presenting every measurement as equally solid.
   */
  confidence: number;
  /**
   * True when F1 is expected to be unreliable.
   *
   * Close vowels measured 5-32% F1 error against under 5% for open vowels, because a
   * close vowel's F1 sits among the voicing harmonics. Flagged per token so the plot
   * can show it rather than burying it in a footnote.
   */
  f1Unreliable: boolean;
}

export function extractVowels(
  audio: Float32Array,
  words: AlignedWord[],
  sampleRate = DEFAULT_SAMPLE_RATE,
): VowelMeasurement[] {
  const out: VowelMeasurement[] = [];

  // Flattened and ordered, so each phone can see its neighbours across word boundaries.
  const flat = words
    .flatMap((w) => w.phonetic.map((p) => ({ ...p, word: w.word })))
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < flat.length; i++) {
    const phone = flat[i];
    {
      if (!MONOPHTHONGS.has(phone.phone)) continue;

      // Centre on the label, grow toward the neighbours but never across them.
      const centre = (phone.start + phone.end) / 2;
      const prevEnd = i > 0 ? flat[i - 1].end : -Infinity;
      const nextStart = i + 1 < flat.length ? flat[i + 1].start : Infinity;

      const half = Math.min(
        WINDOW_HALF_SECONDS,
        centre - prevEnd,
        nextStart - centre,
      );
      if (!(half >= MIN_HALF_SECONDS)) continue;

      const duration = half * 2;
      const from = Math.floor((centre - half) * sampleRate);
      const to = Math.ceil((centre + half) * sampleRate);
      if (from < 0 || to > audio.length || to - from < 64) continue;

      const frame = audio.subarray(from, to);

      let energy = 0;
      for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
      const rms = Math.sqrt(energy / frame.length);
      if (rms < 0.005) continue;

      // Voicing check. An unvoiced interval labelled as a vowel is a recognition
      // artefact, and its "formants" would be noise.
      const f0 = detectPitch(frame, sampleRate);
      if (f0 === null) continue;

      const f = formants(frame, sampleRate);
      if (f.length < 2) continue;

      // Narrower bandwidths mean better-defined resonances.
      const meanBw = (f[0].bandwidth + f[1].bandwidth) / 2;
      const bwScore = Math.max(0, Math.min(1, 1 - meanBw / 400));
      const durScore = Math.min(1, duration / (WINDOW_HALF_SECONDS * 2));
      const confidence = Math.round(bwScore * durScore * 100) / 100;

      out.push({
        phone: phone.phone,
        word: phone.word,
        start: phone.start,
        end: phone.end,
        f1: f[0].frequency,
        f2: f[1].frequency,
        f3: f[2]?.frequency ?? null,
        f0,
        confidence,
        f1Unreliable: CLOSE_VOWELS.has(phone.phone),
      });
    }
  }

  return out;
}

export interface VowelCluster {
  phone: string;
  tokens: VowelMeasurement[];
  meanF1: number;
  meanF2: number;
  sdF1: number;
  sdF2: number;
  /**
   * Whether there are enough tokens to draw a dispersion ellipse.
   *
   * With one or two tokens an ellipse would be drawing a shape through noise and
   * implying a distribution that was never observed.
   */
  enoughForEllipse: boolean;
}

/** Minimum tokens before a category's spread means anything. */
export const MIN_TOKENS_FOR_ELLIPSE = 3;

export function clusterByVowel(measurements: VowelMeasurement[]): VowelCluster[] {
  const groups = new Map<string, VowelMeasurement[]>();
  for (const m of measurements) {
    const list = groups.get(m.phone) ?? [];
    list.push(m);
    groups.set(m.phone, list);
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = (xs: number[], m: number) =>
    xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));

  return [...groups.entries()]
    .map(([phone, tokens]) => {
      const f1s = tokens.map((t) => t.f1);
      const f2s = tokens.map((t) => t.f2);
      const meanF1 = mean(f1s);
      const meanF2 = mean(f2s);
      return {
        phone,
        tokens,
        meanF1,
        meanF2,
        sdF1: sd(f1s, meanF1),
        sdF2: sd(f2s, meanF2),
        enoughForEllipse: tokens.length >= MIN_TOKENS_FOR_ELLIPSE,
      };
    })
    .sort((a, b) => b.tokens.length - a.tokens.length);
}
