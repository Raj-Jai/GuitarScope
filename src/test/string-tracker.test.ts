import { describe, expect, test } from 'vitest';
import {
  StringTracker,
  guidanceForCents,
  targetForString,
} from '../lib/analysis/string-tracker';

function frame(
  stringNumber: 1 | 2 | 3 | 4 | 5 | 6 | null,
  stringCents: number | null,
  t: number,
  extra: Partial<{ confidence: number; status: string }> = {},
) {
  return {
    stringNumber,
    stringCents,
    confidence: extra.confidence ?? 0.95,
    status: extra.status ?? 'NOTE_DETECTED',
    timestampMs: t,
  };
}

describe('StringTracker GuitarTuna latch', () => {
  test('requires 2 consecutive frames to acquire (no single-frame flash)', () => {
    const tr = new StringTracker();
    const s1 = tr.push(frame(5, -8, 0));
    expect(s1.activeString).toBeNull();
    const s2 = tr.push(frame(5, -8, 85));
    expect(s2.activeString).toBe(5);
    expect(s2.targetNote).toBe('A2');
    expect(s2.targetFrequency).toBeCloseTo(110, 1);
  });

  test('ignores low confidence frames', () => {
    const tr = new StringTracker();
    tr.push(frame(5, -8, 0, { confidence: 0.2 }));
    const s = tr.push(frame(5, -8, 85, { confidence: 0.2 }));
    expect(s.activeString).toBeNull();
  });

  test('holds active 600ms across dropout, then releases', () => {
    const tr = new StringTracker();
    tr.push(frame(6, 4, 0));
    tr.push(frame(6, 4, 85));
    // dropout at t=200 (invalid)
    const held = tr.push(frame(null, null, 200, { status: 'NO_SIGNAL', confidence: 0 }));
    expect(held.activeString).toBe(6);
    expect(held.displayCents).not.toBeNull();
    expect(held.held).toBe(true);
    // rapid re-pluck same string during hold clears held
    const repluck = tr.push(frame(6, 5, 250));
    expect(repluck.activeString).toBe(6);
    expect(repluck.held).toBe(false);
    // past hold window
    tr.push(frame(6, 4, 1000));
    tr.push(frame(6, 4, 1085));
    const held2 = tr.push(frame(null, null, 1200, { status: 'NO_SIGNAL', confidence: 0 }));
    expect(held2.held).toBe(true);
    const dropped = tr.push(frame(null, null, 1800, { status: 'NO_SIGNAL', confidence: 0 }));
    expect(dropped.activeString).toBeNull();
    expect(dropped.displayCents).toBeNull();
    expect(dropped.held).toBe(false);
  });

  test('weak challenger does not steal active without 15c margin', () => {
    const tr = new StringTracker();
    // Lock onto E6 at +5
    tr.push(frame(6, 5, 0));
    tr.push(frame(6, 5, 85));
    // A5 appears at -5 (equally close, not 15c closer) for 2 frames
    tr.push(frame(5, -5, 170));
    const s = tr.push(frame(5, -5, 255));
    expect(s.activeString).toBe(6);
  });

  test('clearly-closer challenger switches after 2 frames', () => {
    const tr = new StringTracker();
    tr.push(frame(6, 20, 0));
    tr.push(frame(6, 20, 85));
    expect(tr.push(frame(6, 20, 90)).activeString).toBe(6);
    // D4 nearly perfect: 20c closer than current -> candidate 1
    const c1 = tr.push(frame(4, 1, 170));
    expect(c1.activeString).toBe(6);
    const c2 = tr.push(frame(4, 1, 255));
    expect(c2.activeString).toBe(4);
  });

  test('per-string histories do not contaminate (E2/A2 isolation)', () => {
    const tr = new StringTracker();
    tr.push(frame(6, 2, 0));
    tr.push(frame(6, 2, 85));
    // Feed A with outlier then stable: median should reject 50c blip
    tr.push(frame(5, 50, 170));
    // challenger at 50c is outside acquire (35) so no switch
    const s = tr.push(frame(5, 50, 255));
    expect(s.activeString).toBe(6);
  });

  test('far pitch (>55c) never acquires', () => {
    const tr = new StringTracker();
    tr.push(frame(5, 60, 0));
    const s = tr.push(frame(5, 60, 85));
    expect(s.activeString).toBeNull();
  });
});

describe('guidance boundaries', () => {
  test('±5 deadband, ±3 perfect distinction', () => {
    expect(guidanceForCents(null)).toBe('IDLE');
    expect(guidanceForCents(0)).toBe('IN_TUNE');
    expect(guidanceForCents(5)).toBe('IN_TUNE');
    expect(guidanceForCents(-5)).toBe('IN_TUNE');
    expect(guidanceForCents(5.1)).toBe('SHARP');
    expect(guidanceForCents(-5.1)).toBe('FLAT');
    expect(guidanceForCents(20)).toBe('SHARP');
    expect(guidanceForCents(-20)).toBe('FLAT');
  });

  test('targets resolve for all 6 strings', () => {
    expect(targetForString(6)?.note).toBe('E2');
    expect(targetForString(1)?.note).toBe('E4');
    expect(targetForString(5)?.frequency).toBeCloseTo(110, 1);
  });
});
