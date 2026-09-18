/**
 * Benchmark suite: accuracy + latency of both pipelines on synthetic
 * guitar-like signals. Prints a report table and asserts thresholds.
 * Run: vitest run src/test/benchmark.test.ts
 */
import { describe, expect, test } from 'vitest';
import { detectPitch } from '../lib/pitch/pitch-detector';
import { detectChord } from '../lib/analysis/polyphonic';
import {
  GUITAR_HARMONICS,
  WEAK_FUNDAMENTAL_HARMONICS,
  chordTone,
  harmonicTone,
  takeFrame,
} from '../lib/dsp/synth';
import { centsOffset } from '../lib/notes/cents';

const SR = 48000;

interface Row {
  test: string;
  expected: string;
  detected: string;
  correct: boolean;
  latencyMs: number;
  confidence: number;
  detail: string;
}

const rows: Row[] = [];

function timed<T>(fn: () => T): { result: T; ms: number } {
  const t0 = performance.now();
  const result = fn();
  return { result, ms: performance.now() - t0 };
}

describe('benchmark: monophonic open strings', () => {
  const strings = [
    { freq: 82.4069, note: 'E2' },
    { freq: 110, note: 'A2' },
    { freq: 146.8318, note: 'D3' },
    { freq: 195.9977, note: 'G3' },
    { freq: 246.9417, note: 'B3' },
    { freq: 329.6276, note: 'E4' },
  ];
  for (const s of strings) {
    test(`clean ${s.note}`, () => {
      const signal = harmonicTone(s.freq, { sampleRate: SR, duration: 0.5 });
      const { result: r, ms } = timed(() =>
        detectPitch(takeFrame(signal, 8000, 4096), { sampleRate: SR }),
      );
      const ok = r.note === s.note;
      rows.push({
        test: `mono clean ${s.note}`,
        expected: s.note,
        detected: r.note ?? r.status,
        correct: ok,
        latencyMs: ms,
        confidence: r.confidence,
        detail: `${r.frequency?.toFixed(2)}Hz ${r.cents?.toFixed(1)}c${r.octaveCorrected ? ' oct-corr' : ''}`,
      });
      expect(ok).toBe(true);
    });

    test(`noisy ${s.note}`, () => {
      const signal = harmonicTone(s.freq, {
        sampleRate: SR,
        duration: 0.5,
        noiseLevel: 0.03,
      });
      const { result: r, ms } = timed(() =>
        detectPitch(takeFrame(signal, 8000, 4096), { sampleRate: SR }),
      );
      const ok = r.note === s.note;
      rows.push({
        test: `mono noisy ${s.note}`,
        expected: s.note,
        detected: r.note ?? r.status,
        correct: ok,
        latencyMs: ms,
        confidence: r.confidence,
        detail: `${r.frequency?.toFixed(2)}Hz`,
      });
      expect(ok).toBe(true);
    });
  }

  test('weak fundamental E2 (octave trap)', () => {
    const signal = harmonicTone(82.4069, {
      sampleRate: SR,
      duration: 0.5,
      harmonics: WEAK_FUNDAMENTAL_HARMONICS,
    });
    const { result: r, ms } = timed(() =>
      detectPitch(takeFrame(signal, 8000, 4096), { sampleRate: SR }),
    );
    const octaveErr =
      r.frequency !== null &&
      Math.abs(centsOffset(r.frequency, 82.4069)) > 600;
    rows.push({
      test: 'mono weak-fund E2',
      expected: 'E2',
      detected: r.note ?? r.status,
      correct: r.note === 'E2',
      latencyMs: ms,
      confidence: r.confidence,
      detail: octaveErr ? 'OCTAVE ERROR' : `${r.frequency?.toFixed(2)}Hz`,
    });
    expect(r.note).toBe('E2');
    expect(octaveErr).toBe(false);
  });
});

