# Song analyzer (offline)

Analyzes full songs into time-aligned chords + notes (`analysis.json`),
consumed by the Song Lab tutorial UI. Separate from the real-time tuner
pipeline by design: songs are processed in batches, not streamed.

## Quick start

```bash
# 1. Get audio (48k mono WAV; ffmpeg standardizes anything)
ffmpeg -y -i input.mp3 -ar 48000 -ac 2 song48st.wav

# 2. Analyze (raw branch; add --branches multi for vocal-robust mode)
npm run analyze -- --input song48st.wav --output song.analysis.json
npm run analyze -- --input song48st.wav --output song-multi.json --branches multi

# 3. Open the app → Song Lab → Open audio file + Open analysis JSON
#    (or Analyze demo song for the built-in progression)
```

Options: `--top N` (candidates per frame), `--chroma` (embed chroma for
debugging), `--branches raw|multi`.

## YouTube fixtures (local testing only)

The public app never downloads from YouTube (ToS). For local validation
fixtures where the network permits:

```bash
yt-dlp -x --audio-format wav -o "test-audio/<name>.%(ext)s" "<youtube-url>"
ffmpeg -y -i test-audio/<name>.wav -ar 48000 -ac 2 test-audio/<name>48st.wav
```

Never commit recordings: `test-audio/`, `*.wav`, `*.analysis.json` are
gitignored. This environment blocks YouTube media downloads (HTTP 403),
so pop-with-vocals validation currently runs on synthetic band fixtures
(vocal + clicks + panned guitar) — see `src/test/song-branches.test.ts`.

## Reference annotations (ground truth)

Chord reference (`<start> <end> <label>` per line, `#` comments allowed):

```
0.000 4.112  G
4.112 8.251  D
```

Note reference (`<onset> <duration> <midi>` per line):

```
12.440 0.532  64
```

Parsers: `analyzer/reference.ts`. Scorers: `analyzer/score.ts`
(duration-weighted accuracy, root/quality/triad, boundary error) and
`analyzer/note-score.ts` (onset precision/recall ±100 ms + pitch).

## Measured validation status

| Case | Result |
|---|---|
| Synthetic G–D–Am–C progression, decoded vs chart | weighted > 0.95, boundaries ±0.2 s |
| Contaminated band (vocal + clicks): raw → agreed | 0.62 → 0.87 acc, 22 → 8 flips |
| Spanish Romance (real solo guitar, tuned +2): coherence | F#m/C#/C#7 tonic–dominant structure, 31 events |
| Etude (exact truth): clean arpeggio/dyad/sustain | ~1.0; overlapping bass+melody F1 = 0.64 (recorded limit) |
| Throughput (raw branch) | ~70–80× realtime DSP |
| Throughput (multi branch incl. HPSS) | ~3× realtime DSP |

Known limits: template chord scope; overlapping-note octave-downs and
group phantoms in dense fingerstyle; vocal passing tones can still win
single frames (decoder + agreement absorb most); exact boundaries are
inherently fuzzy (±0.2–0.5 s typical).
