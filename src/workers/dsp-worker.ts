/**
 * DSP Worker: thin protocol glue around DspEngine.
 * Owns the latest-wins queue (NEWER AUDIO > STALE AUDIO) and posts
 * timestamped results + stats to the main thread.
 */
import { DspEngine } from '../lib/analysis/engine';
import { FrameQueue } from '../lib/analysis/frame-queue';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../lib/audio/protocol';

let engine: DspEngine | null = null;

interface WorkerFrame {
  seq: number;
  captureTimestamp: number;
  samples: Float32Array;
  workerReceivePerf: number;
}

let queue = new FrameQueue<WorkerFrame>(2);
let running = false;
let sampleRate = 48000;

function post(msg: WorkerToMainMessage): void {
  postMessage(msg);
}

function pump(): void {
  if (!engine || !running) return;
  // Bounded: queue capacity is 2, so at most 2 engine runs per pump.
  let frame = queue.pop();
  while (frame) {
    try {
      const r = engine.pushFrame(frame.samples, frame.captureTimestamp);
      post({
        type: 'result',
        seq: r.seq,
        capturePerf: r.captureTimestamp,
        workerReceivePerf: frame.workerReceivePerf,
        resultPerf: r.processedTimestamp,
        pitchProcessingMs: r.pitchProcessingMs,
        chordProcessingMs: r.chordProcessingMs,
        ranChord: r.ranChord,
        chordHeld: r.chordHeld,
        pitch: r.pitch,
        chord: r.chord,
      });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    frame = queue.pop();
  }
  const stats = engine.stats;
  post({
    type: 'stats',
    queueDepth: queue.depth,
    droppedFrames: queue.droppedFrames,
    framesProcessed: stats.framesProcessed,
    chordsRun: stats.chordsRun,
  });
}

onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'configure':
        sampleRate = msg.sampleRate;
        engine = new DspEngine({
          sampleRate,
          chordCadenceHz: msg.chordCadenceHz ?? 4,
          minConfidence: msg.minConfidence ?? 0.5,
          pitchFrameSize: msg.pitchFrameSize ?? 4096,
        });
        queue = new FrameQueue<WorkerFrame>(2);
        post({ type: 'ready' });
        break;
      case 'start':
        running = true;
        engine?.reset();
        queue.clear();
        break;
      case 'stop':
        running = false;
        queue.clear();
        break;
      case 'frame':
        if (!engine || !running) break;
        queue.push({
          seq: msg.seq,
          captureTimestamp: msg.capturePerf,
          samples: msg.samples,
          workerReceivePerf: performance.now(),
        });
        pump();
        break;
      case 'set-chord-cadence':
        engine?.configure({ chordCadenceHz: msg.hz });
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
