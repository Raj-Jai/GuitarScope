/**
 * T-M3 — down/up strum inference from acoustic evidence ONLY.
 * No grid, no alternation prior (that needs M4 quantization — without a
 * grid, rests are invisible and naive alternation misfires).
 *
 * Evidence is computed on the attack region only (±40 ms): whole-slice
 * statistics let decay wash out the 10-40 ms sweep that carries direction.
 *  - lagMs: lag of max cross-correlation (lowFlux x highFlux), computed
 *    on squared envelopes so loud attack frames dominate parallel decay
 *    tails. Positive = bass leads = downstroke. (Peak-time comparison
 *    fails: broadband pick noise peaks instantly in high bands while low
 *    resonance builds up.)
 *  - centroidSlope: energy-gated least-squares trend. Rising =
 *    bass-then-treble = downstroke. (Ungated fits lock onto the
 *    silence-to-tone step, a fake rising trend.)
 *
 * Decision:
 *  - |lagMs| > maxLagEvidence (28 ms) -> '?' unconditionally. Beyond the
 *    maximum plausible string-sweep span the lag is resonance artifact,
 *    not string order. This is what separates simultaneous pile-ups
 *    (lag ~-32 ms) from real sweeps; width/peak-count heuristics were
 *    tried and failed (beating hash defeats both — documented in tests).
 *  - else |score| >= threshold AND slope sign agrees with score sign,
 *    else '?'. (Lag alone misfires on tight ~20 ms sweeps.)
 * Low-confidence cases yield '?' — never a fabricated D/U.
 */
import { strumFeatureFrames } from './strums';
import type { StrumDirection } from './schema';

export interface DirectionEvidence {
  lagMs: number;
  centroidSlope: number; // Hz per ms, energy-gated least-squares fit
  score: number; // >0 down, <0 up
  direction: StrumDirection;
  confidence: number;
}

export interface DirectionOptions {
  region?: number; // seconds each side for evidence (default 0.04)
  maxLagMs?: number; // xcorr search range (default 40)
  threshold?: number; // |score| below this -> '?' (default 0.2)
  /** |lag| above this is unphysical as string order -> '?' (default 28). */
  maxEvidenceLagMs?: number;
}

export function directionEvidence(
  samples: Float32Array,
  sampleRate: number,
  strumTime: number,
  options: DirectionOptions = {},
): DirectionEvidence {
  const { region = 0.04, maxLagMs = 40, threshold = 0.2, maxEvidenceLagMs = 28 } = options;
  const start = Math.max(0, Math.floor((strumTime - 0.15) * sampleRate));
  const end = Math.min(samples.length, Math.ceil((strumTime + 0.15) * sampleRate));
  const slice = samples.slice(start, end);
  const t0 = start / sampleRate;
  const { rows } = strumFeatureFrames(slice, sampleRate, { frameSize: 1024, hop: 256 });
  const inRegion = (t: number): boolean => Math.abs(t0 + t - strumTime) <= region;
  const reg = rows.filter((r) => inRegion(r.time));

  const frameMs = (256 / sampleRate) * 1000;
  const low = reg.map((r) => r.lowFlux);
  const high = reg.map((r) => r.highFlux);
  const low2 = low.map((v) => v * v);
  const high2 = high.map((v) => v * v);
  const maxLagFrames = Math.max(1, Math.round(maxLagMs / frameMs));
  let bestLag = 0;
  let bestCorr = -Infinity;
  for (let lag = -maxLagFrames; lag <= maxLagFrames; lag++) {
    let s = 0;
    for (let i = 0; i < low2.length; i++) {
      const j = i + lag;
      if (j >= 0 && j < high2.length) s += low2[i] * high2[j];
    }
    if (s > bestCorr) {
      bestCorr = s;
      bestLag = lag;
    }
  }
  // bestLag > 0: low[i] aligns with high[i+lag], i.e. low LEADS by lag.
  const lagMs = bestLag * frameMs;

  // Energy-gated centroid slope (ignore near-silent frames).
  let peak = 0;
  for (const r of reg) {
    const e = r.lowFlux + r.midFlux + r.highFlux;
    if (e > peak) peak = e;
  }
  const loud = reg.filter((r) => r.lowFlux + r.midFlux + r.highFlux >= peak * 0.1);
  let slope = 0;
  if (loud.length >= 3) {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const r of loud) {
      const x = (t0 + r.time - (strumTime - region)) * 1000;
      sx += x;
      sy += r.centroidHz;
      sxx += x * x;
      sxy += x * r.centroidHz;
    }
    const n = loud.length;
    const denom = n * sxx - sx * sx;
    slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  }

  const lagNorm = Math.max(-1, Math.min(1, lagMs / 25));
  const slopeNorm = Math.max(-1, Math.min(1, slope / 30));
  const score = 0.55 * lagNorm + 0.45 * slopeNorm;
  let direction: StrumDirection = Math.abs(score) < threshold ? '?' : score > 0 ? 'D' : 'U';
  const slopeAgrees =
    direction === '?' ||
    (direction === 'D' && slope > 0) ||
    (direction === 'U' && slope < 0);
  if (!slopeAgrees || Math.abs(lagMs) > maxEvidenceLagMs) {
    direction = '?';
  }
  const confidence =
    direction === '?' ? Math.min(0.2, Math.abs(score)) : Math.min(1, Math.abs(score));
  return {
    lagMs: Math.round(lagMs * 10) / 10,
    centroidSlope: Math.round(slope * 100) / 100,
    score: Math.round(score * 100) / 100,
    direction,
    confidence: Math.round(confidence * 100) / 100,
  };
}
