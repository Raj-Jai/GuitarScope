import { describe, expect, test } from 'vitest';
import { detectPitch } from '../lib/pitch/pitch-detector';
import {
  GUITAR_HARMONICS,
  harmonicTone,
  silence,
  takeFrame,
  whiteNoise,
} from '../lib/dsp/synth';
import {
  STANDARD_TUNING,
  fretPosition,
  identifyString,
  tuningVerdict,
} from '../lib/guitar/tuning';

const SR = 48000;
const FRAME = 4096;

function detectOpenString(freq: number) {
  const signal = harmonicTone(freq, {
    sampleRate: SR,
    duration: 0.5,
    harmonics: GUITAR_HARMONICS,
  });
  return detectPitch(takeFrame(signal, 8000, FRAME), { sampleRate: SR });
}

describe('full pitch pipeline on open strings', () => {
  const cases = [
    { freq: 82.4069, note: 'E2', stringNumber: 6 },
    { freq: 110, note: 'A2', stringNumber: 5 },
    { freq: 146.8318, note: 'D3', stringNumber: 4 },
    { freq: 195.9977, note: 'G3', stringNumber: 3 },
    { freq: 246.9417, note: 'B3', stringNumber: 2 },
    { freq: 329.6276, note: 'E4', stringNumber: 1 },
  ];
  for (const c of cases) {
    test(`${c.note} -> note + string ${c.stringNumber}`, () => {
      const r = detectOpenString(c.freq);
      expect(['NOTE_DETECTED', 'OCTAVE_CORRECTED']).toContain(r.status);
      expect(r.note).toBe(c.note);
      expect(r.stringNumber).toBe(c.stringNumber);
      expect(r.openString).toBe(true);
      expect(r.confidence).toBeGreaterThan(0.5);
      // Perfect synthetic open string must read ~0 cents.
      expect(Math.abs(r.stringCents ?? 999)).toBeLessThan(10);
    });
  }

  test('sharp string reads SHARP with correct cents', () => {
    const sharpE2 = 82.4069 * Math.pow(2, 20 / 1200); // +20 cents
    const signal = harmonicTone(sharpE2, { sampleRate: SR, duration: 0.5 });
    const r = detectPitch(takeFrame(signal, 8000, FRAME), { sampleRate: SR });
    expect(r.note).toBe('E2');
    expect(r.stringCents).not.toBeNull();
    expect(Math.abs((r.stringCents as number) - 20)).toBeLessThan(5);
    expect(r.tuning).toBe('SHARP');
  });

  test('silence -> NO_SIGNAL, no phantom note', () => {
    const r = detectPitch(takeFrame(silence(0.5, SR), 0, FRAME), {
      sampleRate: SR,
    });
    expect(r.status).toBe('NO_SIGNAL');
    expect(r.note).toBeNull();
  });

  test('noise does not produce NOTE_DETECTED', () => {
    const r = detectPitch(takeFrame(whiteNoise(0.2, 0.5, SR), 0, FRAME), {
      sampleRate: SR,
    });
    expect(r.status).not.toBe('NOTE_DETECTED');
    expect(r.status).not.toBe('OCTAVE_CORRECTED');
  });
});

describe('guitar string logic', () => {
  test('STANDARD_TUNING has 6 strings E2..E4', () => {
    expect(STANDARD_TUNING).toHaveLength(6);
    expect(STANDARD_TUNING.map((s) => s.note)).toEqual([
      'E2',
      'A2',
      'D3',
      'G3',
      'B3',
      'E4',
    ]);
  });
  test('identifyString finds nearest open string', () => {
    expect(identifyString(82.43)?.string.stringNumber).toBe(6);
    expect(identifyString(329.6)?.string.stringNumber).toBe(1);
    expect(identifyString(440)?.string.stringNumber).toBe(1); // nearest, but not open
    expect(identifyString(440)?.isOpenString).toBe(false);
  });
  test('tuningVerdict boundaries', () => {
    expect(tuningVerdict(0)).toBe('IN_TUNE');
    expect(tuningVerdict(5)).toBe('IN_TUNE');
    expect(tuningVerdict(-8)).toBe('CLOSE');
    expect(tuningVerdict(30)).toBe('SHARP');
    expect(tuningVerdict(-30)).toBe('FLAT');
  });
  test('fretPosition finds playable position', () => {
    // A4 (69): string 1 fret 5.
    expect(fretPosition(69)).toEqual({ string: 1, fret: 5 });
    expect(fretPosition(40)).toEqual({ string: 6, fret: 0 });
  });
});
