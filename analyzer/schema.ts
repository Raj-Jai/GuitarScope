/**
 * M0 — Analysis JSON contract.
 * The offline analyzer produces this; the tutorial UI consumes only
 * `chords` + `notes` (+ `source` for clock/sync). Raw `frames` are kept
 * for debugging the temporal decoder.
 */

export interface AnalysisSource {
  type: 'file' | 'youtube';
  /** Original file name for local audio. */
  fileName?: string;
  /** YouTube video ID when the tutorial syncs to a YT player. */
  videoId?: string;
  duration: number;
}

export interface AnalysisMeta {
  /** 1 = chords/notes only; 2 = plus rhythm/tab layers. */
  version: 1 | 2;
  sampleRate: number;
  windowSize: number;
  hopSize: number;
  dictionary: 'mvp60' | 'extended132';
  /** Which preprocessing branches contributed (raw, hpss, center-diff). */
  branches: string[];
  createdAt: string;
}

export interface FrameCandidate {
  label: string;
  score: number;
}

export interface FrameAnalysis {
  /** Center time of the analysis window in seconds. */
  time: number;
  candidates: FrameCandidate[];
  /** 12-D chroma (C=0..B=11); present when requested for debugging. */
  chroma?: number[];
}

export interface ChordAlternative {
  label: string;
  score: number;
}

export interface ChordEvent {
  start: number;
  end: number;
  /** 'NO_CHORD' when no class is credible — never force a label. */
  label: string;
  root: string | null;
  /** 'min' | 'maj' | '7' | ... | null for NO_CHORD. */
  quality: string | null;
  confidence: number;
  alternatives: ChordAlternative[];
}

export interface NoteEvent {
  onset: number;
  offset: number;
  duration: number;
  midi: number;
  note: string;
  frequency: number;
  confidence: number;
  /** 'yin' | 'multi-pitch'. */
  source: string;
}

export interface NoteGroup {
  onset: number;
  offset: number;
  notes: { midi: number; frequency: number; confidence: number }[];
}

// ---- Rhythm / tutorial layers (v2; all optional, UI degrades gracefully) ----
//
// Confidence convention for ALL rhythm fields: normalized 0..1 expressing
// confidence in the timestamp/identity of the event — never loudness, and
// not a calibrated probability. TabNote.confidence specifically means
// confidence in the suggested string/fret assignment; pitch confidence
// already lives on the note-detection layer.

export interface TempoInfo {
  bpm: number;
  confidence: number;
}

export interface MeterInfo {
  numerator: number;
  denominator: number;
  confidence: number;
  /**
   * True ONLY as a fallback flag: the system selected this meter because
   * evidence was insufficient — not "probably correct". Display as
   * "4/4 (assumed)" and discount confidence accordingly.
   */
  assumed?: boolean;
}

export interface BeatEvent {
  time: number;
  index: number;
  bar: number;
  beatInBar: number;
  confidence: number;
}

export type StrumDirection = 'D' | 'U' | '?';

export interface StrumEvent {
  time: number;
  /**
   * Index into beats[] of the containing/nearest beat anchor, or -1 when
   * unresolved. A strum may fall between beats but must anchor to one.
   */
  beatIndex: number;
  /** Subdivision SLOT within the beat (0-based); grid resolution is slotsPerBeat. */
  subdivision: number;
  /** Slots per beat of the grid this slot belongs to (2 = eighths, 4 = 16ths). */
  slotsPerBeat: number;
  direction: StrumDirection;
  confidence: number;
  /** Normalized 0..1 attack strength relative to the analyzed song. */
  strength: number;
}

export interface RhythmPattern {
  start: number;
  end: number;
  meter: '4/4' | '3/4' | '6/8' | 'unknown';
  subdivision: 4 | 8 | 16;
  /**
   * One symbol per grid slot. For whole bars: symbols.length MUST equal
   * bars × slotsPerBar where slotsPerBar = subdivision × numerator / 4
   * (8ths in 4/4 → 8/bar). A truncated final bar is allowed only when
   * partial === true.
   */
  symbols: ('D' | 'U' | 'X' | '-')[];
  partial?: boolean;
  /** Closest library pattern id, if matched. */
  matchedPattern?: string;
  confidence: number;
}

export type GuitarString = 1 | 2 | 3 | 4 | 5 | 6;

