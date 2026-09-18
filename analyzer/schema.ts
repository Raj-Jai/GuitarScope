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
  version: 1;
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

export interface SongAnalysis {
  source: AnalysisSource;
  meta: AnalysisMeta;
  frames: FrameAnalysis[];
  chords: ChordEvent[];
  notes: (NoteEvent | NoteGroup)[];
}

export function isNoteGroup(n: NoteEvent | NoteGroup): n is NoteGroup {
  return (n as NoteGroup).notes !== undefined;
}

/** Minimal structural validation (returns error strings, empty = valid). */
export function validateAnalysis(a: SongAnalysis): string[] {
  const errors: string[] = [];
  if (!a || typeof a !== 'object') return ['not an object'];
  if (!a.source || typeof a.source.duration !== 'number') errors.push('source.duration missing');
  if (!a.meta || a.meta.version !== 1) errors.push('meta.version must be 1');
  if (!Array.isArray(a.frames)) errors.push('frames must be an array');
  if (!Array.isArray(a.chords)) errors.push('chords must be an array');
  if (!Array.isArray(a.notes)) errors.push('notes must be an array');
  for (const [i, c] of (a.chords ?? []).entries()) {
    if (!(c.end > c.start)) errors.push(`chords[${i}]: end must exceed start`);
    if (!c.label) errors.push(`chords[${i}]: label missing`);
  }
  return errors;
}
