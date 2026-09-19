import { describe, expect, test } from 'vitest';
import { directionEvidence } from '../../analyzer/strum-direction';
import { harmonicTone } from '../lib/dsp/synth';

const SR = 48000;
const STRINGS = [82.4069, 110, 146.8318, 195.9977, 246.9417, 329.6276]; // low -> high

/** Strummed chord with inter-string delay (ms); direction down = low first. */
function staggered(
  direction: 'D' | 'U' | 'flat',
  gapMs: number,
  startSec: number,
  total: Float32Array,
): void {
  const order = direction === 'U' ? [...STRINGS].reverse() : STRINGS;
  order.forEach((f, i) => {
    const at = direction === 'flat' ? startSec : startSec + (i * gapMs) / 1000;
    const part = harmonicTone(f, { sampleRate: SR, duration: 0.5, attack: 0.004, decay: 4 });
    const s0 = Math.floor(at * SR);
    for (let k = 0; k < part.length && s0 + k < total.length; k++) {
      total[s0 + k] += part[k] * 0.35;
    }
  });
}

function sequence(dirs: ('D' | 'U')[], gapMs: number): { audio: Float32Array; times: number[] } {
  const total = new Float32Array(SR * (dirs.length * 0.8 + 1));
  const times: number[] = [];
  dirs.forEach((d, i) => {
    const t = 0.3 + i * 0.8;
    times.push(t);
    staggered(d, gapMs, t, total);
  });
  return { audio: total, times };
}

describe('D/U direction evidence (8ms sweeps)', () => {
  test('downstrokes -> D', () => {
    const { audio, times } = sequence(['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D'], 8);
    const got = times.map((t) => directionEvidence(audio, SR, t));
    expect(got.every((g) => g.direction === 'D')).toBe(true);
  });

  test('upstrokes -> U', () => {
    const { audio, times } = sequence(['U', 'U', 'U', 'U', 'U', 'U', 'U', 'U'], 8);
    const got = times.map((t) => directionEvidence(audio, SR, t));
    expect(got.every((g) => g.direction === 'U')).toBe(true);
  });

  test('alternating D U resolves in order', () => {
    const { audio, times } = sequence(['D', 'U', 'D', 'U', 'D', 'U'], 8);
    expect(times.map((t) => directionEvidence(audio, SR, t).direction)).toEqual([
      'D', 'U', 'D', 'U', 'D', 'U',
    ]);
  });
});

describe('direction honesty', () => {
  test('simultaneous (no stagger) -> ? not fabricated', () => {
    const total = new Float32Array(SR * 3);
    staggered('flat', 8, 0.5, total);
    staggered('flat', 8, 1.5, total);
    const got = [0.5, 1.5].map((t) => directionEvidence(total, SR, t));
    expect(got.every((g) => g.direction === '?')).toBe(true);
  });

  test('tight 4ms sweeps: correct or ?, never wrong', () => {
    const total = new Float32Array(SR * 5);
    staggered('D', 4, 0.5, total);
    staggered('U', 4, 1.5, total);
    staggered('D', 4, 2.5, total);
    staggered('U', 4, 3.5, total);
    const expected = ['D', 'U', 'D', 'U'];
    [0.5, 1.5, 2.5, 3.5].forEach((t, i) => {
      const g = directionEvidence(total, SR, t);
      // Correct or unknown — a wrong decided label fails the test.
      expect(g.direction === expected[i] || g.direction === '?').toBe(true);
    });
  });
});
