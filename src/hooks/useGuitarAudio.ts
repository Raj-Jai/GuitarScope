import { useCallback, useEffect, useRef, useState } from 'react';import { MicController, MicError } from '../lib/audio/microphone';
import { DemoProgram } from '../lib/audio/demo-program';
import { CHORD_CADENCE_HZ } from '../lib/audio/audio-constants';
import type {
  MainToWorkerMessage,
  WorkerResultMessage,
  WorkerStatsMessage,
  WorkerToMainMessage,
} from '../lib/audio/protocol';
import type { DetectionResult } from '../lib/pitch/pitch-detector';
import type { ChordResult } from '../lib/analysis/polyphonic';
import { StringTracker, type TuneGuidance } from '../lib/analysis/string-tracker';
import { LabelStabilizer } from '../lib/analysis/temporal-smoothing';
import { ChordStabilityGate } from '../lib/analysis/chord-stability';
import { SessionLog } from '../lib/analysis/session-log';

export type { TuneGuidance };

export type AudioStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error';

export interface LivePitch extends DetectionResult {
  /** Smoothed cents vs ACTIVE string target (null when idle). GuitarTuna-style. */
  displayCents: number | null;
  /** Majority-vote stabilized note label. */
  stableNote: string | null;
  /** Latched string (differs from instantaneous stringNumber during holds). */
  activeString: 1 | 2 | 3 | 4 | 5 | 6 | null;
  targetFrequency: number | null;
  targetNote: string | null;
  guidance: TuneGuidance;
  /** True when showing held (stale) value during 600ms dropout — UI should dim. */
  held: boolean;
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

export function useGuitarAudio(): {
  status: AudioStatus;
  micError: MicError | null;
  demoMode: boolean;
  pitch: LivePitch | null;
  chord: ChordResult | null;
  chordName: string | null;
  stats: LiveStats;
  analyser: AnalyserNode | null;
  sessionEvents: number;
  demoVolume: number;
  startMic: () => Promise<void>;
  stop: () => Promise<void>;
  startDemo: () => Promise<void>;
  setChordCadence: (hz: number) => void;
  setDemoVolume: (v: number) => void;
  downloadSessionLog: () => void;
} {
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [micError, setMicError] = useState<MicError | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [pitch, setPitch] = useState<LivePitch | null>(null);
  const [chord, setChord] = useState<ChordResult | null>(null);
  const [chordName, setChordName] = useState<string | null>(null);
  const [stats, setStats] = useState<LiveStats>(INITIAL_STATS);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [sessionEvents, setSessionEvents] = useState(0);
  const [demoVolume, setDemoVolumeState] = useState(0.8);

  const workerRef = useRef<Worker | null>(null);
  const micRef = useRef<MicController | null>(null);
  const demoRef = useRef<DemoProgram | null>(null);
  const trackerRef = useRef(new StringTracker());
  const noteStabRef = useRef(new LabelStabilizer(5));
  const chordGateRef = useRef(new ChordStabilityGate());
  const resultTimesRef = useRef<number[]>([]);
  const readyRef = useRef(false);
  const chordCadenceRef = useRef(CHORD_CADENCE_HZ);
  const sessionLogRef = useRef(new SessionLog());
  const sessionStartRef = useRef(0);
  const lastStatsLogRef = useRef(0);
  const queueDepthRef = useRef(0);
  const droppedRef = useRef(0);
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
    const tracked = trackerRef.current.push({
      stringNumber: p.stringNumber,
      stringCents: p.stringCents,
      confidence: p.confidence,
      status: p.status,
      timestampMs: now,
    });
    const stableNote = noteStabRef.current.push(
      p.status === 'NOTE_DETECTED' || p.status === 'OCTAVE_CORRECTED' ? p.note : null,
    );
    setPitch({
      ...p,
      displayCents: tracked.displayCents,
      stableNote,
      activeString: tracked.activeString,
      targetFrequency: tracked.targetFrequency,
      targetNote: tracked.targetNote,
      guidance: tracked.guidance,
      held: tracked.held,
    });

    // Session log (bounded ring; stats throttled to ~0.5 Hz).
    const t = now - sessionStartRef.current;
    const log = sessionLogRef.current;
    log.logPitch(
      { note: p.note, frequency: p.frequency, cents: p.cents, confidence: p.confidence, status: p.status },
      t,
    );

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
      log.logChord(
        { name: detected?.name ?? null, confidence: c?.confidence ?? 0, status: c?.status ?? 'none' },
        t,
      );
    }

