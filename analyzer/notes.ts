/**
 * M5 — note transcription: onsets -> pitch tracking -> note events.
 * One dominant pitch: YIN tracking from onset until energy decay/next
 * onset. 2-4 credible simultaneous pitches: multi-pitch NoteGroup.
 * No string/fret inference (pitch only, per M5 scope).
 */
import { detectOnsets } from '../src/lib/dsp/onsets';
import { yinDetect } from '../src/lib/dsp/yin';
import { estimateF0Candidates } from '../src/lib/dsp/multi-pitch';
import { frameSpectrum } from '../src/lib/dsp/hps';
import { frequencyToMidi } from '../src/lib/notes/frequency';
import { midiToNoteOctave } from '../src/lib/notes/note-name';
import { rms } from '../src/lib/dsp/synth';
import type { NoteEvent, NoteGroup } from './schema';

export interface TranscribeOptions {
  sampleRate?: number;
  /** YIN window (default 4096). */
  yinWindow?: number;
  /** Tracking step in samples (default 1024). */
  trackHop?: number;
  /** Min YIN confidence to sustain a note (default 0.4). */
  minConfidence?: number;
  /** End note after this many quiet windows (default 3). */
  maxQuietWindows?: number;
  /** Energy fraction of onset level that ends a note (default 0.22). */
  endEnergyRatio?: number;
}

function sliceAt(samples: Float32Array, startSample: number, size: number): Float32Array {
  const out = new Float32Array(size);
  const s = Math.max(0, Math.floor(startSample));
  const n = Math.min(size, samples.length - s);
  for (let i = 0; i < n; i++) out[i] = samples[s + i];
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface TrackedVoice {
  freq: number;
  freqs: number[];
  confidence: number;
  endSample: number;
}

interface TrackOpts {
  sampleRate: number;
  yinWindow: number;
  trackHop: number;
  minConfidence: number;
  maxQuietWindows: number;
  endEnergyRatio: number;
  onsetRms: number;
}

/** YIN-track one (optionally band-filtered) voice from an onset. */
function trackVoice(
  samples: Float32Array,
  onsetSample: number,
  limitSample: number,
  opts: TrackOpts,
  filter?: (frame: Float32Array) => Float32Array,
): TrackedVoice | null {
  const { sampleRate, yinWindow, trackHop, minConfidence, maxQuietWindows, endEnergyRatio, onsetRms } = opts;
  const freqs: number[] = [];
  const confs: number[] = [];
  let quiet = 0;
  let endSample = Math.min(samples.length, limitSample);
  for (let s = onsetSample; s + yinWindow <= limitSample; s += trackHop) {
    const frame = sliceAt(samples, s, yinWindow);
    if (rms(frame) < onsetRms * endEnergyRatio) {
      quiet++;
      if (quiet >= maxQuietWindows) {
        endSample = s;
        break;
      }
      continue;
    }
    quiet = 0;
    const r = yinDetect(filter ? filter(frame) : frame, { sampleRate });
    if (r && r.confidence >= minConfidence) {
      freqs.push(r.frequency);
      confs.push(r.confidence);
    }
  }
  if (freqs.length === 0) return null;
  return { freq: median(freqs), freqs, confidence: median(confs), endSample };
}

export function transcribeNotes(
  samples: Float32Array,
  options: TranscribeOptions = {},
): (NoteEvent | NoteGroup)[] {
  const {
    sampleRate = 48000,
    yinWindow = 4096,
    trackHop = 1024,
    minConfidence = 0.4,
    maxQuietWindows = 3,
    endEnergyRatio = 0.22,
  } = options;
  const onsets = detectOnsets(samples, sampleRate);
  const events: (NoteEvent | NoteGroup)[] = [];
  if (onsets.length === 0) return events;

  for (let oi = 0; oi < onsets.length; oi++) {
    const onset = onsets[oi];
    const nextOnset = oi + 1 < onsets.length ? onsets[oi + 1] : samples.length / sampleRate;
    const onsetSample = Math.floor(onset * sampleRate);
    const probe = sliceAt(samples, onsetSample + Math.floor(0.02 * sampleRate), yinWindow);
    const onsetRms = rms(probe);
    if (onsetRms < 0.008) continue; // too quiet to transcribe

    // Multi-pitch snapshot at onset: 2-4 strong distinct pitch classes?
    const { magnitude, fftSize } = frameSpectrum(probe);
    const f0cands = estimateF0Candidates(magnitude, sampleRate, fftSize);
    const maxW = Math.max(0, ...f0cands.map((c) => c.weight));
    const strong = f0cands.filter((c) => c.weight >= maxW * 0.3);
    const distinctPC = new Set(strong.map((c) => c.pitchClass));

    if (distinctPC.size >= 2 && distinctPC.size <= 4) {
      const notes = strong
        .filter((c, idx, arr) => arr.findIndex((x) => x.pitchClass === c.pitchClass) === idx)
        .map((c) => {
          const midi = frequencyToMidi(c.frequency) ?? Math.round(69 + 12 * Math.log2(c.frequency / 440));
          return { midi, frequency: Math.round(c.frequency * 10) / 10, confidence: Math.round(Math.min(1, c.weight / Math.max(1e-9, maxW)) * 100) / 100 };
        });
      // Group offset: energy decay or next onset.
      let endSample = Math.min(samples.length, Math.floor(nextOnset * sampleRate));
      for (let s = onsetSample; s < endSample; s += trackHop) {
        if (rms(sliceAt(samples, s, yinWindow)) < onsetRms * endEnergyRatio) {
          endSample = s;
          break;
        }
      }
      events.push({
        onset: Math.round(onset * 1000) / 1000,
        offset: Math.round((endSample / sampleRate) * 1000) / 1000,
        notes,
      });
      continue;
    }
    // Monophonic fallback: single YIN-tracked voice. (A band-split
    // bass/treble variant was tried and measured WORSE on overlaps —
    // extra voices emitted harmonic ghosts; see etude test notes.)
    const limitSample = Math.min(samples.length, Math.floor(nextOnset * sampleRate));
    const trackOpts = {
      sampleRate,
      yinWindow,
      trackHop,
      minConfidence,
      maxQuietWindows,
      endEnergyRatio,
      onsetRms,
    };
    const tracked = trackVoice(samples, onsetSample, limitSample, trackOpts);
    if (!tracked) continue;
    const midi = frequencyToMidi(tracked.freq);
    if (midi === null) continue;
    const sorted = [...tracked.freqs].sort((a, b) => a - b);
    const spreadCents =
      1200 * Math.log2(sorted[sorted.length - 1] / Math.max(1e-9, sorted[0]));
    const stability = Math.max(0.5, 1 - Math.max(0, spreadCents - 60) / 400);
    events.push({
      onset: Math.round(onset * 1000) / 1000,
      offset: Math.round((tracked.endSample / sampleRate) * 1000) / 1000,
      duration: Math.round(((tracked.endSample - onsetSample) / sampleRate) * 1000) / 1000,
      midi,
      note: midiToNoteOctave(midi) ?? `midi${midi}`,
      frequency: Math.round(tracked.freq * 10) / 10,
      confidence: Math.round(tracked.confidence * stability * 100) / 100,
      source: 'yin',
    });
  }
  return events;
}
