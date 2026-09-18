import { MAX_MIDI, MIN_MIDI } from './frequency';

export const NOTE_NAMES_SHARP = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export const NOTE_NAMES_FLAT = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

export type AccidentalStyle = 'sharp' | 'flat';

/** Pitch class 0-11 for a MIDI note. C=0 ... B=11. */
export function midiToPitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

/** Octave in scientific pitch notation (C4 = middle C, MIDI 60). */
export function midiToOctave(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

/** Note name without octave, e.g. "C#". */
export function midiToNoteName(
  midi: number,
  style: AccidentalStyle = 'sharp',
): string | null {
  const m = Math.round(midi);
  if (m < MIN_MIDI || m > MAX_MIDI) return null;
  const names = style === 'sharp' ? NOTE_NAMES_SHARP : NOTE_NAMES_FLAT;
  return names[midiToPitchClass(m)];
}

/** Full note name with octave, e.g. "E2", "A4". */
export function midiToNoteOctave(
  midi: number,
  style: AccidentalStyle = 'sharp',
): string | null {
  const name = midiToNoteName(midi, style);
  if (name === null) return null;
  return `${name}${midiToOctave(midi)}`;
}

/** Parse "E2", "C#4", "Bb3" → MIDI number, or null if invalid. */
export function noteOctaveToMidi(note: string): number | null {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note.trim());
  if (!match) return null;
  const [, letterRaw, accidental, octaveRaw] = match;
  const letter = letterRaw.toUpperCase();
  const baseSemitone: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  };
  let semitone = baseSemitone[letter];
  if (accidental === '#') semitone += 1;
  else if (accidental === 'b') semitone -= 1;
  const octave = parseInt(octaveRaw, 10);
  const midi = (octave + 1) * 12 + semitone;
  if (midi < MIN_MIDI || midi > MAX_MIDI) return null;
  return midi;
}
