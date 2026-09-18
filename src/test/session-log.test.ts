import { describe, expect, test } from 'vitest';
import { SessionLog } from '../lib/analysis/session-log';

describe('SessionLog', () => {
  test('records pitch/chord/stats/marker events with timestamps', () => {
    const log = new SessionLog();
    log.begin();
    log.logPitch({ note: 'E2', frequency: 82.41, cents: 1.2, confidence: 0.95, status: 'NOTE_DETECTED' }, 100);
    log.logChord({ name: 'A', confidence: 0.77, status: 'CHORD_DETECTED' }, 500);
    log.logStats({ queueDepth: 0, droppedFrames: 0, pitchMs: 4, chordMs: 1.2, e2eMs: 5 }, 2000);
    log.marker('start strumming', 2100);
    expect(log.length).toBe(4);
    const json = log.toJSON();
    expect(json.eventCount).toBe(4);
    expect(json.events[0]).toMatchObject({ t: 100, kind: 'pitch' });
    expect(json.events[1].data).toMatchObject({ name: 'A' });
    expect(json.events[3]).toMatchObject({ kind: 'marker' });
    expect(typeof json.startedWall).toBe('string');
  });

  test('bounded ring drops oldest beyond capacity', () => {
    const log = new SessionLog(3);
    for (let i = 0; i < 5; i++) log.marker(`m${i}`, i);
    expect(log.length).toBe(3);
    expect(log.toJSON().events[0].data).toMatchObject({ label: 'm2' });
  });

  test('begin() resets', () => {
    const log = new SessionLog();
    log.logPitch({ note: 'E2', frequency: 82, cents: 0, confidence: 1, status: 'NOTE_DETECTED' }, 0);
    log.begin();
    expect(log.length).toBe(0);
  });
});
