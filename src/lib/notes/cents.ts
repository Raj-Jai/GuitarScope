import { frequencyToMidiFloat, midiToFrequency } from './frequency';
import {
  midiToNoteOctave,
  midiToOctave,
  midiToPitchClass,
  type AccidentalStyle,
} from './note-name';

/**
 * Cents offset of a detected frequency from a reference frequency.
 * cents = 1200 * log2(f_detected / f_reference)
 * +100 cents = one semitone sharp.
 */
export function centsOffset(
  detectedFrequency: number,
  referenceFrequency: number,
): number {
  if (
    !Number.isFinite(detectedFrequency) ||
    !Number.isFinite(referenceFrequency) ||
    detectedFrequency <= 0 ||
    referenceFrequency <= 0
  ) {
    return NaN;
  }
  return 1200 * Math.log2(detectedFrequency / referenceFrequency);
}

export interface DetectedPitchInfo {
  frequency: number;
  /** Nearest MIDI note, or null if out of range. */
  midi: number | null;
  /** Full note name e.g. "E2", or null. */
  note: string | null;
  /** Pitch class 0-11 (C=0), or null. */
  pitchClass: number | null;
  /** Octave number, or null. */
  octave: number | null;
  /** Cents deviation from nearest note (-50..+50 when in range), or null. */
  cents: number | null;
  /** Reference frequency of nearest note in Hz, or null. */
  referenceFrequency: number | null;
}

/**
 * Convert a detected frequency into full musical-note information.
 * Returns nulls (not NaN/throw) for invalid input so the UI can show
 * a NO_SIGNAL state instead of nonsense values.
 */
export function describeFrequency(
  frequency: number,
  style: AccidentalStyle = 'sharp',
): DetectedPitchInfo {
  const none: DetectedPitchInfo = {
    frequency,
    midi: null,
    note: null,
    pitchClass: null,
    octave: null,
    cents: null,
    referenceFrequency: null,
  };
  if (!Number.isFinite(frequency) || frequency <= 0) return none;
  const midiFloat = frequencyToMidiFloat(frequency);
  const midi = Math.round(midiFloat);
  if (midi < 0 || midi > 127) return none;
  const referenceFrequency = midiToFrequency(midi);
  return {
    frequency,
    midi,
    note: midiToNoteOctave(midi, style),
    pitchClass: midiToPitchClass(midi),
    octave: midiToOctave(midi),
    cents: 1200 * Math.log2(frequency / referenceFrequency),
    referenceFrequency,
  };
}