    setStats((s) => ({
      ...s,
      resultsPerSec,
      e2eLatencyMs: now - msg.capturePerf,
      workerTurnaroundMs: msg.resultPerf - msg.workerReceivePerf,
      pitchProcessingMs: msg.pitchProcessingMs,
      chordProcessingMs: msg.ranChord ? msg.chordProcessingMs : s.chordProcessingMs,
    }));
    if (now - lastStatsLogRef.current > 2000) {
      lastStatsLogRef.current = now;
      log.logStats(
        {
          queueDepth: queueDepthRef.current,
          droppedFrames: droppedRef.current,
          pitchMs: msg.pitchProcessingMs,
          chordMs: msg.ranChord ? msg.chordProcessingMs : null,
          e2eMs: now - msg.capturePerf,
        },
        t,
      );
      setSessionEvents(log.length);
    }
  }, []);

  const handleStats = useCallback((msg: WorkerStatsMessage) => {
    queueDepthRef.current = msg.queueDepth;
    droppedRef.current = msg.droppedFrames;
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

  const teardownDemo = useCallback(async () => {
    await demoRef.current?.stop().catch(() => undefined);
    demoRef.current = null;
    setAnalyser(null);
  }, []);

  const resetDisplay = useCallback(() => {
    trackerRef.current.reset();
    noteStabRef.current.reset();
    chordGateRef.current.reset();
    resultTimesRef.current = [];
    sessionLogRef.current.begin();
    sessionStartRef.current = performance.now();
    lastStatsLogRef.current = 0;
    setSessionEvents(0);
    setPitch(null);
    setChord(null);
    setChordName(null);
  }, []);

  const stop = useCallback(async () => {
    setDemoMode(false);
    workerRef.current?.postMessage({ type: 'stop' } satisfies MainToWorkerMessage);
    await teardownDemo();
    await teardownMic();
    setStatus('stopped');
  }, [teardownDemo, teardownMic]);

  const startMic = useCallback(async () => {
    if (statusRef.current === 'starting' || statusRef.current === 'running') return;
    setStatus('starting');
    setMicError(null);
    setDemoMode(false);
    resetDisplay();
    try {
      // Demo and microphone are mutually exclusive (no interleaved frames).
      await teardownDemo();
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
  }, [resetDisplay, teardownDemo, teardownMic, ensureWorker, postFrame]);

  const startDemo = useCallback(async () => {
    if (statusRef.current === 'running' && demoMode) return;
    // Create the AudioContext SYNCHRONOUSLY in the click handler so the
    // browser ties resume() to the user gesture (autoplay policy).
    let demo: DemoProgram;
    try {
      let seq = 0;
      demo = new DemoProgram({
        volume: demoVolume,
        onWorkletFrame: (frame, capturePerf) => {
          postFrame(frame, capturePerf, seq++);
        },
      });
    } catch {
      setMicError(new MicError('not-supported', 'Demo audio is not supported in this browser.'));
      setStatus('error');
      return;
    }
    setStatus('starting');
    setMicError(null);
    resetDisplay();
    try {
      // Demo and microphone are mutually exclusive (no interleaved frames).
      await teardownMic();
      demoRef.current = demo;
      await demo.start();
      ensureWorker(demo.sampleRate);
      workerRef.current?.postMessage({ type: 'start' } satisfies MainToWorkerMessage);
      setAnalyser(demo.analyser);
      setStats((s) => ({ ...s, sampleRate: demo.sampleRate }));
      setDemoMode(true);
      setStatus('running');
    } catch (err) {
      setMicError(err instanceof Error ? new MicError('unknown', err.message) : new MicError('unknown', String(err)));
      setStatus('error');
      await teardownDemo();
    }
  }, [demoMode, demoVolume, resetDisplay, teardownMic, teardownDemo, ensureWorker, postFrame]);

  const setChordCadence = useCallback((hz: number) => {
    chordCadenceRef.current = hz;
    workerRef.current?.postMessage({ type: 'set-chord-cadence', hz } satisfies MainToWorkerMessage);
    setStats((s) => ({ ...s, chordCadenceHz: hz }));
  }, []);

  const setDemoVolume = useCallback((v: number) => {
    setDemoVolumeState(v);
    demoRef.current?.setVolume(v);
  }, []);

  const downloadSessionLog = useCallback(() => {
    const blob = new Blob([JSON.stringify(sessionLogRef.current.toJSON())], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guitarscope-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      void micRef.current?.stop().catch(() => undefined);
      void demoRef.current?.stop().catch(() => undefined);
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
    sessionEvents,
    demoVolume,
    startMic,
    stop,
    startDemo,
    setChordCadence,
    setDemoVolume,
    downloadSessionLog,
  };
}
