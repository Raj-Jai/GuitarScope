/**
 * Fused monophonic pitch pipeline (per ADR-001):
 * gate → YIN → HPS octave validation → note description → confidence.
 */
import { yinDetect } from '../dsp/yin';
import { frameSpectrum, validateOctave } from '../dsp/hps';
import {
  classifyFrame,
  type SignalQuality,
} from '../analysis/signal-quality';
import { describeFrequency } from '../notes/cents';
import { frequencyToMidi } from '../notes/frequency';
import { identifyString, tuningVerdict } from '../guitar/tuning';

export type DetectionStatus =
  | SignalQuality
  | 'NOTE_DETECTED'
  | 'OCTAVE_CORRECTED';

export interface DetectionResult {
  status: DetectionStatus;
  frequency: number | null;
  midi: number | null;
  note: string | null;
  octave: number | null;
  cents: number | null;
  /** Cents from nearest open string (tuner needle). */
  stringCents: number | null;
  stringNumber: 1 | 2 | 3 | 4 | 5 | 6 | null;
  openString: boolean;
  tuning: ReturnType<typeof tuningVerdict> | null;
  confidence: number;
  rms: number;
  /** Debug: was an octave-down correction applied? */
  octaveCorrected: boolean;
}

export interface PitchDetectorOptions {
  sampleRate?: number;
  /** Minimum confidence to report NOTE_DETECTED (default 0.5). */
  minConfidence?: number;
}

const NO_RESULT: DetectionResult = {
  status: 'NO_SIGNAL',
  frequency: null,
  midi: null,
  note: null,
  octave: null,
  cents: null,
  stringCents: null,
  stringNumber: null,
  openString: false,
  tuning: null,
  confidence: 0,
  rms: 0,
  octaveCorrected: false,
};

export function detectPitch(
  frame: Float32Array,
  options: PitchDetectorOptions = {},
): DetectionResult {
  const { sampleRate = 48000, minConfidence = 0.5 } = options;
  const gate = classifyFrame(frame);
  if (gate.quality === 'NO_SIGNAL' || gate.quality === 'LOW_SIGNAL') {
    return { ...NO_RESULT, status: gate.quality, rms: gate.rms };
  }

  const yin = yinDetect(frame, { sampleRate });
  if (!yin) {
    return {
      ...NO_RESULT,
      status: gate.quality === 'TRANSIENT' ? 'TRANSIENT' : 'UNCERTAIN',
      rms: gate.rms,
    };
  }

  // Harmonic-structure validation (octave guard).
  const { magnitude, fftSize } = frameSpectrum(frame);
  const verdict = validateOctave(magnitude, yin.frequency, sampleRate, fftSize);
  const frequency = verdict.correctedFrequency;
  const octaveCorrected = verdict.decision === 'octave-down';

  const described = describeFrequency(frequency);
  if (described.midi === null) {
    return { ...NO_RESULT, status: 'UNCERTAIN', rms: gate.rms };
  }

  // Confidence: YIN periodicity, penalized when octave correction fired
  // (still report — the corrected pitch is usually right — but flag it).
  let confidence = yin.confidence;
  if (octaveCorrected) confidence *= 0.9;
  if (gate.quality === 'TRANSIENT') confidence *= 0.7;

  if (confidence < minConfidence) {
    return {
      ...NO_RESULT,
      status: 'UNCERTAIN',
      rms: gate.rms,
      confidence,
      frequency,
    };
  }

  const stringMatch = identifyString(frequency);
  const midi = frequencyToMidi(frequency);
  return {
    status: octaveCorrected ? 'OCTAVE_CORRECTED' : 'NOTE_DETECTED',
    frequency,
    midi,
    note: described.note,
    octave: described.octave,
    cents: described.cents,
    stringCents: stringMatch?.centsFromOpen ?? null,
    stringNumber: stringMatch?.string.stringNumber ?? null,
    openString: stringMatch?.isOpenString ?? false,
    tuning:
      stringMatch && stringMatch.isOpenString
        ? tuningVerdict(stringMatch.centsFromOpen)
        : null,
    confidence,
    rms: gate.rms,
    octaveCorrected,
  };
}
