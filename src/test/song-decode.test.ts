import { describe, expect, test } from 'vitest';
import { decodeChords, smoothFrames } from '../../analyzer/decode';
import { analyzeFrames } from '../../analyzer/frames';
import { scoreChords } from '../../analyzer/score';
import { chordTone } from '../lib/dsp/synth';

const SR = 48000;
const HOP = 4096 / SR;

function progressionFrames(): ReturnType<typeof analyzeFrames> {
  const prog = [
    [196.0, 246.9417, 293.6648], // G 0-8
    [146.8318, 185.0, 220.0], // D 8-16
    [110, 130.8128, 164.8138], // Am 16-24
    [130.8128, 164.8138, 196.0], // C 24-32
  ];
  const total = new Float32Array(SR * 32);
  prog.forEach((freqs, i) => {
    const part = chordTone(freqs, { sampleRate: SR, duration: 8 });
    total.set(part, i * SR * 8);
  });
  return analyzeFrames(total, { sampleRate: SR });
}

describe('temporal decoder on synthetic progression', () => {
  test('four chords with boundaries near 8/16/24s', () => {
    const { frames } = progressionFrames();
    const events = decodeChords(frames, {}, HOP);
    expect(events.map((e) => e.label)).toEqual(['G', 'D', 'Am', 'C']);
    expect(Math.abs(events[1].start - 8)).toBeLessThan(0.7);
    expect(Math.abs(events[2].start - 16)).toBeLessThan(0.7);
    expect(Math.abs(events[3].start - 24)).toBeLessThan(0.7);
  });

  test('decoded output scores ~1.0 against the known chart', () => {
    const { frames } = progressionFrames();
    const events = decodeChords(frames, {}, HOP);
    const ref = [
      { start: 0, end: 8, label: 'G' },
      { start: 8, end: 16, label: 'D' },
      { start: 16, end: 24, label: 'Am' },
      { start: 24, end: 32, label: 'C' },
    ];
    const s = scoreChords(events, ref);
    expect(s.weightedAccuracy).toBeGreaterThan(0.95);
    expect(s.rootAccuracy).toBeGreaterThan(0.95);
  });

  test('single-frame flicker is absorbed', () => {
    const { frames } = progressionFrames();
    // Corrupt a few isolated frames deep inside segments.
    frames[30].candidates = [{ label: 'F#m7', score: 0.9 }];
    frames[31].candidates = [{ label: 'F#m7', score: 0.9 }];
    frames[200].candidates = [{ label: 'Bb', score: 0.9 }];
    const events = decodeChords(frames, {}, HOP);
    expect(events.map((e) => e.label)).toEqual(['G', 'D', 'Am', 'C']);
  });

  test('silence decodes to NO_CHORD, never a forced label', () => {
    const { frames: f2 } = analyzeFrames(new Float32Array(SR * 3), { sampleRate: SR });
    const events = decodeChords(f2, {}, HOP);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.label === 'NO_CHORD')).toBe(true);
  });

  test('smoothing majority holds through a noisy patch', () => {
    const { frames } = progressionFrames();
    const smoothed = smoothFrames(frames, 7);
    // Middle of the G segment must still read G after smoothing.
    const mid = smoothed[Math.floor(smoothed.length / 8)];
    expect(mid.label).toBe('G');
  });
});
