# GuitarScope — real-time browser guitar tuner, note & chord detector

Listens to guitar audio through the microphone and identifies notes, tuning,
strings, and chords — entirely in the browser, no backend.

## Run it

```bash
cd app
npm install
npm run dev      # open the printed localhost URL, allow the microphone
npm test         # 129 unit/integration tests (DSP + browser layer)
npm run build    # production build (tsc + vite)
```

No microphone? Click **Play demo signal** — synthetic open strings and chords
run through the real DSP Worker path.

## Phone / LAN testing (microphone needs HTTPS)

Phone browsers treat `http://<laptop-ip>` as an **insecure context**, so
`navigator.mediaDevices` is undefined and the app reports
“Microphone needs HTTPS” instead of starting. Fix:

```bash
npm run dev:https   # or: npm run dev:lan  (HTTPS on port 5199, LAN-visible)
```

Then open `https://<laptop-ip>:5199` on the phone (the URL is printed on
server start) and accept the self-signed certificate warning. If the
certificate warning blocks you, alternatives in order: `mkcert` trusted
local cert, then an HTTPS tunnel.

## Architecture

```
Mic → MediaStream → AudioWorklet (framing only, any block size)
  → main thread (transfer Float32Array) → DSP Worker → React UI
```

- **AudioWorklet** (`src/worklets/capture-processor.js`): mono mixdown,
  4096-sample frame assembly, transferable posts. No DSP. The shipped file
  is tested directly with stubbed worklet globals.
- **DSP Worker** (`src/workers/dsp-worker.ts`): thin glue around `DspEngine`
  with a latest-wins queue (capacity 2, drops counted — newer audio wins).
- **Pitch path**: 4096-sample frames (~85 ms @48 kHz) → YIN primary +
  HPS harmonic validation/octave guard → note/string/cents/confidence.
- **Chord path**: continuous 16384-sample ring (~341 ms @48 kHz) →
  peak-based multi-pitch with harmonic subtraction → chroma → template
  matching. Cadence configurable (2/4/8 Hz, default 4 Hz).
- **UI**: tuner needle uses median + EMA smoothed cents with instant reset
  on note change; note/chord labels use majority-vote stabilization.
  Waveform/spectrum canvases draw from AnalyserNode (mic) or the demo frame.

DSP methodology and the 16384-window rationale: `docs/ADR-001-dsp-architecture.md`.

## Measured results (synthetic guitar-like signals, desktop)

| Suite | Result |
|---|---|
| Mono open strings E2–E4 (clean + noisy + weak-fundamental E2) | 13/13, 0 octave errors |
| Chords incl. C7/Cmaj7/Cm7/A7/Am7 | 17/17 |
| Full suite | 129/129, `tsc` clean, build passes |
| Pitch DSP | ~4–6 ms/frame (4096) |
| Chord DSP | ~1–3 ms/frame (16384) |
| Live worker turnaround (headless Chrome) | ~3–6 ms, 12 results/s, queue 0, drops 0 |
| End-to-end capture→UI (steady state) | ~4–6 ms + 85 ms frame fill |
| Strum→stable chord display | ~0.3–1.0 s (341 ms window + 4 Hz cadence + label stabilization) |

Browser validation: headless Chrome with file-backed fake microphone —
all 6 open strings + A/E/C chords detected through the real
AudioContext→Worklet→Worker→UI path, 0 console errors. Screenshots in milestone logs.

## Manual microphone checklist (real guitar, not yet done here)

Play each open string (E A D G B E), check note + string + cents needle;
sustained vs softly-picked notes; muted strings; silence (must show No
signal, never a phantom note); background noise/speech; major, minor and
7th chords; fast strumming; rapid note changes. Try 8 Hz chord rate and
watch queue/dropped counters stay near zero.

## Known limitations

- Chord recognition uses template matching on harmonic-subtracted chroma:
  accurate on triads/7ths in tests, but dense voicings, heavy distortion,
  and detuned instruments degrade it. No ML model (by design, so far).
- Chord display latency (~0.3–1 s) is inherent to the 16384 window +
  stabilization; the tuner path stays at ~85 ms + processing.
- Brief transition artifacts possible when jumping between items
  (e.g. a fleeting wrong chord in the first ~300 ms after a change).
- No on-device mobile test yet (no device attached; `adb` present but
  empty). Layout is responsive and was checked at 390 px width.
- Tuner string identification is nearest-open-string based; fretted notes
  show the closest string, not true fingering.
