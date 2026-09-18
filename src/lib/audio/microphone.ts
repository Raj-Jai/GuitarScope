/**
 * Microphone lifecycle controller.
 * Owns AudioContext + source + capture worklet + analyser tap.
 * Never connects the mic to the destination (no feedback).
 */
import { PITCH_FRAME_SIZE } from './audio-constants';
// The processor is self-contained plain JS, inlined as text at build time
// and loaded via a Blob URL (reliable across dev/build; no worklet
// chunk-MIME pitfalls). See src/worklets/capture-processor.js.
import processorSource from '../../worklets/capture-processor.js?raw';

let cachedProcessorUrl: string | null = null;
function getProcessorUrl(): string {
  if (!cachedProcessorUrl) {
    cachedProcessorUrl = URL.createObjectURL(
      new Blob([processorSource], { type: 'application/javascript' }),
    );
  }
  return cachedProcessorUrl;
}

export type MicState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error';

export type MicErrorReason =
  | 'permission-denied'
  | 'no-microphone'
  | 'insecure-origin'
  | 'not-supported'
  | 'worklet-load-failed'
  | 'context-failed'
  | 'unknown';

export class MicError extends Error {
  readonly reason: MicErrorReason;
  constructor(reason: MicErrorReason, message: string) {
    super(message);
    this.name = 'MicError';
    this.reason = reason;
  }
}

export interface AudioSupportEnv {
  isSecureContext?: boolean;
  hasMediaDevices?: boolean;
  hasAudioContext?: boolean;
}

function readSupportEnv(env?: AudioSupportEnv): Required<AudioSupportEnv> {
  if (env) {
    return {
      isSecureContext: env.isSecureContext ?? true,
      hasMediaDevices: env.hasMediaDevices ?? true,
      hasAudioContext: env.hasAudioContext ?? true,
    };
  }
  const w = typeof window !== 'undefined' ? window : undefined;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    isSecureContext: w?.isSecureContext ?? false,
    hasMediaDevices: typeof nav?.mediaDevices?.getUserMedia === 'function',
    hasAudioContext: typeof AudioContext !== 'undefined',
  };
}

export type AudioSupport = 'ok' | 'insecure-origin' | 'not-supported';

/**
 * Pure support check (unit-testable via `env`; defaults to live globals).
 * Order matters: an insecure origin (e.g. phone on http://LAN-ip) hides
 * mediaDevices, so it must be reported as insecure-origin — NOT as
 * "browser not supported".
 */
export function getAudioSupport(env?: AudioSupportEnv): AudioSupport {
  const s = readSupportEnv(env);
  if (!s.isSecureContext) return 'insecure-origin';
  if (!s.hasMediaDevices || !s.hasAudioContext) return 'not-supported';
  return 'ok';
}

/** Throw the actionable MicError for the current support state. */
export function checkAudioSupport(env?: AudioSupportEnv): void {
  const support = getAudioSupport(env);
  if (support === 'insecure-origin') {
    throw new MicError(
      'insecure-origin',
      'Microphone access needs a secure origin (HTTPS or localhost). ' +
        'You are opening the app over plain HTTP — e.g. http://<laptop-ip>. ' +
        'Start the dev server with HTTPS (npm run dev:https) and open the ' +
        'https:// address instead, accepting the self-signed certificate warning.',
    );
  }
  if (support === 'not-supported') {
    throw new MicError('not-supported', 'Microphone capture is not supported in this browser.');
  }
}

/** Pure mapping of getUserMedia/AudioContext failures -> reasons (unit-tested). */
export function mapMicFailure(err: unknown): MicError {
  if (err instanceof MicError) return err;
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';
  const message =
    err instanceof Error ? err.message : 'Unknown microphone error';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MicError(
      'permission-denied',
      'Microphone permission was denied. Allow microphone access in the browser and try again.',
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new MicError(
      'no-microphone',
      'No microphone was found. Connect a microphone and try again.',
    );
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new MicError(
      'unknown',
      `Could not open the microphone (${message}). It may be in use by another app.`,
    );
  }
  if (name === 'TypeError' && typeof navigator === 'undefined') {
    return new MicError('not-supported', 'Microphone capture is not supported in this browser.');
  }
  return new MicError('unknown', message || 'Could not start microphone capture.');
}

export interface MicStartOptions {
  /** Desired sample rate; the actual context rate is always honored. */
  sampleRate?: number;
  pitchFrameSize?: number;
  onWorkletFrame?: (frame: Float32Array, capturePerf: number, seq: number) => void;
}

export class MicController {
  state: MicState = 'idle';
  lastError: MicError | null = null;

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  get sampleRate(): number {
    return this.context?.sampleRate ?? 48000;
  }

  /** Analyser tap for waveform/spectrum visualization (read-only). */
  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  get workletPort(): MessagePort | null {
    return this.worklet?.port ?? null;
  }

  async start(options: MicStartOptions = {}): Promise<void> {
    if (this.state === 'starting' || this.state === 'running') return;
    this.state = 'starting';
    this.lastError = null;
    try {
      checkAudioSupport();
      this.stream = await navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })
        .catch((err: unknown) => {
          throw mapMicFailure(err);
        });

      this.context = new AudioContext({
        latencyHint: 'interactive',
        sampleRate: options.sampleRate ?? 48000,
      });
      if (this.context.state === 'suspended') {
        await this.context.resume().catch(() => undefined);
      }

      const frameSize = options.pitchFrameSize ?? PITCH_FRAME_SIZE;
      try {
        await this.context.audioWorklet.addModule(getProcessorUrl());
      } catch {
        throw new MicError('worklet-load-failed', 'Could not load the audio capture processor.');
      }

      this.source = this.context.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.context, 'guitar-capture', {
        processorOptions: { frameSize },
      });
      if (options.onWorkletFrame) {
        const handler = options.onWorkletFrame;
        this.worklet.port.onmessage = (event: MessageEvent) => {
          const msg = event.data as { type?: string; samples?: Float32Array; capturePerf?: number; seq?: number };
          if (msg?.type === 'frame' && msg.samples) {
            handler(msg.samples, msg.capturePerf ?? 0, msg.seq ?? 0);
          }
        };
      }
      // Tap for visualization. Deliberately NOT connected to destination.
      this.analyserNode = this.context.createAnalyser();
      this.analyserNode.fftSize = 4096;
      this.analyserNode.smoothingTimeConstant = 0;
      this.source.connect(this.worklet);
      this.source.connect(this.analyserNode);

      this.worklet.port.postMessage({ type: 'start' });
      this.state = 'running';
    } catch (err) {
      await this.teardown().catch(() => undefined);
      this.state = 'error';
      this.lastError = err instanceof MicError ? err : mapMicFailure(err);
      throw this.lastError;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') return;
    try {
      this.worklet?.port.postMessage({ type: 'stop' });
    } catch {
      /* ignore */
    }
    await this.teardown().catch(() => undefined);
    this.state = 'stopped';
  }

  private async teardown(): Promise<void> {
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.worklet?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.analyserNode?.disconnect();
    } catch {
      /* ignore */
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
    if (this.context) {
      await this.context.close().catch(() => undefined);
    }
    this.source = null;
    this.worklet = null;
    this.analyserNode = null;
    this.stream = null;
    this.context = null;
  }
}
