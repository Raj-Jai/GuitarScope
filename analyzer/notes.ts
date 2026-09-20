/**
 * Note transcription (event-centric, TABFIX revision).
 *
 * Old model (wrong for fingerstyle): 85 ms snapshot -> all pitches found
 * in the window treated as simultaneous -> phantom chord groups when
 * arpeggio notes 60-80 ms apart smeared together.
 *
 * New model: onset candidates -> short local probe (2048) -> pitch
 * candidates WITH onset timestamps -> simultaneity clustering (25 ms)
 * -> singles or true simultaneous groups -> offsets by energy decay.
 * Simultaneity is established from onset proximity, never from
 * co-occurrence inside a fixed window.
 */
import { detectOnsets } from '../src/lib/dsp/onsets';
import { yinDetect } from '../src/lib/dsp/yin';
import { estimateF0Candidates } from '../src/lib/dsp/multi-pitch';
import { frameSpectrum, magnitudeAt } from '../src/lib/dsp/hps';
import { stft } from '../src/lib/dsp/hpss';
import { frequencyToMidi } from '../src/lib/notes/frequency';
import { midiToNoteOctave } from '../src/lib/notes/note-name';
import { rms } from '../src/lib/dsp/synth';
import type { NoteEvent, NoteGroup } from './schema';

export interface TranscribeOptions {
  sampleRate?: number;
  /** Local probe window for pitch candidates (default 4096). */
  probeWindow?: number;
  /** YIN tracking window for offsets (default 4096). */
  yinWindow?: number;
  /** Tracking step in samples (default 1024). */
  trackHop?: number;
  /** Min YIN confidence to sustain a note (default 0.4). */
  minConfidence?: number;
  /** End note after this many quiet windows (default 3). */
  maxQuietWindows?: number;
  /** Energy fraction of onset level that ends a note (default 0.22). */
  endEnergyRatio?: number;
  /** Max onset spread inside one simultaneous cluster, seconds (default 0.025). */
  clusterWindow?: number;
  /** Hard cap on group size (defensive; default 4). */
  maxGroupSize?: number;
}

function sliceAt(samples: Float32Array, startSample: number, size: number): Float32Array {
  const out = new Float32Array(size);
  const s = Math.max(0, Math.floor(startSample));
  const n = Math.min(size, samples.length - s);
  for (let i = 0; i < n; i++) out[i] = samples[s + i];
  return out;
}

interface PitchCandidate {
  midi: number;
  frequency: number;
  confidence: number;
  onset: number;
}

/** True when high is an integer-multiple harmonic of low (±cents). */
function isHarmonicOf(high: number, low: number, cents = 40): boolean {
  if (!(high > 0 && low > 0)) return false;
  for (let k = 2; k <= 6; k++) {
    if (Math.abs(1200 * Math.log2(high / (low * k))) <= cents) return true;
  }
  return false;
}

/** Pitch candidates at one onset from a short local probe.
 *
 * Guards (all measured, all load-bearing):
 * - YIN sanity: the YIN fundamental must carry real spectral energy
 *   (>= 0.12 of the strongest peak <= 2 kHz). Mixture subharmonic
 *   hallucinations (e.g. 49 Hz for G major) have none.
 * - R1 future-cut: a candidate's harmonic energy must not concentrate
 *   in the LAST 40 ms of the probe (ratio >= 0.35) — later-starting
 *   notes rise late; pre-existing/fresh attacks don't.
 * - R0 harmonic-drop: integer harmonic of an accepted stronger
 *   candidate at < 0.5x weight carries no new pitch information.
 * - R2 decay-drop: a candidate within 60 cents of the previous
 *   cluster survives only with a FRESH attack here (narrowband energy
 *   after the onset > 1.8x before it). Decay continuation merges into
 *   the sustained note instead of double-counting.
 * - R3 strength: extras need weight >= 0.4 of the window max.
 * - Dedupe: candidates within 6 semitones merge (beating wobble);
 *   true octave doubles (12 apart) and semitone neighbors survive.
 */
