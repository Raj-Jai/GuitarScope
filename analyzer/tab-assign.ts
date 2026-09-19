/**
 * T-M5 — bounded pitch-to-string/fret assignment.
 * Hard rules (supervisor review):
 *  - Chord/shape context is an assignment PRIOR. It never alters, adds,
 *    or drops a detected MIDI pitch. Pitch metrics stay fully separate.
 *  - Every emitted assignment is source 'suggested', never recorded truth.
 *  - Alternatives preserved when scores are close.
 *  - Frets limited to 0..12, standard tuning, one note per string.
 */
import { OPEN_SHAPES } from '../src/lib/chords/fingerings';
import type { ChordEvent, NoteEvent, NoteGroup, TabEvent } from './schema';
import { isNoteGroup } from './schema';

/** Open-string MIDI, index 0 = string 6 (low E) .. index 5 = string 1. */
export const OPEN_MIDI = [40, 45, 50, 55, 59, 64];

export interface Position {
  /** 1..6, 1 = high E. */
  string: 1 | 2 | 3 | 4 | 5 | 6;
  fret: number;
}

/** Candidate positions for a MIDI pitch (frets 0..12). Ordered low-fret first. */
export function candidatesFor(midi: number): Position[] {
  const out: Position[] = [];
  for (let s = 6; s >= 1; s--) {
    const fret = midi - OPEN_MIDI[6 - s];
    if (fret >= 0 && fret <= 12) out.push({ string: s as Position['string'], fret });
  }
  out.sort((a, b) => a.fret - b.fret || b.string - a.string);
  return out;
}

export interface AssignOptions {
  /** Bonus for candidates present in the current chord's library shape. */
  chordBonus?: number; // default 1.0
  /** Penalty per fret of simultaneous span beyond 4. */
  spanPenalty?: number; // default 0.5
  /** Penalty per fret of hand movement from previous position. */
  movePenalty?: number; // default 0.3
  /** Penalty per fret above 7. */
  highPenalty?: number; // default 0.2
  /** Margin below best to keep an alternative. */
  altMargin?: number; // default 1.5
}

/** Shape pitch classes present in a library chord shape (for bonuses). */
function shapePositions(label: string): Position[] {
  const shape = OPEN_SHAPES[label];
  if (!shape) return [];
  const out: Position[] = [];
  shape.forEach((fret, i) => {
    if (fret >= 0) out.push({ string: (6 - i) as Position['string'], fret });
  });
  return out;
}

/** Single-note assignment score (higher = better). */
export function scorePosition(
  pos: Position,
  prevFret: number | null,
  inChordShape: boolean,
  options: AssignOptions = {},
): number {
  const { chordBonus = 1.0, movePenalty = 0.3, highPenalty = 0.2 } = options;
  let score = 0;
  if (pos.fret === 0) score += 0.5; // open strings are easy
  score -= pos.fret * 0.05; // mild preference for low positions
  if (pos.fret > 7) score -= (pos.fret - 7) * highPenalty;
  if (prevFret !== null) score -= Math.abs(pos.fret - prevFret) * movePenalty;
  if (inChordShape) score += chordBonus;
  return score;
}

interface GroupItem {
  onset: number;
  offset: number;
  midis: number[];
}

/** Simultaneous-group assignment score (span + per-note scores). */
function scoreGroup(
  assignment: Position[],
  prevPositions: Position[] | null,
  chordShape: Position[],
  options: AssignOptions,
): number {
  const { spanPenalty = 0.5 } = options;
  const strings = new Set(assignment.map((a) => a.string));
  if (strings.size !== assignment.length) return -Infinity; // one note per string
  const frets = assignment.map((a) => a.fret);
  const span = Math.max(...frets) - Math.min(...frets.filter((f) => f > 0).concat([0]));
  let score = span > 4 ? -(span - 4) * spanPenalty : 0;
  const shapeKeys = new Set(chordShape.map((p) => `${p.string}:${p.fret}`));
  assignment.forEach((pos, i) => {
    const prev = prevPositions && prevPositions[i] ? prevPositions[Math.min(i, prevPositions.length - 1)] : null;
    score += scorePosition(pos, prev ? prev.fret : null, shapeKeys.has(`${pos.string}:${pos.fret}`), options);
  });
  return score;
}

/** Cartesian product of per-note candidates, capped (v1: small groups only). */
function combinations(lists: Position[][], cap = 64): Position[][] {
  let out: Position[][] = [[]];
  for (const list of lists) {
    const next: Position[][] = [];
    for (const prefix of out) {
      for (const pos of list) {
        next.push([...prefix, pos]);
        if (next.length >= cap) return next;
      }
    }
    out = next;
  }
  return out;
}

