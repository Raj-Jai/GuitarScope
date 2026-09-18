/**
 * Worklet artifact test: evaluates the EXACT file shipped to the browser
 * (src/worklets/capture-processor.js) with stubbed AudioWorklet globals
 * and drives process() with synthetic blocks.
 */
import { describe, expect, test } from 'vitest';
import processorSource from '../worklets/capture-processor.js?raw';

interface PostedMsg {
  msg: { type: string; seq: number; capturePerf: number; samples: Float32Array };
  transfer: unknown[];
}

function loadProcessor() {
  const posted: PostedMsg[] = [];
  let handler: ((event: { data: unknown }) => void) | null = null;
  class FakeProcessor {
    port = {
      postMessage: (msg: PostedMsg['msg'], transfer: unknown[]) => {
        posted.push({ msg, transfer });
      },
      set onmessage(h: (event: { data: unknown }) => void) {
        handler = h;
      },
    };
  }
  const factory = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'currentTime',
    `${processorSource}\nreturn CaptureProcessor;`,
  ) as (
    base: unknown,
    reg: (name: string, ctor: unknown) => void,
    now: number,
  ) => new (options?: unknown) => {
    process(inputs: Float32Array[][]): boolean;
  };
  let registered = '';
  const Ctor = factory(FakeProcessor, (name: string) => {
    registered = name;
  }, 0);
  return {
    posted,
    registered,
    sendToPort: (data: unknown) => handler?.({ data }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (options?: unknown) => new Ctor(options as any),
  };
}

describe('shipped capture processor', () => {
  test('registers as guitar-capture', () => {
    expect(loadProcessor().registered).toBe('guitar-capture');
  });

  test('silent until start; then emits 4096-frames from 128-blocks', () => {
    const t = loadProcessor();
    const proc = t.create({ processorOptions: { frameSize: 4096 } });
    // Not started: nothing posted.
    proc.process([[new Float32Array(128).fill(0.5)]]);
    expect(t.posted).toHaveLength(0);
    t.sendToPort({ type: 'start' });
    for (let i = 0; i < 31; i++) proc.process([[new Float32Array(128).fill(0.5)]]);
    expect(t.posted).toHaveLength(0);
    proc.process([[new Float32Array(128).fill(0.5)]]);
    expect(t.posted).toHaveLength(1);
    const [{ msg, transfer }] = t.posted;
    expect(msg.type).toBe('frame');
    expect(msg.seq).toBe(0);
    expect(msg.samples).toHaveLength(4096);
    expect(msg.samples[0]).toBe(0.5);
    expect(transfer).toHaveLength(1); // transferred, not copied
    expect(msg.capturePerf).toBeGreaterThanOrEqual(0);
  });

  test('arbitrary block sizes (100) assemble exactly, order preserved', () => {
    const t = loadProcessor();
    const proc = t.create({ processorOptions: { frameSize: 64 } });
    t.sendToPort({ type: 'start' });
    let n = 0;
    for (let b = 0; b < 7; b++) {
      const block = new Float32Array(100);
      for (let i = 0; i < 100; i++) block[i] = n++;
      proc.process([[block]]);
    }
    // 700 samples @64 = 10 frames + 60 pending.
    expect(t.posted).toHaveLength(10);
    expect(t.posted[0].msg.samples[0]).toBe(0);
    expect(t.posted[9].msg.samples[0]).toBe(9 * 64);
    expect(t.posted.map((p) => p.msg.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('stereo input is mixed to mono', () => {
    const t = loadProcessor();
    const proc = t.create({ processorOptions: { frameSize: 4 } });
    t.sendToPort({ type: 'start' });
    proc.process([[new Float32Array(4).fill(1), new Float32Array(4).fill(-1)]]);
    expect(t.posted).toHaveLength(1);
    expect(Array.from(t.posted[0].msg.samples)).toEqual([0, 0, 0, 0]);
  });

  test('stop halts emission and clears partial state', () => {
    const t = loadProcessor();
    const proc = t.create({ processorOptions: { frameSize: 64 } });
    t.sendToPort({ type: 'start' });
    proc.process([[new Float32Array(32).fill(1)]]);
    t.sendToPort({ type: 'stop' });
    proc.process([[new Float32Array(128).fill(1)]]);
    expect(t.posted).toHaveLength(0);
  });
});
