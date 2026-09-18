/**
 * Chord data model. Chords are defined by pitch-class sets so the
 * matcher stays fully general (no frequency lookup tables).
 */
import { midiToNoteName } from '../notes/note-name';

export type ChordQuality =
  | 'major'
  | 'minor'
  | '7'
  | 'maj7'
  | 'm7'
  | 'sus2'
  | 'sus4'
  | 'dim'
  | 'aug'
  | 'add9'
  | 'm7b5';

export interface ChordDefinition {
  /** Display name, e.g. "Am", "Cmaj7", "G7". */
  name: string;
  /** Root pitch class 0-11 (C=0). */
  root: number;
  quality: ChordQuality;
  /** Pitch classes in the chord. */
  pitchClasses: number[];
  aliases: string[];
  /** Common open/guitar voicing as MIDI notes (for diagrams). */
  voicing?: number[];
}

const pc = (root: number, intervals: number[]): number[] =>
  intervals.map((i) => (((root + i) % 12) + 12) % 12);

const ROOT_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  major: '',
  minor: 'm',
  '7': '7',
  maj7: 'maj7',
  m7: 'm7',
  sus2: 'sus2',
  sus4: 'sus4',
  dim: 'dim',
  aug: 'aug',
  add9: 'add9',
  m7b5: 'm7b5',
};

const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  add9: [0, 4, 7, 14],
  m7b5: [0, 3, 6, 10],
};

/** MVP qualities from the project brief. */
export const MVP_QUALITIES: ChordQuality[] = ['major', 'minor', '7', 'maj7', 'm7'];

/** Full vocabulary: build every quality for every root. */
export function buildChordDictionary(
  qualities: ChordQuality[] = MVP_QUALITIES,
): ChordDefinition[] {
  const dict: ChordDefinition[] = [];
  for (let root = 0; root < 12; root++) {
    for (const quality of qualities) {
      const intervals = QUALITY_INTERVALS[quality];
      dict.push({
        name: `${ROOT_NAMES[root]}${QUALITY_SUFFIX[quality]}`,
        root,
        quality,
        pitchClasses: pc(root, intervals),
        aliases: [],
      });
    }
  }
  return dict;
}

/** Default dictionary: 12 roots × 5 MVP qualities = 60 chords. */
export const CHORD_DICTIONARY: ChordDefinition[] = buildChordDictionary();

/** Extended vocabulary incl. sus/dim/aug/add9/m7b5 (12 × 11 = 132). */
export const EXTENDED_CHORD_DICTIONARY: ChordDefinition[] =
  buildChordDictionary([
    ...MVP_QUALITIES,
    'sus2',
    'sus4',
    'dim',
    'aug',
    'add9',
    'm7b5',
  ]);

/** Human-readable note names for a chord's pitch classes. */
export function chordNoteNames(
  chord: ChordDefinition,
  style: 'sharp' | 'flat' = 'sharp',
): string[] {
  // Use a representative octave (4) purely for naming.
  return chord.pitchClasses.map(
    (p) => midiToNoteName(p + 60, style) ?? '?',
  );
}
