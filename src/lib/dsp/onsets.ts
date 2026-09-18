/**
 * Spectral-flux onset detection (cheap baseline for note segmentation).
 * Positive log-magnitude spectral changes summed per frame, then
 * adaptive-threshold peak-picking. Pure functions, no dependencies
 * beyond the STFT in hpss.ts.
 */
import { stft } from './hpss';

export interface OnsetOptions {
  frameSize?: number; // default 2048
  hop?: number; // default 512 (~10.7ms @48k)
  /** Minimum gap between onsets in seconds (default 0.08). */
  minGap?: number;
  /** Peak threshold above local median, as fraction of global max (default 0.08). */
  delta?: number;
  /** Absolute flux floor (default 0.5). */
  floor?: number;
}

/** Onset-strength envelope (one value per STFT frame). */
export function onsetStrength(
  samples: Float32Array,
  _sampleRate = 48000,
  options: OnsetOptions = {},
): { envelope: Float32Array; hop: number } {
  const { frameSize = 2048, hop = 512 } = options;
  const spec = stft(samples, { size: frameSize, hop });
  const env = new Float32Array(spec.frames);
  let prev = new Float32Array(spec.bins);
  for (let f = 0; f < spec.frames; f++) {
    let flux = 0;
    for (let k = 1; k < spec.bins; k++) {
      const cur = Math.log1p(Math.hypot(spec.real[f][k], spec.imag[f][k]));
      const diff = cur - prev[k];
      if (diff > 0) flux += diff;
      prev[k] = cur;
    }
    env[f] = flux;
  }
  return { envelope: env, hop };
}

function medianSorted(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Peak-pick the onset envelope -> onset times in seconds. */
export function pickOnsets(
  envelope: Float32Array,
  sampleRate: number,
  hop: number,
  options: OnsetOptions & { frameSize?: number } = {},
): number[] {
  const { minGap = 0.08, delta = 0.08, floor = 0.5, frameSize = 2048 } = options;
  let max = 0;
  for (let i = 0; i < envelope.length; i++) if (envelope[i] > max) max = envelope[i];
  const onsets: number[] = [];
  let lastTime = -Infinity;
  const R = 10;
  for (let i = 0; i < envelope.length; i++) {
    const local: number[] = [];
    for (let j = Math.max(0, i - R); j <= Math.min(envelope.length - 1, i + R); j++) {
      local.push(envelope[j]);
    }
    const threshold = Math.max(floor, medianSorted(local) + delta * max);
    if (envelope[i] <= threshold) continue;
    // Local maximum in ±3 frames.
    let isPeak = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(envelope.length - 1, i + 3); j++) {
      if (envelope[j] > envelope[i]) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;
    // Frame CENTER time: the transient sits inside the window, not at its start.
    const t = (i * hop + frameSize / 2) / sampleRate;
    if (t - lastTime < minGap) continue;
    onsets.push(t);
    lastTime = t;
  }
  return onsets;
}

/** Convenience: onsets directly from samples. */
export function detectOnsets(
  samples: Float32Array,
  sampleRate = 48000,
  options: OnsetOptions = {},
): number[] {
  const frameSize = options.frameSize ?? 2048;
  const { envelope, hop } = onsetStrength(samples, sampleRate, { ...options, frameSize });
  return pickOnsets(envelope, sampleRate, hop, { ...options, frameSize });
}
