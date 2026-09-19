import { describe, expect, test } from 'vitest';
import { detectStrums } from '../../analyzer/strums';
import { directionEvidence } from '../../analyzer/strum-direction';
import { extractPatterns, matchLibrary, quantizeStrums } from '../../analyzer/patterns';
import { harmonicTone } from '../lib/dsp/synth';

const SR = 48000;
const BPM = 100;
const BEAT = 60 / BPM;
const STRINGS = [82.4069, 110, 146.8318, 195.9977, 246.9417, 329.6276];

// Island pattern on 8th slots: 0:D 2:D 3:U 5:U 6:D (8ms string sweep).
const ISLAND: { slot: number; dir: 'D' | 'U' }[] = [
  { slot: 0, dir: 'D' },
  { slot: 2, dir: 'D' },
  { slot: 3, dir: 'U' },
  { slot: 5, dir: 'U' },
  { slot: 6, dir: 'D' },
];

function staggered(dir: 'D' | 'U', atSec: number, total: Float32Array): void {
  const order = dir === 'U' ? [...STRINGS].reverse() : STRINGS;
  order.forEach((f, i) => {
    const at = atSec + (i * 8) / 1000;
    const part = harmonicTone(f, { sampleRate: SR, duration: 0.4, attack: 0.004, decay: 5 });
    const s0 = Math.floor(at * SR);
    for (let k = 0; k < part.length && s0 + k < total.length; k++) total[s0 + k] += part[k] * 0.3;
  });
}

function songFixture(): { audio: Float32Array; beats: { time: number }[] } {
  // 8 bars, chord per bar (G D Am C x2), 0.6s lead-in so the first attack
  // has pre-roll flux (songs starting mid-air at t=0 are a known limit).
  const LEAD = 0.6;
  const bars = 8;
  const total = new Float32Array(Math.floor(SR * (LEAD + bars * 4 * BEAT + 1)));
  for (let bar = 0; bar < bars; bar++) {
    for (const s of ISLAND) {
      staggered(s.dir, LEAD + bar * 4 * BEAT + s.slot * (BEAT / 2), total);
    }
  }
  const beats: { time: number }[] = [];
  for (let i = 0; i < bars * 4; i++) beats.push({ time: LEAD + i * BEAT });
  return { audio: total, beats };
}

const CHORDS = [
  { start: 0.6, end: 3.0, label: 'G', root: 'G', quality: 'maj', confidence: 0.9, alternatives: [] },
  { start: 3.0, end: 5.4, label: 'D', root: 'D', quality: 'maj', confidence: 0.9, alternatives: [] },
  { start: 5.4, end: 7.8, label: 'Am', root: 'A', quality: 'min', confidence: 0.9, alternatives: [] },
  { start: 7.8, end: 10.2, label: 'C', root: 'C', quality: 'maj', confidence: 0.9, alternatives: [] },
  { start: 10.2, end: 12.6, label: 'G', root: 'G', quality: 'maj', confidence: 0.9, alternatives: [] },
  { start: 12.6, end: 15.0, label: 'D', root: 'D', quality: 'maj', confidence: 0.9, alternatives: [] },
  { start: 15.0, end: 17.4, label: 'Am', root: 'A', quality: 'min', confidence: 0.9, alternatives: [] },
  { start: 17.4, end: 19.8, label: 'C', root: 'C', quality: 'maj', confidence: 0.9, alternatives: [] },
];

describe('M4 exit: repeating island pattern over G-D-Am-C', () => {
  test('slot symbols exact, chord-bar alignment exact, library match', () => {
    const { audio, beats } = songFixture();
    const raw = detectStrums(audio, SR);
    const strums = raw.map((s) => ({
      ...s,
      direction: directionEvidence(audio, SR, s.time).direction,
    }));
    // Drop '?' (none expected on this clean fixture, but tolerate).
    const res = extractPatterns(strums, beats, CHORDS, 1);
    expect(res.patterns).toHaveLength(8);
    for (const [i, p] of res.patterns.entries()) {
      expect(p.symbols).toEqual(['D', '-', 'D', 'U', '-', 'U', 'D', '-']);
      expect(p.matchedPattern).toBe('island');
      expect(p.start).toBeCloseTo(0.6 + i * 2.4, 0);
    }
    // Slot accuracy: every sounding strum lands in a D/U slot.
    expect(res.slotAccuracyBasis).toBeGreaterThan(0.9);
  });

  test('quantize leaves off-grid strums unquantized', () => {
    const { beats } = songFixture();
    const off = [
      // 1.02s sits between 8th slots (0.9, 1.2) beyond tolerance.
      { time: 1.02, beatIndex: -1, subdivision: 0, slotsPerBeat: 1, direction: 'D' as const, confidence: 0.9, strength: 0.9 },
    ];
    const { quantized, unquantized } = quantizeStrums(off, beats);
    expect(quantized).toHaveLength(0);
    expect(unquantized).toHaveLength(1);
  });

  test('library matching rejects distant patterns', () => {
    expect(matchLibrary(['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U'])?.id).toBe('alt-8');
    expect(matchLibrary(['U', 'U', 'U', 'U', 'U', 'U', 'U', 'U'])?.id).toBeUndefined();
  });
});
