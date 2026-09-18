/**
 * Chroma (pitch-class energy) vectors.
 *
 * Two builders:
 * - spectrumToChroma: raw-bin mapping (fast, but misattributes leakage
 *   where FFT bins are wider than semitones, i.e. low guitar register).
 * - candidatesToChroma: built from multi-pitch F0 candidates after
 *   harmonic subtraction — preferred for chord recognition.
 */
import { frequencyToMidiFloat } from '../notes/frequency';

export type ChromaVector = Float64Array; // length 12, C=0..B=11

export interface ChromaOptions {
  /** Minimum frequency to include (default 55 Hz, below A1). */
  minFrequency?: number;
  /** Maximum frequency to include (default 2000 Hz). */
  maxFrequency?: number;
  /** Log compression factor (default 20). 0 disables. */
  logCompression?: number;
}

export function spectrumToChroma(
  magnitude: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  options: ChromaOptions = {},
): ChromaVector {
  const { minFrequency = 55, maxFrequency = 2000, logCompression = 20 } = options;
  const chroma = new Float64Array(12);
  const binHz = sampleRate / fftSize;
  const nyquist = sampleRate / 2;
  const hi = Math.min(maxFrequency, nyquist);
  const startBin = Math.max(1, Math.floor(minFrequency / binHz));
  const endBin = Math.min(magnitude.length - 1, Math.ceil(hi / binHz));
  for (let k = startBin; k <= endBin; k++) {
    const mag = magnitude[k];
    if (!(mag > 0)) continue;
    const freq = k * binHz;
    const midiFloat = frequencyToMidiFloat(freq);
    if (!Number.isFinite(midiFloat)) continue;
    // Nearest pitch class (chroma folds octaves by design).
    const pc = ((Math.round(midiFloat) % 12) + 12) % 12;
    const v = logCompression > 0 ? Math.log1p(mag * logCompression) : mag;
    chroma[pc] += v;
  }
  // Normalize to unit sum (zero vector stays zero).
  normalizeChroma(chroma);
  return chroma;
}

/** Normalize a 12-dim chroma vector to unit sum in place. */
export function normalizeChroma(chroma: Float64Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum > 0) {
    for (let i = 0; i < 12; i++) chroma[i] /= sum;
  }
  return chroma;
}

export interface F0Like {
  pitchClass: number;
  weight: number;
}

/**
 * Chroma from multi-pitch F0 candidates: each candidate contributes
 * its residual weight to its pitch class. Harmonic residue was already
 * discounted during candidate estimation.
 */
export function candidatesToChroma(candidates: F0Like[]): ChromaVector {
  const chroma = new Float64Array(12);
  for (const c of candidates) {
    if (c.weight > 0) chroma[((c.pitchClass % 12) + 12) % 12] += c.weight;
  }
  return normalizeChroma(chroma);
}
