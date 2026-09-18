/**
 * Frequency-selective filtering for band-split pitch tracking.
 * Brickwall via FFT on individual frames (exact crossover, no phase
 * distortion concerns for YIN periodicity estimation).
 */
import { fftInPlace } from './fft';
import { isPowerOfTwo } from './windowing';

export function brickwall(
  frame: Float32Array,
  sampleRate: number,
  cutoffHz: number,
  pass: 'low' | 'high',
): Float32Array {
  const n = frame.length;
  if (!isPowerOfTwo(n)) throw new Error('brickwall needs power-of-2 frame');
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i];
  fftInPlace(re, im);
  const cutoffBin = Math.floor((cutoffHz * n) / sampleRate);
  for (let k = 0; k < n; k++) {
    const bin = k <= n / 2 ? k : n - k;
    const kill = pass === 'low' ? bin > cutoffBin : bin < cutoffBin;
    if (kill) {
      re[k] = 0;
      im[k] = 0;
    }
  }
  // Inverse via conjugated forward transform.
  for (let k = 0; k < n; k++) im[k] = -im[k];
  fftInPlace(re, im);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i] / n;
  return out;
}
