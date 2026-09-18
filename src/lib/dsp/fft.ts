/**
 * Radix-2 iterative FFT (pure TypeScript, no dependencies).
 * Forward transform, no scaling. For magnitude spectra and chroma use.
 */
import { isPowerOfTwo } from './windowing';

export interface ComplexSpectrum {
  real: Float64Array;
  imag: Float64Array;
}

/** In-place radix-2 DIT FFT on real/imag arrays (length must be power of 2). */
export function fftInPlace(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (!isPowerOfTwo(n)) throw new Error(`FFT length must be power of 2, got ${n}`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = real[i]; real[i] = real[j]; real[j] = t;
      t = imag[i]; imag[i] = imag[j]; imag[j] = t;
    }
  }

  // Cooley-Tukey butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      for (let k = 0; k < len / 2; k++) {
        const uReal = real[i + k];
        const uImag = imag[i + k];
        const vReal = real[i + k + len / 2] * curReal - imag[i + k + len / 2] * curImag;
        const vImag = real[i + k + len / 2] * curImag + imag[i + k + len / 2] * curReal;
        real[i + k] = uReal + vReal;
        imag[i + k] = uImag + vImag;
        real[i + k + len / 2] = uReal - vReal;
        imag[i + k + len / 2] = uImag - vImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

/** Magnitude spectrum (first n/2+1 bins) of a real frame. */
export function magnitudeSpectrum(frame: ArrayLike<number>): Float64Array {
  const n = frame.length;
  if (!isPowerOfTwo(n)) throw new Error(`Frame length must be power of 2, got ${n}`);
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < n; i++) real[i] = frame[i];
  fftInPlace(real, imag);
  const half = n / 2;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    mag[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]) / n;
  }
  return mag;
}

export interface SpectralPeak {
  /** Fractional bin index (parabolic interpolation). */
  bin: number;
  frequency: number;
  magnitude: number;
}

/**
 * Local-maximum peak picking with parabolic interpolation.
 * Returns peaks sorted by magnitude descending, capped at maxPeaks.
 */
export function findSpectralPeaks(
  magnitude: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  options: { minMagnitude?: number; maxPeaks?: number } = {},
): SpectralPeak[] {
  const { minMagnitude = 0, maxPeaks = 12 } = options;
  const peaks: SpectralPeak[] = [];
  for (let k = 1; k < magnitude.length - 1; k++) {
    const m = magnitude[k];
    if (m < minMagnitude) continue;
    if (m > magnitude[k - 1] && m >= magnitude[k + 1]) {
      // Parabolic interpolation (Hz refinement between bins).
      const alpha = magnitude[k - 1];
      const beta = m;
      const gamma = magnitude[k + 1];
      const denom = alpha - 2 * beta + gamma;
      let shift = 0;
      if (denom !== 0) {
        shift = (0.5 * (alpha - gamma)) / denom;
        if (!Number.isFinite(shift) || Math.abs(shift) > 1) shift = 0;
      }
      const bin = k + shift;
      peaks.push({
        bin,
        frequency: (bin * sampleRate) / fftSize,
        magnitude: m,
      });
    }
  }
  peaks.sort((a, b) => b.magnitude - a.magnitude);
  return peaks.slice(0, maxPeaks);
}
