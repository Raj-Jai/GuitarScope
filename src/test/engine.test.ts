import { describe, expect, test } from 'vitest';
import { DspEngine } from '../lib/analysis/engine';
import { FrameQueue } from '../lib/analysis/frame-queue';
import { TunerSmoother } from '../lib/analysis/tuner-smoother';
import { LabelStabilizer, MedianFilter } from '../lib/analysis/temporal-smoothing';
import {
  chordTone,
  harmonicTone,
  silence,
  takeFrame,
} from '../lib/dsp/synth';

const SR = 48000;

function pitchFrame(freq: number): Float32Array {
  const signal = harmonicTone(freq, { sampleRate: SR, duration: 0.5 });
  return takeFrame(signal, 8000, 4096);
}

describe('DspEngine pitch path', () => {
  test('E2 frame -> E2 result with timings', () => {
    const engine = new DspEngine({ sampleRate: SR });
    const capturePerf = performance.now();
    const r = engine.pushFrame(pitchFrame(82.4069), capturePerf);
    expect(r.seq).toBe(0);
    expect(r.pitch.note).toBe('E2');
    expect(r.captureTimestamp).toBe(capturePerf);
    expect(r.processedTimestamp).toBeGreaterThanOrEqual(capturePerf);
    expect(r.pitchProcessingMs).toBeGreaterThanOrEqual(0);
    expect(r.ranChord).toBe(false); // ring not full yet
    expect(r.chord).toBeNull();
  });

  test('silence -> NO_SIGNAL, never a fake note', () => {
    const engine = new DspEngine({ sampleRate: SR });
    const r = engine.pushFrame(takeFrame(silence(0.5, SR), 0, 4096), 0);
    expect(r.pitch.status).toBe('NO_SIGNAL');
    expect(r.pitch.note).toBeNull();
  });

  test('chord runs once the 16384 ring fills, at configured cadence', () => {
    const engine = new DspEngine({ sampleRate: SR, chordCadenceHz: 4 });
    const signal = chordTone([110, 138.5913, 164.8138], { sampleRate: SR, duration: 1.5 });
    let ranAt = -1;
    let chordName: string | null | undefined;
    // Feed 4096-frames consecutively (85ms each).
    for (let start = 0, i = 0; start + 4096 <= signal.length; start += 4096, i++) {
      const r = engine.pushFrame(takeFrame(signal, start, 4096), i * 85);
      if (r.ranChord && ranAt === -1) {
        ranAt = i;
        chordName = r.chord?.chord?.name;
      }
    }
    expect(ranAt).toBeGreaterThanOrEqual(0);
    expect(chordName).toBe('A');
    // 4Hz @12Hz frame rate -> roughly every 3rd frame after warmup.
    expect(engine.stats.chordsRun).toBeGreaterThanOrEqual(2);
  });

  test('8Hz cadence runs ~2x more chord analyses than 4Hz', () => {
    const run = (hz: number) => {
      const engine = new DspEngine({ sampleRate: SR, chordCadenceHz: hz });
      const signal = chordTone([110, 130.8128, 164.8138], { sampleRate: SR, duration: 2.0 });
      for (let start = 0; start + 4096 <= signal.length; start += 4096) {
        engine.pushFrame(takeFrame(signal, start, 4096), start);
      }
      return engine.stats.chordsRun;
    };
    const c4 = run(4);
    const c8 = run(8);
    expect(c8).toBeGreaterThan(c4);
    // Sample-count gating + 4096-frame quantization makes the ratio
    // approximate (warmup + boundary effects), not exactly 2.
    expect(c8 / c4).toBeGreaterThan(1.3);
  });

  test('ring always holds the LATEST window (long-run regression)', () => {
    // 3s of A major then 3s of E major: late chord runs must report E,
    // not a stale A/mixed window. (copyWithin with an ever-growing offset
    // used to freeze the ring prefix after ~0.7s.)
    const engine = new DspEngine({ sampleRate: SR, chordCadenceHz: 4 });
    const a = chordTone([110, 138.5913, 164.8138], { sampleRate: SR, duration: 3.0 });
    const e = chordTone([82.4069, 103.8262, 123.4708], { sampleRate: SR, duration: 3.0 });
    const feed = (signal: Float32Array) => {
      const names: (string | null)[] = [];
      for (let start = 0; start + 4096 <= signal.length; start += 4096) {
        const r = engine.pushFrame(takeFrame(signal, start, 4096), start);
        if (r.ranChord) names.push(r.chord?.chord?.name ?? r.chord?.status ?? null);
      }
      return names;
    };
    const namesA = feed(a);
    expect(namesA[namesA.length - 1]).toBe('A');
    const namesE = feed(e);
    // Last runs see a pure-E window.
    expect(namesE.slice(-3)).toEqual(['E', 'E', 'E']);
  });

  test('configure() clamps cadence, reset() clears chord state', () => {
    const engine = new DspEngine({ sampleRate: SR });
    engine.configure({ chordCadenceHz: 999 });
    const signal = chordTone([110, 138.5913, 164.8138], { sampleRate: SR, duration: 1.0 });
    for (let start = 0; start + 4096 <= signal.length; start += 4096) {
      engine.pushFrame(takeFrame(signal, start, 4096), start);
    }
    expect(engine.stats.chordsRun).toBeGreaterThan(0);
    engine.reset();
    const r = engine.pushFrame(pitchFrame(110), 0);
    expect(r.ranChord).toBe(false);
    expect(r.chord).toBeNull();
  });
});

