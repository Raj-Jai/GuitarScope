import { describe, expect, test } from 'vitest';
import { transcribeNotes } from '../../analyzer/notes';
import { scoreNotes } from '../../analyzer/note-score';
import { isNoteGroup } from '../../analyzer/schema';
import type { RefNote } from '../../analyzer/reference';
import { harmonicTone } from '../lib/dsp/synth';

const SR = 48000;

/**
 * M5 exit fixture: 16s etude, Am F C G, bass on beats + eighth melody.
 * Exact ground truth (onset/midi); melody overlaps sustained bass.
 */
interface Pluck {
  onset: number;
  midi: number;
  dur: number;
  gain: number;
}

const FREQ = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

const ETUDE: Pluck[] = [];
{
  // Am (0-4): A2 bass, A3 C4 E4 A4 melody bits; F (4-8); C (8-12); G (12-16).
  const bars: { bass: number; melody: number[] }[] = [
    { bass: 33, melody: [57, 60, 64, 69] }, // A2; A3 C4 E4 A4
    { bass: 29, melody: [53, 57, 60, 65] }, // F2; F3 A3 C4 F4
    { bass: 36, melody: [55, 60, 64, 67] }, // C3; G3 C4 E4 G4
    { bass: 31, melody: [55, 59, 62, 67] }, // G2; G3 B3 D4 G4
  ];
  bars.forEach((bar, bi) => {
    const t0 = bi * 4;
    ETUDE.push({ onset: t0, midi: bar.bass, dur: 1.8, gain: 0.8 });
    ETUDE.push({ onset: t0 + 2, midi: bar.bass + 7, dur: 1.6, gain: 0.6 });
    bar.melody.forEach((m, k) => {
      ETUDE.push({ onset: t0 + k * 1.0 + 0.0, midi: m, dur: 0.9, gain: 0.7 });
    });
  });
  ETUDE.sort((a, b) => a.onset - b.onset);
}

function renderEtude(): { audio: Float32Array; ref: RefNote[] } {
  const total = new Float32Array(SR * 17);
  const ref: RefNote[] = [];
  for (const p of ETUDE) {
    const part = harmonicTone(FREQ(p.midi), {
      sampleRate: SR,
      duration: p.dur,
      attack: 0.008,
      decay: 2.5,
    });
    const s0 = Math.floor(p.onset * SR);
    for (let i = 0; i < part.length && s0 + i < total.length; i++) {
      total[s0 + i] += part[i] * p.gain * 0.5;
    }
    ref.push({ onset: p.onset, duration: p.dur, midi: p.midi });
  }
  // Normalize.
  let peak = 0;
  for (let i = 0; i < total.length; i++) peak = Math.max(peak, Math.abs(total[i]));
  if (peak > 0.98) for (let i = 0; i < total.length; i++) total[i] *= 0.98 / peak;
  return { audio: total, ref };
}

describe('M5 exit: etude transcription', () => {
  test('precision/recall on overlapping bass+melody', () => {
    const { audio, ref } = renderEtude();
    const events = transcribeNotes(audio, { sampleRate: SR });
    const s = scoreNotes(events, ref, 0.12);
    console.log(
      `etude: ${events.length} events (${events.filter((e) => isNoteGroup(e)).length} groups), ` +
        `P=${s.precision.toFixed(2)} R=${s.recall.toFixed(2)} F1=${s.f1.toFixed(2)} onsetErr=${s.meanOnsetErrMs.toFixed(0)}ms`,
    );
    // Overlapping bass+melody is genuinely hard for onset+YIN+groups:
    // octave-downs on overlapped bass and group phantoms are RECORDED
    // limits (see test notes), not hidden. Clean material scores ~1.0
    // (see song-notes.test.ts). Bar: beat a coin flip with margin and
    // keep onsets tight.
    expect(s.f1).toBeGreaterThan(0.6);
    expect(s.meanOnsetErrMs).toBeLessThan(100);
  });
});
