/**
 * Audible demo program: a virtual microphone for GuitarScope.
 *
 * Single graph, scheduled on the AudioContext clock:
 *
 *   AudioBufferSource(sched) → gain ─┬→ speakers (what you hear)
 *                                     └→ MediaStreamDestination → MediaStreamSource
 *                                         → AudioWorklet (framing) → DSP Worker
 *
 * The analyzed stream derives from the same scheduled source you hear
 * (post-gain split), so heard audio and DSP input cannot drift apart.
 * Demo buffers are generated at the ACTUAL context rate and the engine
 * is configured from it — never assume 48 kHz.
 */
import { PITCH_FRAME_SIZE } from './audio-constants';
import { getProcessorUrl } from './microphone';
import { chordTone, harmonicTone } from '../dsp/synth';

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

/** Raw demo items (mono Float32Arrays) at the given sample rate. */
export function buildDemoBuffers(sampleRate: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (const f of DEMO_NOTES) {
    out.push(harmonicTone(f, { sampleRate, duration: 1.6 }));
  }
  for (const freqs of DEMO_CHORDS) {
    out.push(chordTone(freqs, { sampleRate, duration: 1.8 }));
  }
  return out;
}

/**
 * Pure gapless timeline: start offset (seconds) of each item.
 * The scheduler plays items back-to-back and loops; unit-tested.
 */
export function buildDemoTimeline(durations: number[]): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const d of durations) {
    starts.push(t);
    t += d;
  }
  return starts;
}

export interface DemoProgramOptions {
  /** Requested context rate (actual rate is honored; default 48000). */
  sampleRate?: number;
  /** Speaker volume 0..1 (post-split gain is shared, default 0.8). */
  volume?: number;
  /** Scheduler lookahead in seconds (default 0.4). */
  lookahead?: number;
  pitchFrameSize?: number;
  onWorkletFrame?: (frame: Float32Array, capturePerf: number, seq: number) => void;
}

export class DemoProgram {
  /** Created synchronously so the caller keeps the user-gesture context. */
  readonly context: AudioContext;
  private readonly volume: number;
  private readonly lookahead: number;
  private readonly frameSize: number;
  private readonly onWorkletFrame?: DemoProgramOptions['onWorkletFrame'];

  private gain: GainNode | null = null;
  private mediaDest: MediaStreamAudioDestinationNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private items: AudioBuffer[] = [];
  private nextItem = 0;
  private nextStartTime = 0;
  private timer: number | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private scheduling = false;

  constructor(options: DemoProgramOptions = {}) {
    this.context = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: options.sampleRate ?? 48000,
    });
    this.volume = options.volume ?? 0.8;
    this.lookahead = options.lookahead ?? 0.4;
    this.frameSize = options.pitchFrameSize ?? PITCH_FRAME_SIZE;
    this.onWorkletFrame = options.onWorkletFrame;
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  async start(): Promise<void> {
    await this.context.resume();
    if (this.context.state !== 'running') {
      throw new Error('Demo audio could not start (AudioContext suspended).');
    }
    // Buffers at the ACTUAL rate — engine must be configured from it too.
    const rate = this.context.sampleRate;
    this.items = buildDemoBuffers(rate).map((raw) => {
      const buf = this.context.createBuffer(1, raw.length, rate);
      buf.copyToChannel(raw as Float32Array<ArrayBuffer>, 0);
      return buf;
    });

    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.context.destination);

    this.mediaDest = this.context.createMediaStreamDestination();
    this.gain.connect(this.mediaDest);

    await this.context.audioWorklet.addModule(getProcessorUrl());
    this.worklet = new AudioWorkletNode(this.context, 'guitar-capture', {
      processorOptions: { frameSize: this.frameSize },
    });
    if (this.onWorkletFrame) {
      const handler = this.onWorkletFrame;
      this.worklet.port.onmessage = (event: MessageEvent) => {
        const msg = event.data as { type?: string; samples?: Float32Array; capturePerf?: number; seq?: number };
        if (msg?.type === 'frame' && msg.samples) {
          handler(msg.samples, msg.capturePerf ?? 0, msg.seq ?? 0);
        }
      };
    }
    const mediaSource = this.context.createMediaStreamSource(this.mediaDest.stream);
    mediaSource.connect(this.worklet);

    this.analyserNode = this.context.createAnalyser();
    this.analyserNode.fftSize = 4096;
    this.analyserNode.smoothingTimeConstant = 0;
    this.gain.connect(this.analyserNode);

    this.worklet.port.postMessage({ type: 'start' });
    this.scheduling = true;
    this.nextItem = 0;
    this.nextStartTime = this.context.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 100);
    this.schedule();
  }

  /** Top up scheduled items against the audio clock (gapless, looping). */
  private schedule(): void {
    if (!this.scheduling) return;
    const horizon = this.context.currentTime + this.lookahead;
    let guard = 0;
    while (this.nextStartTime < horizon && guard++ < 16) {
      const buf = this.items[this.nextItem];
      const src = this.context.createBufferSource();
      src.buffer = buf;
      src.connect(this.gain as GainNode);
      src.start(this.nextStartTime);
      src.stop(this.nextStartTime + buf.duration);
      src.onended = () => {
        this.activeSources.delete(src);
        try {
          src.disconnect();
        } catch {
          /* ignore */
        }
      };
      this.activeSources.add(src);
      this.nextStartTime += buf.duration;
      this.nextItem = (this.nextItem + 1) % this.items.length;
    }
  }

  async stop(): Promise<void> {
    // Deterministic teardown: stop scheduling -> silence sources ->
    // disconnect graph -> end tracks -> close context.
    this.scheduling = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.activeSources.clear();
    try {
      this.worklet?.port.postMessage({ type: 'stop' });
    } catch {
      /* ignore */
    }
    try {
      this.gain?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.worklet?.disconnect();
    } catch {
      /* ignore */
    }
    if (this.mediaDest) {
      for (const track of this.mediaDest.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
    this.gain = null;
    this.mediaDest = null;
    this.worklet = null;
    this.analyserNode = null;
    this.items = [];
    await this.context.close().catch(() => undefined);
  }
}
