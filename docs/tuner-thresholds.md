# Tuner thresholds (user-facing contract)

Single source of truth: `classifyTuning` in
`src/lib/analysis/string-tracker.ts`. Every user-facing surface (panel class,
guidance line, string-strip cell, meter) derives from it, so the label,
guidance, color, and needle can never disagree.

## User-facing bands (cents vs active open-string target)

| Band | Range | Label | Guidance line | Panel / note color |
|---|---|---|---|---|
| PERFECT | \|c\| ≤ 3 | ✓ PERFECT | `✓ PERFECT +0.0¢` | green (`in-tune`) |
| IN_TUNE | 3 < \|c\| ≤ 5 | ✓ IN TUNE | `✓ IN TUNE −5.0¢` | green (`in-tune`) |
| SLIGHTLY_FLAT | −15 ≤ c < −5 | ↑ TUNE UP · Slightly flat | `↑ TUNE UP −8.0¢` + sub | amber (`close`) |
| SLIGHTLY_SHARP | +5 < c ≤ +15 | ↓ TUNE DOWN · Slightly sharp | `↓ TUNE DOWN +8.0¢` + sub | amber (`close`) |
| FLAT | c < −15 | ↑ TUNE UP | `↑ TUNE UP −30.0¢` | red/amber (`off`) |
| SHARP | c > +15 | ↓ TUNE DOWN | `↓ TUNE DOWN +30.0¢` | red/amber (`off`) |
| IDLE | null / NaN | — | hidden | idle |

Exact-boundary rule: the inner band wins (`3.0` → PERFECT, `5.0` → IN_TUNE,
`15.0` → SLIGHTLY_*, `-5.0` → IN_TUNE).

## Machine guidance (unchanged, compatible)

`guidanceForCents` still returns coarse `FLAT | IN_TUNE | SHARP | IDLE` for the
tracker state. Compatibility invariant (unit-tested):

- `classifyTuning` ∈ {PERFECT, IN_TUNE} ⟺ `guidanceForCents` = IN_TUNE
- `classifyTuning` ∈ {SLIGHTLY_FLAT, FLAT} ⟺ `guidanceForCents` = FLAT
- `classifyTuning` ∈ {SLIGHTLY_SHARP, SHARP} ⟺ `guidanceForCents` = SHARP

(`pitch-detector`'s `tuningVerdict` CLOSE band is a DSP-level detail and is
never shown directly; the UI only renders `classifyTuning`.)

## String acquisition / hold (unchanged)

| Parameter | Value | Meaning |
|---|---|---|
| `ACQUIRE_CENTS` | 35 | latch a string after 2 consecutive frames ≤ 35¢ + conf ≥ 0.60 |
| open-string tolerance (`identifyString`) | 40 | `openString=true` within ±40¢ |
| `RELEASE_CENTS` | 55 | frames beyond ±55¢ are unusable; 35–55 gap = hysteresis |
| `SWITCH_MARGIN_CENTS` | 15 | challenger must be ≥15¢ closer for 2 frames to steal latch |
| `HOLD_MS` | 600 | keep showing (dimmed, `held`) up to 600 ms across dropouts |
| `MIN_CONFIDENCE` | 0.60 | below this, frames never acquire or update |
| Needle clamp | ±50 | meter maps ±50¢ to 0–100%; in-tune zone 45–55% = ±5¢ |

## String-claim wording (tuner-sub line)

- `open-match` (open string, \|cents\| ≤ 15): `5th string • A2`
- `near-open` (open string, 15 < \|cents\| ≤ 40): shown secondary (see Phase 2)
- `nearest` (not an open string): `Nearest: 5th string`

## Low-confidence / dropout behavior (P2-8, verified by tests)

- Frames below `MIN_CONFIDENCE` (0.60), LOW_SIGNAL, TRANSIENT, or NO_SIGNAL
  never acquire and never update the display: the UI cannot show an
  authoritative PERFECT/IN TUNE for them.
- Within `HOLD_MS` (600 ms) of the last valid frame, the panel keeps showing
  the last value dimmed (`tuner-held`, `(held)` marker) instead of flashing.
- After the hold expires the panel goes idle (`No signal`, `Signal too
  quiet`, `Low confidence — pluck one open string`) with no guidance badge
  and no needle marker.
- Pick-attack transients: the first frames do not latch (2-frame rule), and
  the latch, once acquired, is the correct string — no wrong-string flash.
- Confidence/hysteresis decisions live in the tracker/DSP layer, never in
  `TunerPanel`, which purely renders `classifyTuning` + tracker state.

## Layout stability contract (flicker-free shells)

The tuner deliberately reserves the maximum readout/badge footprint.
State changes may alter content visibility, but must never alter panel
height or the vertical position of the meter.

`TunerPanel` renders fixed shells — `.tuner-readout` (note/target/status/guidance zones)
and `.tuner-badge-zone` — that always exist; only their contents swap via
conditional content, never mount/unmount geometry. No height/margin/padding
animation anywhere in the tuner.

- Desktop: panel 573.5px, meter Y constant in all 14 states (not 523.5:
  far states need status+guidance simultaneously and the badge reserves
  space — shrinking to 523.5 would require cutting content).
- ≤560px: two-line guidance zone + single-column cards (taller but constant
  within mobile).
- Regression: `tuner-boundaries.test.tsx` asserts shells always render and
  content stays conditional; the Playwright flicker probe asserts
  max−min panel height and meter Y ≤ 1px across all states.
