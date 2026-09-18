import { describe, expect, test } from 'vitest';
import { detectOnsets } from '../lib/dsp/onsets';
import { transcribeNotes } from '../../analyzer/notes';
import { scoreNotes } from '../../analyzer/note-score';
import { isNoteGroup } from '../../analyzer/schema';
import { harmonicTone, silence } from '../lib/dsp/synth';

const SR = 48000;

function noteAt(freq: number, startSec: number, durSec: number, total: Float32Array): void {
  // Realistic pluck: fast attack + exponential decay (no hard stops that
  // would forge offset transients).
  const part = harmonicTone(freq, { sampleRate: SR, duration: durSec, attack: 0.01, decay: 2.0 });
  const s0 = Math.floor(startSec * SR);
  for (let i = 0; i < part.length && s0 + i < total.length; i++) total[i + s0] += part[i] * 0.7;
}

/** Am arpeggio: A2 C3 E3 A3 at 0.5s spacing + E4 dyad test helpers. */
function arpeggio(): Float32Array {
  const total = new Float32Array(SR * 3);
  noteAt(110, 0.2, 0.45, total);
  noteAt(130.8128, 0.7, 0.45, total);
  noteAt(164.8138, 1.2, 0.45, total);
  noteAt(220, 1.7, 0.6, total);
  return total;
}

describe('onset detection', () => {
  test('finds 4 arpeggio onsets within tolerance', () => {
    const onsets = detectOnsets(arpeggio(), SR);
    expect(onsets.length).toBeGreaterThanOrEqual(4);
    expect(onsets.length).toBeLessThanOrEqual(6);
    for (const expected of [0.2, 0.7, 1.2, 1.7]) {
      expect(onsets.some((o) => Math.abs(o - expected) < 0.06)).toBe(true);
    }
  });

  test('silence yields no onsets', () => {
    expect(detectOnsets(silence(1.0, SR), SR)).toEqual([]);
  });
});

describe('note transcription', () => {
  test('arpeggio -> 4 YIN notes with right pitches', () => {
    const events = transcribeNotes(arpeggio());
    const singles = events.filter((e) => !isNoteGroup(e));
    expect(singles.length).toBe(4);
    const midis = singles.map((e) => (e as { midi: number }).midi);
    expect(midis).toEqual([45, 48, 52, 57]); // A2 C3 E3 A3
  });

  test('sustained note -> exactly one event (no repeats)', () => {
    const total = new Float32Array(SR * 2);
    noteAt(82.4069, 0.2, 1.6, total);
    const events = transcribeNotes(total);
    expect(events.length).toBe(1);
    expect(isNoteGroup(events[0])).toBe(false);
  });

  test('dyad -> NoteGroup with both pitches', () => {
    const total = new Float32Array(SR * 1);
    noteAt(164.8138, 0.2, 0.6, total);
    noteAt(196.0, 0.2, 0.6, total);
    const events = transcribeNotes(total);
    expect(events.length).toBe(1);
    expect(isNoteGroup(events[0])).toBe(true);
    const midis = (events[0] as { notes: { midi: number }[] }).notes
      .map((n) => n.midi)
      .sort((a, b) => a - b);
    expect(midis).toEqual([52, 55]); // E3 G3
  });

  test('note scorer: perfect and partial', () => {
    const ref = [
      { onset: 0.2, duration: 0.45, midi: 45 },
      { onset: 0.7, duration: 0.45, midi: 48 },
    ];
    const perfect = transcribeNotes(arpeggio()).slice(0, 2);
    const s = scoreNotes(perfect, ref);
    expect(s.recall).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.meanOnsetErrMs).toBeLessThan(100);
    const wrong = scoreNotes(perfect, [{ onset: 0.2, duration: 0.4, midi: 99 }]);
    expect(wrong.recall).toBe(0);
  });
});
