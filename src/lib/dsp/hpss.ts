/**
 * Harmonic/Percussive Source Separation (Fitzgerald-style median filtering).
 * Pure TypeScript, no dependencies. Used as ONE preprocessing branch for
 * song analysis — it suppresses percussive attacks (drums, pick transients),
 * NOT vocals (sustained voice is harmonic and stays in H). Never the sole
 * basis for a chord decision; see analyzer branch agreement.
 */
import { fftInPlace } from './fft';

export interface StftOptions {
  size?: number; // FFT size (default 4096)
  hop?: number; // hop in samples (default 1024)
}

export interface Spectrogram {
  real: Float32Array[]; // [frame][bin], bins = size/2+1
  imag: Float32Array[];
  frames: number;
  bins: number;
  size: number;
  hop: number;
  length: number; // original signal length
}

function hann(n: number, i: number): number {
  return 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
}

export function stft(signal: Float32Array, options: StftOptions = {}): Spectrogram {
  const { size = 4096, hop = 1024 } = options;
  const bins = size / 2 + 1;
  const frames = Math.max(0, Math.floor((signal.length - size) / hop) + 1);
  const real: Float32Array[] = [];
  const imag: Float32Array[] = [];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = (signal[start + i] ?? 0) * hann(size, i);
      im[i] = 0;
    }
    fftInPlace(re, im);
    const r = new Float32Array(bins);
    const m = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      r[k] = re[k];
      m[k] = im[k];
    }
    real.push(r);
    imag.push(m);
  }
  return { real, imag, frames, bins, size, hop, length: signal.length };
}

export function istft(spec: Spectrogram): Float32Array {
  const { real, imag, frames, bins, size, hop, length } = spec;
  const out = new Float64Array(length);
  const wsum = new Float64Array(length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < bins; k++) {
      re[k] = real[f][k];
      im[k] = imag[f][k];
    }
    // Reconstruct full spectrum (conjugate mirror).
    for (let k = bins; k < size; k++) {
      re[k] = re[size - k];
      im[k] = -im[size - k];
    }
    // Inverse DFT via conjugated forward FFT.
    for (let k = 0; k < size; k++) im[k] = -im[k];
    fftInPlace(re, im);
    const start = f * hop;
    for (let i = 0; i < size && start + i < length; i++) {
      const w = hann(size, i);
      out[start + i] += (re[i] / size) * w;
      wsum[start + i] += w * w;
    }
  }
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = wsum[i] > 1e-8 ? out[i] / wsum[i] : 0;
  }
  return result;
}

/** Sliding median of values at radius r around index i (clamped edges). */
function medianAt(get: (i: number) => number, n: number, i: number, r: number): number {
  const win: number[] = [];
  for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) win.push(get(j));
  win.sort((a, b) => a - b);
  const mid = win.length >> 1;
  return win.length % 2 === 1 ? win[mid] : (win[mid - 1] + win[mid]) / 2;
}

export interface HpssResult {
  harmonic: Float32Array;
  percussive: Float32Array;
}

export function hpss(
  signal: Float32Array,
  options: StftOptions & { timeRadius?: number; freqRadius?: number; power?: number } = {},
): HpssResult {
  const { timeRadius = 8, freqRadius = 8, power = 2 } = options;
  const spec = stft(signal, options);
  const { real, imag, frames, bins } = spec;
  const mag = (f: number, k: number): number => {
    const r = real[f][k];
    const m = imag[f][k];
    return Math.sqrt(r * r + m * m);
  };
  const harm: Spectrogram = {
    real: [],
    imag: [],
    frames,
    bins,
    size: spec.size,
    hop: spec.hop,
    length: spec.length,
  };
  const perc: Spectrogram = { ...harm, real: [], imag: [] };
  for (let f = 0; f < frames; f++) {
    const hr = new Float32Array(bins);
    const hi = new Float32Array(bins);
    const pr = new Float32Array(bins);
    const pi = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      const h = medianAt((ff) => mag(ff, k), frames, f, timeRadius);
      const p = medianAt((kk) => mag(f, kk), bins, k, freqRadius);
      const hp = Math.pow(h, power);
      const pp = Math.pow(p, power);
      const denom = hp + pp;
      const mh = denom > 0 ? hp / denom : 0.5;
      hr[k] = real[f][k] * mh;
      hi[k] = imag[f][k] * mh;
      pr[k] = real[f][k] * (1 - mh);
      pi[k] = imag[f][k] * (1 - mh);
    }
    harm.real.push(hr);
    harm.imag.push(hi);
    perc.real.push(pr);
    perc.imag.push(pi);
  }
  return { harmonic: istft(harm), percussive: istft(perc) };
}
