import { describe, expect, test } from 'vitest';
import { encodeWavBlob } from '../lib/audio/wav-encode';
import { fingeringFor } from '../lib/chords/fingerings';
import { transposeChordLabel, transposeNoteName } from '../lib/chords/transpose';
import { extractVideoId } from '../lib/song/youtube';

describe('encodeWavBlob', () => {
  test('produces a parseable WAV header', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWavBlob(samples, 48000);
    expect(blob.type).toBe('audio/wav');
    const buf = new DataView(await blob.arrayBuffer());
    const str = (off: number, n: number): string => {
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(buf.getUint8(off + i));
      return s;
    };
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(buf.getUint32(24, true)).toBe(48000);
    expect(buf.getUint16(22, true)).toBe(1);
    expect(buf.getInt16(44, true)).toBe(0);
    expect(buf.getInt16(46, true)).toBe(Math.floor(0.5 * 32767));
  });
});

describe('fingerings', () => {
  test('known shapes resolve, unknown return null (no invention)', () => {
    expect(fingeringFor('E')).toEqual([0, 2, 2, 1, 0, 0]);
    expect(fingeringFor('Am')).toEqual([-1, 0, 2, 2, 1, 0]);
    expect(fingeringFor('F#m7')).toBeNull();
    expect(fingeringFor('NO_CHORD')).toBeNull();
  });
});

describe('transposeChordLabel', () => {
  test('basic transpositions (sharp spelling)', () => {
    expect(transposeChordLabel('C', 2)).toBe('D');
    expect(transposeChordLabel('Am', 2)).toBe('Bm');
    expect(transposeChordLabel('G7', -2)).toBe('F7');
    expect(transposeChordLabel('F#m7', 1)).toBe('Gm7');
    expect(transposeChordLabel('B', 1)).toBe('C');
  });
  test('passthrough', () => {
    expect(transposeChordLabel('NO_CHORD', 5)).toBe('NO_CHORD');
    expect(transposeChordLabel('Em', 0)).toBe('Em');
    expect(transposeChordLabel('Em', 12)).toBe('Em');
  });
});

describe('transposeNoteName', () => {
  test('MIDI shift', () => {
    expect(transposeNoteName(60, 2)).toBe('D4');
    expect(transposeNoteName(69, -12)).toBe('A3');
  });
});

describe('extractVideoId', () => {
  test('watch/embed/shorts/short links', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=hwZNL7QVJjE')).toBe('hwZNL7QVJjE');
    expect(extractVideoId('https://youtu.be/hwZNL7QVJjE')).toBe('hwZNL7QVJjE');
    expect(extractVideoId('https://www.youtube.com/embed/hwZNL7QVJjE')).toBe('hwZNL7QVJjE');
    expect(extractVideoId('https://www.youtube.com/shorts/hwZNL7QVJjE')).toBe('hwZNL7QVJjE');
    expect(extractVideoId('not a url')).toBeNull();
  });
});
