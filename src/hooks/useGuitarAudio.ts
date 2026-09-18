import { useCallback, useEffect, useRef, useState } from 'react';import { MicController, MicError } from '../lib/audio/microphone';
import {
  CHORD_CADENCE_HZ,
  PITCH_FRAME_SIZE,
} from '../lib/audio/audio-constants';
import type {
  MainToWorkerMessage,
  WorkerResultMessage,
  WorkerStatsMessage,
  WorkerToMainMessage,
} from '../lib/audio/protocol';
import type { DetectionResult } from '../lib/pitch/pitch-detector';
import type { ChordResult } from '../lib/analysis/polyphonic';
import { TunerSmoother } from '../lib/analysis/tuner-smoother';
import { LabelStabilizer } from '../lib/analysis/temporal-smoothing';
import { ChordStabilityGate } from '../lib/analysis/chord-stability';
import { chordTone, harmonicTone } from '../lib/dsp/synth';

export type AudioStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error';

export interface LivePitch extends DetectionResult {
  /** Smoothed cents for the needle (null when unusable). */
  displayCents: number | null;
  /** Majority-vote stabilized note label. */
  stableNote: string | null;
}

export interface LiveStats {
  resultsPerSec: number;
  e2eLatencyMs: number | null;
  workerTurnaroundMs: number | null;
  pitchProcessingMs: number | null;
  chordProcessingMs: number | null;
  queueDepth: number;
  droppedFrames: number;
  framesProcessed: number;
  chordsRun: number;
  sampleRate: number;
  chordCadenceHz: number;
}

const INITIAL_STATS: LiveStats = {
  resultsPerSec: 0,
  e2eLatencyMs: null,
  workerTurnaroundMs: null,
  pitchProcessingMs: null,
  chordProcessingMs: null,
  queueDepth: 0,
  droppedFrames: 0,
  framesProcessed: 0,
  chordsRun: 0,
  sampleRate: 48000,
  chordCadenceHz: CHORD_CADENCE_HZ,
};

/** Demo program: open strings then common chords (synthetic, real DSP path). */
const DEMO_NOTES = [82.4069, 110, 146.8318, 195.9977, 246.9417, 329.6276];
const DEMO_CHORDS: number[][] = [
  [110, 138.5913, 164.8138], // A
  [82.4069, 103.8262, 123.4708], // E
  [146.8318, 185.0, 220.0], // D
  [98.0, 123.4708, 146.8318], // G
  [130.8128, 164.8138, 196.0], // C
  [110, 130.8128, 164.8138], // Am
  [82.4069, 98.0, 123.4708], // Em
];

function buildDemoBuffers(sampleRate: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (const f of DEMO_NOTES) {
    out.push(harmonicTone(f, { sampleRate, duration: 1.6 }));
  }
  for (const freqs of DEMO_CHORDS) {
    out.push(chordTone(freqs, { sampleRate, duration: 1.8 }));
  }
  return out;
}

