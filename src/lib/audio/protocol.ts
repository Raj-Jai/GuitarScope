/**
 * Typed Worker protocol (main thread <-> DSP Worker).
 * Audio carriers are Float32Array, transferred (not copied) where noted.
 */
import type { DetectionResult } from '../pitch/pitch-detector';
import type { ChordResult } from '../analysis/polyphonic';

export type MainToWorkerMessage =
  | {
      type: 'configure';
      sampleRate: number;
      chordCadenceHz?: number;
      minConfidence?: number;
      pitchFrameSize?: number;
    }
  | { type: 'start' }
  | { type: 'stop' }
  | {
      type: 'frame';
      seq: number;
      /** performance.now() timestamp taken in the worklet at post time. */
      capturePerf: number;
      /** TRANSFERRED buffer (4096 samples expected). */
      samples: Float32Array;
    }
  | { type: 'set-chord-cadence'; hz: number };

export interface WorkerResultMessage {
  type: 'result';
  seq: number;
  /** Worklet post timestamp (performance.now domain). */
  capturePerf: number;
  /** Worker onmessage timestamp (queue-wait = engineStart - received). */
  workerReceivePerf: number;
  /** performance.now() when the engine finished. */
  resultPerf: number;
  pitchProcessingMs: number;
  chordProcessingMs: number;
  ranChord: boolean;
  /** Attack gate suppressed a due chord run (display should hold). */
  chordHeld: boolean;
  pitch: DetectionResult;
  chord: ChordResult | null;
}

export interface WorkerStatsMessage {
  type: 'stats';
  queueDepth: number;
  droppedFrames: number;
  framesProcessed: number;
  chordsRun: number;
}

export type WorkerToMainMessage =
  | { type: 'ready' }
  | WorkerResultMessage
  | WorkerStatsMessage
  | { type: 'error'; message: string };
