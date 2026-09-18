import { describe, expect, test } from 'vitest';
import { analyzeWithBranches, centerDiff } from '../../analyzer/branches';
import { analyzeFrames } from '../../analyzer/frames';
import { decodeChords } from '../../analyzer/decode';
import { scoreChords } from '../../analyzer/score';
import { chordTone } from '../lib/dsp/synth';

const SR = 48000;
const HOP = 4096 / SR;

/** Vibrato lead line (proper FM phase integration). */
function vocalLine(notes: { freq: number; start: number; dur: number }[], total: number): Float32Array {
  const out = new Float32Array(total);
  for (const n of notes) {
    let phase = 0;
    const s0 = Math.floor(n.start * SR);
    const s1 = Math.min(total, s0 + Math.floor(n.dur * SR));
    for (let i = s0; i < s1; i++) {
      const t = i / SR;
      const f = n.freq * Math.pow(2, (0.5 * Math.sin(2 * Math.PI * 5.5 * t)) / 12);
      phase += (2 * Math.PI * f) / SR;
      // Gentle syllable envelope to avoid clicks.
      const local = (i - s0) / Math.max(1, s1 - s0);
      const env = Math.min(1, local * 10, (1 - local) * 10);
      out[i] += 0.45 * Math.sin(phase) * Math.max(0, env);
    }
  }
  return out;
}

function clicks(total: number, everySec: number, amp: number): Float32Array {
  const out = new Float32Array(total);
  for (let t = 0; t < total / SR; t += everySec) {
    const at = Math.floor(t * SR);
    for (let i = 0; i < 48 && at + i < total; i++) {
      out[at + i] += (i % 2 === 0 ? 1 : -1) * amp * (1 - i / 48);
    }
  }
  return out;
}

/**
 * Stereo band mock: guitar panned left, centered vocal + clicks.
 * True chart: G(0-4) D(4-8) Am(8-12) C(12-16).
 */
function bandFixture(): { left: Float32Array; right: Float32Array } {
  const total = SR * 16;
  const prog = [
    [196.0, 246.9417, 293.6648],
    [146.8318, 185.0, 220.0],
    [110, 130.8128, 164.8138],
    [130.8128, 164.8138, 196.0],
  ];
  // Vocal melody with non-chord passing tones to mislead raw chroma.
  const melodies = [
    [392.0, 493.88, 440.0, 392.0], // G B A(pass) G
    [587.33, 523.25, 493.88, 587.33], // D C(pass?) ... C is non-chord in D
    [440.0, 523.25, 493.88, 440.0], // A C B(pass) A
    [523.25, 659.25, 587.33, 523.25], // C E D(pass) C
  ];
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  prog.forEach((freqs, ci) => {
    const part = chordTone(freqs, { sampleRate: SR, duration: 4 });
    for (let i = 0; i < part.length; i++) {
      const at = ci * SR * 4 + i;
      left[at] += part[i] * 1.0;
      right[at] += part[i] * 0.35;
    }
    const notes = melodies[ci].map((freq, k) => ({ freq, start: ci * 4 + k, dur: 1 }));
    const vox = vocalLine(notes, total);
    const clk = clicks(total, 0.5, 0.4);
    for (let i = 0; i < total; i++) {
      left[i] += (vox[i] + clk[i]) * 0.5;
      right[i] += (vox[i] + clk[i]) * 0.5;
    }
  });
  // Normalize.
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const g = peak > 1 ? 0.98 / peak : 1;
  for (let i = 0; i < total; i++) {
    left[i] *= g;
    right[i] *= g;
  }
  return { left, right };
}

const REF = [
  { start: 0, end: 4, label: 'G' },
  { start: 4, end: 8, label: 'D' },
  { start: 8, end: 12, label: 'Am' },
  { start: 12, end: 16, label: 'C' },
];

function accuracy(frames: { time: number; candidates: { label: string }[] }[]): number {
  let ok = 0;
  let n = 0;
  for (const f of frames) {
    const seg = REF.find((r) => f.time >= r.start + 0.4 && f.time < r.end - 0.4);
    if (!seg) continue;
    n++;
    if (f.candidates[0]?.label === seg.label) ok++;
  }
  return n ? ok / n : 0;
}

function flips(frames: { candidates: { label: string }[] }[]): number {
  let f = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].candidates[0]?.label !== frames[i - 1].candidates[0]?.label) f++;
  }
  return f;
}

describe('vocal-contaminated band: raw vs agreed branches', () => {
  test('agreement beats raw on accuracy and stability', () => {
    const { left, right } = bandFixture();
    const mono = left.map((v, i) => (v + right[i]) / 2);
    const raw = analyzeFrames(mono, { sampleRate: SR }).frames;
    const { agreed, agreeRate } = analyzeWithBranches({ left, right }, { sampleRate: SR });
    const rawAcc = accuracy(raw);
    const agreedAcc = accuracy(agreed);
    console.log(`raw acc=${rawAcc.toFixed(2)} flips=${flips(raw)} | agreed acc=${agreedAcc.toFixed(2)} flips=${flips(agreed)} agreeRate=${agreeRate.toFixed(2)}`);
    expect(rawAcc).toBeLessThan(1); // fixture must actually challenge raw
    expect(agreedAcc).toBeGreaterThanOrEqual(rawAcc);
    expect(flips(agreed)).toBeLessThanOrEqual(flips(raw));
  }, 120000);

  test('agreed frames decode to the true progression', () => {
    const { left, right } = bandFixture();
    const { agreed } = analyzeWithBranches({ left, right }, { sampleRate: SR });
    const events = decodeChords(agreed, {}, HOP);
    const s = scoreChords(events, REF);
    console.log(`decoded=${events.map((e) => e.label).join(',')} weighted=${s.weightedAccuracy.toFixed(2)}`);
    expect(s.weightedAccuracy).toBeGreaterThan(0.6);
  }, 120000);

  test('centerDiff suppresses centered content', () => {
    const { left, right } = bandFixture();
    const diff = centerDiff(left, right);
    // Guitar (panned) survives; centered vocal largely cancels.
    let eDiff = 0;
    let eMono = 0;
    for (let i = 0; i < diff.length; i++) {
      eDiff += diff[i] * diff[i];
      const m = (left[i] + right[i]) / 2;
      eMono += m * m;
    }
    expect(eDiff).toBeGreaterThan(0.05 * eMono);
    expect(eDiff).toBeLessThan(eMono);
  });
});
