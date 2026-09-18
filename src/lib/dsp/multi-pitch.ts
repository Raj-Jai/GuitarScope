/**
 * Peak-based multi-pitch candidate estimation with iterative
 * harmonic subtraction (lightweight matching pursuit).
 *
 * Why: raw-bin chroma misattributes low-frequency leakage (bins wider
 * than semitones below ~200 Hz) and counts every harmonic as an
 * independent pitch class. Here each spectral peak is either explained
 * as a harmonic of an already-accepted stronger F0 (discounted) or
 * accepted as a new independent fundamental.
 */
import { findSpectralPeaks, type SpectralPeak } from './fft';
import { frequencyToMidiFloat } from '../notes/frequency';

export interface F0Candidate {
  frequency: number;
  /** Residual magnitude after harmonic subtraction (display weight). */
  weight: number;
  pitchClass: number;
  midi: number;
}

export interface MultiPitchOptions {
  /** Relative magnitude floor: ignore peaks below maxPeak * floor (default 0.06). */
  peakFloor?: number;
  /** Max peaks to consider (default 16). */
  maxPeaks?: number;
  /** Cents tolerance for harmonic association (default 40). */
  harmonicToleranceCents?: number;
  /** Harmonics modeled per accepted F0 (default 8). */
  numHarmonics?: number;
  /**
   * Expected harmonic amplitude profile, index k-1 = gain of k-th
   * harmonic relative to its fundamental. Defaults to a guitar-like
   * series; mismatch here leaks harmonic residue into new candidates.
   */
  harmonicGains?: number[];
  /** Min residual (fraction of strongest peak) to accept new F0 (default 0.12). */
  acceptanceFloor?: number;
}

/**
 * Guitar-like harmonic amplitude profile (relative to fundamental).
 * Matches the synth's GUITAR_HARMONICS so real string overtones are
 * explained rather than mistaken for independent notes.
 */
export const GUITAR_HARMONIC_GAINS = [1, 0.6, 0.4, 0.3, 0.2, 0.15, 0.1, 0.08];

function centsBetween(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}

export function estimateF0Candidates(
  magnitude: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  options: MultiPitchOptions = {},
): F0Candidate[] {
  const {
    peakFloor = 0.06,
    maxPeaks = 16,
    harmonicToleranceCents = 40,
    numHarmonics = 8,
    harmonicGains = GUITAR_HARMONIC_GAINS,
    acceptanceFloor = 0.12,
  } = options;

  const peaks: SpectralPeak[] = findSpectralPeaks(magnitude, sampleRate, fftSize, {
    maxPeaks: 32,
  });
  if (peaks.length === 0) return [];
  const strongest = peaks[0].magnitude;

  // Keep peaks above the relative floor, within guitar-relevant range.
  const usable = peaks
    .filter(
      (p) =>
        p.magnitude >= strongest * peakFloor &&
        p.frequency >= 50 &&
        p.frequency <= 2500,
    )
    .slice(0, maxPeaks);
  if (usable.length === 0) return [];

  const accepted: F0Candidate[] = [];
  // Ascending frequency order: a peak can only be explained by a LOWER
  // F0 (k>=2 harmonics), so every potential explainer is accepted first.
  // (Strongest-first ordering let loud harmonics masquerade as F0s.)
  const ordered = [...usable].sort((a, b) => a.frequency - b.frequency);
  for (const peak of ordered) {
    // Energy already explained by accepted F0s' harmonics?
    let explained = 0;
    for (const f0 of accepted) {
      const maxK = Math.min(numHarmonics, harmonicGains.length);
      for (let k = 2; k <= maxK; k++) {
        const expected = f0.frequency * k;
        if (Math.abs(centsBetween(peak.frequency, expected)) <= harmonicToleranceCents) {
          // Predicted harmonic amplitude from the calibrated profile,
          // scaled by the accepted F0's own residual weight.
          explained += f0.weight * harmonicGains[k - 1];
          break; // one harmonic association per F0 is enough
        }
      }
    }
    // Residual in units of the strongest peak's magnitude.
    const residual = peak.magnitude - explained;
    if (residual >= strongest * acceptanceFloor) {
      const midiFloat = frequencyToMidiFloat(peak.frequency);
      if (!Number.isFinite(midiFloat)) continue;
      const midi = Math.round(midiFloat);
      if (midi < 0 || midi > 127) continue;
      accepted.push({
        frequency: peak.frequency,
        weight: residual,
        pitchClass: ((midi % 12) + 12) % 12,
        midi,
      });
    }
  }
  return accepted;
}
