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
export function candidatesFor(midi: number, tuningShift = 0): Position[] {
  return candidatesForShifted(midi - tuningShift);
}

function candidatesForShifted(standardMidi: number): Position[] {
  const out: Position[] = [];
  for (let s = 6; s >= 1; s--) {
    const fret = standardMidi - OPEN_MIDI[6 - s];
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
  /**
   * Global transposition in semitones (detected concert pitch MINUS the
   * pitch the physical shape was fingered at; e.g. +2 for a guitar tuned
   * a whole step up, -1 for Eb).
   * Candidate positions are computed against the shifted grid while
   * emitted midis stay as detected (concert pitch). Fret shapes are
   * tuning-invariant. `pitchShift` is the primary name; `tuningShift`
   * is a deprecated alias for the same value. A discrete ±1/±2 shift
   * can NOT be inferred from cents residuals (absorbed by MIDI
   * rounding) — use estimatePitchShift below, never the cents median.
   */
  pitchShift?: number; // default 0
  /** @deprecated alias of pitchShift. */
  tuningShift?: number; // default 0
}

/** Resolve the effective shift: pitchShift wins, tuningShift is the legacy alias. */
function resolveShift(options: AssignOptions): number {
  return options.pitchShift ?? options.tuningShift ?? 0;
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

const SHARP_PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/**
 * Estimate sub-semitone DETUNE (not transposition) from confident single
 * notes: median cents offset from the 440 grid.
 *
 * @deprecated for discrete shifts: a uniform ±1/±2 retune (Eb, D
 * standard, whole-step-up recordings, capo-like shifts) is absorbed by
 * MIDI rounding, so the residual sits near 0 and this returns 0. Use
 * estimatePitchShift (open-rate + playability scoring over candidate
 * shifts) when the question is "which discrete shift was fingered at".
 * Kept for backward compatibility; still useful for mild detune display.
 */
export function estimateTuningShift(
  notes: { midi: number; frequency: number; confidence: number }[],
): { semitones: number; medianCents: number; confidence: number } {
  const cents: number[] = [];
  for (const n of notes) {
    if (n.confidence < 0.6 || !(n.frequency > 0)) continue;
    const ref = 440 * Math.pow(2, (n.midi - 69) / 12);
    cents.push(1200 * Math.log2(n.frequency / ref));
  }
  if (cents.length < 3) return { semitones: 0, medianCents: 0, confidence: 0 };
  cents.sort((a, b) => a - b);
  const median = cents[Math.floor(cents.length / 2)];
  const semitones = Math.round(median / 100);
  if (Math.abs(semitones) > 6) return { semitones: 0, medianCents: Math.round(median * 10) / 10, confidence: 0 };
  const agree = cents.filter((c) => Math.abs(c - semitones * 100) < 25).length / cents.length;
  return {
    semitones,
    medianCents: Math.round(median * 10) / 10,
    confidence: Math.round(agree * 100) / 100,
  };
}

/** Transpose a chord root name by semitones (sharp spelling) for shape lookup. */
export function transposeRoot(label: string, semitones: number): string {
  const m = /^([A-G][#b]?)(.*)$/.exec(label.trim());
  if (!m || !(m[1] in ROOT_PC)) return label;
  const pc = (((ROOT_PC[m[1]] + semitones) % 12) + 12) % 12;
  return `${SHARP_PC[pc]}${m[2]}`;
}

/** Single-note assignment score (higher = better). */
export function scorePosition(
  pos: Position,
  prevFret: number | null,
  inChordShape: boolean,
  options: AssignOptions = {},
  gapSec = 0,
): number {
  const { chordBonus = 1.0, movePenalty = 0.3, highPenalty = 0.2 } = options;
  let score = 0;
  if (pos.fret === 0) score += 0.5; // open strings are easy
  score -= pos.fret * 0.05; // mild preference for low positions
  if (pos.fret > 7) score -= (pos.fret - 7) * highPenalty;
  if (prevFret !== null) {
    // Gap-scaled: the hand resets given time (no ratchet after forced
    // high notes); only penalize movement between close onsets.
    score -= Math.abs(pos.fret - prevFret) * movePenalty * Math.exp(-gapSec / 0.4);
  }
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
  prevGapSec: number,
  chordShape: Position[],
  options: AssignOptions,
): number {
  const { spanPenalty = 0.5 } = options;
  const strings = new Set(assignment.map((a) => a.string));
  if (strings.size !== assignment.length) return -Infinity; // one note per string
  // Span over FRETTED notes only: open strings need no hand stretch.
  // (Counting 0 punished open+fretted mixes and hid the real signal.)
  const fretted = assignment.map((a) => a.fret).filter((f) => f > 0);
  const span = fretted.length >= 2 ? Math.max(...fretted) - Math.min(...fretted) : 0;
  let score = span > 4 ? -(span - 4) * spanPenalty : 0;
  const shapeKeys = new Set(chordShape.map((p) => `${p.string}:${p.fret}`));
  assignment.forEach((pos, i) => {
    const prev = prevPositions && prevPositions[i] ? prevPositions[Math.min(i, prevPositions.length - 1)] : null;
    score += scorePosition(pos, prev ? prev.fret : null, shapeKeys.has(`${pos.string}:${pos.fret}`), options, prevGapSec);
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
  const shift = resolveShift(options);
  const out: AssignedGroup[] = [];
  let prev: Position[] | null = null;
  let prevOnset = 0;
  for (const g of groups) {
    // Chord shapes are fingered shapes: transpose the concert label down
    // by the shift before shape lookup (F#m @+2 -> Em open shape).
    const shape = shapePositions(transposeRoot(chordAt((g.onset + g.offset) / 2), -shift));
    const candLists = g.midis.map((m) => candidatesFor(m, shift));
    if (candLists.some((l) => l.length === 0)) continue; // unplayable pitch: skip group honestly
    const gap: number = prev === null ? Infinity : Math.max(0, g.onset - prevOnset);
    const ranked = combinations(candLists)
      .map((combo) => ({ combo, s: scoreGroup(combo, prev, gap, shape, options) }))
      .filter((c) => c.s !== -Infinity)
      .sort((a, b) => b.s - a.s);
    if (ranked.length === 0) continue;
    const best = ranked[0];
    prev = best.combo;
    prevOnset = g.onset;
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

/** Per-shift playability evidence (all rates over assigned groups; higher score = more idiomatic). */
export interface PitchShiftScore {
  shift: number;
  /** Fraction of assigned notes on open strings. */
  openRate: number;
  /** Fraction of assigned notes above fret 7. */
  highFretRate: number;
  /** Assigned groups whose fretted span exceeds 4. */
  spanViolations: number;
  /** Input groups skipped as unplayable under this shift. */
  unplayable: number;
  /** Mean assignment score of kept groups. */
  meanScore: number;
  /** Kept groups. */
  kept: number;
  /** Combined playability score (higher = more idiomatic). */
  score: number;
}

/**
 * Score discrete transposition hypotheses (concert MINUS fingered pitch)
 * by re-running assignment under each shift and measuring physical
 * playability: open-string rate (primary), high-fret rate, span
 * violations, unplayable groups, mean assignment score. Chord-shape
 * consistency enters as a secondary signal via the transposed shape
 * bonus inside assignSequence.
 *
 * Detected midis are NEVER altered — each shift is only a fingering
 * hypothesis. Capo (non-uniform) is out of scope: it yields flat scores
 * and low confidence, and the caller must not auto-apply then.
 */
export function scorePitchShifts(
  groups: GroupItem[],
  chordAt: (time: number) => string,
  options: AssignOptions = {},
  shifts: number[] = [-2, -1, 0, 1, 2],
): PitchShiftScore[] {
  const out: PitchShiftScore[] = [];
  for (const shift of shifts) {
    const assigned = assignSequence(groups, chordAt, { ...options, pitchShift: shift });
    const kept = assigned.length;
    const unplayable = groups.length - kept;
    let opens = 0;
    let high = 0;
    let total = 0;
    let spanViolations = 0;
    let scoreSum = 0;
    for (const g of assigned) {
      scoreSum += g.score;
      const fretted = g.positions.map((p) => p.fret).filter((f) => f > 0);
      if (fretted.length >= 2 && Math.max(...fretted) - Math.min(...fretted) > 4) spanViolations++;
      for (const p of g.positions) {
        total++;
        if (p.fret === 0) opens++;
        if (p.fret > 7) high++;
      }
    }
    const openRate = total > 0 ? opens / total : 0;
    const highFretRate = total > 0 ? high / total : 0;
    const meanScore = kept > 0 ? scoreSum / kept : 0;
    const n = Math.max(1, groups.length);
    const score =
      3 * openRate - 2 * highFretRate - 0.5 * (spanViolations / n) - 2 * (unplayable / n) + 0.05 * meanScore;
    const r2 = (v: number): number => Math.round(v * 1000) / 1000;
    out.push({
      shift,
      openRate: r2(openRate),
      highFretRate: r2(highFretRate),
      spanViolations,
      unplayable,
      meanScore: r2(meanScore),
      kept,
      score: r2(score),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export interface PitchShiftEstimate {
  /** Best shift hypothesis (concert MINUS fingered, semitones). */
  semitones: number;
  /** 0..1 confidence from the best-vs-second margin (low = ambiguous, do not auto-apply). */
  confidence: number;
  /** Best minus second-best combined score. */
  margin: number;
  /** All scored hypotheses, best first. */
  scores: PitchShiftScore[];
}

/**
 * Pick the discrete shift with a margin-based confidence. Auto-apply ONLY
 * when confidence is high (>= 0.6); otherwise store as
 * suggestedShift + shiftConfidence and expose a manual override.
 */
export function estimatePitchShift(
  groups: GroupItem[],
  chordAt: (time: number) => string,
  options: AssignOptions = {},
  shifts: number[] = [-2, -1, 0, 1, 2],
): PitchShiftEstimate {
  const scores = scorePitchShifts(groups, chordAt, options, shifts);
  if (scores.length === 0 || groups.length === 0) {
    return { semitones: 0, confidence: 0, margin: 0, scores };
  }
  const best = scores[0];
  const second = scores[1];
  const margin = second ? best.score - second.score : best.score;
  const confidence = Math.round(Math.min(1, Math.max(0, margin / 1.5)) * 100) / 100;
  return { semitones: best.shift, confidence, margin: Math.round(margin * 1000) / 1000, scores };
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
 * detected pitch class in the span belongs to the shape (else an honest
 * gap). Under a nonzero pitchShift the concert label is transposed down
 * to the fingered shape (F#m @+2 -> Em) and both the consistency gate
 * and the emitted midis move with it, so emitted midis stay concert
 * pitch while frets show the playable shape.
 */
export function chordsToTab(
  chords: ChordEvent[],
  detectedPitchClasses: (time: number) => number[],
  options: AssignOptions = {},
): TabEvent[] {
  const shift = resolveShift(options);
  const out: TabEvent[] = [];
  for (const c of chords) {
    if (c.label === 'NO_CHORD') continue;
    const shape = shapePositions(transposeRoot(c.label, -shift));
    if (shape.length === 0) continue; // no known shape: honest gap, no invention
    const shapePCs = new Set(shape.map((p) => (OPEN_MIDI[6 - p.string] + p.fret) % 12));
    const detected = detectedPitchClasses((c.start + c.end) / 2).map(
      (pc) => ((((pc - shift) % 12) + 12) % 12),
    );
    if (!detected.every((pc) => shapePCs.has(pc))) continue;
    out.push({
      start: c.start,
      end: c.end,
      kind: 'chord',
      notes: shape.map((p) => {
        const midi = OPEN_MIDI[6 - p.string] + p.fret + shift;
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

/** Pitch classes detected by note events overlapping a time span. */
export function pcsInSpan(
  notes: (NoteEvent | NoteGroup)[],
  start: number,
  end: number,
): number[] {
  const pcs = new Set<number>();
  for (const n of notes) {
    const onset = n.onset;
    const offset = isNoteGroup(n) ? n.offset : n.offset;
    if (offset < start || onset > end) continue;
    const midis = isNoteGroup(n) ? n.notes.map((x) => x.midi) : [(n as NoteEvent).midi];
    for (const m of midis) pcs.add(((m % 12) + 12) % 12);
  }
  return [...pcs];
}

/**
 * Shared final assembly (CLI and browser worker MUST agree).
 * 1. Note-driven tab from transcribed notes + chord context.
 * 2. Shape tab from chord events, pitch-consistent.
 * 3. Dedup: drop note-tab groups fully covered (time + pitch classes)
 *    by a shape-tab event (avoids double-rendering strummed chords).
 * Sorted by start time.
 *
 * options.pitchShift (alias tuningShift) applies a discrete transposition
 * hypothesis to BOTH layers; detected concert midis are never altered —
 * only the suggested string/fret hypotheses move. Default 0 (no shift).
 * Prefer estimatePitchShift for the hypothesis + confidence, and only
 * apply it on explicit user override or high confidence (>= 0.6).
 */
export function assembleTab(
  chords: ChordEvent[],
  notes: (NoteEvent | NoteGroup)[],
  options: AssignOptions = {},
): TabEvent[] {
  const chordAt = (t: number): string => {
    for (const c of chords) if (t >= c.start && t < c.end) return c.label;
    return 'NO_CHORD';
  };
  const noteTab = notesToTab(notes, chordAt, options);
  const shapeTab = chordsToTab(chords, (t) => pcsInSpan(notes, t - 0.5, t + 0.5), options);
  const shapeSpans = shapeTab.map((s) => ({
    start: s.start,
    end: s.end,
    pcs: new Set(s.notes.map((n) => ((n.midi % 12) + 12) % 12)),
  }));
  const kept = noteTab.filter((g) => {
    const groupPCs = new Set(
      g.notes.map((n) => ((n.midi % 12) + 12) % 12),
    );
    for (const s of shapeSpans) {
      const overlap = Math.min(g.end, s.end) - Math.max(g.start, s.start);
      const dur = Math.max(1e-6, g.end - g.start);
      if (overlap / dur >= 0.8 && [...groupPCs].every((pc) => s.pcs.has(pc))) {
        return false; // covered by a shape event
      }
    }
    return true;
  });
  const all = [...shapeTab, ...kept];
  all.sort((a, b) => a.start - b.start);
  return all;
}
