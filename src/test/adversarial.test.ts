/**
 * Adversarial fixtures: detuning, hum, clipping, unequal chord voices,
 * dense voicings. Baselines for real-guitar validation — if any fail,
 * that is a recorded DSP limit, not a reason to redesign (per ADR-001).
 */
import { describe, expect, test } from 'vitest';
import { detectPitch } from '../lib/pitch/pitch-detector';
import { detectChord } from '../lib/analysis/polyphonic';
import {
  chordTone,
  harmonicTone,
  sineTone,
  takeFrame,
} from '../lib/dsp/synth';

const SR = 48000;
const sharp = (f: number, cents: number) => f * Math.pow(2, cents / 1200);

function mix(parts: Float32Array[]): Float32Array {
  const len = Math.max(...parts.map((p) => p.length));
  const out = new Float32Array(len);
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) out[i] += p[i];
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1) for (let i = 0; i < len; i++) out[i] /= peak;
  return out;
}

function scale(sig: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] * gain;
  return out;
}

describe('detuning', () => {
  test('+15c E2 still E2 with ~+15c readout', () => {
    const sig = harmonicTone(sharp(82.4069, 15), { sampleRate: SR, duration: 0.5 });
    const r = detectPitch(takeFrame(sig, 8000, 4096), { sampleRate: SR });
    expect(r.note).toBe('E2');
    expect(Math.abs((r.stringCents ?? 999) - 15)).toBeLessThan(4);
  });
  test('-20c A2 still A2, verdict FLAT', () => {
    const sig = harmonicTone(sharp(110, -20), { sampleRate: SR, duration: 0.5 });
    const r = detectPitch(takeFrame(sig, 8000, 4096), { sampleRate: SR });
    expect(r.note).toBe('A2');
    expect(r.tuning).toBe('FLAT');
  });
});

describe('hum and clipping', () => {
  test('E2 under 50Hz mains hum still E2', () => {
    const sig = mix([
      harmonicTone(82.4069, { sampleRate: SR, duration: 0.5 }),
      scale(sineTone(50, { sampleRate: SR, duration: 0.5 }), 0.08),
    ]);
    const r = detectPitch(takeFrame(sig, 8000, 4096), { sampleRate: SR });
    expect(r.note).toBe('E2');
  });
  test('hard-clipped E2 still E2', () => {
    const sig = harmonicTone(82.4069, { sampleRate: SR, duration: 0.5 });
    for (let i = 0; i < sig.length; i++) {
      sig[i] = Math.max(-0.35, Math.min(0.35, sig[i]));
    }
    const r = detectPitch(takeFrame(sig, 8000, 4096), { sampleRate: SR });
    expect(r.note).toBe('E2');
  });
});

describe('unequal chord voices', () => {
  test('A major with weak third (C# at 0.3x) still A', () => {
    const sig = mix([
      harmonicTone(110, { sampleRate: SR, duration: 1.0 }),
      scale(harmonicTone(138.5913, { sampleRate: SR, duration: 1.0 }), 0.3),
      harmonicTone(164.8138, { sampleRate: SR, duration: 1.0 }),
    ]);
    const r = detectChord(takeFrame(sig, 12000, 16384), { sampleRate: SR });
    expect(r.status).toBe('CHORD_DETECTED');
    expect(r.chord?.name).toBe('A');
  });
});

describe('dense voicings with doubled notes', () => {
  test('Cmaj7 with doubled root', () => {
    const sig = chordTone([130.8128, 130.8128, 164.8138, 196.0, 246.9417], {
      sampleRate: SR,
      duration: 1.0,
    });
    const r = detectChord(takeFrame(sig, 12000, 16384), { sampleRate: SR });
    expect(r.status).toBe('CHORD_DETECTED');
    expect(r.chord?.name).toBe('Cmaj7');
  });
  test('Am7 with doubled fifth', () => {
    const sig = chordTone([110, 130.8128, 164.8138, 164.8138, 196.0], {
      sampleRate: SR,
      duration: 1.0,
    });
    const r = detectChord(takeFrame(sig, 12000, 16384), { sampleRate: SR });
    expect(r.status).toBe('CHORD_DETECTED');
    expect(r.chord?.name).toBe('Am7');
  });
});

describe('post-attack steady state', () => {
  test('20ms-attack E chord detects past the attack', () => {
    const sig = chordTone([82.4069, 103.8262, 123.4708], {
      sampleRate: SR,
      duration: 1.0,
      attack: 0.02,
    });
    const r = detectChord(takeFrame(sig, 20000, 16384), { sampleRate: SR });
    expect(r.status).toBe('CHORD_DETECTED');
    expect(r.chord?.name).toBe('E');
  });
});
