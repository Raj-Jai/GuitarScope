import { describe, expect, test } from 'vitest';
import { yinDetect } from '../lib/dsp/yin';
import { findSpectralPeaks, magnitudeSpectrum } from '../lib/dsp/fft';
import { applyHannWindow, removeDcOffset } from '../lib/dsp/windowing';
import {
  GUITAR_HARMONICS,
  WEAK_FUNDAMENTAL_HARMONICS,
  chordTone,
  harmonicTone,
  silence,
  sineTone,
  takeFrame,
  whiteNoise,
} from '../lib/dsp/synth';
import { centsOffset } from '../lib/notes/cents';

const SR = 48000;
const FRAME = 4096;

function detectSine(freq: number): number | null {
  const signal = sineTone(freq, { sampleRate: SR, duration: 0.4 });
  const frame = takeFrame(signal, 8000, FRAME);
  return yinDetect(removeDcOffset(frame), { sampleRate: SR })?.frequency ?? null;
}

describe('YIN pure sine tones', () => {
  test.each([
    [82.4069, 'E2'],
    [110, 'A2'],
    [146.8318, 'D3'],
    [195.9977, 'G3'],
    [246.9417, 'B3'],
    [329.6276, 'E4'],
    [440, 'A4'],
  ])('%f Hz (%s) within 0.5%%', (freq) => {
    const detected = detectSine(freq);
    expect(detected).not.toBeNull();
    expect(Math.abs(centsOffset(detected as number, freq))).toBeLessThan(9); // ~0.5%
  });
});

describe('YIN guitar-like harmonic tones (octave correctness)', () => {
  test.each([
    [82.4069, 'E2'],
    [110, 'A2'],
    [146.8318, 'D3'],
    [195.9977, 'G3'],
    [246.9417, 'B3'],
    [329.6276, 'E4'],
  ])('%f Hz (%s) resolves to fundamental, not harmonic', (freq) => {
    const signal = harmonicTone(freq, {
      sampleRate: SR,
      duration: 0.5,
      harmonics: GUITAR_HARMONICS,
    });
    const frame = takeFrame(signal, 8000, FRAME);
    const result = yinDetect(removeDcOffset(frame), { sampleRate: SR });
    expect(result).not.toBeNull();
    // Must be within a semitone of the true fundamental (rules out octave jumps).
    expect(Math.abs(centsOffset(result!.frequency, freq))).toBeLessThan(50);
  });

  test('weak fundamental (2nd harmonic dominant) still finds E2', () => {
    const signal = harmonicTone(82.4069, {
      sampleRate: SR,
      duration: 0.5,
      harmonics: WEAK_FUNDAMENTAL_HARMONICS,
    });
    const frame = takeFrame(signal, 8000, FRAME);
    const result = yinDetect(removeDcOffset(frame), { sampleRate: SR });
    expect(result).not.toBeNull();
    expect(Math.abs(centsOffset(result!.frequency, 82.4069))).toBeLessThan(50);
  });

  test('noisy E2 (+noise) still resolves', () => {
    const signal = harmonicTone(82.4069, {
      sampleRate: SR,
      duration: 0.5,
      harmonics: GUITAR_HARMONICS,
      noiseLevel: 0.02,
    });
    const frame = takeFrame(signal, 8000, FRAME);
    const result = yinDetect(removeDcOffset(frame), { sampleRate: SR });
    expect(result).not.toBeNull();
    expect(Math.abs(centsOffset(result!.frequency, 82.4069))).toBeLessThan(50);
  });
});

describe('YIN rejection', () => {
  test('silence -> null', () => {
    const frame = takeFrame(silence(0.5, SR), 0, FRAME);
    expect(yinDetect(frame, { sampleRate: SR })).toBeNull();
  });
  test('white noise -> null or very low confidence', () => {
    const frame = takeFrame(whiteNoise(0.2, 0.5, SR), 0, FRAME);
    const result = yinDetect(removeDcOffset(frame), { sampleRate: SR });
    if (result !== null) {
      expect(result.confidence).toBeLessThan(0.6);
    }
  });
});

describe('FFT magnitude + peak picking', () => {
  test('440 Hz sine peaks near 440 Hz', () => {
    const signal = sineTone(440, { sampleRate: SR, duration: 0.4 });
    const frame = applyHannWindow(
      removeDcOffset(takeFrame(signal, 8000, FRAME)),
    );
    const mag = magnitudeSpectrum(frame);
    const peaks = findSpectralPeaks(mag, SR, FRAME, {
      minMagnitude: 1e-6,
      maxPeaks: 3,
    });
    expect(peaks.length).toBeGreaterThan(0);
    expect(Math.abs(centsOffset(peaks[0].frequency, 440))).toBeLessThan(25);
  });

  test('harmonic tone shows multiple peaks incl. fundamental', () => {
    const signal = harmonicTone(110, {
      sampleRate: SR,
      duration: 0.5,
      harmonics: GUITAR_HARMONICS,
    });
    const frame = applyHannWindow(
      removeDcOffset(takeFrame(signal, 8000, FRAME)),
    );
    const mag = magnitudeSpectrum(frame);
    const peaks = findSpectralPeaks(mag, SR, FRAME, {
      minMagnitude: 1e-6,
      maxPeaks: 8,
    });
    const nearFundamental = peaks.some(
      (p) => Math.abs(centsOffset(p.frequency, 110)) < 60,
    );
    expect(nearFundamental).toBe(true);
  });

  test('silence has no significant peaks', () => {
    const frame = takeFrame(silence(0.5, SR), 0, FRAME);
    const mag = magnitudeSpectrum(frame);
    const peaks = findSpectralPeaks(mag, SR, FRAME, {
      minMagnitude: 1e-6,
      maxPeaks: 8,
    });
    expect(peaks.length).toBe(0);
  });

  test('chordTone mixes fundamentals (sanity)', () => {
    const signal = chordTone([110, 138.59, 164.81], {
      sampleRate: SR,
      duration: 0.3,
    });
    expect(signal.length).toBe(Math.floor(SR * 0.3));
  });
});
