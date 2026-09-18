/**
 * Song analysis worker: full offline pipeline in the browser so the
 * tutorial UI works without the Node CLI (raw branch only; use the CLI
 * --branches multi for deep vocal-robust analysis).
 * Protocol: {type:'analyze', jobId, samples (transferred), sampleRate}
 *   -> {type:'progress', jobId, stage, done, total}
 *   -> {type:'done', jobId, chords, notes, duration}
 *   -> {type:'error', jobId, message}
 */
import { analyzeFrames } from '../../analyzer/frames';
import { decodeChords } from '../../analyzer/decode';
import { transcribeNotes } from '../../analyzer/notes';
import type { ChordEvent, NoteEvent, NoteGroup } from '../../analyzer/schema';

interface AnalyzeMessage {
  type: 'analyze';
  jobId: number;
  samples: Float32Array;
  sampleRate: number;
}

function post(msg: unknown): void {
  postMessage(msg);
}

onmessage = (event: MessageEvent<AnalyzeMessage>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'analyze') return;
  const { jobId, samples, sampleRate } = msg;
  try {
    post({ type: 'progress', jobId, stage: 'frames', done: 0, total: 100 });
    const hopSeconds = 4096 / sampleRate;
    const { frames } = analyzeFrames(
      samples,
      { sampleRate, windowSize: 16384, hopSize: 4096, topN: 3 },
      (done, total) => post({ type: 'progress', jobId, stage: 'frames', done, total }),
    );
    post({ type: 'progress', jobId, stage: 'chords', done: 1, total: 1 });
    const chords: ChordEvent[] = decodeChords(frames, {}, hopSeconds);
    post({ type: 'progress', jobId, stage: 'notes', done: 0, total: 1 });
    const notes: (NoteEvent | NoteGroup)[] = transcribeNotes(samples, { sampleRate });
    post({ type: 'progress', jobId, stage: 'notes', done: 1, total: 1 });
    post({ type: 'done', jobId, chords, notes, duration: samples.length / sampleRate });
  } catch (err) {
    post({ type: 'error', jobId, message: err instanceof Error ? err.message : String(err) });
  }
};