export function useGuitarAudio(): {
  status: AudioStatus;
  micError: MicError | null;
  demoMode: boolean;
  pitch: LivePitch | null;
  chord: ChordResult | null;
  chordName: string | null;
  stats: LiveStats;
  analyser: AnalyserNode | null;
  /** Latest demo frame for visualization (ref: no re-renders). Null when idle/mic. */
  demoFrameRef: { current: Float32Array | null };
  startMic: () => Promise<void>;
  stop: () => Promise<void>;
  startDemo: () => void;
  setChordCadence: (hz: number) => void;
} {
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [micError, setMicError] = useState<MicError | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [pitch, setPitch] = useState<LivePitch | null>(null);
  const [chord, setChord] = useState<ChordResult | null>(null);
  const [chordName, setChordName] = useState<string | null>(null);
  const [stats, setStats] = useState<LiveStats>(INITIAL_STATS);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const micRef = useRef<MicController | null>(null);
  const demoTimerRef = useRef<number | null>(null);
  const smootherRef = useRef(new TunerSmoother());
  const noteStabRef = useRef(new LabelStabilizer(5));
  const chordGateRef = useRef(new ChordStabilityGate());
  const resultTimesRef = useRef<number[]>([]);
  const readyRef = useRef(false);
  const chordCadenceRef = useRef(CHORD_CADENCE_HZ);
  const demoFrameRef = useRef<Float32Array | null>(null);
  const statusRef = useRef<AudioStatus>('idle');
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const handleResult = useCallback((msg: WorkerResultMessage) => {
    const now = performance.now();
    const times = resultTimesRef.current;
    times.push(now);
    while (times.length > 2 || (times.length > 0 && now - times[0] > 2000)) times.shift();
    const resultsPerSec = times.length >= 2 ? (1000 * (times.length - 1)) / (now - times[0]) : 0;

    const p = msg.pitch;
    const displayCents = smootherRef.current.push(p.note, p.cents);
    const stableNote = noteStabRef.current.push(
      p.status === 'NOTE_DETECTED' || p.status === 'OCTAVE_CORRECTED' ? p.note : null,
    );
    setPitch({ ...p, displayCents, stableNote });

    // Attack gate (chordHeld): hold the displayed chord, no stabilization input.
    if (msg.ranChord && !msg.chordHeld) {
      const c = msg.chord;
      const detected = c && c.status === 'CHORD_DETECTED' ? (c.chord ?? null) : null;
      setChordName(
        chordGateRef.current.push(
          detected ? { name: detected.name, confidence: c?.confidence ?? 0 } : null,
        ),
      );
      setChord(c);
    }

    setStats((s) => ({
      ...s,
      resultsPerSec,
      e2eLatencyMs: now - msg.capturePerf,
      workerTurnaroundMs: msg.resultPerf - msg.workerReceivePerf,
      pitchProcessingMs: msg.pitchProcessingMs,
      chordProcessingMs: msg.ranChord ? msg.chordProcessingMs : s.chordProcessingMs,
    }));
  }, []);

  const handleStats = useCallback((msg: WorkerStatsMessage) => {
    setStats((s) => ({
      ...s,
      queueDepth: msg.queueDepth,
      droppedFrames: msg.droppedFrames,
      framesProcessed: msg.framesProcessed,
      chordsRun: msg.chordsRun,
    }));
  }, []);

  const ensureWorker = useCallback(
    (sampleRate: number) => {
      if (workerRef.current) return workerRef.current;
      const worker = new Worker(
        new URL('../workers/dsp-worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
        const msg = event.data;
        if (msg.type === 'ready') {
          readyRef.current = true;
          return;
        }
        if (msg.type === 'result') {
          handleResult(msg);
          return;
        }
        if (msg.type === 'stats') handleStats(msg);
      };
      worker.onerror = () => {
        setMicError(new MicError('unknown', 'Analysis worker failed. Stop and start again.'));
        setStatus('error');
      };
      worker.postMessage({
        type: 'configure',
        sampleRate,
        chordCadenceHz: chordCadenceRef.current,
      } satisfies MainToWorkerMessage);
      workerRef.current = worker;
      setStats((s) => ({ ...s, sampleRate }));
      return worker;
    },
    [handleResult, handleStats],
  );

  const postFrame = useCallback((samples: Float32Array, capturePerf: number, seq: number) => {
    const worker = workerRef.current;
    if (!worker || !readyRef.current) return;
    const copy = new Float32Array(samples);
    worker.postMessage(
      { type: 'frame', seq, capturePerf, samples: copy } satisfies MainToWorkerMessage,
      [copy.buffer],
    );
  }, []);

  const teardownMic = useCallback(async () => {
    await micRef.current?.stop().catch(() => undefined);
    micRef.current = null;
    setAnalyser(null);
  }, []);

  const stopDemoFrames = useCallback(() => {
    if (demoTimerRef.current !== null) {
      window.clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    }
  }, []);

  const resetDisplay = useCallback(() => {
    smootherRef.current.reset();
    noteStabRef.current.reset();
    chordGateRef.current.reset();
    resultTimesRef.current = [];
    demoFrameRef.current = null;
    setPitch(null);
    setChord(null);
    setChordName(null);
  }, []);

  const stop = useCallback(async () => {
    stopDemoFrames();
    setDemoMode(false);
    workerRef.current?.postMessage({ type: 'stop' } satisfies MainToWorkerMessage);
    await teardownMic();
    setStatus('stopped');
  }, [stopDemoFrames, teardownMic]);

  const startMic = useCallback(async () => {
    if (statusRef.current === 'starting' || statusRef.current === 'running') return;
    setStatus('starting');
    setMicError(null);
    setDemoMode(false);
    stopDemoFrames();
    resetDisplay();
    try {
      const mic = new MicController();
      micRef.current = mic;
      let seq = 0;
      await mic.start({
        onWorkletFrame: (frame, capturePerf) => {
          postFrame(frame, capturePerf, seq++);
        },
      });
      ensureWorker(mic.sampleRate);
      workerRef.current?.postMessage({ type: 'start' } satisfies MainToWorkerMessage);
      setAnalyser(mic.analyser);
      setStats((s) => ({ ...s, sampleRate: mic.sampleRate }));
      setStatus('running');
    } catch (err) {
      setMicError(err instanceof MicError ? err : new MicError('unknown', String(err)));
      setStatus('error');
      await teardownMic();
    }
  }, [stopDemoFrames, resetDisplay, teardownMic, ensureWorker, postFrame]);

  const startDemo = useCallback(() => {
    if (statusRef.current === 'running' && demoMode) return;
    setMicError(null);
    setDemoMode(true);
    setStatus('running');
    resetDisplay();
    // Demo and microphone are mutually exclusive (no interleaved frames).
    void teardownMic().then(() => {
      const sampleRate = 48000;
      const worker = ensureWorker(sampleRate);
      worker.postMessage({ type: 'start' } satisfies MainToWorkerMessage);
      const buffers = buildDemoBuffers(sampleRate);
      let item = 0;
      let offset = 0;
      let seq = 0;
      stopDemoFrames();
      // Real-time cadence: one 4096-frame per ~85ms.
      demoTimerRef.current = window.setInterval(() => {
        const buf = buffers[item];
        const frame = new Float32Array(PITCH_FRAME_SIZE);
        const n = Math.min(PITCH_FRAME_SIZE, buf.length - offset);
        frame.set(buf.subarray(offset, offset + n));
        offset += n;
        if (offset >= buf.length) {
          item = (item + 1) % buffers.length;
          offset = 0;
        }
        demoFrameRef.current = frame;
        postFrame(frame, performance.now(), seq++);
      }, (PITCH_FRAME_SIZE / sampleRate) * 1000);
    });
  }, [demoMode, resetDisplay, teardownMic, ensureWorker, stopDemoFrames, postFrame]);

  const setChordCadence = useCallback((hz: number) => {
    chordCadenceRef.current = hz;
    workerRef.current?.postMessage({ type: 'set-chord-cadence', hz } satisfies MainToWorkerMessage);
    setStats((s) => ({ ...s, chordCadenceHz: hz }));
  }, []);

  useEffect(
    () => () => {
      if (demoTimerRef.current !== null) window.clearInterval(demoTimerRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
      void micRef.current?.stop().catch(() => undefined);
    },
    [],
  );

  return {
    status,
    micError,
    demoMode,
    pitch,
    chord,
    chordName,
    stats,
    analyser,
    demoFrameRef,
    startMic,
    stop,
    startDemo,
    setChordCadence,
  };
}
