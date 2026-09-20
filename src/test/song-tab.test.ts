import { describe, expect, test } from 'vitest';
import {
  assembleTab,
  assignSequence,
  candidatesFor,
  chordsToTab,
  estimatePitchShift,
  notesToTab,
  pcsInSpan,
} from '../../analyzer/tab-assign';
import type { ChordEvent } from '../../analyzer/schema';

const NO_CHORD = () => 'NO_CHORD';

describe('candidates', () => {
  test('E2 lives only on string 6 open; E4 prefers open 1st', () => {
    expect(candidatesFor(40)).toEqual([{ string: 6, fret: 0 }]);
    const e4 = candidatesFor(64);
    expect(e4[0]).toEqual({ string: 1, fret: 0 });
    expect(e4).toContainEqual({ string: 2, fret: 5 });
  });
  test('out-of-range pitch has no candidates', () => {
    expect(candidatesFor(200)).toEqual([]);
  });
});

describe('idiomatic fixtures (stipulated fingerings)', () => {
  test('open strings map to open positions', () => {
    const groups = [40, 45, 50, 55, 59, 64].map((midi, i) => ({
      onset: i,
      offset: i + 0.5,
      midis: [midi],
    }));
    const assigned = assignSequence(groups, NO_CHORD);
    expect(assigned.map((g) => g.positions[0])).toEqual([
      { string: 6, fret: 0 },
      { string: 5, fret: 0 },
      { string: 4, fret: 0 },
      { string: 3, fret: 0 },
      { string: 2, fret: 0 },
      { string: 1, fret: 0 },
    ]);
  });

  test('E4 lists the 2nd-string alternative (close scores preserved)', () => {
    const assigned = assignSequence([{ onset: 0, offset: 0.5, midis: [64] }], NO_CHORD);
    expect(assigned[0].positions[0]).toEqual({ string: 1, fret: 0 });
    expect(assigned[0].alternatives.some((a) => a.positions[0].string === 2 && a.positions[0].fret === 5)).toBe(true);
  });

  test('scale run keeps position continuity (A2 B2 C3 on 5th string)', () => {
    const assigned = assignSequence(
      [
        { onset: 0, offset: 0.4, midis: [45] },
        { onset: 0.5, offset: 0.9, midis: [47] },
        { onset: 1.0, offset: 1.4, midis: [48] },
      ],
      NO_CHORD,
    );
    expect(assigned.map((g) => g.positions[0])).toEqual([
      { string: 5, fret: 0 },
      { string: 5, fret: 2 },
      { string: 5, fret: 3 },
    ]);
  });

  test('Am notes with Am context take the open shape', () => {
    const assigned = assignSequence(
      [{ onset: 0, offset: 1, midis: [45, 52, 57, 60, 64] }],
      () => 'Am',
    );
    const pos = assigned[0].positions;
    expect(pos).toContainEqual({ string: 5, fret: 0 });
    expect(pos).toContainEqual({ string: 2, fret: 1 });
    expect(pos).toContainEqual({ string: 1, fret: 0 });
  });

  test('chord prior never overwrites detected pitches', () => {
    const events = notesToTab(
      [
        { onset: 0, offset: 0.5, duration: 0.5, midi: 45, note: 'A2', frequency: 110, confidence: 0.9, source: 'yin' },
        { onset: 0, offset: 0.5, duration: 0.5, midi: 60, note: 'C4', frequency: 261.6, confidence: 0.9, source: 'yin' },
      ],
      () => 'G', // G major contains neither A2's... (pitches must survive regardless)
    );
    const midis = events.flatMap((e) => e.notes.map((n) => n.midi)).sort((a, b) => a - b);
    expect(midis).toEqual([45, 60]);
  });
});

describe('chordsToTab pitch consistency', () => {
  const am: ChordEvent = {
    start: 0, end: 2, label: 'Am', root: 'A', quality: 'min', confidence: 0.8, alternatives: [],
  };
  test('consistent detected PCs -> full open shape', () => {
    const tab = chordsToTab([am], () => [9, 0, 4]);
    expect(tab).toHaveLength(1);
    expect(tab[0].notes.map((n) => [n.string, n.fret])).toContainEqual([5, 0]);
    expect(tab[0].notes.map((n) => [n.string, n.fret])).toContainEqual([2, 1]);
  });
  test('contradictory PCs -> honest gap', () => {
    expect(chordsToTab([am], () => [9, 1])).toEqual([]);
  });
  test('unknown shape -> honest gap', () => {
    const fsharp: ChordEvent = { ...am, label: 'F#m7' };
    expect(chordsToTab([fsharp], () => [6, 9, 1, 4])).toEqual([]);
  });
});

describe('separated assignment metrics', () => {
  test('string/fret/exact accuracy on idiomatic material', () => {
    // Stipulated truth: open strings + Am shape + C major shape notes.
    const truth: { midi: number; string: number; fret: number }[] = [
      { midi: 40, string: 6, fret: 0 },
      { midi: 45, string: 5, fret: 0 },
      { midi: 64, string: 1, fret: 0 },
    ];
    const assigned = assignSequence(
      truth.map((t, i) => ({ onset: i, offset: i + 0.5, midis: [t.midi] })),
      () => 'NO_CHORD',
    );
    let sOk = 0;
    let fOk = 0;
    let exact = 0;
    truth.forEach((t, i) => {
      const p = assigned[i].positions[0];
      if (p.string === t.string) sOk++;
      if (p.fret === t.fret) fOk++;
      if (p.string === t.string && p.fret === t.fret) exact++;
    });
    expect(sOk / truth.length).toBe(1); // string accuracy
    expect(fOk / truth.length).toBe(1); // fret accuracy
    expect(exact / truth.length).toBe(1); // exact s+f accuracy
  });
});