describe('FrameQueue latest-wins', () => {
  test('drops oldest when over capacity and counts drops', () => {
    const q = new FrameQueue(2);
    const mk = (seq: number) => ({ seq, captureTimestamp: seq, samples: new Float32Array(4) });
    q.push(mk(0));
    q.push(mk(1));
    q.push(mk(2)); // drops 0
    q.push(mk(3)); // drops 1
    expect(q.droppedFrames).toBe(2);
    expect(q.depth).toBe(2);
    expect(q.pop()?.seq).toBe(2);
    expect(q.pop()?.seq).toBe(3);
    expect(q.pop()).toBeNull();
  });
});

describe('TunerSmoother', () => {
  test('converges to stable cents, rejects outlier', () => {
    const s = new TunerSmoother();
    let out: number | null = null;
    for (const c of [2.0, 2.2, 50 /* outlier */, 2.1, 1.9, 2.0]) {
      out = s.push('E2', c);
    }
    expect(out).not.toBeNull();
    expect(Math.abs((out as number) - 2.0)).toBeLessThan(2);
  });

  test('note change resets (no E2/A2 averaging)', () => {
    const s = new TunerSmoother();
    for (let i = 0; i < 5; i++) s.push('E2', 2.0);
    const first = s.push('A2', 40.0);
    // Fresh state: output equals the single new sample exactly.
    expect(first).toBe(40.0);
  });

  test('null input resets and returns null', () => {
    const s = new TunerSmoother();
    s.push('E2', 2.0);
    expect(s.push(null, null)).toBeNull();
    expect(s.push('E2', 3.0)).toBe(3.0); // fresh after reset
  });
});

describe('LabelStabilizer + MedianFilter', () => {
  test('majority vote stabilizes flickering labels', () => {
    const st = new LabelStabilizer(5);
    const seq = ['E2', 'E3', 'E2', 'E2', 'E2'];
    let out: string | null = null;
    for (const l of seq) out = st.push(l);
    expect(out).toBe('E2');
  });

  test('all-null window shows nothing', () => {
    const st = new LabelStabilizer(3);
    st.push(null);
    st.push(null);
    expect(st.push(null)).toBeNull();
  });

  test('median filter smooths numbers', () => {
    const m = new MedianFilter(3);
    m.push(1);
    m.push(100);
    expect(m.push(2)).toBe(2);
  });
});
