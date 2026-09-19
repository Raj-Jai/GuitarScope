import { describe, expect, test } from 'vitest';
import { estimateTempo, trackBeats } from '../lib/dsp/rhythm';
import { chordTone } from '../lib/dsp/synth';

const SR = 48000;

/** Metronome clicks with optional accent pattern (accentEvery=0: all equal). */
function metronome(bpm: number, seconds: number, accentEvery = 0): Float32Array {
  const total = new Float32Array(Math.floor(SR * seconds));
  const period = SR * (60 / bpm);
  let beat = 0;
  for (let t = 0; t < total.length; t += period, beat++) {
    const amp = accentEvery > 0 && beat % accentEvery === 0 ? 1 : 0.6;
    const at = Math.floor(t);
    for (let i = 0; i < 64 && at + i < total.length; i++) {
      total[at + i] += (i % 2 === 0 ? 1 : -1) * amp * (1 - i / 64);
    }
  }
  return total;
}

/** Strummed progression at a tempo: 8th-note strums, 4 chords. */
function strummedProg(bpm: number): { audio: Float32Array; beats: number[] } {
  const beat = 60 / bpm;
  const eighth = beat / 2;
  const chords = [
    [196.0, 246.9417, 293.6648],
    [146.8318, 185.0, 220.0],
    [110, 130.8128, 164.8138],
    [130.8128, 164.8138, 196.0],
  ];
  const total = new Float32Array(Math.floor(SR * beat * 16));
  const beats: number[] = [];
  let strum = 0;
  for (let bar = 0; bar < 4; bar++) {
    for (let e = 0; e < 8; e++) {
      const t = (bar * 4 + e * 0.5) * beat;
      if (e % 2 === 0) beats.push(t);
      const part = chordTone(chords[bar], { sampleRate: SR, duration: eighth * 0.95, attack: 0.005 });
      const s0 = Math.floor(t * SR);
      for (let i = 0; i < part.length && s0 + i < total.length; i++) {
        total[s0 + i] += part[i] * 0.5;
      }
      strum++;
    }
  }
  void strum;
  return { audio: total, beats };
}

describe('tempo estimation', () => {
  test.each([92, 100, 120, 140])('metronome %i BPM exact', (bpm) => {
    const est = estimateTempo(metronome(bpm, 8), SR);
    expect(est).not.toBeNull();
    expect(Math.abs((est as { bpm: number }).bpm - bpm)).toBeLessThan(1.5);
  });

  test('no 2x/0.5x octave error on even clicks', () => {
    const est = estimateTempo(metronome(100, 8), SR);
    expect(est?.bpm).toBeGreaterThan(75);
    expect(est?.bpm).toBeLessThan(135);
  });

  test('half-time accents still read the beat, not the bar', () => {
    const est = estimateTempo(metronome(90, 10, 2), SR);
    expect(est).not.toBeNull();
    expect(Math.abs((est as { bpm: number }).bpm - 90)).toBeLessThan(3);
  });

  test('strummed progression tempo within 2 BPM', () => {
    const { audio } = strummedProg(100);
    const est = estimateTempo(audio, SR);
    expect(est).not.toBeNull();
    expect(Math.abs((est as { bpm: number }).bpm - 100)).toBeLessThan(2);
  });

  test('silence returns null', () => {
    expect(estimateTempo(new Float32Array(SR * 2), SR)).toBeNull();
  });
});

describe('beat tracking', () => {
  test('metronome beats land within 30ms', () => {
    const bpm = 120;
    const beats = trackBeats(metronome(bpm, 6), bpm, SR);
    expect(beats.length).toBeGreaterThanOrEqual(10);
    for (const [i, b] of beats.slice(0, 10).entries()) {
      const expected = (i + Math.round((beats[0] * bpm) / 60)) * (60 / bpm);
      expect(Math.abs(b - expected)).toBeLessThan(0.03);
    }
  });

  test('strummed beats align to the grid', () => {
    const { audio, beats: ref } = strummedProg(100);
    const beats = trackBeats(audio, 100, SR);
    let matched = 0;
    for (const r of ref) {
      if (beats.some((b) => Math.abs(b - r) < 0.05)) matched++;
    }
    expect(matched / ref.length).toBeGreaterThan(0.85);
  });
});
