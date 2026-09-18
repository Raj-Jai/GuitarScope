/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara 2002).
 *
 * Primary monophonic pitch detector. Steps:
 *  1. Difference function d[tau] = Σ (x[j] - x[j+tau])²
 *  2. Cumulative-mean-normalized difference d'[tau]
 *  3. Absolute threshold: first dip below `threshold`
 *  4. Local minimum + parabolic interpolation → sub-sample period
 *
 * Returns null when no periodic candidate passes the threshold
 * (caller maps this to NO_SIGNAL / UNCERTAIN).
 */

export interface YinOptions {
  sampleRate?: number;
  /** Lowest detectable frequency (Hz). Default 40 (below E2=82.4). */
  minFrequency?: number;
  /** Highest detectable frequency (Hz). Default 1000. */
  maxFrequency?: number;
  /** CMND threshold. Default 0.10 (YIN paper's recommendation). */
  threshold?: number;
}

export interface YinResult {
  /** Estimated fundamental in Hz. */
  frequency: number;
  /** Estimated period in samples (fractional, interpolated). */
  period: number;
  /** Aperiodicity d'[tau] at chosen minimum (0 = perfectly periodic). */
  aperiodicity: number;
  /** Confidence 0..1 (1 - aperiodicity, clamped). */
  confidence: number;
}

export function yinDetect(
  frame: ArrayLike<number>,
  options: YinOptions = {},
): YinResult | null {
  const {
    sampleRate = 48000,
    minFrequency = 40,
    maxFrequency = 1000,
    threshold = 0.1,
  } = options;
  const n = frame.length;
  if (n < 16) return null;

  const minPeriod = Math.max(2, Math.floor(sampleRate / maxFrequency));
  let maxPeriod = Math.floor(sampleRate / minFrequency);
  // Difference function needs j+tau < n.
  maxPeriod = Math.min(maxPeriod, n - 1);
  if (maxPeriod <= minPeriod) return null;

  // 1. Difference function.
  const size = maxPeriod + 1;
  const diff = new Float64Array(size);
  for (let tau = minPeriod; tau <= maxPeriod; tau++) {
    let sum = 0;
    for (let j = 0; j + tau < n; j++) {
      const d = frame[j] - frame[j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // 2. Cumulative mean normalized difference.
  const cmnd = new Float64Array(size);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxPeriod; tau++) {
    runningSum += diff[tau];
    cmnd[tau] =
      runningSum === 0 ? 1 : (diff[tau] * tau) / runningSum;
  }

  // 3. Absolute threshold: first tau in range dipping below threshold.
  let tauEstimate = -1;
  for (let tau = minPeriod; tau <= maxPeriod; tau++) {
    if (cmnd[tau] < threshold) {
      // 4. Walk to local minimum.
      while (tau + 1 <= maxPeriod && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) return null;

  // 5. Parabolic interpolation around the minimum (YIN eq. 12-14).
  let period = tauEstimate;
  if (tauEstimate > minPeriod && tauEstimate < maxPeriod) {
    const s0 = cmnd[tauEstimate - 1];
    const s1 = cmnd[tauEstimate];
    const s2 = cmnd[tauEstimate + 1];
    const denom = s0 + s2 - 2 * s1;
    if (denom !== 0) {
      const shift = (0.5 * (s0 - s2)) / denom;
      // Clamp shift to avoid wild extrapolation on noisy minima.
      if (Number.isFinite(shift) && Math.abs(shift) <= 1) {
        period = tauEstimate + shift;
      }
    }
  }

  const aperiodicity = cmnd[tauEstimate];
  return {
    frequency: sampleRate / period,
    period,
    aperiodicity,
    confidence: Math.min(1, Math.max(0, 1 - aperiodicity)),
  };
}
