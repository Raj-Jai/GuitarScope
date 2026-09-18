import { describe, expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadWavMono, resampleLinear } from '../../analyzer/wav';
import { analyzeFrames } from '../../analyzer/frames';
import { chordTone, harmonicTone } from '../lib/dsp/synth';

const SR = 48000;

/** Write a float mono buffer as 16-bit PCM WAV for loader round-trips. */
function writeTestWav(path: string, samples: Float32Array, sampleRate = SR, channels = 1): void {
  const pcm = new Int16Array(samples.length * channels);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    for (let c = 0; c < channels; c++) pcm[i * channels + c] = v * 32767;
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length * 2, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length * 2, 40);
  writeFileSync(path, Buffer.concat([header, Buffer.from(pcm.buffer)]));
}

describe('WAV loader', () => {
  test('16-bit mono round-trip preserves samples', () => {
    const sig = harmonicTone(110, { sampleRate: SR, duration: 0.5 });
    writeTestWav('/tmp/t-wav-mono.wav', sig);
    const loaded = loadWavMono('/tmp/t-wav-mono.wav', SR);
    expect(loaded.sampleRate).toBe(SR);
    expect(loaded.samples.length).toBe(sig.length);
    // 16-bit quantization tolerance.
    expect(Math.abs(loaded.samples[1000] - sig[1000])).toBeLessThan(1 / 32768 + 1e-9);
  });

  test('stereo downmixes to mono', () => {
    const sig = harmonicTone(110, { sampleRate: SR, duration: 0.2 });
    writeTestWav('/tmp/t-wav-stereo.wav', sig, SR, 2);
    const loaded = loadWavMono('/tmp/t-wav-stereo.wav', SR);
    expect(loaded.samples.length).toBe(sig.length);
  });

  test('44.1k resamples to 48k', () => {
    const sig = harmonicTone(110, { sampleRate: 44100, duration: 0.5 });
    writeTestWav('/tmp/t-wav-441.wav', sig, 44100);
    const loaded = loadWavMono('/tmp/t-wav-441.wav', SR);
    expect(loaded.sampleRate).toBe(SR);
    expect(loaded.samples.length).toBe(Math.floor(sig.length * (48000 / 44100)));
  });

  test('garbage file throws', () => {
    writeFileSync('/tmp/t-wav-bad.wav', Buffer.from([1, 2, 3]));
    expect(() => loadWavMono('/tmp/t-wav-bad.wav')).toThrow();
  });

  test('resampleLinear identity and 2x', () => {
    const s = new Float32Array([0, 1, 0, -1]);
    expect(resampleLinear(s, SR, SR)).toBe(s);
    const up = resampleLinear(new Float32Array([0, 2]), 1, 2);
    expect(up.length).toBe(4);
    expect(up[1]).toBeCloseTo(1, 9);
  });
});

describe('frame engine', () => {
  test('frame count and timestamps for 2s audio', () => {
    const sig = harmonicTone(110, { sampleRate: SR, duration: 2.0 });
    const r = analyzeFrames(sig, { sampleRate: SR });
    const expected = Math.floor((sig.length - 16384) / 4096) + 1;
    expect(r.frameCount).toBe(expected);
    expect(r.frames[0].time).toBeCloseTo(16384 / 2 / SR, 9);
    const hop = r.frames[1].time - r.frames[0].time;
    expect(hop).toBeCloseTo(4096 / SR, 9);
  });

  test('sustained A-major frames vote A on top', () => {
    const sig = chordTone([110, 138.5913, 164.8138], { sampleRate: SR, duration: 2.0 });
    const r = analyzeFrames(sig, { sampleRate: SR });
    const topA = r.frames.filter((f) => f.candidates[0]?.label === 'A').length;
    expect(topA / r.frames.length).toBeGreaterThan(0.8);
  });

  test('silence frames carry no credible candidate', () => {
    const sig = new Float32Array(SR); // 1s silence
    const r = analyzeFrames(sig, { sampleRate: SR });
    expect(r.frameCount).toBeGreaterThan(0);
    // Scores on silence must be weak (no confident false chord).
    const maxScore = Math.max(...r.frames.flatMap((f) => f.candidates.map((c) => c.score)));
    expect(maxScore).toBeLessThan(0.6);
  });
});