describe('assembleTab', () => {
  const am: ChordEvent = {
    start: 0, end: 2, label: 'Am', root: 'A', quality: 'min', confidence: 0.8, alternatives: [],
  };
  test('strummed chord covered by shape: note groups deduped, shape kept', () => {
    const notes = [
      { onset: 0.1, offset: 0.6, duration: 0.5, midi: 45, note: 'A2', frequency: 110, confidence: 0.9, source: 'yin' as const },
      { onset: 0.1, offset: 0.6, duration: 0.5, midi: 52, note: 'E3', frequency: 164.8, confidence: 0.9, source: 'yin' as const },
    ];
    const tab = assembleTab([am], notes);
    // Shape event covers both pitches -> group events dropped, one chord event.
    expect(tab).toHaveLength(1);
    expect(tab[0].kind).toBe('chord');
    expect(tab[0].notes.map((n) => n.midi).sort((a, b) => a - b)).toEqual([40, 45, 52, 57, 60, 64].filter((m) => [45, 52, 57, 60, 64].includes(m)));
  });

  test('melody outside any shape survives alongside', () => {
    const notes = [
      { onset: 0.1, offset: 0.4, duration: 0.3, midi: 45, note: 'A2', frequency: 110, confidence: 0.9, source: 'yin' as const },
      { onset: 1.0, offset: 1.3, duration: 0.3, midi: 67, note: 'G4', frequency: 392, confidence: 0.9, source: 'yin' as const },
    ];
    const tab = assembleTab([am], notes);
    // G4 (pc 7) is not in Am's shape PCs -> its group survives.
    expect(tab.some((t) => t.notes.some((n) => n.midi === 67))).toBe(true);
  });

  test('pcsInSpan collects pitch classes in window', () => {
    const notes = [
      { onset: 0.1, offset: 0.4, duration: 0.3, midi: 45, note: 'A2', frequency: 110, confidence: 0.9, source: 'yin' as const },
    ];
    expect(pcsInSpan(notes, 0, 1)).toEqual([9]);
    expect(pcsInSpan(notes, 5, 6)).toEqual([]);
  });
});

describe('discrete pitchShift hypotheses (supervisor TABFIX order)', () => {
  // Open-string passage in standard tuning: shift 0 is the idiomatic truth.
  const opens = [40, 45, 50, 55, 59, 64].map((midi, i) => ({
    onset: i, offset: i + 0.5, midis: [midi],
  }));
  // Same physical shapes on a guitar tuned a whole step up: concert +2.
  const upTwo = opens.map((g) => ({ ...g, midis: [g.midis[0] + 2] }));
  // Same shapes tuned a whole step down: concert -2.
  const downTwo = [43, 48, 53, 57, 62].map((midi, i) => ({
    onset: i, offset: i + 0.5, midis: [midi],
  }));

  test('standard opens -> shift 0 with confidence', () => {
    const est = estimatePitchShift(opens, NO_CHORD);
    expect(est.semitones).toBe(0);
    expect(est.confidence).toBeGreaterThanOrEqual(0.6);
  });

  test('whole-step-up concert pitches -> shift +2 with confidence', () => {
    const est = estimatePitchShift(upTwo, NO_CHORD);
    expect(est.semitones).toBe(2);
    expect(est.confidence).toBeGreaterThanOrEqual(0.6);
  });

  test('whole-step-down concert pitches -> shift -2 with confidence', () => {
    const est = estimatePitchShift(downTwo, NO_CHORD);
    expect(est.semitones).toBe(-2);
    expect(est.confidence).toBeGreaterThanOrEqual(0.6);
  });

  test('chromatic cluster -> ambiguous, low confidence, never auto-apply', () => {
    const chromatic = [61, 62, 63].map((midi, i) => ({
      onset: i, offset: i + 0.5, midis: [midi],
    }));
    const est = estimatePitchShift(chromatic, NO_CHORD);
    expect(est.confidence).toBeLessThan(0.4);
  });

  test('shift never alters detected midis, only suggested frets', () => {
    const events = (shift: number): number[][] =>
      notesToTab(
        upTwo.map((g) => ({
          onset: g.onset, offset: g.offset, duration: 0.5,
          midi: g.midis[0], note: 'x', frequency: 440, confidence: 0.9, source: 'yin' as const,
        })),
        NO_CHORD,
        { pitchShift: shift },
      ).map((t) => [t.notes[0].midi, t.notes[0].fret]);
    const plain = events(0);
    const shifted = events(2);
    // Same concert midis in both hypotheses ...
    expect(shifted.map(([m]) => m)).toEqual(plain.map(([m]) => m));
    // ... but the +2 hypothesis fingers opens (0s) where plain frets 2s.
    expect(plain.every(([, f]) => f === 2)).toBe(true);
    expect(shifted.every(([, f]) => f === 0)).toBe(true);
  });

  test('tuningShift alias behaves identically to pitchShift', () => {
    const a = assignSequence(opens, NO_CHORD, { pitchShift: 1 });
    const b = assignSequence(opens, NO_CHORD, { tuningShift: 1 });
    expect(a.map((g) => g.positions)).toEqual(b.map((g) => g.positions));
  });
});
