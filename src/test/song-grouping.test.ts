import { describe, expect, test } from 'vitest';
import { transcribeNotes } from '../../analyzer/notes';
import { isNoteGroup } from '../../analyzer/schema';
import { harmonicTone } from '../lib/dsp/synth';

const SR = 48000;

function pluck(freq: number, atSec: number, total: Float32Array, dur = 0.5): void {
  const part = harmonicTone(freq, { sampleRate: SR, duration: dur, attack: 0.006, decay: 3 });
  const s0 = Math.floor(atSec * SR);
  for (let i = 0; i < part.length && s0 + i < total.length; i++) total[s0 + i] += part[i] * 0.6;
}

/** G3=196.0, A3=220.0, C#5=554.37, B3=246.94, D4=293.66, E4=329.63 */
function show(events: ReturnType<typeof transcribeNotes>): string {
  return events.map((e) => isNoteGroup(e)
    ? `GROUP@${e.onset}[${e.notes.map((n) => n.midi).join(',')}]`
    : `note@${e.onset}(midi ${(e as { midi: number }).midi})`).join(' ');
}

describe('phantom-group reproduction (supervisor step 1)', () => {
  test('A: exact simultaneous chord G3@0 B3@10 D4@16ms stays one group', () => {
    const total = new Float32Array(SR * 1);
    pluck(196.0, 0.1, total);
    pluck(246.94, 0.11, total);
    pluck(293.66, 0.116, total);
    const events = transcribeNotes(total, { sampleRate: SR });
    const groups = events.filter(isNoteGroup);
    console.log('A chord events:', show(events));
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups.some((g) => g.notes.length >= 3)).toBe(true);
  });

  test('B: arpeggio G3@0 A3@70 C#5@140ms forms no 3-note phantom', () => {
    const total = new Float32Array(SR * 1);
    pluck(196.0, 0.1, total);
    pluck(220.0, 0.17, total);
    pluck(554.37, 0.24, total);
    const events = transcribeNotes(total, { sampleRate: SR });
    const groups = events.filter(isNoteGroup);
    console.log('B arpeggio events:', show(events));
    expect(groups.filter((g) => g.notes.length >= 3)).toHaveLength(0);
  });

  test('C: borderline timing sweep 10..80ms stays sane', () => {
    // Same three pitches at increasing inter-onset gaps: tight gaps may
    // group (defensible), wide gaps must not form 3-note phantoms.
    for (const gapMs of [10, 20, 30, 40, 60, 80]) {
      const total = new Float32Array(SR * 1);
      const gap = gapMs / 1000;
      pluck(196.0, 0.1, total);
      pluck(220.0, 0.1 + gap, total);
      pluck(554.37, 0.1 + 2 * gap, total);
      const events = transcribeNotes(total, { sampleRate: SR });
      const groups = events.filter(isNoteGroup);
      const phantom3 = groups.filter((g) => g.notes.length >= 3);
      console.log(`C gap=${gapMs}ms events:`, show(events));
      if (gapMs >= 60) expect(phantom3).toHaveLength(0);
    }
  });

  test('D: decay smear (G3 rings 200ms under A3) stays two notes', () => {
    const total = new Float32Array(SR * 1);
    pluck(196.0, 0.1, total, 0.6);
    pluck(220.0, 0.17, total);
    const events = transcribeNotes(total, { sampleRate: SR });
    console.log('D decay events:', show(events));
    // A3 must appear as its own note; G3 decay must not fuse into a group.
    expect(events.some((e) => !isNoteGroup(e) && (e as { midi: number }).midi === 57)).toBe(true);
  });

  test('E: mixed texture (3-note chord + melody 70ms later)', () => {
    const total = new Float32Array(SR * 1.5);
    pluck(196.0, 0.1, total);
    pluck(246.94, 0.11, total);
    pluck(293.66, 0.116, total);
    pluck(329.63, 0.19, total);
    const events = transcribeNotes(total, { sampleRate: SR });
    const groups = events.filter(isNoteGroup);
    console.log('E mixed events:', show(events));
    expect(groups.some((g) => g.notes.length >= 3)).toBe(true);
    expect(events.some((e) => !isNoteGroup(e) && (e as { midi: number }).midi === 64)).toBe(true);
  });

  test('F: open-string-heavy passage keeps high open rate', () => {
    const total = new Float32Array(SR * 2);
    const opens: [number, number][] = [
      [82.4069, 0.1], [110.0, 0.4], [146.8318, 0.7], [196.0, 1.0], [246.9417, 1.3], [329.6276, 1.6],
    ];
    for (const [f, t] of opens) pluck(f, t, total, 0.35);
    const events = transcribeNotes(total, { sampleRate: SR });
    const singles = events.filter((e) => !isNoteGroup(e)) as { midi: number }[];
    const openMidis = new Set([40, 45, 50, 55, 59, 64]);
    const matched = singles.filter((e) => openMidis.has(e.midi)).length;
    console.log('F open events:', show(events));
    // Diagnostic threshold (not a universal law): an all-open passage
    // must not come back starved of open pitches.
    expect(matched / Math.max(1, singles.length)).toBeGreaterThan(0.5);
  });

  test('G: original Romanza failure — G3/A3/C#5 staggered 70ms are 3 singles, never one group', () => {
    // Locks the reported TABFIX case: 85ms-snapshot smear merged these
    // into one phantom chord (assigned s3f0/s4f7/s1f9). Event-centric
    // clustering must keep staggered arpeggio entries sequential.
    const total = new Float32Array(SR * 1);
    pluck(196.0, 0.1, total);
    pluck(220.0, 0.17, total);
    pluck(554.37, 0.24, total);
    const events = transcribeNotes(total, { sampleRate: SR });
    console.log('G romanza events:', show(events));
    // No single event may contain all three pitches at once.
    for (const g of events.filter(isNoteGroup)) {
      expect(g.notes.map((n) => n.midi).sort()).not.toEqual([55, 57, 73]);
    }
    // Each pitch surfaces as its own single note (late decay doubles
    // allowed — they are separate events, not phantom simultaneity).
    for (const midi of [55, 57, 73]) {
      expect(events.some((e) => !isNoteGroup(e) && (e as { midi: number }).midi === midi)).toBe(true);
    }
  });
});
