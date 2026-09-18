import { describe, expect, test } from 'vitest';
import { validateAnalysis, type SongAnalysis } from '../../analyzer/schema';
import { parseChordReference, parseNoteReference } from '../../analyzer/reference';
import { parseChordLabel, scoreChords } from '../../analyzer/score';

function sampleAnalysis(): SongAnalysis {
  return {
    source: { type: 'file', fileName: 'test.wav', duration: 8.0 },
    meta: {
      version: 1,
      sampleRate: 48000,
      windowSize: 16384,
      hopSize: 4096,
      dictionary: 'mvp60',
      branches: ['raw'],
      createdAt: new Date().toISOString(),
    },
    frames: [{ time: 0.17, candidates: [{ label: 'G', score: 0.8 }] }],
    chords: [
      { start: 0, end: 4, label: 'G', root: 'G', quality: 'maj', confidence: 0.8, alternatives: [] },
      { start: 4, end: 8, label: 'D', root: 'D', quality: 'maj', confidence: 0.75, alternatives: [] },
    ],
    notes: [
      { onset: 0.5, offset: 1.0, duration: 0.5, midi: 67, note: 'G4', frequency: 392, confidence: 0.9, source: 'yin' },
    ],
  };
}

describe('M0 schema contract', () => {
  test('sample analysis validates clean', () => {
    expect(validateAnalysis(sampleAnalysis())).toEqual([]);
  });
  test('bad chord event flagged', () => {
    const a = sampleAnalysis();
    a.chords = [{ start: 5, end: 5, label: '', root: null, quality: null, confidence: 0, alternatives: [] }];
    const errs = validateAnalysis(a);
    expect(errs.length).toBeGreaterThan(0);
  });
  test('JSON round-trip preserves structure', () => {
    const a = sampleAnalysis();
    const back = JSON.parse(JSON.stringify(a)) as SongAnalysis;
    expect(validateAnalysis(back)).toEqual([]);
    expect(back.chords[0].label).toBe('G');
  });
});

describe('reference parsers', () => {
  test('chord reference with comments', () => {
    const ref = parseChordReference('# verse\n0.000 4.112 G\n4.112 8.251 D\n');
    expect(ref).toEqual([
      { start: 0, end: 4.112, label: 'G' },
      { start: 4.112, end: 8.251, label: 'D' },
    ]);
  });
  test('note reference', () => {
    expect(parseNoteReference('12.440 0.532 64\n')).toEqual([{ onset: 12.44, duration: 0.532, midi: 64 }]);
  });
  test('malformed lines throw', () => {
    expect(() => parseChordReference('nope\n')).toThrow();
    expect(() => parseNoteReference('1 2\n')).toThrow();
  });
});

