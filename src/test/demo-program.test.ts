import { describe, expect, test } from 'vitest';
import { buildDemoBuffers, buildDemoTimeline } from '../lib/audio/demo-program';

describe('buildDemoTimeline', () => {
  test('gapless back-to-back start offsets', () => {
    expect(buildDemoTimeline([1.6, 1.6, 1.8])).toEqual([0, 1.6, 3.2]);
  });
  test('empty program', () => {
    expect(buildDemoTimeline([])).toEqual([]);
  });
  test('total program length matches demo buffers', () => {
    const buffers = buildDemoBuffers(48000);
    const durations = buffers.map((b) => b.length / 48000);
    const starts = buildDemoTimeline(durations);
    expect(starts).toHaveLength(buffers.length);
    // Last item ends where the loop restarts.
    const total = starts[starts.length - 1] + durations[durations.length - 1];
    expect(total).toBeCloseTo(6 * 1.6 + 7 * 1.8, 6);
  });
  test('buffers generated at the requested rate', () => {
    for (const rate of [44100, 48000]) {
      const buffers = buildDemoBuffers(rate);
      expect(buffers.length).toBe(13);
      expect(buffers[0].length).toBe(Math.floor(rate * 1.6));
    }
  });
});
