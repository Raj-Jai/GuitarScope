import { describe, expect, test } from 'vitest';
import { FrameAssembler, toMono } from '../lib/audio/frame-assembler';

function block(len: number, value: number): Float32Array {
  return new Float32Array(len).fill(value);
}

describe('FrameAssembler', () => {
  test('assembles exact frames from 128-sample quanta', () => {
    const asm = new FrameAssembler(4096);
    let frames: Float32Array[] = [];
    for (let i = 0; i < 32; i++) frames = frames.concat(asm.push(block(128, 0.5)));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(4096);
    expect(frames[0][0]).toBe(0.5);
    expect(asm.pending).toBe(0);
  });

  test('handles odd block sizes (137) without losing samples', () => {
    const asm = new FrameAssembler(4096);
    const total = 4096 * 3 + 100;
    let produced = 0;
    let samples = 0;
    let n = 0;
    while (samples < total) {
      const len = Math.min(137, total - samples);
      const b = block(len, 1);
      for (let i = 0; i < len; i++) b[i] = n++;
      const frames = asm.push(b);
      produced += frames.length;
      for (const f of frames) {
        // Order preserved: first sample of first frame is 0.
        expect(f[0]).toBe((produced - frames.length + frames.indexOf(f)) * 4096);
      }
      samples += len;
    }
    expect(produced).toBe(3);
    expect(asm.pending).toBe(100);
  });

  test('single oversized block yields multiple frames', () => {
    const asm = new FrameAssembler(1024);
    const frames = asm.push(block(3000, 0.25));
    expect(frames).toHaveLength(2);
    expect(asm.pending).toBe(3000 - 2048);
  });

  test('empty blocks are ignored', () => {
    const asm = new FrameAssembler(64);
    expect(asm.push(new Float32Array(0))).toHaveLength(0);
    expect(asm.pending).toBe(0);
  });

  test('returned frames are independent copies', () => {
    const asm = new FrameAssembler(4);
    const [f] = asm.push(block(4, 1));
    asm.push(block(4, 2));
    expect(f[0]).toBe(1); // not overwritten by later input
  });

  test('reset clears partial buffer', () => {
    const asm = new FrameAssembler(64);
    asm.push(block(10, 1));
    asm.reset();
    expect(asm.pending).toBe(0);
  });
});

describe('toMono', () => {
  test('passthrough single channel', () => {
    const ch = block(8, 0.5);
    expect(toMono([ch])).toBe(ch);
  });
  test('averages stereo', () => {
    const out = toMono([block(4, 1), block(4, -1)]);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });
  test('empty input', () => {
    expect(toMono([])).toHaveLength(0);
  });
});
