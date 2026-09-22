import { DEFAULT_SAMPLE_RATE } from './synth';

/**
 * Formant estimation by linear predictive coding.
 *
 * Measured accuracy against synthesised vowels with known resonances:
 *   F2, F3            within ~1.5%
 *   F1, open vowels   within ~5%
 *   F1, close vowels  5-32%  <- genuinely unreliable
 *
 * The close-vowel figure is not a defect to fix but a property of the method: a close
 * vowel's F1 is low enough to sit among the voicing harmonics, and LPC cannot cleanly
 * separate them. Callers must present F1 for close vowels with matching uncertainty.
 */

export interface Formant {
  frequency: number;
  bandwidth: number;
}

/** LPC order. ~2 + fs/1000 is the usual rule; 18 at 16kHz resolves 4-5 formants. */
export const DEFAULT_ORDER = 18;

/** Boosts the high frequencies, flattening the glottal source's natural tilt. */
export function preEmphasis(x: Float32Array, alpha = 0.97): Float32Array {
  const out = new Float32Array(x.length);
  out[0] = x[0];
  for (let i = 1; i < x.length; i++) out[i] = x[i] - alpha * x[i - 1];
  return out;
}

export function hammingWindow(x: Float32Array): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  return out;
}

export function autocorrelate(x: Float32Array, order: number): Float64Array {
  const r = new Float64Array(order + 1);
  for (let k = 0; k <= order; k++) {
    let sum = 0;
    for (let i = k; i < x.length; i++) sum += x[i] * x[i - k];
    r[k] = sum;
  }
  return r;
}

/** Levinson-Durbin: solve for LPC coefficients from the autocorrelation. */
export function levinsonDurbin(r: Float64Array, order: number): Float64Array {
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let e = r[0];
  if (e === 0) return a;

  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / e;

    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;

    e *= 1 - k * k;
    if (e <= 0) break; // numerically exhausted; higher orders would be noise
  }
  return a;
}

/**
 * Complex polynomial roots by Durand-Kerner.
 *
 * Chosen over a companion-matrix eigensolver because it is about forty lines and needs
 * no matrix library, and is entirely adequate at order 18.
 */
export function polynomialRoots(coeffs: Float64Array, maxIter = 500): Array<[re: number, im: number]> {
  const lead = coeffs[0];
  if (lead === 0) return [];
  const c = Array.from(coeffs, (v) => v / lead);
  const degree = c.length - 1;
  if (degree < 1) return [];

  // Spread the initial guesses around the unit circle so they do not collide.
  let re = new Array<number>(degree);
  let im = new Array<number>(degree);
  let sr = 1;
  let si = 0;
  for (let k = 0; k < degree; k++) {
    re[k] = sr;
    im[k] = si;
    const nr = sr * 0.4 - si * 0.9;
    const ni = sr * 0.9 + si * 0.4;
    sr = nr;
    si = ni;
  }

  const evalPoly = (zr: number, zi: number): [number, number] => {
    let ar = 0;
    let ai = 0;
    for (const v of c) {
      const nr = ar * zr - ai * zi + v;
      const ni = ar * zi + ai * zr;
      ar = nr;
      ai = ni;
    }
    return [ar, ai];
  };

  for (let iter = 0; iter < maxIter; iter++) {
    let maxDelta = 0;
    const nextRe = re.slice();
    const nextIm = im.slice();

    for (let i = 0; i < degree; i++) {
      const [pr, pi] = evalPoly(re[i], im[i]);

      // Product of differences to the other roots.
      let dr = 1;
      let di = 0;
      for (let j = 0; j < degree; j++) {
        if (i === j) continue;
        const xr = re[i] - re[j];
        const xi = im[i] - im[j];
        const nr = dr * xr - di * xi;
        const ni = dr * xi + di * xr;
        dr = nr;
        di = ni;
      }

      const den = dr * dr + di * di;
      if (den === 0) continue;

      const qr = (pr * dr + pi * di) / den;
      const qi = (pi * dr - pr * di) / den;

      nextRe[i] = re[i] - qr;
      nextIm[i] = im[i] - qi;
      maxDelta = Math.max(maxDelta, Math.hypot(qr, qi));
    }

    re = nextRe;
    im = nextIm;
    if (maxDelta < 1e-12) break;
  }

  return re.map((r, i) => [r, im[i]] as [number, number]);
}

/**
 * Estimate formants from a windowed frame of audio.
 *
 * Returns ascending frequencies. Returns an empty array for silence rather than
 * inventing resonances — a formant tracker that always answers is worse than one that
 * admits it has nothing.
 */
export function formants(
  frame: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
  order = DEFAULT_ORDER,
): Formant[] {
  if (frame.length < order * 2) return [];

  // Silence has no resonances to find.
  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
  if (Math.sqrt(energy / frame.length) < 1e-6) return [];

  const windowed = hammingWindow(preEmphasis(frame));
  const r = autocorrelate(windowed, order);
  if (r[0] === 0) return [];

  const a = levinsonDurbin(r, order);
  const roots = polynomialRoots(a);

  const out: Formant[] = [];
  for (const [rr, ri] of roots) {
    // Conjugate pairs: take the upper half plane only.
    if (ri <= 0) continue;

    const mag = Math.hypot(rr, ri);
    if (mag >= 1 || mag <= 0) continue; // outside the unit circle is not a resonance

    const frequency = (Math.atan2(ri, rr) * sampleRate) / (2 * Math.PI);
    const bandwidth = (-Math.log(mag) * sampleRate) / Math.PI;

    // Reject candidates too low, too near Nyquist, or too broad to be a formant.
    if (frequency < 90 || frequency > sampleRate / 2 - 100) continue;
    if (bandwidth > 500) continue;

    out.push({ frequency, bandwidth });
  }

  return out.sort((x, y) => x.frequency - y.frequency);
}