function probeOnset(
  samples: Float32Array,
  onset: number,
  sampleRate: number,
  probeWindow: number,
  minConfidence: number,
  prevMidis: number[],
): PitchCandidate[] {
  const onsetSample = Math.floor(onset * sampleRate);
  const probe = sliceAt(samples, onsetSample + Math.floor(0.008 * sampleRate), probeWindow);
  if (rms(probe) < 0.008) return [];
  const out: PitchCandidate[] = [];
  const seen = new Set<number>();
  const accepted: { freq: number; weight: number }[] = [];
  const { magnitude, fftSize } = frameSpectrum(probe);
  const yin = yinDetect(probe, { sampleRate });
  const yinMidi =
    yin && yin.confidence >= minConfidence && yinHasSupport(magnitude, yin.frequency, sampleRate, fftSize)
      ? frequencyToMidi(yin.frequency)
      : null;
  if (yin && yinMidi !== null) {
    seen.add(yinMidi);
    accepted.push({ freq: yin.frequency, weight: Number.MAX_SAFE_INTEGER });
    out.push({ midi: yinMidi, frequency: yin.frequency, confidence: yin.confidence, onset });
  }
  const f0cands = estimateF0Candidates(magnitude, sampleRate, fftSize);
  const maxW = Math.max(0, ...f0cands.map((c) => c.weight));
  // R1 temporal profile: per-candidate narrowband energy (f0 + 2f) in the
  // probe's first vs last 40 ms. Pre-existing and fresh attacks hold
  // steady or decay; later-starting notes rise late and are excluded.
  // Wide detail STFT (pre-onset included) also feeds the R2' fresh-attack
  // test below.
  const detail = stft(probe, { size: 1024, hop: 512 });
  const wideStart = Math.max(0, onsetSample - Math.floor(0.025 * sampleRate));
  const wide = sliceAt(samples, wideStart, Math.floor(0.025 * sampleRate) + probe.length);
  const wideDetail = stft(wide, { size: 1024, hop: 512 });
  const wideMs = (f: number): number => ((wideStart + f * 512) / sampleRate - onset) * 1000;
  const bandRange = (freq: number, t0ms: number, t1ms: number): number => {
    let e = 0;
    for (const mult of [1, 2]) {
      const bin = Math.round(((freq * mult) * wideDetail.size) / sampleRate);
      if (bin < 1 || bin >= wideDetail.bins) continue;
      for (let f = 0; f < wideDetail.frames; f++) {
        const t = wideMs(f);
        if (t < t0ms || t >= t1ms) continue;
        const r = wideDetail.real[f][bin] ?? 0;
        const m = wideDetail.imag[f][bin] ?? 0;
        e += r * r + m * m;
      }
    }
    return e;
  };
  const bandEnergyAt = (freq: number, fromFrame: number, toFrame: number): number => {
    let e = 0;
    for (const mult of [1, 2]) {
      const bin = Math.round(((freq * mult) * detail.size) / sampleRate);
      if (bin < 1 || bin >= detail.bins) continue;
      for (let f = Math.max(0, fromFrame); f < Math.min(detail.frames, toFrame); f++) {
        const r = detail.real[f][bin] ?? 0;
        const m = detail.imag[f][bin] ?? 0;
        e += r * r + m * m;
      }
    }
    return e;
  };
  const earlyLate = (freq: number): number => {
    const n = detail.frames;
    if (n < 4) return 1;
    const split = Math.floor(n / 2);
    const e0 = bandEnergyAt(freq, 0, split);
    const e1 = bandEnergyAt(freq, split, n);
    return e0 / (e0 + e1 + 1e-12);
  };
  for (const c of f0cands) {
    if (c.weight < maxW * 0.4) continue;
    if (earlyLate(c.frequency) < 0.35) continue; // R1: rises late = starts later
    // R0: harmonic residue of an accepted stronger candidate is not news.
    if (accepted.some((a) => isHarmonicOf(c.frequency, a.freq) && c.weight < 0.5 * a.weight)) {
      continue;
    }
    const midi = frequencyToMidi(c.frequency);
    if (midi === null) continue;
    // Same-note duplicates (YIN + multi-pitch measuring one pitch apart
    // through beating): merge below 90 cents. True semitone neighbors
    // (100 cents) and octave doublings (1200) always survive.
    const dup = [...seen].some((m) => Math.abs(m - midi) * 100 < 90);
    if (dup) continue;
    // R2': near-previous-cluster pitches survive only with a FRESH attack
    // here: a broadband transient jump AND sustained narrowband energy
    // after it. Either alone misfires (attack transients are broadband;
    // decay can outlive any single window). Decay continuation merges
    // into the sustained note instead of double-counting.
    const nearPrev = prevMidis.some((m) => Math.abs(m - midi) * 100 < 60);
    if (nearPrev) {
      const pre = bandRange(c.frequency, -20, 0) + 1e-12;
      const transient = bandRange(c.frequency, 0, 20) / pre;
      const sustain = bandRange(c.frequency, 25, 45) / pre;
      if (transient <= 1.8 || sustain <= 1.15) continue;
    }
    seen.add(midi);
    accepted.push({ freq: c.frequency, weight: c.weight });
    out.push({
      midi,
      frequency: c.frequency,
      confidence: Math.min(1, c.weight / Math.max(1e-9, maxW)),
      onset,
    });
  }
  return out;
}

/** YIN sanity: the reported fundamental must carry real spectral energy.
 * Rejects mixture subharmonic hallucinations (e.g. 49 Hz for G major). */
