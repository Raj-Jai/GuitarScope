/**
 * Polyphonic pipeline: frame → spectrum → F0 candidates → chroma
 * → chord template matching → ranked result with confidence.
 */
import { frameSpectrum } from '../dsp/hps';
import { candidatesToChroma, type ChromaVector } from '../dsp/chroma';
import { estimateF0Candidates, type F0Candidate } from '../dsp/multi-pitch';
import { classifyFrame } from './signal-quality';
import {
  CHORD_DICTIONARY,
  chordNoteNames,
  type ChordDefinition,
} from '../chords/chord-definitions';
import { chromaIsSparse, matchChord } from '../chords/chord-matcher';

export type ChordStatus =
  | 'NO_SIGNAL'
  | 'LOW_SIGNAL'
  | 'MONOPHONIC'
  | 'CHORD_DETECTED'
  | 'UNCERTAIN';

export interface ChordResult {
  status: ChordStatus;
  chord: ChordDefinition | null;
  /** Top-N ranked alternatives. */
  alternatives: { name: string; score: number; confidence: number }[];
  confidence: number;
  /** Pitch-class names present (from candidates). */
  pitchClasses: string[];
  noteNames: string[];
  candidates: F0Candidate[];
  chroma: ChromaVector | null;
}

export interface ChordDetectorOptions {
  sampleRate?: number;
  dictionary?: ChordDefinition[];
  /** Min top-score to report CHORD_DETECTED (default 0.6). */
  minScore?: number;
  topN?: number;
  /**
   * Analysis window (power of 2, default 16384 = 341ms @48kHz).
   * Deliberately longer than the monophonic 4096 path: low guitar
   * triads (E2/G#2/B2 = bins 7/9/10.5 @4096) merge inside one Hann
   * main lobe (4 bins wide). @16384 they sit 6-7 bins apart and
   * resolve. Uses the LAST frameSize samples of the input frame.
   */
  frameSize?: number;
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function detectChord(
  frame: Float32Array,
  options: ChordDetectorOptions = {},
): ChordResult {
  const {
    sampleRate = 48000,
    dictionary = CHORD_DICTIONARY,
    minScore = 0.6,
    topN = 3,
    frameSize = 16384,
  } = options;
  const none = (status: ChordStatus): ChordResult => ({
    status,
    chord: null,
    alternatives: [],
    confidence: 0,
    pitchClasses: [],
    noteNames: [],
    candidates: [],
    chroma: null,
  });

  const gate = classifyFrame(frame);
  if (gate.quality === 'NO_SIGNAL') return none('NO_SIGNAL');
  if (gate.quality === 'LOW_SIGNAL') return none('LOW_SIGNAL');
  if (frame.length < frameSize) return none('UNCERTAIN');

  const window = frame.slice(frame.length - frameSize);
  const { magnitude, fftSize } = frameSpectrum(window);
  const candidates = estimateF0Candidates(magnitude, sampleRate, fftSize);
  // Monophonic if fewer than 2 DISTINCT pitch classes carry significant
  // weight (same-PC octave harmonics must not count as polyphony).
  const maxWeight = Math.max(0, ...candidates.map((c) => c.weight));
  const strongPCs = new Set(
    candidates
      .filter((c) => c.weight >= maxWeight * 0.25)
      .map((c) => c.pitchClass),
  );
  if (strongPCs.size < 2) return none('MONOPHONIC');

  const chroma = candidatesToChroma(candidates);
  if (chromaIsSparse(chroma)) return none('UNCERTAIN');

  const ranked = matchChord(chroma, dictionary, topN);
  const best = ranked[0];
  if (!best || best.score < minScore) {
    return {
      ...none('UNCERTAIN'),
      candidates,
      chroma,
      alternatives: ranked.map((r) => ({
        name: r.chord.name,
        score: r.score,
        confidence: r.confidence,
      })),
    };
  }
  const pitchClasses = [
    ...new Set(candidates.map((c) => NOTE_NAMES[c.pitchClass])),
  ];
  return {
    status: 'CHORD_DETECTED',
    chord: best.chord,
    alternatives: ranked.slice(1).map((r) => ({
      name: r.chord.name,
      score: r.score,
      confidence: r.confidence,
    })),
    confidence: best.confidence,
    pitchClasses,
    noteNames: chordNoteNames(best.chord),
    candidates,
    chroma,
  };
}
