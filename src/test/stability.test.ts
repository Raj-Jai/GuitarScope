import { describe, expect, test } from 'vitest';
import { ChordStabilityGate } from '../lib/analysis/chord-stability';
import { describeStringClaim } from '../lib/guitar/tuning';
import { DspEngine } from '../lib/analysis/engine';
import { chordTone, harmonicTone, silence, takeFrame, whiteNoise } from '../lib/dsp/synth';

const SR = 48000;

describe('ChordStabilityGate', () => {
  test('first confident chord shows immediately', () => {
    const g = new ChordStabilityGate();
    expect(g.push({ name: 'A', confidence: 0.77 })).toBe('A');
  });

  test('single-run blip does not replace the display', () => {
    const g = new ChordStabilityGate();
    g.push({ name: 'A', confidence: 0.77 });
    g.push({ name: 'A', confidence: 0.76 });
    // One Amaj7 blip (transition artifact) must not display.
    expect(g.push({ name: 'Amaj7', confidence: 0.6 })).toBe('A');
    // Back to A: still A, challenger cleared.
    expect(g.push({ name: 'A', confidence: 0.77 })).toBe('A');
  });

  test('confirmed challenger (2 runs) replaces display', () => {
    const g = new ChordStabilityGate();
    g.push({ name: 'A', confidence: 0.77 });
    expect(g.push({ name: 'E', confidence: 0.75 })).toBe('A'); // 1st: hold
    expect(g.push({ name: 'E', confidence: 0.76 })).toBe('E'); // 2nd: switch
  });

  test('collapse switches immediately without confirmation', () => {
    const g = new ChordStabilityGate();
    g.push({ name: 'A', confidence: 0.77 });
    // Displayed confidence collapses (reported via matching low run)...
    g.push({ name: 'A', confidence: 0.2 }); // below minConfidence -> absence path
    g.push(null);
    g.push(null); // 3rd absence clears
    expect(g.current).toBeNull();
    // ...then the next confident chord shows at once.
    expect(g.push({ name: 'C', confidence: 0.7 })).toBe('C');
  });

  test('sustained absence clears the display', () => {
    const g = new ChordStabilityGate();
    g.push({ name: 'G', confidence: 0.8 });
    g.push(null);
    g.push(null);
    expect(g.push(null)).toBeNull();
  });

  test('rapid A->C->E transition ends on E without sticking', () => {
    const g = new ChordStabilityGate();
    const seq = ['A', 'A', 'C', 'C', 'E', 'E'];
    let out: string | null = null;
    for (const name of seq) out = g.push({ name, confidence: 0.75 });
    expect(out).toBe('E');
  });
});

describe('describeStringClaim', () => {
  test('close open string -> open-match', () => {
    expect(describeStringClaim(true, 2.0)).toBe('open-match');
    expect(describeStringClaim(true, -15)).toBe('open-match');
  });
  test('open tolerance but far -> near-open', () => {
    expect(describeStringClaim(true, 20)).toBe('near-open');
    expect(describeStringClaim(true, -39)).toBe('near-open');
  });
  test('not an open string -> nearest (fretted honesty)', () => {
    expect(describeStringClaim(false, 200)).toBe('nearest');
  });
});

describe('engine attack gate', () => {
  function feed(engine: DspEngine, signal: Float32Array): { held: number; names: (string | null)[] } {
    let held = 0;
    const names: (string | null)[] = [];
    for (let start = 0; start + 4096 <= signal.length; start += 4096) {
      const r = engine.pushFrame(takeFrame(signal, start, 4096), start);
      if (r.chordHeld) held++;
      if (r.ranChord) names.push(r.chord?.chord?.name ?? r.chord?.status ?? null);
    }
    return { held, names };
  }

  test('abrupt chord onset holds first, then detects correctly', () => {
    const engine = new DspEngine({ sampleRate: SR, chordCadenceHz: 4 });
    // Warm up on quiet so the onset is abrupt.
    feed(engine, silence(1.0, SR));
    const { held, names } = feed(
      engine,
      chordTone([110, 138.5913, 164.8138], { sampleRate: SR, duration: 1.5, attack: 0.02 }),
    );
    expect(held).toBeGreaterThan(0);
    expect(names[names.length - 1]).toBe('A');
  });

  test('lone percussive click never becomes a chord', () => {
    const engine = new DspEngine({ sampleRate: SR, chordCadenceHz: 4 });
    feed(engine, silence(1.0, SR));
    // One loud noise frame in the middle of silence.
    const burst = silence(0.5, SR);
    burst.set(takeFrame(whiteNoise(0.5, 0.1, SR), 0, 4096), 2048);
    const { names } = feed(engine, burst);
    const chordNames = names.filter(
      (n) => n !== null && !['NO_SIGNAL', 'LOW_SIGNAL', 'MONOPHONIC', 'UNCERTAIN'].includes(n),
    );
    expect(chordNames).toEqual([]);
  });

  test('sustained chord is not starved by the gate', () => {
    const engine = new DspEngine({ sampleRate: SR, chordCadenceHz: 4 });
    const { names } = feed(
      engine,
      chordTone([82.4069, 103.8262, 123.4708], { sampleRate: SR, duration: 2.5 }),
    );
    const eCount = names.filter((n) => n === 'E').length;
    expect(eCount).toBeGreaterThanOrEqual(3);
  });

  test('single picked note does not disturb pitch path via gate', () => {
    const engine = new DspEngine({ sampleRate: SR });
    const r = engine.pushFrame(
      takeFrame(harmonicTone(82.4069, { sampleRate: SR, duration: 0.5 }), 8000, 4096),
      0,
    );
    expect(r.pitch.note).toBe('E2');
  });
});
