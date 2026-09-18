/**
 * M4b — multi-branch evidence + agreement.
 * Branches: raw (as-is), harmonic (HPSS: percussive attacks suppressed),
 * center-diff (L-R on stereo: center-panned content suppressed).
 * No branch is trusted alone: the agreed frame label needs a majority,
 * and disagreement lowers the score so the decoder prefers NO_CHORD over
 * a vocal-driven false chord.
 */
import { hpss } from '../src/lib/dsp/hpss';
import type { FrameAnalysis } from './schema';
import { analyzeFrames, type FrameEngineOptions } from './frames';

export type BranchName = 'raw' | 'harmonic' | 'center-diff';

export interface BranchFrames {
  name: BranchName;
  frames: FrameAnalysis[];
}

export interface BranchAgreement {
  branches: BranchFrames[];
  agreed: FrameAnalysis[];
  /** Fraction of frames where a strict majority agreed on top-1. */
  agreeRate: number;
}

export function analyzeBranch(
  samples: Float32Array,
  options: FrameEngineOptions = {},
): FrameAnalysis[] {
  return analyzeFrames(samples, options).frames;
}

/**
 * Cross-branch pooled scoring.
 * score(label) = best branch score × (0.6 + 0.4 × support breadth).
 * A label with one clean witness (e.g. center-diff at 0.999) beats a
 * label that merely tops two confused branches. Single-branch mode is
 * unaffected (breadth = 1/1 → factor 1.0).
 */
export function agreeFrames(branches: BranchFrames[]): { agreed: FrameAnalysis[]; agreeRate: number } {
  // Pool DEEP (top-8 per branch): the true chord often sits at rank 4-8
  // in contaminated branches while a vocal-driven label tops them.
  const POOL_DEPTH = 8;
  const n = Math.min(...branches.map((b) => b.frames.length));
  const agreed: FrameAnalysis[] = [];
  // Majority = winner backed by 2+ branches (unanimity is near-zero on
  // real audio and would make the metric useless).
  let majority = 0;
  for (let i = 0; i < n; i++) {
    const best = new Map<string, number>();
    const support = new Map<string, number>();
    const tops: string[] = [];
    for (const b of branches) {
      const cands = b.frames[i].candidates;
      if (cands.length > 0) tops.push(cands[0].label);
      for (const c of cands.slice(0, POOL_DEPTH)) {
        best.set(c.label, Math.max(best.get(c.label) ?? 0, c.score));
        support.set(c.label, (support.get(c.label) ?? 0) + 1);
      }
    }
    let winner = tops[0] ?? 'NO_CHORD';
    let winnerScore = -1;
    for (const [label, maxScore] of best) {
      const breadth = (support.get(label) ?? 1) / Math.max(1, branches.length);
      const score = maxScore * (0.6 + 0.4 * breadth);
      if (score > winnerScore) {
        winner = label;
        winnerScore = score;
      }
    }
    if ((support.get(winner) ?? 0) >= 2 || branches.length === 1) majority++;
    const score = best.size === 0 ? 0 : Math.min(1, Math.round(winnerScore * 1000) / 1000);
    const runners = [...best.entries()]
      .filter(([label]) => label !== winner)
      .map(([label, maxScore]) => ({
        label,
        score: Math.min(1, Math.round(maxScore * (0.6 + 0.4 * ((support.get(label) ?? 1) / branches.length)) * 1000) / 1000),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    agreed.push({
      time: branches[0].frames[i].time,
      candidates: best.size === 0 ? [] : [{ label: winner, score }, ...runners],
    });
  }
  return { agreed, agreeRate: n > 0 ? majority / n : 0 };
}

export function analyzeWithBranches(
  input: { mono: Float32Array } | { left: Float32Array; right: Float32Array },
  options: FrameEngineOptions = {},
): BranchAgreement {
  const branches: BranchFrames[] = [];
  // Deep candidate lists: pooling needs ranks below the top-3.
  const deep = { ...options, topN: 8 };
  const mono = 'mono' in input ? input.mono : mixDown(input.left, input.right);
  branches.push({ name: 'raw', frames: analyzeBranch(mono, deep) });
  branches.push({ name: 'harmonic', frames: analyzeBranch(hpss(mono).harmonic, deep) });
  if ('left' in input) {
    const diff = centerDiff(input.left, input.right);
    branches.push({ name: 'center-diff', frames: analyzeBranch(diff, deep) });
  }
  const { agreed, agreeRate } = agreeFrames(branches);
  return { branches, agreed, agreeRate };
}

/** (L-R)/2 mono: suppresses center-panned content (lead vocal, kick). */
export function centerDiff(left: Float32Array, right: Float32Array): Float32Array {
  const n = Math.min(left.length, right.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (left[i] - right[i]) / 2;
  return out;
}

function mixDown(left: Float32Array, right: Float32Array): Float32Array {
  const n = Math.min(left.length, right.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (left[i] + right[i]) / 2;
  return out;
}
