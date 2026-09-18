/**
 * Display transposition: shift stored canonical pitch data for VIEWING
 * without touching the audio. Chords and notes transpose independently.
 */
import { midiToNoteOctave } from '../notes/note-name';

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** Transpose a chord label by semitones (sharp spelling), NO_CHORD passes through. */
export function transposeChordLabel(label: string, semitones: number): string {
  if (!label || label === 'NO_CHORD' || label === 'N') return label;
  const m = /^([A-G][#b]?)(.*)$/.exec(label.trim());
  if (!m || !(m[1] in ROOT_PC)) return label;
  const newRoot = SHARPS[(((ROOT_PC[m[1]] + semitones) % 12) + 12) % 12];
  return `${newRoot}${m[2]}`;
}

/** Transpose a MIDI note for display. */
export function transposeNoteName(midi: number, semitones: number): string {
  return midiToNoteOctave(midi + semitones) ?? `midi${midi + semitones}`;
}
