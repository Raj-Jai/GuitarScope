/**
 * M3 — temporal chord decoder: frame candidates -> chord events.
 * v1 duration-aware model: majority smoothing -> min-score NO_CHORD ->
 * merge identicals -> absorb too-short segments -> events.
 * (A Viterbi/HMM decoder is the planned iteration, not v1.)
 */
import type { ChordEvent, FrameAnalysis } from './schema';

export interface DecodeOptions {
  /** Majority window in frames (odd, default 7 ≈ 0.6s at 85ms hop). */
  smoothWindow?: number;
  /** Top-score below this -> NO_CHORD contender (default 0.6). */
  minScore?: number;
  /** Segments shorter than this are absorbed (seconds, default 0.8). */
  minDuration?: number;
}

interface Labeled {
  time: number;
  label: string;
  score: number;
}

export function smoothFrames(frames: FrameAnalysis[], window = 7): Labeled[] {
  const half = Math.floor(window / 2);
  return frames.map((f, i) => {
    const votes = new Map<string, { count: number; score: number }>();
    for (let j = Math.max(0, i - half); j <= Math.min(frames.length - 1, i + half); j++) {
      const top = frames[j].candidates[0];
      if (!top) continue;
      const v = votes.get(top.label) ?? { count: 0, score: 0 };
      v.count++;
      v.score = Math.max(v.score, top.score);
      votes.set(top.label, v);
    }
    let bestLabel = 'NO_CHORD';
    let bestCount = 0;
    let bestScore = 0;
    for (const [label, v] of votes) {
      if (v.count > bestCount || (v.count === bestCount && v.score > bestScore)) {
        bestLabel = label;
        bestCount = v.count;
        bestScore = v.score;
      }
    }
    return { time: f.time, label: bestLabel, score: bestScore };
  });
}

interface Segment {
  label: string;
  startIdx: number;
  endIdx: number; // inclusive frame index
  score: number; // max top-score inside
}

export function decodeChords(
  frames: FrameAnalysis[],
  options: DecodeOptions = {},
  hopSeconds = 4096 / 48000,
): ChordEvent[] {
  const { smoothWindow = 7, minScore = 0.6, minDuration = 0.8 } = options;
  if (frames.length === 0) return [];
  const labeled = smoothFrames(frames, smoothWindow).map((l) =>
    l.score < minScore ? { ...l, label: 'NO_CHORD', score: l.score } : l,
  );

  // Merge consecutive identical labels.
  const merged: Segment[] = [];
  for (let i = 0; i < labeled.length; i++) {
    const cur = merged[merged.length - 1];
    if (cur && cur.label === labeled[i].label) {
      cur.endIdx = i;
      cur.score = Math.max(cur.score, labeled[i].score);
    } else {
      merged.push({ label: labeled[i].label, startIdx: i, endIdx: i, score: labeled[i].score });
    }
  }

  // Absorb too-short segments into the stronger neighbor (repeat until
  // every segment meets the minimum duration or one remains).
  const dur = (s: Segment): number => (s.endIdx - s.startIdx + 1) * hopSeconds;
  const segs = [...merged];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      if (dur(segs[i]) >= minDuration || segs.length === 1) continue;
      const prev = i > 0 ? segs[i - 1] : null;
      const next = i + 1 < segs.length ? segs[i + 1] : null;
      if (!prev || (next && next.score > prev.score)) {
        const target = next as Segment;
        target.startIdx = segs[i].startIdx;
        target.score = Math.max(target.score, segs[i].score);
      } else {
        const target = prev as Segment;
        target.endIdx = segs[i].endIdx;
        target.score = Math.max(target.score, segs[i].score);
      }
      segs.splice(i, 1);
      changed = true;
      break;
    }
  }

  // Absorbing can place identical labels adjacently: merge once more.
  const mergedFinal: Segment[] = [];
  for (const s of segs) {
    const cur = mergedFinal[mergedFinal.length - 1];
    if (cur && cur.label === s.label) {
      cur.endIdx = s.endIdx;
      cur.score = Math.max(cur.score, s.score);
    } else {
      mergedFinal.push({ ...s });
    }
  }

  return mergedFinal.map((seg) => {
    const start = frames[seg.startIdx].time - hopSeconds / 2;
    const end = frames[seg.endIdx].time + hopSeconds / 2;
    // Alternatives: runner-up labels by mean score inside the segment.
    const alt = new Map<string, { total: number; count: number }>();
    for (let i = seg.startIdx; i <= seg.endIdx; i++) {
      for (const c of frames[i].candidates.slice(1, 3)) {
        const a = alt.get(c.label) ?? { total: 0, count: 0 };
        a.total += c.score;
        a.count++;
        alt.set(c.label, a);
      }
    }
    const alternatives = [...alt.entries()]
      .map(([label, v]) => ({ label, score: Math.round((v.total / v.count) * 1000) / 1000 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    const root = seg.label === 'NO_CHORD' ? null : rootOf(seg.label);
    return {
      start: Math.max(0, Math.round(start * 1000) / 1000),
      end: Math.round(end * 1000) / 1000,
      label: seg.label,
      root,
      quality: seg.label === 'NO_CHORD' ? null : qualityOf(seg.label),
      confidence: Math.round(seg.score * 1000) / 1000,
      alternatives,
    };
  });
}

function rootOf(label: string): string {
  const m = /^([A-G][#b]?)/.exec(label);
  return m ? m[1] : label;
}

function qualityOf(label: string): string {
  const m = /^([A-G][#b]?)(.*)$/.exec(label);
  const suffix = m ? m[2] : '';
  if (suffix === '' ) return 'maj';
  if (suffix === 'm') return 'min';
  return suffix;
}