export interface TabNote {
  start: number;
  end: number;
  midi: number;
  string: GuitarString;
  fret: number;
  /** Confidence in the string/fret ASSIGNMENT (not the pitch). */
  confidence: number;
  /** Always 'suggested' in v1 — never claim recorded fingering. */
  source: 'suggested';
}

/** Ranked alternative fingering with its playability score. */
export interface TabAlternative {
  notes: TabNote[];
  score: number;
}

export interface TabEvent {
  start: number;
  end: number;
  notes: TabNote[];
  kind: 'note' | 'chord' | 'arpeggio';
  alternatives?: TabAlternative[];
}

export interface SongAnalysis {
  source: AnalysisSource;
  meta: AnalysisMeta;
  frames: FrameAnalysis[];
  chords: ChordEvent[];
  notes: (NoteEvent | NoteGroup)[];
  /** v2 rhythm layers (absent in v1 files). */
  tempo?: TempoInfo;
  meter?: MeterInfo;
  beats?: BeatEvent[];
  strums?: StrumEvent[];
  patterns?: RhythmPattern[];
  tab?: TabEvent[];
}

export function isNoteGroup(n: NoteEvent | NoteGroup): n is NoteGroup {
  return (n as NoteGroup).notes !== undefined;
}

/** Minimal structural validation (returns error strings, empty = valid). */
export function validateAnalysis(a: SongAnalysis): string[] {
  const errors: string[] = [];
  if (!a || typeof a !== 'object') return ['not an object'];
  if (!a.source || typeof a.source.duration !== 'number') errors.push('source.duration missing');
  if (!a.meta || (a.meta.version !== 1 && a.meta.version !== 2)) {
    errors.push('meta.version must be 1 or 2');
  }
  if (!Array.isArray(a.frames)) errors.push('frames must be an array');
  if (!Array.isArray(a.chords)) errors.push('chords must be an array');
  if (!Array.isArray(a.notes)) errors.push('notes must be an array');
  for (const [i, c] of (a.chords ?? []).entries()) {
    if (!(c.end > c.start)) errors.push(`chords[${i}]: end must exceed start`);
    if (!c.label) errors.push(`chords[${i}]: label missing`);
  }
  const conf = (v: number | undefined): boolean =>
    v === undefined || (Number.isFinite(v) && v >= 0 && v <= 1);
  if (a.beats !== undefined) {
    if (!Array.isArray(a.beats)) errors.push('beats must be an array');
    else {
      for (const [i, b] of a.beats.entries()) {
        if (!Number.isFinite(b.time) || b.time < 0) errors.push(`beats[${i}]: bad time`);
        if (!Number.isInteger(b.index) || b.index < 0) errors.push(`beats[${i}]: bad index`);
        if (!Number.isInteger(b.bar) || b.bar < 0) errors.push(`beats[${i}]: bad bar`);
        if (!Number.isInteger(b.beatInBar) || b.beatInBar < 0) errors.push(`beats[${i}]: bad beatInBar`);
        if (!conf(b.confidence)) errors.push(`beats[${i}]: confidence must be 0..1`);
      }
      for (let i = 1; i < a.beats.length; i++) {
        if (!(a.beats[i].time > a.beats[i - 1].time)) {
          errors.push('beats: times must be strictly increasing');
          break;
        }
        if (a.beats[i].index !== a.beats[i - 1].index + 1) {
          errors.push('beats: indices must be consecutive');
          break;
        }
      }
      // Consistency with a known (non-assumed) meter: index === bar * numerator + beatInBar.
      const meter = a.meter;
      if (meter && !meter.assumed && Number.isInteger(meter.numerator) && meter.numerator > 0) {
        for (const [i, b] of a.beats.entries()) {
          if (b.beatInBar >= meter.numerator || b.index !== b.bar * meter.numerator + b.beatInBar) {
            errors.push(`beats[${i}]: inconsistent with meter ${meter.numerator}/4`);
            break;
          }
        }
      }
    }
  }
  const beatIndices = new Set((a.beats ?? []).map((b) => b.index));
  if (a.strums !== undefined) {
    if (!Array.isArray(a.strums)) errors.push('strums must be an array');
    else {
      for (const [i, s] of a.strums.entries()) {
        if (!Number.isFinite(s.time) || s.time < 0) errors.push(`strums[${i}]: bad time`);
        if (s.direction !== 'D' && s.direction !== 'U' && s.direction !== '?') {
          errors.push(`strums[${i}]: bad direction`);
        }
        if (!Number.isInteger(s.subdivision) || s.subdivision < 0) {
          errors.push(`strums[${i}]: bad subdivision`);
        }
        if (!Number.isInteger(s.slotsPerBeat) || s.slotsPerBeat < 1 || s.subdivision >= s.slotsPerBeat) {
          errors.push(`strums[${i}]: subdivision must be < slotsPerBeat`);
        }
        if (!conf(s.confidence)) errors.push(`strums[${i}]: confidence must be 0..1`);
        if (!Number.isFinite(s.strength) || s.strength < 0 || s.strength > 1) {
          errors.push(`strums[${i}]: strength must be 0..1`);
        }
        if (!Number.isInteger(s.beatIndex) || (s.beatIndex !== -1 && beatIndices.size > 0 && !beatIndices.has(s.beatIndex))) {
          errors.push(`strums[${i}]: beatIndex must reference beats[] or be -1`);
        }
      }
    }
  }
  if (a.patterns !== undefined) {
    if (!Array.isArray(a.patterns)) errors.push('patterns must be an array');
    else {
      const okSymbols = new Set(['D', 'U', 'X', '-']);
      const slotsPerBar = (meter: RhythmPattern['meter'], subdivision: number): number | null => {
        if (meter === 'unknown') return null;
        const numerator = parseInt(meter[0], 10);
        return (subdivision * numerator) / 4;
      };
      for (const [i, p] of a.patterns.entries()) {
        if (!(p.end > p.start)) errors.push(`patterns[${i}]: end must exceed start`);
        if (!Array.isArray(p.symbols) || p.symbols.some((s) => !okSymbols.has(s))) {
          errors.push(`patterns[${i}]: bad symbols`);
        }
        if (!conf(p.confidence)) errors.push(`patterns[${i}]: confidence must be 0..1`);
        const spb = slotsPerBar(p.meter, p.subdivision);
        if (spb !== null && Array.isArray(p.symbols)) {
          const whole = p.symbols.length % spb === 0;
          if (!whole && !p.partial) {
            errors.push(`patterns[${i}]: symbols must fill whole bars (${spb}/bar) unless partial`);
          }
        }
      }
    }
  }
  if (a.tab !== undefined) {
    if (!Array.isArray(a.tab)) errors.push('tab must be an array');
    else {
      for (const [i, t] of a.tab.entries()) {
        if (!(t.end >= t.start)) errors.push(`tab[${i}]: end must not precede start`);
        if (t.kind !== 'note' && t.kind !== 'chord' && t.kind !== 'arpeggio') {
          errors.push(`tab[${i}]: bad kind`);
        }
        for (const [j, n] of t.notes.entries()) {
          if (!Number.isInteger(n.midi) || n.midi < 0 || n.midi > 127) {
            errors.push(`tab[${i}].notes[${j}]: bad midi`);
          }
          if (![1, 2, 3, 4, 5, 6].includes(n.string)) {
            errors.push(`tab[${i}].notes[${j}]: bad string`);
          }
          if (!Number.isInteger(n.fret) || n.fret < 0 || n.fret > 24) {
            errors.push(`tab[${i}].notes[${j}]: bad fret`);
          }
          if (n.source !== 'suggested') errors.push(`tab[${i}].notes[${j}]: source must be 'suggested'`);
          if (!conf(n.confidence)) errors.push(`tab[${i}].notes[${j}]: confidence must be 0..1`);
          if (n.start < t.start - 1e-3 || n.end > t.end + 1e-3) {
            errors.push(`tab[${i}].notes[${j}]: must lie within the event`);
          }
        }
        for (const [j, alt] of (t.alternatives ?? []).entries()) {
          if (!Array.isArray(alt.notes) || !Number.isFinite(alt.score)) {
            errors.push(`tab[${i}].alternatives[${j}]: need notes + score`);
          }
        }
      }
    }
  }
  if (a.tempo !== undefined) {
    if (!Number.isFinite(a.tempo.bpm) || a.tempo.bpm <= 0) errors.push('tempo.bpm invalid');
  }
  return errors;
}
