/**
 * T-M1 analyzer wrapper: tempo + assumed-4/4 beat grid -> schema events.
 * Meter is NOT inferred in v1 (always 4/4 assumed, flagged as such).
 */
import { estimateTempo, trackBeats } from '../src/lib/dsp/rhythm';
import type { BeatEvent, MeterInfo, TempoInfo } from './schema';

export interface RhythmAnalysis {
  tempo: TempoInfo | null;
  meter: MeterInfo;
  beats: BeatEvent[];
}

export function analyzeRhythm(
  samples: Float32Array,
  sampleRate = 48000,
): RhythmAnalysis {
  const meter: MeterInfo = { numerator: 4, denominator: 4, confidence: 0.5, assumed: true };
  const est = estimateTempo(samples, sampleRate);
  if (!est) {
    return { tempo: null, meter, beats: [] };
  }
  const times = trackBeats(samples, est.bpm, sampleRate);
  const beats: BeatEvent[] = times.map((time, index) => ({
    time,
    index,
    bar: Math.floor(index / 4),
    beatInBar: index % 4,
    confidence: est.confidence,
  }));
  return {
    tempo: { bpm: est.bpm, confidence: est.confidence },
    meter,
    beats,
  };
}
