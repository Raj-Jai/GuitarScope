import { describe, expect, test } from 'vitest';
import { chordTone, harmonicTone, silence, takeFrame } from '../lib/dsp/synth';
import {
  CHORD_DICTIONARY,
  buildChordDictionary,
  chordNoteNames,
} from '../lib/chords/chord-definitions';
import { matchChord } from '../lib/chords/chord-matcher';
import { detectChord } from '../lib/analysis/polyphonic';

const SR = 48000;

describe('chord dictionary', () => {
  test('default dictionary = 12 roots x 5 qualities', () => {
    expect(CHORD_DICTIONARY).toHaveLength(60);
  });
  test('A major = A C# E pitch classes', () => {
    const a = CHORD_DICTIONARY.find((c) => c.name === 'A');
    expect(a?.pitchClasses).toEqual([9, 1, 4]);
    expect(chordNoteNames(a!)).toEqual(['A', 'C#', 'E']);
  });
  test('Am = A C E', () => {
    const am = CHORD_DICTIONARY.find((c) => c.name === 'Am');
    expect(am?.pitchClasses).toEqual([9, 0, 4]);
  });
  test('extended dictionary builds 132 chords', () => {
    expect(
      buildChordDictionary([
        'major',
        'minor',
        '7',
        'maj7',
        'm7',
        'sus2',
        'sus4',
        'dim',
        'aug',
        'add9',
        'm7b5',
      ]),
    ).toHaveLength(132);
  });
});

describe('template matching on ideal chroma', () => {
  test('perfect A-major chroma matches A', () => {
    const chroma = new Float64Array(12);
    chroma[9] = 1; chroma[1] = 1; chroma[4] = 1; // A C# E
    const top = matchChord(chroma, CHORD_DICTIONARY, 3);
    expect(top[0].chord.name).toBe('A');
    expect(top[0].confidence).toBeGreaterThan(0.5);
  });
  test('perfect C minor triad matches Cm', () => {
    const chroma = new Float64Array(12);
    chroma[0] = 1; chroma[3] = 1; chroma[7] = 1; // C Eb G
    const top = matchChord(chroma, CHORD_DICTIONARY, 3);
    expect(top[0].chord.name).toBe('Cm');
  });
});

describe('end-to-end: synthetic triads -> chord names', () => {
  const cases = [
    { name: 'A', freqs: [110, 138.5913, 164.8138] }, // A C# E
    { name: 'Am', freqs: [110, 130.8128, 164.8138] }, // A C E
    { name: 'C', freqs: [130.8128, 164.8138, 196.0] }, // C E G
    { name: 'G', freqs: [98.0, 123.4708, 146.8318] }, // G B D
    { name: 'E', freqs: [82.4069, 103.8262, 123.4708] }, // E G# B
    { name: 'Em', freqs: [82.4069, 98.0, 123.4708] }, // E G B
    { name: 'D', freqs: [146.8318, 185.0, 220.0] }, // D F# A
    { name: 'Dm', freqs: [146.8318, 174.6141, 220.0] }, // D F A
  ];
  for (const c of cases) {
    test(`${c.name} triad recognized`, () => {
      const signal = chordTone(c.freqs, { sampleRate: SR, duration: 1.0 });
      const result = detectChord(takeFrame(signal, 12000, 16384), {
        sampleRate: SR,
      });
      expect(result.status).toBe('CHORD_DETECTED');
      expect(result.chord?.name).toBe(c.name);
    });
  }

  test('single note is MONOPHONIC, not a chord', () => {
    const signal = harmonicTone(110, { sampleRate: SR, duration: 0.5 });
    const result = detectChord(takeFrame(signal, 4000, 16384), {
      sampleRate: SR,
    });
    expect(result.status).not.toBe('CHORD_DETECTED');
  });

  test('silence -> NO_SIGNAL', () => {
    const result = detectChord(takeFrame(silence(0.5, SR), 0, 16384), {
      sampleRate: SR,
    });
    expect(result.status).toBe('NO_SIGNAL');
    expect(result.chord).toBeNull();
  });
});