function yinHasSupport(
  magnitude: ArrayLike<number>,
  frequency: number,
  sampleRate: number,
  fftSize: number,
): boolean {
  let peak = 0;
  const topBin = Math.min(magnitude.length - 1, Math.floor((2000 * fftSize) / sampleRate));
  for (let k = 1; k <= topBin; k++) {
    if (magnitude[k] > peak) peak = magnitude[k];
  }
  if (!(peak > 0)) return false;
  return magnitudeAt(magnitude, frequency, sampleRate, fftSize) >= 0.12 * peak;
}

/** Offset by energy decay: first sample where level stays low, else limit. */
function findOffset(
  samples: Float32Array,
  fromSample: number,
  limitSample: number,
  onsetRms: number,
  yinWindow: number,
  trackHop: number,
  endEnergyRatio: number,
  maxQuietWindows: number,
): number {
  let quiet = 0;
  let endSample = Math.min(samples.length, limitSample);
  for (let s = fromSample; s + yinWindow <= limitSample; s += trackHop) {
    if (rms(sliceAt(samples, s, yinWindow)) < onsetRms * endEnergyRatio) {
      quiet++;
      if (quiet >= maxQuietWindows) {
        endSample = s;
        break;
      }
    } else {
      quiet = 0;
    }
  }
  return endSample;
}

export function transcribeNotes(
  samples: Float32Array,
  options: TranscribeOptions = {},
): (NoteEvent | NoteGroup)[] {
  const {
    sampleRate = 48000,
    probeWindow = 4096,
    yinWindow = 4096,
    trackHop = 1024,
    minConfidence = 0.4,
    maxQuietWindows = 3,
    endEnergyRatio = 0.22,
    clusterWindow = 0.025,
    maxGroupSize = 4,
  } = options;
  // Tight minGap: folk arpeggios legitimately onset 50-70 ms apart, and
  // the 25 ms simultaneity clustering (not the gap) merges doubles.
  // A wide gap here silently deletes masked attacks (measured: A3's
  // 0.149 flux peak suppressed as 'too close' to G3's onset).
  const onsets = detectOnsets(samples, sampleRate, { minGap: 0.03 });
  if (onsets.length === 0) return [];

  // 1. Candidates with onset timestamps (no simultaneity assumed yet).
  // Previous cluster midis feed the decay-drop guard (R2).
  const candidates: PitchCandidate[] = [];
  let prevMidis: number[] = [];
  for (const onset of onsets) {
    const probed = probeOnset(samples, onset, sampleRate, probeWindow, minConfidence, prevMidis);
    if (probed.length > 0) {
      prevMidis = probed.map((p) => p.midi);
      candidates.push(...probed);
    }
  }
  candidates.sort((a, b) => a.onset - b.onset);

  // 2. Simultaneity clustering by onset proximity. Same-pitch
  // candidates within 80 ms are attack-roughness doubles of one note and
  // are DROPPED (true immediate repetition at the same pitch is
  // vanishingly rare versus roughness). Different pitches merge only
  // within 25 ms (true simultaneity).
  const clusters: PitchCandidate[][] = [];
  for (const c of candidates) {
    const cur = clusters[clusters.length - 1];
    const samePitch =
      cur && cur.some((m) => Math.abs(m.midi - c.midi) * 100 < 90);
    if (cur && c.onset - cur[0].onset <= clusterWindow) {
      if (!samePitch && cur.length < maxGroupSize) cur.push(c);
    } else if (cur && samePitch && c.onset - cur[0].onset <= 0.08) {
      continue; // roughness double: owned by the earlier onset
    } else {
      clusters.push([c]);
    }
  }

  // 3. Offsets + events.
  const events: (NoteEvent | NoteGroup)[] = [];
  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    const onset = cluster[0].onset;
    const nextOnset = ci + 1 < clusters.length ? clusters[ci + 1][0].onset : samples.length / sampleRate;
    const onsetSample = Math.floor(onset * sampleRate);
    const probe = sliceAt(samples, onsetSample, yinWindow);
    const onsetRms = rms(probe);
    const endSample = findOffset(
      samples,
      onsetSample,
      Math.min(samples.length, Math.floor(nextOnset * sampleRate)),
      Math.max(onsetRms, 1e-6),
      yinWindow,
      trackHop,
      endEnergyRatio,
      maxQuietWindows,
    );
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    if (cluster.length === 1) {
      const c = cluster[0];
      events.push({
        onset: r3(onset),
        offset: r3(endSample / sampleRate),
        duration: r3((endSample - onsetSample) / sampleRate),
        midi: c.midi,
        note: midiToNoteOctave(c.midi) ?? `midi${c.midi}`,
        frequency: Math.round(c.frequency * 10) / 10,
        confidence: Math.round(c.confidence * 100) / 100,
        source: 'yin',
      });
    } else {
      events.push({
        onset: r3(onset),
        offset: r3(endSample / sampleRate),
        notes: cluster.map((c) => ({
          midi: c.midi,
          frequency: Math.round(c.frequency * 10) / 10,
          confidence: Math.round(c.confidence * 100) / 100,
        })),
      });
    }
  }
  return events;
}
