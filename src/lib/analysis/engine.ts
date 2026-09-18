/**
 * DspEngine: pure, headless orchestration of the validated DSP pipelines.
 * The Worker is a thin protocol wrapper around this class so all
 * scheduling logic is unit-testable in Node without a browser.
 */
import { detectPitch, type DetectionResult } from '../pitch/pitch-detector';
import { detectChord, type ChordResult } from './polyphonic';

export interface EngineConfig {
  sampleRate: number;
  /** Pitch analysis frame (default 4096 ≈ 85ms @48k). */
  pitchFrameSize?: number;
  /** Chord ring window (default 16384 ≈ 341ms @48k — calibrated, do not shrink casually). */
  chordWindowSize?: number;
  /** Chord analyses per second (default 4, configurable to 8). */
  chordCadenceHz?: number;
  minConfidence?: number;
}

export interface EngineResult {
  seq: number;
  captureTimestamp: number;
  processedTimestamp: number;
  pitchProcessingMs: number;
  chordProcessingMs: number;
  ranChord: boolean;
  pitch: DetectionResult;
  chord: ChordResult | null;
}

export class DspEngine {
  private readonly pitchFrameSize: number;
  private readonly chordWindowSize: number;
  private chordCadenceHz: number;
  private readonly sampleRate: number;
  private readonly minConfidence: number;
  private seq = 0;
  private ring: Float32Array;
  private ringFill = 0; // total samples ever appended (monotonic)
  private lastChordAtFill = 0;
  private lastChord: ChordResult | null = null;
  private framesProcessed = 0;
  private chordsRun = 0;

  constructor(config: EngineConfig) {
    this.sampleRate = config.sampleRate;
    this.pitchFrameSize = config.pitchFrameSize ?? 4096;
    this.chordWindowSize = config.chordWindowSize ?? 16384;
    this.chordCadenceHz = config.chordCadenceHz ?? 4;
    this.minConfidence = config.minConfidence ?? 0.5;
    this.ring = new Float32Array(this.chordWindowSize);
  }

  configure(patch: { chordCadenceHz?: number; minConfidence?: number }): void {
    if (patch.chordCadenceHz !== undefined) {
      this.chordCadenceHz = Math.min(30, Math.max(1, patch.chordCadenceHz));
    }
  }

  get stats(): { framesProcessed: number; chordsRun: number } {
    return { framesProcessed: this.framesProcessed, chordsRun: this.chordsRun };
  }

  pushFrame(samples: Float32Array, captureTimestamp: number): EngineResult {
    const seq = this.seq++;
    // Pitch path: latest pitchFrameSize samples.
    const frame =
      samples.length >= this.pitchFrameSize
        ? samples.slice(samples.length - this.pitchFrameSize)
        : samples;
    const t0 = performance.now();
    const pitch = detectPitch(frame, {
      sampleRate: this.sampleRate,
      minConfidence: this.minConfidence,
    });
    const pitchProcessingMs = performance.now() - t0;

    // Chord ring: append (keep latest window).
    this.appendRing(samples);
    let chord = this.lastChord;
    let chordProcessingMs = 0;
    let ranChord = false;
    const chordIntervalSamples =
      this.sampleRate / Math.max(1, this.chordCadenceHz);
    if (
      this.ringFill >= this.chordWindowSize &&
      this.ringFill - this.lastChordAtFill >= chordIntervalSamples
    ) {
      const t1 = performance.now();
      chord = detectChord(this.ring, { sampleRate: this.sampleRate });
      chordProcessingMs = performance.now() - t1;
      this.lastChord = chord;
      this.lastChordAtFill = this.ringFill;
      this.chordsRun++;
      ranChord = true;
    }

    this.framesProcessed++;
    return {
      seq,
      captureTimestamp,
      processedTimestamp: performance.now(),
      pitchProcessingMs,
      chordProcessingMs,
      ranChord,
      pitch,
      chord,
    };
  }

  private appendRing(samples: Float32Array): void {
    const W = this.chordWindowSize;
    if (samples.length >= W) {
      this.ring.set(samples.subarray(samples.length - W));
    } else {
      const valid = Math.min(this.ringFill, W);
      const keep = Math.min(valid, W - samples.length);
      if (keep > 0) {
        this.ring.copyWithin(0, valid - keep);
      }
      this.ring.set(samples, keep);
    }
    this.ringFill += samples.length;
  }

  reset(): void {
    this.ring.fill(0);
    this.ringFill = 0;
    this.lastChordAtFill = 0;
    this.lastChord = null;
  }
}
