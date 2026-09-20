/**
 * T-M4 — chord-aware rhythm patterns.
 * Locked rules (supervisor review):
 *  - sounding strums vs hand-motion grid stay separate; '-' means NO
 *    DETECTED strum, never a proven rest. (Full hand-motion inference
 *    through rests is deferred — it needs confident alternation modeling.)
 *  - Quantization is tolerance-based: strums outside ±25% of a slot stay
 *    unquantized, kept aside, never forced into slots.
 *  - Bar-aware: normalized 8th-note slots within bar/chord segments.
 *  - Repeats share a matchedPattern id; slot accuracy and match
 *    confidence are reported separately.
 *  - The curated library interprets; it never invents D/U evidence.
 */
import type { ChordEvent, RhythmPattern, StrumEvent } from './schema';

export interface QuantizedStrum {
  time: number;
  bar: number;
  slot: number; // 0..7 eighth slots within the bar
  direction: 'D' | 'U';
  confidence: number;
  /** True when direction came from hand-grid parity, not acoustic evidence. */
  inferred: boolean;
  /** Session-normalized onset strength (weak residue never emits symbols). */
  strength: number;
}

/** Minimum strength for a quantized strum to EMIT a pattern symbol. */
export const SYMBOL_MIN_STRENGTH = 0.15;

export interface PatternExtraction {
  patterns: RhythmPattern[];
  quantized: QuantizedStrum[];
  unquantized: StrumEvent[];
  slotAccuracyBasis: number; // quantized / total sounding
}

/** Curated pattern library (8th-grid bar signatures). */
export const PATTERN_LIBRARY: { id: string; symbols: string[]; description: string }[] = [
  { id: 'straight-8-down', symbols: ['D', '-', 'D', '-', 'D', '-', 'D', '-'], description: 'Quarter-note downstrums' },
  { id: 'island', symbols: ['D', '-', 'D', 'U', '-', 'U', 'D', '-'], description: 'Classic island strum' },
  { id: 'alt-8', symbols: ['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U'], description: 'Straight alternating eighths' },
  { id: 'half-time', symbols: ['D', '-', '-', '-', 'D', '-', '-', '-'], description: 'Half-time downs' },
  { id: 'backbeat', symbols: ['-', '-', 'D', '-', '-', '-', 'D', '-'], description: 'Backbeat chops' },
  { id: 'folk', symbols: ['D', '-', 'D', 'U', 'D', '-', 'D', 'U'], description: 'Folk 8th pattern' },
];

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Bar starts from beat times (assumed 4/4: every 4th beat starts a bar). */
export function barStarts(beats: { time: number }[]): number[] {
  const starts: number[] = [];
  for (let i = 0; i < beats.length; i += 4) starts.push(beats[i].time);
  return starts;
}

export function quantizeStrums(
  strums: StrumEvent[],
  beats: { time: number }[],
): { quantized: QuantizedStrum[]; unquantized: StrumEvent[]; eighth: number } {
  const quantized: QuantizedStrum[] = [];
  const unquantized: StrumEvent[] = [];
  if (beats.length < 2) {
    return { quantized, unquantized: [...strums], eighth: NaN };
  }
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i++) gaps.push(beats[i].time - beats[i - 1].time);
  const beatDur = median(gaps);
  const eighth = beatDur / 2;
  const starts = barStarts(beats);
  const barDur = starts.length > 1 ? starts[1] - starts[0] : beatDur * 4;
  // Tolerance so early-detected attacks just before a boundary still
  // belong to it (onset detection + walkback routinely land ±30 ms).
  const tol = eighth * 0.25;
  for (const s of strums) {
    if (s.direction !== 'D' && s.direction !== 'U' && s.direction !== '?') continue;
    // Containing bar (arithmetic + clamp: strict >= comparisons drop
    // attacks detected milliseconds before the grid line).
    let bar = Math.floor((s.time - starts[0] + tol) / barDur);
    if (bar < 0 || bar >= starts.length) {
      unquantized.push(s);
      continue;
    }
    const slotFloat = (s.time - starts[bar]) / eighth;
    // Normalize -0 (Math.round of tiny negatives) to +0 for map keys.
    const slot = Math.round(slotFloat) + 0;
    if (slot < 0 || slot > 7 || Math.abs(slotFloat - slot) > 0.25) {
      unquantized.push(s);
      continue;
    }
    quantized.push({
      time: s.time,
      bar,
      slot,
      direction: s.direction === '?' ? 'D' : s.direction, // placeholder, fixed below
      confidence: s.confidence,
      inferred: s.direction === '?',
      strength: s.strength,
    });
  }
  // Hand-grid parity fill: the picking hand alternates D/U every eighth
  // slot regardless of rests, so a SOUNDING '?' strum on an even slot is
  // most likely D, on an odd slot most likely U — at modest confidence.
  // This is interpretation (flagged), not acoustic evidence. Syncopated
  // anticipations can defeat it; the library edit-distance absorbs misses.
  for (const q of quantized) {
    if (!q.inferred) continue;
    q.direction = q.slot % 2 === 0 ? 'D' : 'U';
    q.confidence = Math.min(q.confidence, 0.5);
  }
  return { quantized, unquantized, eighth };
}

