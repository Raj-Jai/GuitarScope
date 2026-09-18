/**
 * M1/M2 — frame-level song analysis.
 * 16384-sample window / 4096-sample hop @48kHz (~12 frames/s), reusing the
 * validated DSP: peak multi-pitch + harmonic subtraction -> chroma ->
 * template matching. Emits top-N candidates per frame WITHOUT hard labels
 * (the temporal decoder in M3 decides).
 */
import { frameSpectrum } from '../src/lib/dsp/hps';
import { candidatesToChroma } from '../src/lib/dsp/chroma';
import { estimateF0Candidates } from '../src/lib/dsp/multi-pitch';
import {
  CHORD_DICTIONARY,
  type ChordDefinition,
} from '../src/lib/chords/chord-definitions';
import { chromaIsSparse, matchChord } from '../src/lib/chords/chord-matcher';
import type { FrameAnalysis } from './schema';

export interface FrameEngineOptions {
  sampleRate?: number;
  windowSize?: number;
  hopSize?: number;
  topN?: number;
  includeChroma?: boolean;
  dictionary?: ChordDefinition[];
}

export interface FrameEngineResult {
  frames: FrameAnalysis[];
  frameCount: number;
  audioSeconds: number;
  analysisMs: number;
}

export function analyzeFrames(
  samples: Float32Array,
  options: FrameEngineOptions = {},
  onProgress?: (done: number, total: number) => void,
): FrameEngineResult {
  const {
    sampleRate = 48000,
    windowSize = 16384,
    hopSize = 4096,
    topN = 3,
    includeChroma = false,
    dictionary = CHORD_DICTIONARY,
  } = options;
  const t0 = performance.now();
  const frames: FrameAnalysis[] = [];
  const total = Math.max(0, Math.floor((samples.length - windowSize) / hopSize) + 1);
  for (let i = 0; i < total; i++) {
    const start = i * hopSize;
    const window = samples.slice(start, start + windowSize);
    const { magnitude, fftSize } = frameSpectrum(window);
    const candidates = estimateF0Candidates(magnitude, sampleRate, fftSize);
    const chroma = candidatesToChroma(candidates);
    // Sparse chroma (silence/thin residue) contributes NO candidates so
    // downstream voting never mistakes emptiness for a chord.
    const ranked = chromaIsSparse(chroma) ? [] : matchChord(chroma, dictionary, topN);
    const frame: FrameAnalysis = {
      time: (start + windowSize / 2) / sampleRate,
      candidates: ranked.map((r) => ({ label: r.chord.name, score: round3(r.score) })),
    };
    if (includeChroma) {
      frame.chroma = Array.from(chroma, (v) => round3(v));
    }
    frames.push(frame);
    if (onProgress && (i % 50 === 0 || i === total - 1)) onProgress(i + 1, total);
  }
  return {
    frames,
    frameCount: frames.length,
    audioSeconds: samples.length / sampleRate,
    analysisMs: performance.now() - t0,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
