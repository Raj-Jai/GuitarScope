import { describe, expect, test } from 'vitest';
import { hpss, istft, stft } from '../lib/dsp/hpss';
import { harmonicTone, sineTone } from '../lib/dsp/synth';

const SR = 48000;

function energy(sig: Float32Array): number {
  let s = 0;
  for (let i = 0; i < sig.length; i++) s += sig[i] * sig[i];
  return s;
}

describe('STFT/ISTFT round-trip', () => {
  test('sine reconstructs with tiny error', () => {
    const sig = sineTone(440, { sampleRate: SR, duration: 0.5 });
    const back = istft(stft(sig));
    let err = 0;
    for (let i = 2048; i < sig.length - 2048; i++) {
      const d = back[i] - sig[i];
      err += d * d;
    }
    const rel = err / energy(sig);
    expect(rel).toBeLessThan(1e-4);
  });
});

describe('HPSS separation', () => {
  test('sustained tone stays harmonic, clicks go percussive', () => {
    const tone = harmonicTone(220, { sampleRate: SR, duration: 1.0, amplitude: 0.6 });
    // Percussive clicks: short loud impulses every 0.25s.
    const mix = new Float32Array(tone);
    for (let n = 0; n < 4; n++) {
      const at = Math.floor(SR * (0.125 + n * 0.25));
      for (let i = 0; i < 64 && at + i < mix.length; i++) {
        mix[at + i] += (i % 2 === 0 ? 1 : -1) * 0.5 * (1 - i / 64);
      }
    }
    const { harmonic, percussive } = hpss(mix);
    // Harmonic output correlates strongly with the pure tone.
    let dot = 0;
    let nt = 0;
    let nh = 0;
    for (let i = 4096; i < tone.length - 4096; i++) {
      dot += harmonic[i] * tone[i];
      nt += tone[i] * tone[i];
      nh += harmonic[i] * harmonic[i];
    }
    const corr = dot / Math.sqrt(nt * nh);
    expect(corr).toBeGreaterThan(0.9);
    // Percussive output carries click energy but little sustained tone.
    expect(energy(percussive)).toBeGreaterThan(0.01 * energy(mix));
    // Energy conservation (soft masks partition unity).
    expect(Math.abs(energy(harmonic) + energy(percussive) - energy(mix)) / energy(mix)).toBeLessThan(0.15);
  });

  test('vibrato vocal-like tone stays harmonic (documents HPSS limit)', () => {
    // Sustained pitched signal with vibrato = what voice looks like to HPSS.
    // (Proper FM via integrated phase — naive sin(2πf(t)t) has artifacts.)
    const len = Math.floor(SR * 1.0);
    const vocal = new Float32Array(len);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const f = 330 * Math.pow(2, (0.4 * Math.sin(2 * Math.PI * 5.5 * t)) / 12);
      phase += (2 * Math.PI * f) / SR;
      vocal[i] = 0.5 * Math.sin(phase);
    }
    const { harmonic } = hpss(vocal);
    let dot = 0;
    let nv = 0;
    let nh = 0;
    for (let i = 4096; i < len - 4096; i++) {
      dot += harmonic[i] * vocal[i];
      nv += vocal[i] * vocal[i];
      nh += harmonic[i] * harmonic[i];
    }
    // Voice-like harmonic content REMAINS harmonic: HPSS is not vocal removal.
    expect(dot / Math.sqrt(nv * nh)).toBeGreaterThan(0.85);
  });
});