function editDistance(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const sub = (a[i - 1] === '-' || b[j - 1] === '-') && a[i - 1] !== b[j - 1] ? 0.25 : a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + sub);
    }
  }
  return dp[a.length][b.length];
}

/** Best library match (id + confidence) or null when nothing is close. */
export function matchLibrary(symbols: string[]): { id: string; confidence: number } | null {
  let best: { id: string; confidence: number } | null = null;
  for (const entry of PATTERN_LIBRARY) {
    if (entry.symbols.length !== symbols.length) continue;
    const dist = editDistance(symbols, entry.symbols);
    const conf = 1 - dist / Math.max(1, symbols.length);
    if (!best || conf > best.confidence) best = { id: entry.id, confidence: Math.round(conf * 100) / 100 };
  }
  return best && best.confidence >= 0.75 ? best : null;
}

export function extractPatterns(
  strums: StrumEvent[],
  beats: { time: number }[],
  chords: ChordEvent[],
  tempoConfidence = 1,
): PatternExtraction {
  const { quantized, unquantized } = quantizeStrums(strums, beats);
  const starts = barStarts(beats);
  // Chord segments cut at bar boundaries: segment = maximal bar run with one chord.
  interface Seg {
    bar0: number;
    bar1: number; // inclusive
    label: string;
  }
  const segs: Seg[] = [];
  const chordAt = (t: number): string => {
    for (const c of chords) if (t >= c.start && t < c.end) return c.label;
    return 'NO_CHORD';
  };
  for (let b = 0; b < starts.length; b++) {
    const mid = b + 1 < starts.length ? (starts[b] + starts[b + 1]) / 2 : starts[b] + 0.1;
    const label = chordAt(mid);
    const last = segs[segs.length - 1];
    if (last && last.label === label) last.bar1 = b;
    else segs.push({ bar0: b, bar1: b, label });
  }
  // Bar signatures from SALIENT quantized strums (weak residue such as
  // note-end transients never emits symbols, even when placed on a slot).
  const barSig = new Map<number, Map<number, QuantizedStrum>>();
  for (const q of quantized) {
    if (q.strength < SYMBOL_MIN_STRENGTH) continue;
    if (!barSig.has(q.bar)) barSig.set(q.bar, new Map());
    const m = barSig.get(q.bar) as Map<number, QuantizedStrum>;
    const prev = m.get(q.slot);
    if (!prev || q.confidence > prev.confidence) m.set(q.slot, q);
  }
  // Repeated-pattern ids: identical bar signatures share an id.
  const sigToId = new Map<string, string>();
  let repCounter = 0;
  const patterns: RhythmPattern[] = [];
  for (const seg of segs) {
    const symbols: RhythmPattern['symbols'] = [];
    let confSum = 0;
    let confN = 0;
    for (let b = seg.bar0; b <= seg.bar1; b++) {
      const m = barSig.get(b);
      for (let slot = 0; slot < 8; slot++) {
        const q = m?.get(slot);
        symbols.push(q ? q.direction : '-');
        if (q) {
          confSum += q.confidence;
          confN++;
        }
      }
    }
    const sigKey = symbols.join('');
    let matched = matchLibrary(symbols.length === 8 ? symbols : []);
    let matchedId = matched?.id;
    if (!matchedId) {
      const existing = sigToId.get(sigKey);
      if (existing) {
        matchedId = existing;
      } else {
        repCounter++;
        matchedId = `rep-${repCounter}`;
        sigToId.set(sigKey, matchedId);
      }
    }
    const gridCertainty =
      quantized.length + unquantized.length > 0
        ? quantized.length / (quantized.length + unquantized.length)
        : 0;
    patterns.push({
      start: Math.round(starts[seg.bar0] * 1000) / 1000,
      end: Math.round(
        (seg.bar1 + 1 < starts.length ? starts[seg.bar1 + 1] : starts[seg.bar1] + 1) * 1000,
      ) / 1000,
      meter: '4/4',
      subdivision: 8,
      symbols,
      matchedPattern: matchedId,
      confidence: Math.round(
        (confN > 0 ? confSum / confN : 0) * 0.6 * 100 +
          gridCertainty * 0.25 * 100 +
          tempoConfidence * 0.15 * 100,
      ) / 100,
    });
  }
  // Grid certainty over SALIENT strums only: weak residue correctly
  // rejected from slots must not read as grid uncertainty.
  const salient = (list: { strength?: number }[]): number =>
    list.filter((s) => (s.strength ?? 1) >= SYMBOL_MIN_STRENGTH).length;
  const salientPlaced = quantized.filter((q) => q.strength >= SYMBOL_MIN_STRENGTH).length;
  const salientTotal = salient(strums);
  return {
    patterns,
    quantized,
    unquantized,
    slotAccuracyBasis: salientTotal > 0 ? salientPlaced / salientTotal : 0,
  };
}