describe('M0 rhythm/tab layers (v2)', () => {
  function v2Analysis(): SongAnalysis {
    const a = sampleAnalysis();
    a.meta.version = 2;
    a.tempo = { bpm: 92.4, confidence: 0.91 };
    a.meter = { numerator: 4, denominator: 4, confidence: 0.72 };
    a.beats = [
      { time: 0, index: 0, bar: 0, beatInBar: 0, confidence: 0.9 },
      { time: 0.65, index: 1, bar: 0, beatInBar: 1, confidence: 0.9 },
    ];
    a.strums = [
      { time: 0, beatIndex: 0, subdivision: 0, slotsPerBeat: 2, direction: 'D', confidence: 0.8, strength: 0.9 },
      { time: 0.325, beatIndex: 0, subdivision: 1, slotsPerBeat: 2, direction: '?', confidence: 0.4, strength: 0.5 },
    ];
    a.patterns = [
      { start: 0, end: 2.6, meter: '4/4', subdivision: 8, symbols: ['D', '-', 'D', 'U', '-', 'U', 'D', 'U'], confidence: 0.71 },
    ];
    a.tab = [
      {
        start: 0,
        end: 0.5,
        kind: 'chord',
        notes: [
          { start: 0, end: 0.5, midi: 45, string: 5, fret: 0, confidence: 0.8, source: 'suggested' },
        ],
        alternatives: [
          { notes: [{ start: 0, end: 0.5, midi: 45, string: 6, fret: 5, confidence: 0.5, source: 'suggested' }], score: 0.5 },
        ],
      },
    ];
    return a;
  }

  test('v2 sample validates; v1 consumers unaffected (chords/notes intact)', () => {
    const a = v2Analysis();
    expect(validateAnalysis(a)).toEqual([]);
    expect(a.chords[0].label).toBe('G');
  });

  test('invalid layers flagged, valid core untouched', () => {
    const a = v2Analysis();
    a.beats = [{ time: 1, index: 5, bar: 0, beatInBar: 0, confidence: 1 } as never];
    a.strums = [{ time: -1, beatIndex: 0, subdivision: 0, direction: 'X', confidence: 0, strength: 0 } as never];
    a.patterns = [{ start: 2, end: 1, meter: '4/4', subdivision: 8, symbols: ['Z'], confidence: 0 } as never];
    a.tab = [{ start: 0, end: 1, kind: 'solo', notes: [{ start: 0, end: 1, midi: 200, string: 7, fret: 30, confidence: 0, source: 'recorded' }] } as never];
    a.tempo = { bpm: -5, confidence: 0 };
    const errs = validateAnalysis(a);
    expect(errs.length).toBeGreaterThanOrEqual(5);
    // Core still fine.
    expect(a.chords).toHaveLength(2);
  });

  test('version 3 rejected (unknown contract)', () => {
    const a = sampleAnalysis();
    (a.meta as { version: number }).version = 3;
    expect(validateAnalysis(a).length).toBeGreaterThan(0);
  });
});

describe('label parsing', () => {
  test('roots and qualities', () => {
    expect(parseChordLabel('Am')).toMatchObject({ root: 9, quality: 'minor' });
    expect(parseChordLabel('F#m7')).toMatchObject({ root: 6, quality: 'm7' });
    expect(parseChordLabel('Cmaj7')).toMatchObject({ root: 0, quality: 'maj7' });
    expect(parseChordLabel('NO_CHORD')).toMatchObject({ root: null });
  });
});

describe('duration-weighted scoring', () => {
  const ref = [
    { start: 0, end: 4, label: 'G' },
    { start: 4, end: 8, label: 'D' },
  ];
  test('perfect match scores 1.0 everywhere, zero boundary error', () => {
    const det = [
      { start: 0, end: 4, label: 'G', root: 'G', quality: 'maj', confidence: 1, alternatives: [] },
      { start: 4, end: 8, label: 'D', root: 'D', quality: 'maj', confidence: 1, alternatives: [] },
    ];
    const s = scoreChords(det, ref);
    expect(s.weightedAccuracy).toBe(1);
    expect(s.rootAccuracy).toBe(1);
    expect(s.qualityAccuracy).toBe(1);
    expect(s.triadAccuracy).toBe(1);
    expect(s.boundaryMeanErr).toBe(0);
  });
  test('wrong quality hurts exact+quality, spares root+triad', () => {
    const det = [
      { start: 0, end: 4, label: 'G', root: 'G', quality: 'maj', confidence: 1, alternatives: [] },
      { start: 4, end: 8, label: 'D7', root: 'D', quality: '7', confidence: 1, alternatives: [] },
    ];
    const s = scoreChords(det, ref);
    expect(s.weightedAccuracy).toBeCloseTo(0.5, 9);
    expect(s.rootAccuracy).toBe(1);
    expect(s.qualityAccuracy).toBeCloseTo(0.5, 9);
    expect(s.triadAccuracy).toBe(1);
  });
  test('small boundary shift barely dents the score', () => {
    const det = [
      { start: 0, end: 4.2, label: 'G', root: 'G', quality: 'maj', confidence: 1, alternatives: [] },
      { start: 4.2, end: 8, label: 'D', root: 'D', quality: 'maj', confidence: 1, alternatives: [] },
    ];
    const s = scoreChords(det, ref);
    expect(s.weightedAccuracy).toBeCloseTo(7.8 / 8, 9);
    expect(s.boundaryMeanErr).toBeCloseTo(0.2, 9);
  });
});
