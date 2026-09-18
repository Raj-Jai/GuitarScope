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
