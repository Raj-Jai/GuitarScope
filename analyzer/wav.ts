/**
 * Minimal WAV reader (Node): PCM 8/16/24/32-bit int + 32-bit float,
 * any channel count. `loadWavMono` averages to mono; `loadWavStereo`
 * keeps channels (mono files yield null left/right). No dependencies.
 */
import { readFileSync } from 'node:fs';
import { resampleLinear } from '../src/lib/dsp/resample';

export { resampleLinear };

export interface LoadedAudio {
  samples: Float32Array; // mono
  sampleRate: number;
}

export interface StereoAudio {
  left: Float32Array | null;
  right: Float32Array | null;
  mono: Float32Array;
  sampleRate: number;
  stereo: boolean;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

/** (Moved to src/lib/dsp/resample.ts; re-exported above for compatibility.) */

interface WavHeader {
  view: DataView;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  format: number;
  dataOffset: number;
  dataLength: number;
}

function parseHeader(path: string): { bytes: Buffer; header: WavHeader } {
  const bytes = readFileSync(path);
  if (bytes.length < 44) throw new Error(`not a WAV file (too small): ${path}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error(`not a WAV file: ${path}`);
  }
  const header: WavHeader = {
    view,
    channels: 0,
    sampleRate: 0,
    bitsPerSample: 0,
    format: 0,
    dataOffset: -1,
    dataLength: 0,
  };
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      header.format = view.getUint16(offset + 8, true);
      header.channels = view.getUint16(offset + 10, true);
      header.sampleRate = view.getUint32(offset + 12, true);
      header.bitsPerSample = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      header.dataOffset = offset + 8;
      header.dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (header.dataOffset < 0) throw new Error(`WAV has no data chunk: ${path}`);
  if (header.channels <= 0) throw new Error(`WAV has no channels: ${path}`);
  return { bytes, header };
}

function readChannel(h: WavHeader, channel: number, path: string): Float32Array {
  const { view, channels, bitsPerSample, format, dataOffset, dataLength } = h;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * channels));
  const out = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const at = dataOffset + (i * channels + channel) * bytesPerSample;
    if (format === 3 && bitsPerSample === 32) {
      out[i] = view.getFloat32(at, true);
    } else if (bitsPerSample === 16) {
      out[i] = view.getInt16(at, true) / 32768;
    } else if (bitsPerSample === 24) {
      const b0 = view.getUint8(at);
      const b1 = view.getUint8(at + 1);
      const b2 = view.getInt8(at + 2);
      out[i] = (b2 * 65536 + b1 * 256 + b0) / 8388608;
    } else if (bitsPerSample === 32) {
      out[i] = view.getInt32(at, true) / 2147483648;
    } else if (bitsPerSample === 8) {
      out[i] = (view.getUint8(at) - 128) / 128;
    } else {
      throw new Error(`unsupported WAV format (fmt=${format}, ${bitsPerSample}-bit): ${path}`);
    }
  }
  return out;
}

export function loadWavStereo(path: string, targetRate = 48000): StereoAudio {
  const { header } = parseHeader(path);
  const ch0 = resampleLinear(readChannel(header, 0, path), header.sampleRate, targetRate);
  let left: Float32Array | null = null;
  let right: Float32Array | null = null;
  let mono: Float32Array;
  if (header.channels >= 2) {
    const ch1 = resampleLinear(readChannel(header, 1, path), header.sampleRate, targetRate);
    const n = Math.min(ch0.length, ch1.length);
    left = ch0.slice(0, n);
    right = ch1.slice(0, n);
    mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = (left[i] + right[i]) / 2;
  } else {
    mono = ch0;
  }
  return { left, right, mono, sampleRate: targetRate, stereo: header.channels >= 2 };
}

export function loadWavMono(path: string, targetRate = 48000): LoadedAudio {
  const st = loadWavStereo(path, targetRate);
  return { samples: st.mono, sampleRate: st.sampleRate };
}
