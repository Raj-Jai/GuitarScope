/**
 * Signal-quality gating: classify each frame BEFORE pitch detection so
 * the UI never shows nonsense notes for silence/noise/transients.
 */
import { rms } from '../dsp/synth';

export type SignalQuality =
  | 'NO_SIGNAL'
  | 'LOW_SIGNAL'
  | 'TRANSIENT'
  | 'STABLE'
  | 'UNCERTAIN';

export interface SignalQualityOptions {
  /** RMS below this → NO_SIGNAL. Default 0.008. */
  silenceThreshold?: number;
  /** RMS below this → LOW_SIGNAL. Default 0.02. */
  lowThreshold?: number;
  /**
   * Spectral-flux above this (relative) → TRANSIENT (pick attack).
   * Compared against previous frame's spectrum centroid movement is
   * expensive; we use a cheap time-domain transient proxy: peak/RMS
   * (crest factor). Plucks have high crest; sustained notes low.
   * Default 8.
   */
  crestTransientThreshold?: number;
}

export interface FrameQuality {
  quality: SignalQuality;
  rms: number;
  crest: number;
}

/** Peak/RMS crest factor of a frame. */
export function crestFactor(frame: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < frame.length; i++) {
    const a = Math.abs(frame[i]);
    if (a > peak) peak = a;
  }
  const level = rms(frame);
  if (level <= 1e-9) return 0;
  return peak / level;
}

export function classifyFrame(
  frame: ArrayLike<number>,
  options: SignalQualityOptions = {},
): FrameQuality {
  const {
    silenceThreshold = 0.008,
    lowThreshold = 0.02,
    crestTransientThreshold = 8,
  } = options;
  const level = rms(frame);
  const crest = crestFactor(frame);
  if (level < silenceThreshold) return { quality: 'NO_SIGNAL', rms: level, crest };
  if (level < lowThreshold) return { quality: 'LOW_SIGNAL', rms: level, crest };
  if (crest > crestTransientThreshold)
    return { quality: 'TRANSIENT', rms: level, crest };
  return { quality: 'STABLE', rms: level, crest };
}
