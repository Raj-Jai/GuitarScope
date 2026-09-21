/**
 * P2 verification: boundaries through the ACTUAL rendered TunerPanel
 * (react-dom/server static markup) + hysteresis / noise / transient /
 * silence DSP behavior. Supervisor gate-2 items (b),(e) + findings 8,9,10.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TunerPanel } from '../components/TunerPanel';
import type { LivePitch } from '../hooks/useGuitarAudio';
import { StringTracker, classifyTuning, guidanceForCents } from '../lib/analysis/string-tracker';
import { detectPitch } from '../lib/pitch/pitch-detector';
import { harmonicTone, silence } from '../lib/dsp/synth';

const SR = 48000;
const FRAME = 4096;
const HOP = 2048;

/** Faithful LivePitch for a clean tone at `offsetCents` from A2 (DSP measures ≈ offset). */
function a2Pitch(offsetCents: number, extra: Partial<LivePitch> = {}): LivePitch {
  const freq = 110 * Math.pow(2, offsetCents / 1200);
  const abs = Math.abs(offsetCents);
  const coarse = abs <= 5 ? 'IN_TUNE' : offsetCents < 0 ? 'FLAT' : 'SHARP';
  return {
    status: 'NOTE_DETECTED',
    frequency: freq,
    midi: null,
    note: 'A2',
    octave: 2,
    cents: offsetCents,
    stringCents: offsetCents,
    stringNumber: 5,
    openString: abs <= 40,
    tuning: abs <= 5 ? 'IN_TUNE' : abs <= 15 ? 'CLOSE' : coarse,
    confidence: 0.99,
    rms: 0.25,
    octaveCorrected: false,
    displayCents: offsetCents,
    stableNote: 'A2',
    activeString: 5,
    targetFrequency: 110,
    targetNote: 'A2',
    guidance: guidanceForCents(offsetCents),
    held: false,
    ...extra,
  };
}

const render = (p: LivePitch | null, running = true) =>
  renderToStaticMarkup(<TunerPanel pitch={p} running={running} />);

