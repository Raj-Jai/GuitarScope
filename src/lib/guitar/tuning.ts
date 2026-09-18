/** Standard guitar tuning + string model. */
import { midiToFrequency } from '../notes/frequency';
import { midiToNoteOctave } from '../notes/note-name';

export interface GuitarString {
  /** 1 = high E (thinnest), 6 = low E (thickest). */
  stringNumber: 1 | 2 | 3 | 4 | 5 | 6;
  note: string;
  midi: number;
  frequency: number;
}

/** Standard tuning E2 A2 D3 G3 B3 E4, ordered string 6 → 1. */
export const STANDARD_TUNING: GuitarString[] = [
  { stringNumber: 6, note: 'E2', midi: 40, frequency: midiToFrequency(40) },
  { stringNumber: 5, note: 'A2', midi: 45, frequency: midiToFrequency(45) },
  { stringNumber: 4, note: 'D3', midi: 50, frequency: midiToFrequency(50) },
  { stringNumber: 3, note: 'G3', midi: 55, frequency: midiToFrequency(55) },
  { stringNumber: 2, note: 'B3', midi: 59, frequency: midiToFrequency(59) },
  { stringNumber: 1, note: 'E4', midi: 64, frequency: midiToFrequency(64) },
];

export interface StringMatch {
  string: GuitarString;
  /** Cents from the open-string frequency (-50..+50 only if nearest note matches). */
  centsFromOpen: number;
  /** Is the detected pitch plausibly this open string? (|cents| <= tolerance). */
  isOpenString: boolean;
}

/**
 * Identify the most likely open string for a detected frequency.
 * @param toleranceCents max |cents| to count as "this open string" (default 40).
 */
export function identifyString(
  frequency: number,
  toleranceCents = 40,
): StringMatch | null {
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  let best: GuitarString | null = null;
  let bestCents = Infinity;
  for (const s of STANDARD_TUNING) {
    const cents = 1200 * Math.log2(frequency / s.frequency);
    if (Math.abs(cents) < Math.abs(bestCents)) {
      bestCents = cents;
      best = s;
    }
  }
  if (!best) return null;
  return {
    string: best,
    centsFromOpen: bestCents,
    isOpenString: Math.abs(bestCents) <= toleranceCents,
  };
}

export type TuningState = 'IN_TUNE' | 'CLOSE' | 'FLAT' | 'SHARP';

/**
 * Tuning verdict for an open string.
 * inTuneCents default 5, closeCents default 15.
 */
export function tuningVerdict(
  centsFromOpen: number,
  inTuneCents = 5,
  closeCents = 15,
): TuningState {
  const abs = Math.abs(centsFromOpen);
  if (abs <= inTuneCents) return 'IN_TUNE';
  if (abs <= closeCents) return 'CLOSE';
  return centsFromOpen < 0 ? 'FLAT' : 'SHARP';
}

/** Display label for a MIDI note on the fretboard (nearest string/fret hint). */
export function fretPosition(midi: number): { string: number; fret: number } | null {
  const m = Math.round(midi);
  // Find the lowest-fret position across strings (prefer lower strings? prefer lowest fret).
  let best: { string: number; fret: number } | null = null;
  for (const s of STANDARD_TUNING) {
    const fret = m - s.midi;
    if (fret >= 0 && fret <= 24) {
      if (!best || fret < best.fret) best = { string: s.stringNumber, fret };
    }
  }
  return best;
}

export { midiToNoteOctave };
