/**
 * T-M1 — tempo estimation + beat tracking on spectral-flux onset envelopes.
 * FFT 1024 / hop 256 (~5.3ms @48k). Autocorrelation tempo with explicit
 * 2x/0.5x disambiguation, then Ellis-style DP beat tracking.
 */
import { onsetStrength } from './onsets';

export interface TempoEstimate {
  bpm: number;
  confidence: number;
  /** Considered octave hypotheses, strongest first. */
  considered: number[];
}

export interface TempoOptions {
  minBpm?: number; // default 60
  maxBpm?: number; // default 180
}

/** Autocorrelation of the envelope at integer lags (normalized). */
function autocorr(env: Float32Array, maxLag: number): Float64Array {
  const ac = new Float64Array(maxLag + 1);
  let e0 = 0;
  for (let i = 0; i < env.length; i++) e0 += env[i] * env[i];
  if (e0 <= 0) return ac;
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    ac[lag] = s / e0;
  }
  return ac;
}

export function estimateTempo(
  samples: Float32Array,
  sampleRate = 48000,
  options: TempoOptions = {},
): TempoEstimate | null {
  const { minBpm = 60, maxBpm = 180 } = options;
  const { envelope: env, hop } = onsetStrength(samples, sampleRate, {
    frameSize: 1024,
    hop: 256,
  });
  let max = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > max) max = env[i];
  if (max <= 0) return null;
  const fps = sampleRate / hop;
  const minLag = Math.max(1, Math.floor((60 / maxBpm) * fps));
  const maxLag = Math.min(env.length - 1, Math.ceil((60 / minBpm) * fps));
  if (maxLag <= minLag) return null;
  const ac = autocorr(env, maxLag);
  // Log-gaussian prior centered at 120 BPM (Ellis-style weighting).
  const prior = (bpm: number): number => {
    const x = Math.log2(bpm / 120);
    return Math.exp(-0.5 * Math.pow(x / 0.7, 2));
  };
  let bestLag = minLag;
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const score = ac[lag] * (0.5 + 0.5 * prior(bpm));
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // Octave disambiguation on raw autocorrelation strength.
  let period = bestLag;
  const at = (lag: number): number =>
    lag >= 0 && lag <= maxLag ? ac[Math.round(lag)] : 0;
  if (at(period / 2) > 0.9 * at(period) && period / 2 >= minLag) {
    period = period / 2; // half-period stronger -> twice as fast
  } else if (at(period * 2) > 0.95 * at(period) && period * 2 <= maxLag) {
    period = period * 2; // double-period stronger -> half as fast
  }
  const bpm = (60 * fps) / period;
  const clamp = (b: number): number => Math.min(maxBpm * 2, Math.max(minBpm / 2, b));
  const considered = [bpm, bpm / 2, bpm * 2]
    .map((b) => Math.round(clamp(b) * 10) / 10)
    .filter((b, i, arr) => arr.indexOf(b) === i);
  let confidence = Math.min(1, ac[Math.round(period)] * 2);
  // Weak/no-pulse material (sustained pads, ambient washes) must not
  // report full confidence: require salient onsets per unit energy.
  // (Onset COUNT alone fails — beating partials forge flux peaks.)
  let meanFlux = 0;
  for (let i = 0; i < env.length; i++) meanFlux += env[i];
  meanFlux /= Math.max(1, env.length);
  let meanRms = 0;
  let blocks = 0;
  for (let i = 0; i < samples.length; i += hop) {
    let s = 0;
    const n = Math.min(hop, samples.length - i);
    for (let j = i; j < i + n; j++) s += samples[j] * samples[j];
    meanRms += Math.sqrt(s / n);
    blocks++;
  }
  meanRms /= Math.max(1, blocks);
  const salience = meanFlux / (meanRms + 1e-9);
  confidence *= Math.min(1, salience / 150);
  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    considered,
  };
}

export interface BeatOptions {
  /** Tightness of the tempo prior in the DP (default 0.08). */
  tightness?: number;
}

/**
 * Ellis-style DP beat tracker: states are envelope frames, transitions
 * score log-probability around the expected beat period. Returns beat
 * times in seconds covering the signal.
 */
export function trackBeats(
  samples: Float32Array,
  bpm: number,
  sampleRate = 48000,
  options: BeatOptions = {},
): number[] {
  const { tightness = 0.08 } = options;
  if (!(bpm > 0)) return [];
  const { envelope: env, hop } = onsetStrength(samples, sampleRate, {
    frameSize: 1024,
    hop: 256,
  });
  const n = env.length;
  if (n === 0) return [];
  const fps = sampleRate / hop;
  const period = (60 / bpm) * fps;
  const dp = new Float64Array(n).fill(-Infinity);
  const prev = new Int32Array(n).fill(-1);
  const minPrev = Math.max(1, Math.floor(period * 0.5));
  const maxPrev = Math.ceil(period * 2);
  const logTrans = (dt: number): number => {
    const x = Math.log(dt / period);
    return -0.5 * Math.pow(x / tightness, 2);
  };
  for (let t = 0; t < n; t++) {
    let best = env[t] * 0.1; // start-a-track-here bias (weak)
    let bestP = -1;
    const from = Math.max(0, t - maxPrev);
    const to = t - minPrev;
    for (let p = from; p <= to; p++) {
      if (dp[p] === -Infinity) continue;
      const v = dp[p] + logTrans(t - p) + env[t];
      if (v > best) {
        best = v;
        bestP = p;
      }
    }
    dp[t] = best;
    prev[t] = bestP;
  }
  // Backtrack from the best state in the final period.
  let end = n - 1;
  let bestEnd = dp[end];
  const searchFrom = Math.max(0, n - Math.ceil(period * 1.5));
  for (let t = searchFrom; t < n; t++) {
    if (dp[t] > bestEnd) {
      bestEnd = dp[t];
      end = t;
    }
  }
  const frames: number[] = [];
  let cur: number | null = end;
  let guard = n + 1;
  while (cur !== null && cur >= 0 && guard-- > 0) {
    frames.push(cur);
    cur = prev[cur] >= 0 ? prev[cur] : null;
  }
  frames.reverse();
  return frames.map((f) => Math.round(((f * hop) / sampleRate) * 1000) / 1000);
}
