import { describe, expect, test } from 'vitest';
import {
  frequencyToMidi,
  frequencyToMidiFloat,
  midiToFrequency,
} from '../lib/notes/frequency';
import {
  midiToNoteName,
  midiToNoteOctave,
  midiToOctave,
  midiToPitchClass,
  noteOctaveToMidi,
} from '../lib/notes/note-name';
import { centsOffset, describeFrequency } from '../lib/notes/cents';

describe('midiToFrequency', () => {
  test('A4 = 440 Hz', () => expect(midiToFrequency(69)).toBe(440));
  test('open strings', () => {
    expect(midiToFrequency(40)).toBeCloseTo(82.4069, 2); // E2
    expect(midiToFrequency(45)).toBeCloseTo(110, 2); // A2
    expect(midiToFrequency(50)).toBeCloseTo(146.8318, 2); // D3
    expect(midiToFrequency(55)).toBeCloseTo(195.9977, 2); // G3
    expect(midiToFrequency(59)).toBeCloseTo(246.9417, 2); // B3
    expect(midiToFrequency(64)).toBeCloseTo(329.6276, 2); // E4
  });
});

describe('frequencyToMidi', () => {
  test('reference conversions', () => {
    expect(frequencyToMidi(440)).toBe(69);
    expect(frequencyToMidi(82.4069)).toBe(40);
    expect(frequencyToMidi(110)).toBe(45);
    expect(frequencyToMidi(329.6276)).toBe(64);
  });
  test('invalid input -> null', () => {
    expect(frequencyToMidi(0)).toBeNull();
    expect(frequencyToMidi(-5)).toBeNull();
    expect(frequencyToMidi(NaN)).toBeNull();
    expect(frequencyToMidi(Infinity)).toBeNull();
  });
  test('near-boundary A4 +/- cents rounds correctly', () => {
    const sharp49 = 440 * Math.pow(2, 49 / 1200);
    expect(frequencyToMidi(sharp49)).toBe(69);
    const sharp51 = 440 * Math.pow(2, 51 / 1200);
    expect(frequencyToMidi(sharp51)).toBe(70);
    const flat49 = 440 * Math.pow(2, -49 / 1200);
    expect(frequencyToMidi(flat49)).toBe(69);
  });
  test('round-trip exact for MIDI 28..84', () => {
    for (let midi = 28; midi <= 84; midi++) {
      expect(frequencyToMidiFloat(midiToFrequency(midi))).toBeCloseTo(
        midi,
        9,
      );
    }
  });
});

describe('note names', () => {
  test('open strings', () => {
    expect(midiToNoteOctave(40)).toBe('E2');
    expect(midiToNoteOctave(45)).toBe('A2');
    expect(midiToNoteOctave(50)).toBe('D3');
    expect(midiToNoteOctave(55)).toBe('G3');
    expect(midiToNoteOctave(59)).toBe('B3');
    expect(midiToNoteOctave(64)).toBe('E4');
  });
  test('middle C = C4 = MIDI 60', () => {
    expect(midiToNoteOctave(60)).toBe('C4');
    expect(midiToOctave(60)).toBe(4);
  });
  test('pitch classes', () => {
    expect(midiToPitchClass(60)).toBe(0); // C
    expect(midiToPitchClass(69)).toBe(9); // A
    expect(midiToPitchClass(40)).toBe(4); // E
  });
  test('flat style', () => {
    expect(midiToNoteName(61, 'flat')).toBe('Db');
    expect(midiToNoteName(61, 'sharp')).toBe('C#');
  });
  test('parse note strings', () => {
    expect(noteOctaveToMidi('E2')).toBe(40);
    expect(noteOctaveToMidi('A4')).toBe(69);
    expect(noteOctaveToMidi('C#4')).toBe(61);
    expect(noteOctaveToMidi('Db4')).toBe(61);
    expect(noteOctaveToMidi('Bb3')).toBe(58);
    expect(noteOctaveToMidi('bogus')).toBeNull();
  });
});

describe('cents', () => {
  test('identical frequencies = 0 cents', () =>
    expect(centsOffset(440, 440)).toBe(0));
  test('+100 cents = one semitone', () => {
    const up = 440 * Math.pow(2, 1 / 12);
    expect(centsOffset(up, 440)).toBeCloseTo(100, 9);
  });
  test('invalid -> NaN', () =>
    expect(Number.isNaN(centsOffset(0, 440))).toBe(true));
});

describe('describeFrequency', () => {
  test('82.43 Hz -> E2, ~+0.5 cents', () => {
    const d = describeFrequency(82.43);
    expect(d.note).toBe('E2');
    expect(d.midi).toBe(40);
    expect(d.octave).toBe(2);
    expect(d.pitchClass).toBe(4);
    expect(d.cents).not.toBeNull();
    expect(Math.abs((d.cents as number) - 0.48)).toBeLessThan(0.3);
  });
  test('invalid -> nulls, no throw', () => {
    const d = describeFrequency(0);
    expect(d.note).toBeNull();
    expect(d.midi).toBeNull();
    expect(d.cents).toBeNull();
  });
});