describe('rendered boundary matrix (P2-b)', () => {
  const cases: Array<{ offset: number; guidance: string[]; panel: string; sub: string | null }> = [
    { offset: -31, guidance: ['TUNE UP'], panel: 'tuner-off', sub: null },
    { offset: -16, guidance: ['TUNE UP'], panel: 'tuner-off', sub: null },
    { offset: -15, guidance: ['TUNE UP', 'Slightly flat'], panel: 'tuner-close', sub: 'Slightly flat' },
    { offset: -14, guidance: ['TUNE UP', 'Slightly flat'], panel: 'tuner-close', sub: 'Slightly flat' },
    { offset: -6, guidance: ['TUNE UP', 'Slightly flat'], panel: 'tuner-close', sub: 'Slightly flat' },
    { offset: -5, guidance: ['IN TUNE'], panel: 'tuner-in-tune', sub: null },
    { offset: -4, guidance: ['IN TUNE'], panel: 'tuner-in-tune', sub: null },
    { offset: -3, guidance: ['PERFECT'], panel: 'tuner-in-tune', sub: null },
    { offset: -1, guidance: ['PERFECT'], panel: 'tuner-in-tune', sub: null },
    { offset: 0, guidance: ['PERFECT'], panel: 'tuner-in-tune', sub: null },
    { offset: 1, guidance: ['PERFECT'], panel: 'tuner-in-tune', sub: null },
    { offset: 4, guidance: ['IN TUNE'], panel: 'tuner-in-tune', sub: null },
    { offset: 5, guidance: ['IN TUNE'], panel: 'tuner-in-tune', sub: null },
    { offset: 6, guidance: ['TUNE DOWN', 'Slightly sharp'], panel: 'tuner-close', sub: 'Slightly sharp' },
    { offset: 14, guidance: ['TUNE DOWN', 'Slightly sharp'], panel: 'tuner-close', sub: 'Slightly sharp' },
    { offset: 15, guidance: ['TUNE DOWN', 'Slightly sharp'], panel: 'tuner-close', sub: 'Slightly sharp' },
    { offset: 16, guidance: ['TUNE DOWN'], panel: 'tuner-off', sub: null },
    { offset: 31, guidance: ['TUNE DOWN'], panel: 'tuner-off', sub: null },
  ];

  for (const c of cases) {
    test(`${c.offset >= 0 ? '+' : ''}${c.offset}¢ renders one consistent state`, () => {
      const html = render(a2Pitch(c.offset));
      for (const g of c.guidance) expect(html).toContain(g);
      expect(html).toContain(c.panel);
      // Label, guidance, strip class, and meter zone all rendered from classifyTuning.
      expect(classifyTuning(c.offset)).toMatch(/PERFECT|IN_TUNE|SLIGHTLY|FLAT|SHARP/);
      expect(html).toContain('data-testid="tuner-zone"');
      expect(html).toContain('raise pitch');
      expect(html).toContain('lower pitch');
      if (c.sub) expect(html).toContain(c.sub);
      // open-match (|c|<=15): no duplicated status line; near-open: secondary line.
      if (Math.abs(c.offset) <= 15) {
        expect(html).not.toContain('data-testid="tuner-status"');
      } else {
        expect(html).toContain('Near open — tune toward A2');
        expect(html).toContain('tuner-sub secondary');
      }
    });
  }

  test('needle position matches the ±50¢ clamp at key offsets', () => {
    const at = (offset: number) => {
      const html = render(a2Pitch(offset));
      const m = html.match(/tuner-needle" style="left:([0-9.]+)%"/);
      expect(m).not.toBeNull();
      return parseFloat(m![1]);
    };
    expect(at(0)).toBeCloseTo(50, 5);
    expect(at(-5)).toBeCloseTo(45, 5);
    expect(at(5)).toBeCloseTo(55, 5);
    expect(at(-15)).toBeCloseTo(35, 5);
    expect(at(15)).toBeCloseTo(65, 5);
    expect(at(-30)).toBeCloseTo(20, 5);
    expect(at(30)).toBeCloseTo(80, 5);
  });

  test('held state dims; low-signal idle shows no authoritative tuning', () => {
    const held = render(a2Pitch(-12, { held: true }));
    expect(held).toContain('tuner-held');
    expect(held).toContain('(held)');
    const idle: LivePitch = {
      ...a2Pitch(0),
      status: 'LOW_SIGNAL',
      frequency: null,
      note: null,
      cents: null,
      stringCents: null,
      stringNumber: null,
      openString: false,
      tuning: null,
      confidence: 0.1,
      displayCents: null,
      stableNote: null,
      activeString: null,
      targetFrequency: null,
      targetNote: null,
      guidance: 'IDLE',
    };
    const idleHtml = render(idle);
    expect(idleHtml).toContain('Signal too quiet — pluck louder');
    expect(idleHtml).not.toContain('data-testid="tuner-guidance"');
    expect(idleHtml).not.toContain('IN TUNE');
    // Final-gate blocker: no measurement → no needle marker (a centered
    // needle would falsely read as "in tune"). Zone + center line remain.
    expect(idleHtml).not.toContain('tuner-needle');
    expect(idleHtml).toContain('tuner-zone');
    expect(idleHtml).toContain('tuner-idle');
  });

  test('active pitch always renders exactly one needle marker', () => {
    for (const offset of [-30, -15, -5, 0, 5, 15, 30]) {
      const html = render(a2Pitch(offset));
      expect(html.match(/data-testid="tuner-needle"/g)).toHaveLength(1);
    }
  });
});

describe('layout shells: geometry never depends on state (flicker-free)', () => {
  const idleLow: LivePitch = {
    ...a2Pitch(0),
    status: 'LOW_SIGNAL',
    frequency: null,
    note: null,
    cents: null,
    stringCents: null,
    stringNumber: null,
    openString: false,
    tuning: null,
    confidence: 0.1,
    displayCents: null,
    stableNote: null,
    activeString: null,
    targetFrequency: null,
    targetNote: null,
    guidance: 'IDLE',
  };
  const cases: Array<{ name: string; pitch: LivePitch | null; zones: string[]; noInner: string[] }> = [
    {
      name: 'idle',
      pitch: idleLow,
      zones: ['tuner-readout', 'tuner-target-zone', 'tuner-status-zone', 'tuner-guidance-zone', 'tuner-badge-zone', 'tuner-note', 'tuner-zone'],
      noInner: ['tuner-target', 'tuner-guidance', 'tuner-in-tune', 'tuner-needle'],
    },
    {
      name: 'perfect',
      pitch: a2Pitch(0),
      zones: ['tuner-readout', 'tuner-target-zone', 'tuner-status-zone', 'tuner-guidance-zone', 'tuner-badge-zone', 'tuner-note'],
      noInner: ['tuner-status'],
    },
    {
      name: 'slightly-sharp',
      pitch: a2Pitch(8),
      zones: ['tuner-readout', 'tuner-target-zone', 'tuner-status-zone', 'tuner-guidance-zone', 'tuner-badge-zone'],
      noInner: ['tuner-status', 'tuner-in-tune'],
    },
    {
      name: 'flat-far',
      pitch: { ...a2Pitch(-30), openString: true },
      zones: ['tuner-readout', 'tuner-target-zone', 'tuner-status-zone', 'tuner-guidance-zone', 'tuner-badge-zone'],
      noInner: ['tuner-in-tune'],
    },
    {
      name: 'nearest',
      pitch: { ...a2Pitch(45), openString: false, stringCents: 200 },
      zones: ['tuner-readout', 'tuner-target-zone', 'tuner-status-zone', 'tuner-guidance-zone', 'tuner-badge-zone'],
      noInner: ['tuner-in-tune'],
    },
    {
      name: 'held',
      pitch: { ...a2Pitch(-12), held: true },
      zones: ['tuner-readout', 'tuner-target-zone', 'tuner-status-zone', 'tuner-guidance-zone', 'tuner-badge-zone'],
      noInner: ['tuner-status', 'tuner-in-tune'],
    },
  ];

  for (const c of cases) {
    test(`${c.name}: shells always present, content conditional`, () => {
      const html = render(c.pitch);
      for (const z of c.zones) expect(html).toContain(`data-testid="${z}"`);
      for (const n of c.noInner) expect(html).not.toContain(`data-testid="${n}"`);
      // Exactly one needle iff there is a measurement.
      const needles = html.match(/data-testid="tuner-needle"/g) ?? [];
      expect(needles).toHaveLength(c.pitch?.displayCents == null ? 0 : 1);
    });
  }
});

describe('hysteresis around boundaries (finding 9)', () => {
  function oscillate(centsA: number, centsB: number, frames = 14) {
    const tr = new StringTracker();
    const seen: string[] = [];
    let t = 0;
    for (let i = 0; i < frames; i++) {
      const c = i % 2 === 0 ? centsA : centsB;
      const s = tr.push({ stringNumber: 5, stringCents: c, confidence: 0.95, status: 'NOTE_DETECTED', timestampMs: (t += 43) });
      if (s.activeString !== null) seen.push(`${s.activeString}:${s.guidance}`);
    }
    return seen;
  }

  test('±5¢ dither never drops the latch nor flashes the wrong direction', () => {
    for (const seen of [oscillate(4.9, 5.1), oscillate(-5.1, -4.9)]) {
      expect(seen.length).toBeGreaterThan(0);
      for (const s of seen) {
        expect(s.startsWith('5:')).toBe(true);
        expect(['5:IN_TUNE', '5:SHARP', '5:FLAT']).toContain(s);
      }
      // No direction flip across the dither.
      const dirs = new Set(seen.map((s) => s.split(':')[1]));
      expect(dirs.size).toBeLessThanOrEqual(2);
      expect(dirs.has('FLAT') && dirs.has('SHARP')).toBe(false);
    }
  });

  test('±15¢ dither keeps coarse SHARP stable (no IN_TUNE flicker)', () => {
    for (const seen of [oscillate(14.9, 15.1), oscillate(-15.1, -14.9)]) {
      expect(seen.length).toBeGreaterThan(0);
      const dirs = new Set(seen.map((s) => s.split(':')[1]));
      expect(dirs.has('IN_TUNE')).toBe(false);
    }
  });

  test('rapid string bounce without margin never steals the latch', () => {
    const tr = new StringTracker();
    let t = 0;
    const push = (n: 1 | 2 | 3 | 4 | 5 | 6, c: number) =>
      tr.push({ stringNumber: n, stringCents: c, confidence: 0.95, status: 'NOTE_DETECTED', timestampMs: (t += 43) });
    push(6, 2);
    push(6, 2);
    expect(push(6, 2).activeString).toBe(6);
    // Single-frame bounces at other strings: ignored.
    for (const [n, c] of [[5, -3], [4, 10], [1, 4], [5, 0]] as const) push(n, c);
    expect(push(6, 2).activeString).toBe(6);
  });

  test('clearly-closer switch updates target (marker follows active string)', () => {
    const tr = new StringTracker();
    let t = 0;
    const push = (n: 1 | 2 | 3 | 4 | 5 | 6, c: number) =>
      tr.push({ stringNumber: n, stringCents: c, confidence: 0.95, status: 'NOTE_DETECTED', timestampMs: (t += 43) });
    push(6, 20);
    push(6, 20);
    push(4, 1);
    const s = push(4, 1);
    expect(s.activeString).toBe(4);
    expect(s.targetNote).toBe('D3');
    expect(s.targetFrequency).toBeCloseTo(146.83, 1);
  });
});

describe('noisy / weak / transient / silence input (findings 8, 10)', () => {
  function trackThrough(sig: Float32Array, opts: { hop?: number; conf?: number } = {}) {
    const tr = new StringTracker();
    const hop = opts.hop ?? HOP;
    let t = 0;
    const seen: Array<{ str: number | null; cents: number | null; guid: string; status: string }> = [];
    for (let s = 0; s + FRAME <= sig.length; s += hop) {
      const p = detectPitch(sig.slice(s, s + FRAME), { sampleRate: SR });
      const st = tr.push({
        stringNumber: p.stringNumber,
        stringCents: p.stringCents,
        confidence: opts.conf ?? p.confidence,
        status: p.status,
        timestampMs: (t += 43),
      });
      seen.push({ str: st.activeString, cents: st.displayCents, guid: st.guidance, status: p.status });
    }
    return seen;
  }

  test('moderate noise never produces a wrong-string authoritative display', () => {
    const sig = harmonicTone(110, { sampleRate: SR, duration: 2, amplitude: 0.8, attack: 0.01, noiseLevel: 0.05 });
    const seen = trackThrough(sig.slice(Math.floor(SR * 0.5)));
    const latched = seen.filter((s) => s.str !== null);
    expect(latched.length).toBeGreaterThan(0);
    for (const s of latched) expect(s.str).toBe(5);
    const last = latched[latched.length - 1];
    expect(Math.abs(last.cents ?? 999)).toBeLessThanOrEqual(5);
  });

  test('weak pluck never latches (no authoritative IN TUNE on noise floor)', () => {
    const sig = harmonicTone(110, { sampleRate: SR, duration: 1, amplitude: 0.015 });
    const seen = trackThrough(sig);
    expect(seen.every((s) => s.str === null)).toBe(true);
  });

  test('pick attack from t=0 never flashes a wrong string', () => {
    const sig = harmonicTone(110, { sampleRate: SR, duration: 1.2, amplitude: 0.8, attack: 0.003 });
    const seen = trackThrough(sig);
    const latched = seen.filter((s) => s.str !== null);
    expect(latched.length).toBeGreaterThan(0);
    for (const s of latched) expect(s.str).toBe(5);
    expect(latched[latched.length - 1].guid).toBe('IN_TUNE');
  });

  test('silence drops to idle; a new string reacquires cleanly', () => {
    const tr = new StringTracker();
    let t = 0;
    const push = (n: 1 | 2 | 3 | 4 | 5 | 6 | null, c: number | null, status = 'NOTE_DETECTED', conf = 0.95) =>
      tr.push({ stringNumber: n, stringCents: c, confidence: conf, status, timestampMs: (t += 43) });
    push(5, 0);
    push(5, 0);
    expect(push(5, 0).activeString).toBe(5);
    // 800ms of silence: hold first, then drop.
    let s = push(null, null, 'NO_SIGNAL', 0);
    expect(s.activeString).toBe(5);
    expect(s.held).toBe(true);
    for (let i = 0; i < 20; i++) s = push(null, null, 'NO_SIGNAL', 0);
    expect(s.activeString).toBeNull();
    expect(s.displayCents).toBeNull();
    // Fresh pluck on another string acquires with the right target.
    push(1, 0);
    const r = push(1, 0);
    expect(r.activeString).toBe(1);
    expect(r.targetFrequency).toBeCloseTo(329.63, 0);
  });

  test('pure silence frame never yields a pitch', () => {
    expect(detectPitch(silence(FRAME, SR), { sampleRate: SR }).status).toBe('NO_SIGNAL');
  });
});
