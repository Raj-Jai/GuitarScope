import { describe, expect, test } from 'vitest';
import { detectStrums, strumFeatureFrames } from '../../analyzer/strums';
import { chordTone } from '../lib/dsp/synth';

const SR = 48000;

function strumAt(freqs: number[], startSec: number, total: Float32Array, dur = 0.49): void {
  const part = chordTone(freqs, { sampleRate: SR, duration: dur, attack: 0.005, decay: 8 });
  const s0 = Math.floor(startSec * SR);
  for (let i = 0; i < part.length && s0 + i < total.length; i++) total[s0 + i] += part[i] * 0.6;
}

function scoreDetections(detected: number[], ref: number[], tol = 0.03): { p: number; r: number; f1: number } {
  const used = new Array<boolean>(detected.length).fill(false);
  let matched = 0;
  for (const r of ref) {
    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < detected.length; i++) {
      if (used[i]) continue;
      const err = Math.abs(detected[i] - r);
      if (err <= tol && err < bestErr) {
        best = i;
        bestErr = err;
      }
    }
    if (best >= 0) {
      used[best] = true;
      matched++;
    }
  }
  const p = detected.length ? matched / detected.length : ref.length === 0 ? 1 : 0;
  const r = ref.length ? matched / ref.length : 1;
  return { p, r, f1: p + r > 0 ? (2 * p * r) / (p + r) : 0 };
}

describe('strum-onset detection', () => {
  test('8 isolated strums: count + timing (P/R/F1)', () => {
    const total = new Float32Array(SR * 5);
    const G = [196.0, 246.9417, 293.6648];
    const ref = [0.3, 0.8, 1.3, 1.8, 2.3, 2.8, 3.3, 3.8];
    for (const t of ref) strumAt(G, t, total);
    const events = detectStrums(total, SR);
    const s = scoreDetections(events.map((e) => e.time), ref);
    console.log(`strums: ${events.length} events P=${s.p.toFixed(2)} R=${s.r.toFixed(2)} F1=${s.f1.toFixed(2)}`);
    // Every true strum found within tolerance...
    expect(s.r).toBe(1);
    // ...and every SALIENT event is a true strum (sub-0.2 residue such as
    // note-end transients is real acoustic flux, correctly labeled weak).
    const salient = events.filter((e) => e.strength >= 0.2);
    const sp = scoreDetections(salient.map((e) => e.time), ref);
    expect(sp.p).toBe(1);
    expect(salient).toHaveLength(8);
    // Schema: grid-agnostic (quantization is M4's job).
    for (const e of events) {
      expect(e.beatIndex).toBe(-1);
      expect(e.direction).toBe('?');
      expect(e.subdivision).toBe(0);
      expect(e.slotsPerBeat).toBe(1);
    }
  });

  test('30ms flam merges into one salient strum', () => {
    const total = new Float32Array(SR * 2);
    const G = [196.0, 246.9417, 293.6648];
    strumAt(G, 0.5, total);
    strumAt(G, 0.53, total);
    strumAt(G, 1.2, total);
    const events = detectStrums(total, SR);
    expect(events.filter((e) => e.strength >= 0.2)).toHaveLength(2);
  });

  test('band features separate low vs high onsets', () => {
    // Bass-only thump vs treble-only pluck: feature rows must differ.
    const bass = new Float32Array(SR * 1);
    strumAt([82.4069], 0.3, bass, 0.4);
    const treble = new Float32Array(SR * 1);
    strumAt([659.25], 0.3, treble, 0.4);
    const fb = strumFeatureFrames(bass, SR);
    const ft = strumFeatureFrames(treble, SR);
    const peak = (rows: { lowFlux: number; highFlux: number }[]): { lowFlux: number; highFlux: number } =>
      rows.reduce((a, b) => (a.lowFlux + a.highFlux > b.lowFlux + b.highFlux ? a : b));
    const pb = peak(fb.rows);
    const pt = peak(ft.rows);
    expect(pb.lowFlux).toBeGreaterThan(pb.highFlux);
    expect(pt.highFlux).toBeGreaterThan(pt.lowFlux);
  });

  test('silence yields no strums', () => {
    expect(detectStrums(new Float32Array(SR * 2), SR)).toEqual([]);
  });
});