describe('benchmark: chords (triads + sevenths)', () => {
  const cases = [
    { name: 'C', freqs: [130.8128, 164.8138, 196.0] },
    { name: 'Cm', freqs: [130.8128, 155.5635, 196.0] },
    { name: 'C7', freqs: [130.8128, 164.8138, 196.0, 233.0818] },
    { name: 'Cmaj7', freqs: [130.8128, 164.8138, 196.0, 246.9417] },
    { name: 'Cm7', freqs: [130.8128, 155.5635, 196.0, 233.0818] },
    { name: 'D', freqs: [146.8318, 185.0, 220.0] },
    { name: 'Dm', freqs: [146.8318, 174.6141, 220.0] },
    { name: 'E', freqs: [82.4069, 103.8262, 123.4708] },
    { name: 'Em', freqs: [82.4069, 98.0, 123.4708] },
    { name: 'F', freqs: [87.3071, 110.0, 130.8128] },
    { name: 'G', freqs: [98.0, 123.4708, 146.8318] },
    { name: 'A', freqs: [110, 138.5913, 164.8138] },
    { name: 'Am', freqs: [110, 130.8128, 164.8138] },
    { name: 'A7', freqs: [110, 138.5913, 164.8138, 196.0] },
    { name: 'Am7', freqs: [110, 130.8128, 164.8138, 196.0] },
    { name: 'B', freqs: [123.4708, 155.5635, 185.0] },
    { name: 'Bm', freqs: [123.4708, 146.8318, 185.0] },
  ];
  for (const c of cases) {
    test(`chord ${c.name}`, () => {
      const signal = chordTone(c.freqs, { sampleRate: SR, duration: 1.0 });
      const { result: r, ms } = timed(() =>
        detectChord(takeFrame(signal, 12000, 16384), { sampleRate: SR }),
      );
      const ok = r.chord?.name === c.name;
      rows.push({
        test: `chord ${c.name}`,
        expected: c.name,
        detected: r.chord?.name ?? r.status,
        correct: ok,
        latencyMs: ms,
        confidence: r.confidence,
        detail: `root ${r.chord ? 'ok?' : '-'}`,
      });
      expect(r.chord?.name).toBe(c.name);
    });
  }
});

describe('benchmark report', () => {
  test('print + assert aggregate thresholds', () => {
    const mono = rows.filter((r) => r.test.startsWith('mono'));
    const chords = rows.filter((r) => r.test.startsWith('chord'));
    const acc = (rs: Row[]) => rs.filter((r) => r.correct).length / rs.length;
    const avgLat = (rs: Row[]) =>
      rs.reduce((a, r) => a + r.latencyMs, 0) / rs.length;

    console.log('\nTest | Expected | Detected | Correct | LatencyMs | Conf | Detail');
    for (const r of rows) {
      console.log(
        `${r.test} | ${r.expected} | ${r.detected} | ${r.correct ? 'YES' : 'NO'} | ${r.latencyMs.toFixed(2)} | ${r.confidence.toFixed(2)} | ${r.detail}`,
      );
    }
    console.log(
      `\nMONO accuracy ${(acc(mono) * 100).toFixed(1)}% (${mono.length} tests), avg latency ${avgLat(mono).toFixed(2)}ms/frame`,
    );
    console.log(
      `CHORD accuracy ${(acc(chords) * 100).toFixed(1)}% (${chords.length} tests), avg latency ${avgLat(chords).toFixed(2)}ms/frame`,
    );

    expect(acc(mono)).toBe(1);
    expect(acc(chords)).toBe(1);
    // Smoke-gate budgets (generous: CI/shared boxes vary; the REPORTED
    // numbers above are the real evidence — typical dev-hardware avgs are
    // ~5ms mono / ~2ms chord, asserted strictly only in isolation).
    expect(avgLat(mono)).toBeLessThan(60);
    expect(avgLat(chords)).toBeLessThan(300);
  });
});

// Silence unused-harmonics import warning guard.
void GUITAR_HARMONICS;
