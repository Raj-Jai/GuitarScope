/**
 * Duration-weighted chord scoring (primary metric for song validation).
 * Exact boundaries are NOT the main metric: a small boundary shift with
 * the right label barely dents the score; wrong labels do.
 */
import { CHORD_DICTIONARY } from '../src/lib/chords/chord-definitions';
import type { ChordEvent } from './schema';
import type { RefChord } from './reference';

export interface ChordScores {
  /** Duration-weighted exact-label accuracy (primary). */
  weightedAccuracy: number;
  rootAccuracy: number;
  qualityAccuracy: number;
  /** Root + major/minor character, ignoring extensions. */
  triadAccuracy: number;
  totalRefDuration: number;
  boundaryMeanErr: number;
  boundaryMedianErr: number;
}

interface Parsed {
  root: number | null; // pitch class, null = NO_CHORD/unparseable
  quality: string; // exact quality id: major|minor|7|maj7|m7|...|none
  family: string; // 'maj' | 'min' | 'dim' | 'aug' | 'sus' | 'none'
}

const ROOT_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

function familyOf(quality: string): string {
  if (quality === 'dim' || quality === 'm7b5') return 'dim';
  if (quality === 'aug') return 'aug';
  if (quality === 'sus2' || quality === 'sus4') return 'sus';
  if (quality === 'minor' || quality === 'm7') return 'min';
  return 'maj';
}

export function parseChordLabel(label: string): Parsed {
  if (!label || label === 'NO_CHORD' || label === 'N') {
    return { root: null, quality: 'none', family: 'none' };
  }
  const m = /^([A-G][#b]?)(.*)$/.exec(label.trim());
  if (!m) return { root: null, quality: 'none', family: 'none' };
  const root = ROOT_PC[m[1]] ?? null;
  const suffix = m[2];
  const entry = CHORD_DICTIONARY.find((c) => c.name === label.trim());
  const quality = entry
    ? entry.quality
    : suffix === '' || suffix === 'maj'
      ? 'major'
      : suffix === 'm' || suffix === 'min'
        ? 'minor'
        : suffix;
  return { root, quality, family: familyOf(quality) };
}

function activeLabel(events: { start: number; end: number; label: string }[], t: number): string {
  for (const e of events) {
    if (t >= e.start && t < e.end) return e.label;
  }
  return 'NO_CHORD';
}

export function scoreChords(detected: ChordEvent[], ref: RefChord[]): ChordScores {
  const bounds = new Set<number>();
  for (const e of [...detected, ...ref]) {
    bounds.add(e.start);
    bounds.add(e.end);
  }
  const xs = [...bounds].sort((a, b) => a - b);
  let total = 0;
  let exact = 0;
  let root = 0;
  let quality = 0;
  let triad = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const t0 = xs[i];
    const t1 = xs[i + 1];
    const dur = t1 - t0;
    if (dur <= 0) continue;
    // Only score time covered by the reference.
    if (activeLabel(ref, (t0 + t1) / 2) === 'NO_CHORD' && !ref.some((r) => t0 >= r.start && t0 < r.end)) {
      continue;
    }
    const mid = (t0 + t1) / 2;
    const d = parseChordLabel(activeLabel(detected, mid));
    const r = parseChordLabel(activeLabel(ref, mid));
    total += dur;
    if (d.root !== null && r.root !== null) {
      const sameRoot = d.root === r.root;
      const sameQuality = d.quality === r.quality;
      if (sameRoot) root += dur;
      if (sameQuality) quality += dur;
      const dRaw = activeLabel(detected, mid);
      const rRaw = activeLabel(ref, mid);
      if (dRaw === rRaw) {
        exact += dur;
        triad += dur;
      } else if (
        sameRoot &&
        (d.family === 'maj' || d.family === 'min') &&
        d.family === r.family
      ) {
        triad += dur;
      }
    } else if (d.root === null && r.root === null) {
      exact += dur;
      root += dur;
      quality += dur;
      triad += dur;
    }
  }
  // Boundary error: each interior ref boundary vs nearest detected boundary.
  const detBounds = new Set<number>();
  for (const e of detected) {
    detBounds.add(e.start);
    detBounds.add(e.end);
  }
  const errs: number[] = [];
  for (const r of ref) {
    for (const b of [r.start, r.end]) {
      if (b <= ref[0].start || b >= ref[ref.length - 1].end) continue;
      let best = Infinity;
      for (const db of detBounds) best = Math.min(best, Math.abs(db - b));
      if (Number.isFinite(best)) errs.push(best);
    }
  }
  errs.sort((a, b) => a - b);
  const mean = errs.length ? errs.reduce((a, e) => a + e, 0) / errs.length : 0;
  const median = errs.length
    ? errs.length % 2 === 1
      ? errs[Math.floor(errs.length / 2)]
      : (errs[errs.length / 2 - 1] + errs[errs.length / 2]) / 2
    : 0;
  const div = total > 0 ? total : 1;
  return {
    weightedAccuracy: exact / div,
    rootAccuracy: root / div,
    qualityAccuracy: quality / div,
    triadAccuracy: triad / div,
    totalRefDuration: total,
    boundaryMeanErr: mean,
    boundaryMedianErr: median,
  };
}
