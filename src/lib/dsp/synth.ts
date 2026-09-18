/**
 * Synthetic audio generator for DSP testing.
 * Produces deterministic (seeded) test signals so pitch/chord detectors
 * can be validated without a microphone.
 */

export type RNG = () => number;

/** Mulberry32 seeded PRNG for reproducible noise. */
export function seededRng(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HarmonicSpec {
  /** Multiple of fundamental (1 = fundamental). */
  harmonic: number;
  /** Relative amplitude 0..1. */
  amplitude: number;
}

/** Guitar-ish harmonic series: strong fundamental, decaying harmonics. */
export const GUITAR_HARMONICS: HarmonicSpec[] = [
  { harmonic: 1, amplitude: 1.0 },
  { harmonic: 2, amplitude: 0.6 },
  { harmonic: 3, amplitude: 0.4 },
  { harmonic: 4, amplitude: 0.3 },
  { harmonic: 5, amplitude: 0.2 },
  { harmonic: 6, amplitude: 0.15 },
  { harmonic: 7, amplitude: 0.1 },
  { harmonic: 8, amplitude: 0.08 },
];

/**
 * Harmonic series where the 2nd harmonic is STRONGER than the
 * fundamental — the classic octave-error trap for naive peak pickers.
 */
export const WEAK_FUNDAMENTAL_HARMONICS: HarmonicSpec[] = [
  { harmonic: 1, amplitude: 0.4 },
  { harmonic: 2, amplitude: 1.0 },
  { harmonic: 3, amplitude: 0.7 },
  { harmonic: 4, amplitude: 0.5 },
  { harmonic: 5, amplitude: 0.3 },
];

export interface ToneOptions {
  sampleRate?: number;
  /** Seconds of audio. */
  duration?: number;
  harmonics?: HarmonicSpec[];
  /** Overall peak amplitude 0..1. */
  amplitude?: number;
  /** Start phase in radians (default 0). */
  phase?: number;
  /** Simple exponential decay per second (0 = none). */
  decay?: number;
  /** Linear fade-in seconds (pick-attack modeling, 0 = none). */
  attack?: number;
  /** White-noise amplitude mixed in (0 = none). */
  noiseLevel?: number;
  seed?: number;
}

/** Pure sine tone at one frequency. */
export function sineTone(frequency: number, options: ToneOptions = {}): Float32Array {
  return harmonicTone(frequency, {
    ...options,
    harmonics: [{ harmonic: 1, amplitude: 1 }],
  });
}

/** Harmonic-rich tone (guitar-like) at one fundamental. */
export function harmonicTone(
  fundamental: number,
  options: ToneOptions = {},
): Float32Array {
  const {
    sampleRate = 48000,
    duration = 0.5,
    harmonics = GUITAR_HARMONICS,
    amplitude = 0.8,
    phase = 0,
    decay = 0,
    attack = 0,
    noiseLevel = 0,
    seed = 1234,
  } = options;
  const length = Math.floor(sampleRate * duration);
  const out = new Float32Array(length);
  const rng = seededRng(seed);
  // Normalize so peak of the harmonic stack ~= amplitude.
  let stackPeak = 0;
  for (const h of harmonics) stackPeak += Math.abs(h.amplitude);
  const gain = stackPeak > 0 ? amplitude / stackPeak : 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = decay > 0 ? Math.exp(-decay * t) : 1;
    const attackGain = attack > 0 ? Math.min(1, t / attack) : 1;
    let s = 0;
    for (const h of harmonics) {
      s += h.amplitude * Math.sin(2 * Math.PI * fundamental * h.harmonic * t + phase);
    }
    if (noiseLevel > 0) s += (rng() * 2 - 1) * noiseLevel * stackPeak;
    out[i] = s * gain * envelope * attackGain;
  }
  return out;
}

/** Mix of several fundamentals (chords / intervals). Each gets harmonics. */
export function chordTone(
  fundamentals: number[],
  options: ToneOptions = {},
): Float32Array {
  const {
    sampleRate = 48000,
    duration = 0.5,
    harmonics = GUITAR_HARMONICS,
    amplitude = 0.8,
    attack = 0,
    noiseLevel = 0,
    seed = 1234,
  } = options;
  const length = Math.floor(sampleRate * duration);
  const out = new Float32Array(length);
  const per = amplitude / Math.max(1, fundamentals.length);
  for (const f of fundamentals) {
    const part = harmonicTone(f, {
      sampleRate,
      duration,
      harmonics,
      amplitude: per,
      attack,
    });
    for (let i = 0; i < length; i++) out[i] += part[i];
  }
  if (noiseLevel > 0) {
    const rng = seededRng(seed);
    for (let i = 0; i < length; i++) out[i] += (rng() * 2 - 1) * noiseLevel;
  }
  // Hard-clip guard.
  for (let i = 0; i < length; i++) {
    if (out[i] > 1) out[i] = 1;
    else if (out[i] < -1) out[i] = -1;
  }
  return out;
}

/** Silence (all zeros). */
export function silence(duration = 0.5, sampleRate = 48000): Float32Array {
  return new Float32Array(Math.floor(sampleRate * duration));
}

/** White noise at a given amplitude. */
export function whiteNoise(
  amplitude = 0.1,
  duration = 0.5,
  sampleRate = 48000,
  seed = 99,
): Float32Array {
  const length = Math.floor(sampleRate * duration);
  const out = new Float32Array(length);
  const rng = seededRng(seed);
  for (let i = 0; i < length; i++) out[i] = (rng() * 2 - 1) * amplitude;
  return out;
}

/** RMS level of a frame — used for signal-quality gating. */
export function rms(frame: ArrayLike<number>): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/** Slice a frame from a longer buffer (zero-pads at the end). */
export function takeFrame(
  signal: Float32Array,
  start: number,
  size: number,
): Float32Array {
  const out = new Float32Array(size);
  const available = Math.min(size, signal.length - start);
  for (let i = 0; i < available; i++) out[i] = signal[start + i];
  return out;
}
