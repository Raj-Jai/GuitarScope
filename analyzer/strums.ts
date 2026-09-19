/**
 * T-M2 — strum-onset detection WITHOUT direction (direction is M3).
 * Band-split spectral flux (low 80-250 / mid 250-1000 / high 1-6k Hz) +
 * centroid + RMS attack, merged per attack neighborhood into single
 * strum events with ABSOLUTE timestamps. Beat/subdivision quantization
 * happens later (M4) — events carry beatIndex -1 / slotsPerBeat 1.
 */
import { stft } from '../src/lib/dsp/hpss';
import { detectOnsets } from '../src/lib/dsp/onsets';
import type { StrumEvent } from './schema';

export interface StrumFeatures {
  time: number;
  lowFlux: number;
  midFlux: number;
  highFlux: number;
  centroidHz: number;
  rmsAttack: number;
}

export interface StrumOptions {
  frameSize?: number; // default 2048
  hop?: number; // default 512
  /** Neighborhood for feature pooling around a candidate, seconds (default 0.03). */
  neighborhood?: number;
  /** Raw candidate gap, seconds (default 0.03 — flams/partials stay separate here). */
  minGap?: number;
  /**
   * Merge window, seconds (default 0.12): consecutive candidates closer
   * than this form ONE strum at the strongest candidate. Absorbs beating
   * artifacts and flam partials; 16ths faster than ~120ms merge (v1 limit).
   */
  mergeWindow?: number;
}

interface Band {
  lo: number;
  hi: number;
}

const LOW: Band = { lo: 80, hi: 250 };
const MID: Band = { lo: 250, hi: 1000 };
const HIGH: Band = { lo: 1000, hi: 6000 };

function bandEnergy(
  real: Float32Array,
  imag: Float32Array,
  sampleRate: number,
  fftSize: number,
  band: Band,
): number {
  const binHz = sampleRate / fftSize;
  let e = 0;
  const loBin = Math.max(1, Math.floor(band.lo / binHz));
  const hiBin = Math.min(real.length - 1, Math.ceil(band.hi / binHz));
  for (let k = loBin; k <= hiBin; k++) {
    e += real[k] * real[k] + imag[k] * imag[k];
  }
  return e;
}

/** Per-frame band fluxes + centroid + rms, one row per STFT frame. */
export function strumFeatureFrames(
  samples: Float32Array,
  sampleRate = 48000,
  options: StrumOptions = {},
): { times: number[]; rows: StrumFeatures[]; hop: number } {
  const { frameSize = 2048, hop = 512 } = options;
  const spec = stft(samples, { size: frameSize, hop });
  const binHz = sampleRate / frameSize;
  const times: number[] = [];
  const rows: StrumFeatures[] = [];
  let prevLow = 0;
  let prevMid = 0;
  let prevHigh = 0;
  for (let f = 0; f < spec.frames; f++) {
    const re = spec.real[f];
    const im = spec.imag[f];
    const low = bandEnergy(re, im, sampleRate, frameSize, LOW);
    const mid = bandEnergy(re, im, sampleRate, frameSize, MID);
    const high = bandEnergy(re, im, sampleRate, frameSize, HIGH);
    let num = 0;
    let den = 0;
    for (let k = 1; k < spec.bins; k++) {
      const m = Math.hypot(re[k], im[k]);
      num += k * binHz * m;
      den += m;
    }
    let rmsE = 0;
    const start = f * hop;
    const n = Math.min(hop, samples.length - start);
    for (let i = 0; i < n; i++) rmsE += samples[start + i] * samples[start + i];
    rmsE = n > 0 ? Math.sqrt(rmsE / n) : 0;
    rows.push({
      time: (f * hop) / sampleRate,
      lowFlux: Math.max(0, low - prevLow),
      midFlux: Math.max(0, mid - prevMid),
      highFlux: Math.max(0, high - prevHigh),
      centroidHz: den > 0 ? num / den : 0,
      rmsAttack: rmsE,
    });
    times.push((f * hop) / sampleRate);
    prevLow = low;
    prevMid = mid;
    prevHigh = high;
  }
  return { times, rows, hop };
}

/**
 * Detect strums: full-band onset candidates, one event per attack
 * neighborhood with pooled band features. Direction stays '?'.
 */
export function detectStrums(
  samples: Float32Array,
  sampleRate = 48000,
  options: StrumOptions = {},
): StrumEvent[] {
  const { neighborhood = 0.03, minGap = 0.03, mergeWindow = 0.12 } = options;
  const candidates = detectOnsets(samples, sampleRate, {
    frameSize: 2048,
    hop: 512,
    minGap,
  });
  const { rows, hop } = strumFeatureFrames(samples, sampleRate, options);
  const frameSec = hop / sampleRate;
  const strengthAt = (t: number): number => {
    let best = 0;
    const i0 = Math.max(0, Math.floor((t - neighborhood) / frameSec));
    const i1 = Math.min(rows.length - 1, Math.ceil((t + neighborhood) / frameSec));
    for (let i = i0; i <= i1; i++) {
      best = Math.max(best, rows[i].lowFlux + rows[i].midFlux + rows[i].highFlux);
    }
    return best;
  };
  // Group consecutive candidates within mergeWindow; emit the strongest.
  const groups: number[][] = [];
  for (const t of candidates) {
    const g = groups[groups.length - 1];
    if (g && t - g[g.length - 1] < mergeWindow) g.push(t);
    else groups.push([t]);
  }
  const peaks = groups.map((g) => {
    let best = g[0];
    let bestS = -1;
    for (const t of g) {
      const s = strengthAt(t);
      if (s > bestS) {
        bestS = s;
        best = t;
      }
    }
    return { time: best, strength: bestS };
  });
  const maxPeak = Math.max(1e-9, ...peaks.map((p) => p.strength));
  return peaks.map((p) => ({
    time: Math.round(p.time * 1000) / 1000,
    beatIndex: -1,
    subdivision: 0,
    slotsPerBeat: 1,
    direction: '?' as const,
    confidence: Math.round(Math.min(1, p.strength / maxPeak) * 100) / 100,
    strength: Math.round(Math.min(1, p.strength / maxPeak) * 100) / 100,
  }));
}
