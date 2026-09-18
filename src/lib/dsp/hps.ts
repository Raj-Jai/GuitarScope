/**
 * Harmonic-support scoring + octave-error validation.
 *
 * Role (per ADR-001): HPS is NOT an independent detector averaged with YIN.
 * It answers: "does candidate f have the expected harmonic structure?"
 * and "is there evidence YIN picked an octave error?"
 */
import { magnitudeSpectrum } from './fft';
import { applyHannWindow, removeDcOffset } from './windowing';

export interface HarmonicSupportOptions {
  sampleRate?: number;
  /** Number of harmonics to sum (default 5). */
  numHarmonics?: number;
}

/** Interpolated magnitude at an arbitrary frequency from a spectrum. */
export function magnitudeAt(
  magnitude: ArrayLike<number>,
  frequency: number,
  sampleRate: number,
  fftSize: number,
): number {
  const bin = (frequency * fftSize) / sampleRate;
  if (bin < 0 || bin > magnitude.length - 1) return 0;
  const lo = Math.floor(bin);
  const hi = Math.min(magnitude.length - 1, lo + 1);
  const frac = bin - lo;
  return magnitude[lo] * (1 - frac) + magnitude[hi] * frac;
}

/**
 * Harmonic support of candidate f: Σ mag(k*f)/k for k=1..numHarmonics.
 * The 1/k weight favors candidates whose low harmonics are strong.
 */
export function harmonicSupport(
  magnitude: ArrayLike<number>,
  frequency: number,
  sampleRate: number,
  fftSize: number,
  options: HarmonicSupportOptions = {},
): number {
  const { numHarmonics = 5 } = options;
  if (!(frequency > 0)) return 0;
  const nyquist = sampleRate / 2;
  let score = 0;
  for (let k = 1; k <= numHarmonics; k++) {
    const f = frequency * k;
    if (f >= nyquist) break;
    score += magnitudeAt(magnitude, f, sampleRate, fftSize) / k;
  }
  return score;
}

export type OctaveVerdict =
  | { decision: 'accept'; correctedFrequency: number; reason: string }
  | { decision: 'octave-down'; correctedFrequency: number; reason: string };

/**
 * Validate a YIN candidate against harmonic evidence.
 *
 * Only corrects in ONE direction: if f/2 (the sub-octave) has clearly
 * stronger harmonic support than f, YIN almost certainly locked onto the
 * 2nd harmonic (classic E2→E3 error) → correct down to f/2.
 * Upward correction is deliberately NOT done: a genuine low fundamental
 * with weak energy must not be pushed up an octave.
 */
export function validateOctave(
  magnitude: ArrayLike<number>,
  candidateFrequency: number,
  sampleRate: number,
  fftSize: number,
  options: HarmonicSupportOptions & { downRatio?: number } = {},
): OctaveVerdict {
  const { downRatio = 1.6 } = options;
  const sub = candidateFrequency / 2;
  if (sub < 30) {
    return {
      decision: 'accept',
      correctedFrequency: candidateFrequency,
      reason: 'sub-octave below range',
    };
  }
  const supportF = harmonicSupport(magnitude, candidateFrequency, sampleRate, fftSize, options);
  const supportSub = harmonicSupport(magnitude, sub, sampleRate, fftSize, options);
  if (supportF <= 0) {
    return {
      decision: 'accept',
      correctedFrequency: candidateFrequency,
      reason: 'no harmonic energy at candidate',
    };
  }
  if (supportSub / supportF >= downRatio) {
    return {
      decision: 'octave-down',
      correctedFrequency: sub,
      reason: `sub-octave support ${supportSub.toFixed(4)} dominates candidate ${supportF.toFixed(4)}`,
    };
  }
  return {
    decision: 'accept',
    correctedFrequency: candidateFrequency,
    reason: 'harmonic structure consistent',
  };
}

/** Convenience: windowed magnitude spectrum of a frame. */
export function frameSpectrum(
  frame: Float32Array,
  sampleRate?: number,
): { magnitude: Float64Array; fftSize: number } {
  void sampleRate;
  const copy = new Float32Array(frame);
  const magnitude = magnitudeSpectrum(
    applyHannWindow(removeDcOffset(copy)),
  );
  return { magnitude, fftSize: frame.length };
}
