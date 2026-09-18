# ADR-001: DSP + Application Architecture

Date: 2026-09-18
Status: accepted (reviewed by ChatGPT Supervisor, iteration 1)

## Decision

Browser-first real-time guitar tuner + chord detector:

```
Mic → MediaStreamAudioSourceNode → AudioWorkletNode (capture + framing)
  → DSP Worker (preprocessing, YIN, FFT, HPS validation, chroma, chords)
  → Main/UI thread (React presentation only)
```

## Pitch strategy

- **YIN is the primary monophonic F0 estimator.** Spectral/HPS data answers
  "does this candidate have the expected harmonic structure?" and
  "is there evidence of an octave error?" — HPS is NOT averaged with YIN
  as an independent detector (HPS is known to produce octave errors).
- Chord detection is a **separate polyphonic pipeline**:
  STFT → spectral energy → chroma/pitch-class vector → temporal smoothing
  → chord-template matching. YIN is never run on chords.

## Frame parameters @48kHz

- YIN frame: 2048 (42.7ms, low latency) or 4096 (85.3ms, stable low-E)
- STFT/FFT: 4096 (11.7Hz bin spacing; parabolic interpolation refines peaks)
- Hop: 512–1024 → ~10–30 detections/sec
- Never hard-code AudioWorklet render quantum (commonly 128, spec may change).
- Worklet → Worker transport: transferred Float32Array frames (no SharedArrayBuffer for MVP).

## Module layout (pure functions separated from browser code)

- `src/lib/dsp/` — yin, fft, hps, spectral-peaks, chroma, filters, windowing
- `src/lib/pitch/` — detector, candidate, confidence, octave-correction
- `src/lib/notes/` — frequency↔midi, note-name, cents
- `src/lib/guitar/` — tuning, strings, fretboard
- `src/lib/chords/` — definitions, templates, matcher, confidence
- `src/lib/analysis/` — monophonic, polyphonic, temporal-smoothing, signal-quality
- `src/lib/audio/` — microphone, audio-worklet, frame-buffer (browser only)
- `src/workers/dsp-worker.ts` — worker wiring
- `src/components/` — Tuner, NoteDisplay, ChordDisplay, Spectrum, Waveform, GuitarDiagram

`dsp/`, `pitch/`, `notes/`, `chords/` are pure and Vitest-testable in Node
with synthetic signals — no browser or microphone required.

## Detection states

NO_SIGNAL, LOW_SIGNAL, TRANSIENT, STABLE_NOTE, POLYPHONIC, UNCERTAIN.

Separate instantaneous detection from displayed detection:
raw pitch → candidate filtering → confidence → temporal smoothing → display.

Octave-error candidates are explicitly tracked (e.g. OCTAVE_UP_CANDIDATE),
not silently discarded, to aid debugging.

## Amendment 2026-09-18: chord window must be 16384

Evidence: with FFT 4096 @48kHz (bin 11.7 Hz), low triads
(E2/G#2/B2 = FFT bins 7.0/8.9/10.5) merge inside one Hann main lobe
(4 bins wide). Parabolic interpolation of merged lobes reported phantom
frequencies (e.g. 108.5 Hz instead of G#2 103.8 Hz), cascading into
wrong pitch classes and misclassifications (E→Amaj7, Am→Cmaj7).

Fix: polyphonic path uses a 16384-sample window (341 ms @48kHz, 2.9 Hz
bins) so low chord tones sit 6–7 bins apart and resolve. Monophonic YIN
path stays at 4096 for low latency. 8/8 synthetic triads now recognized;
single notes report MONOPHONIC, never a chord. Longer chord smearing is
acceptable (strummed chords sustain for seconds) and is documented in
the UI latency readout.

## Amendment 2026-09-18: ring buffer must not use a monotonic offset

Incident: the chord ring used an ever-growing sample counter as the
`copyWithin` offset. Once total samples exceeded 2× the window (~0.7 s),
the offset exceeded the buffer length, `copyWithin` became a silent no-op,
and the ring froze to [ancient prefix | latest frame]. Chords then read
MONOPHONIC forever in any session longer than a second — while all
short-horizon unit tests still passed.

Fix: track only `valid = min(total, window)` and shift by
`valid - keep`. Regression test feeds 3 s of A major then 3 s of E major
and asserts late runs report E. Lesson: DSP tests must include
long-run/transition sequences, not just steady-state slices.
