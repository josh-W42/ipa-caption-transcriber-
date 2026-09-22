import { DEFAULT_SAMPLE_RATE } from './synth';

/**
 * Pitch detection by the YIN algorithm.
 *
 * Returns null rather than a number when there is no pitch to find. That matters more
 * than it sounds: an unvoiced stop has no fundamental, and a tracker that always
 * answers will draw a confident line through silence.
 */

/** Below this, the candidate is not periodic enough to call pitched. */
export const DEFAULT_THRESHOLD = 0.15;

/** Human speech range. Outside it, a "pitch" is an octave error or noise. */
export const MIN_F0 = 60;
export const MAX_F0 = 500;

export function detectPitch(
  frame: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
  threshold = DEFAULT_THRESHOLD,
): number | null {
  const maxTau = Math.min(Math.floor(sampleRate / MIN_F0), Math.floor(frame.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_F0));
  if (maxTau <= minTau) return null;

  // Silence has no pitch.
  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
  if (Math.sqrt(energy / frame.length) < 1e-4) return null;

  // Step 1: difference function.
  const diff = new Float64Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i + tau < frame.length; i++) {
      const d = frame[i] - frame[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 2: cumulative mean normalised difference. This is what makes YIN robust —
  // it removes the bias toward tau=0 that plain autocorrelation suffers from.
  const cmnd = new Float64Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += diff[tau];
    cmnd[tau] = running === 0 ? 1 : (diff[tau] * tau) / running;
  }

  // Step 3: first dip below threshold, walked down to its local minimum.
  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) return null; // nothing periodic enough

  // Step 4: parabolic interpolation around the minimum, for sub-sample accuracy.
  let betterTau = tauEstimate;
  if (tauEstimate > 1 && tauEstimate < maxTau) {
    const s0 = cmnd[tauEstimate - 1];
    const s1 = cmnd[tauEstimate];
    const s2 = cmnd[tauEstimate + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEstimate + (s2 - s0) / denom;
  }

  const f0 = sampleRate / betterTau;
  return f0 >= MIN_F0 && f0 <= MAX_F0 ? f0 : null;
}

export interface PitchPoint {
  time: number;
  /** Null where the signal is unvoiced — a gap, not a zero. */
  f0: number | null;
}

/**
 * Pitch contour over a whole signal.
 *
 * Unvoiced frames stay null rather than being interpolated. Drawing a smooth line
 * through a voiceless stop would invent pitch that was never produced.
 */
export function pitchContour(
  audio: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
  hopSeconds = 0.01,
  windowSeconds = 0.045,
): PitchPoint[] {
  const hop = Math.round(sampleRate * hopSeconds);
  const win = Math.round(sampleRate * windowSeconds);
  const out: PitchPoint[] = [];

  for (let start = 0; start + win <= audio.length; start += hop) {
    out.push({
      time: start / sampleRate,
      f0: detectPitch(audio.subarray(start, start + win), sampleRate),
    });
  }
  return out;
}

/**
 * Median-smooth a contour to remove octave errors.
 *
 * YIN halves or doubles on creaky voice, producing single frames an octave away from
 * their neighbours. A median filter removes those without rounding off genuine pitch
 * movement, which a mean filter would.
 *
 * Reduces octave errors; does not eliminate them.
 */
export function medianSmooth(points: PitchPoint[], width = 5): PitchPoint[] {
  const half = Math.floor(width / 2);

  return points.map((p, i) => {
    if (p.f0 === null) return p; // never fill a gap

    const window: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j++) {
      const v = points[j].f0;
      if (v !== null) window.push(v);
    }
    if (window.length === 0) return p;

    window.sort((a, b) => a - b);
    return { time: p.time, f0: window[Math.floor(window.length / 2)] };
  });
}

/** Summary statistics over the voiced portion of a contour. */
export function pitchStats(points: PitchPoint[]): {
  median: number | null;
  min: number | null;
  max: number | null;
  voicedFraction: number;
} {
  const voiced = points.map((p) => p.f0).filter((f): f is number => f !== null);
  if (voiced.length === 0) {
    return { median: null, min: null, max: null, voicedFraction: 0 };
  }
  const sorted = [...voiced].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    voicedFraction: voiced.length / points.length,
  };
}