export interface AssignedGroup extends GroupItem {
  positions: Position[];
  score: number;
  alternatives: { positions: Position[]; score: number }[];
}

/**
 * Greedy-with-memory assignment over the note-group sequence (v1).
 * Each group is ranked with previous-group continuity + chord-shape
 * bonuses; best emits with close alternatives. Full beam search adds
 * nothing here (no long-range constraints beyond previous position),
 * so v1 stays simple and auditable.
 */
export function assignSequence(
  groups: GroupItem[],
  chordAt: (time: number) => string,
  options: AssignOptions = {},
): AssignedGroup[] {
  const { altMargin = 1.5 } = options;
  const out: AssignedGroup[] = [];
  let prev: Position[] | null = null;
  for (const g of groups) {
    const shape = shapePositions(chordAt((g.onset + g.offset) / 2));
    const candLists = g.midis.map((m) => candidatesFor(m));
    if (candLists.some((l) => l.length === 0)) continue; // unplayable pitch: skip group honestly
    const ranked = combinations(candLists)
      .map((combo) => ({ combo, s: scoreGroup(combo, prev, shape, options) }))
      .filter((c) => c.s !== -Infinity)
      .sort((a, b) => b.s - a.s);
    if (ranked.length === 0) continue;
    const best = ranked[0];
    prev = best.combo;
    out.push({
      ...g,
      positions: best.combo,
      score: Math.round(best.s * 100) / 100,
      alternatives: ranked
        .slice(1)
        .filter((c) => c.s >= best.s - altMargin)
        .map((a) => ({ positions: a.combo, score: Math.round(a.s * 100) / 100 })),
    });
  }
  return out;
}

/** Build TabEvents from note events/groups + chord context. */
export function notesToTab(
  notes: (NoteEvent | NoteGroup)[],
  chordAt: (time: number) => string,
  options: AssignOptions = {},
): TabEvent[] {
  const groups: GroupItem[] = notes.map((n) => {
    if (isNoteGroup(n)) {
      return { onset: n.onset, offset: n.offset, midis: n.notes.map((x) => x.midi) };
    }
    return { onset: n.onset, offset: n.offset, midis: [n.midi] };
  });
  return assignSequence(groups, chordAt, options).map((g) => ({
    start: g.onset,
    end: g.offset,
    kind: g.midis.length > 1 ? ('chord' as const) : ('note' as const),
    notes: g.positions.map((p, i) => ({
      start: g.onset,
      end: g.offset,
      midi: g.midis[i],
      string: p.string,
      fret: p.fret,
      confidence: Math.round(Math.min(1, Math.max(0, 0.5 + g.score / 10)) * 100) / 100,
      source: 'suggested' as const,
    })),
    alternatives:
      g.alternatives.length > 0
        ? g.alternatives.map((a) => ({
            notes: a.positions.map((p, i) => ({
              start: g.onset,
              end: g.offset,
              midi: g.midis[i],
              string: p.string,
              fret: p.fret,
              confidence: Math.round(Math.min(1, Math.max(0, 0.5 + a.score / 10)) * 100) / 100,
              source: 'suggested' as const,
            })),
            score: a.score,
          }))
        : undefined,
  }));
}

/**
 * Chord-event fingerings from the shape library — emitted ONLY when every
 * detected pitch class in the span belongs to the shape (pitch-consistent).
 * Otherwise an honest gap (no invention, no pitch overwrite).
 */
export function chordsToTab(
  chords: ChordEvent[],
  detectedPitchClasses: (time: number) => number[],
): TabEvent[] {
  const out: TabEvent[] = [];
  for (const c of chords) {
    if (c.label === 'NO_CHORD') continue;
    const shape = shapePositions(c.label);
    if (shape.length === 0) continue; // no known shape: honest gap, no invention
    const shapePCs = new Set(shape.map((p) => (OPEN_MIDI[6 - p.string] + p.fret) % 12));
    const detected = detectedPitchClasses((c.start + c.end) / 2);
    if (!detected.every((pc) => shapePCs.has(((pc % 12) + 12) % 12))) continue;
    out.push({
      start: c.start,
      end: c.end,
      kind: 'chord',
      notes: shape.map((p) => {
        const midi = OPEN_MIDI[6 - p.string] + p.fret;
        return {
          start: c.start,
          end: c.end,
          midi,
          string: p.string,
          fret: p.fret,
          confidence: Math.round(c.confidence * 100) / 100,
          source: 'suggested' as const,
        };
      }),
    });
  }
  return out;
}
