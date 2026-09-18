/**
 * Chord template matching: cosine similarity between an observed
 * chroma vector and binary chord templates, with ranking + confidence.
 */
import type { ChromaVector } from '../dsp/chroma';
import type { ChordDefinition } from './chord-definitions';

export interface ChordCandidate {
  chord: ChordDefinition;
  /** Cosine similarity 0..1. */
  score: number;
  /** Confidence 0..1 (margin over runner-up blended with absolute score). */
  confidence: number;
  rootCorrect?: boolean;
}

function templateVector(chord: ChordDefinition): Float64Array {
  const t = new Float64Array(12);
  const w = 1 / Math.sqrt(chord.pitchClasses.length);
  for (const p of chord.pitchClasses) t[p] = w;
  return t;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Rank dictionary chords against an observed chroma vector.
 * Returns top-N candidates with confidence from score margin.
 */
export function matchChord(
  chroma: ChromaVector,
  dictionary: ChordDefinition[],
  topN = 3,
): ChordCandidate[] {
  const scored = dictionary.map((chord) => ({
    chord,
    score: cosineSimilarity(chroma, templateVector(chord)),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, topN));
  const best = top[0]?.score ?? 0;
  const runner = top[1]?.score ?? 0;
  const margin = Math.max(0, best - runner);
  return top.map((c, i) => ({
    chord: c.chord,
    score: c.score,
    confidence:
      i === 0
        ? Math.min(1, c.score * (0.5 + Math.min(0.5, margin * 2)))
        : Math.min(1, c.score * 0.8),
  }));
}

/** Is the chroma vector too flat/empty to trust? (silence/noise guard). */
export function chromaIsSparse(
  chroma: ChromaVector,
  minPeak = 0.08,
): boolean {
  let max = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
  return max < minPeak;
}
