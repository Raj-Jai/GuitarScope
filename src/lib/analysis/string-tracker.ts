/**
 * StringTracker: GuitarTuna-style active-string latch + per-string smoothing.
 *
 * Separates three regions (cents from open-string target):
 * - acquire (<=35): strong enough to claim "this string was plucked"
 * - open region (<=40): accepted open-string area (matches identifyString tol)
 * - release (>55): too far to be this string at all
 * Gap 35..55 gives hysteresis so adjacent strings don't flicker.
 *
 * Rules (per supervisor spec):
 * - Acquire: |smoothed| <= 35 + conf >= 0.60, 2 consecutive valid frames
 * - Hold: retain active string 600ms after temporary loss
 * - Switch: new string valid 2 frames AND >=15c closer than current
 * - Drop: no valid pitch for >600ms -> idle
 */
import { STANDARD_TUNING } from '../guitar/tuning';
import { TunerSmoother } from './tuner-smoother';

export type StringNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type TuneGuidance = 'FLAT' | 'IN_TUNE' | 'SHARP' | 'IDLE';

export interface TrackerInput {
  stringNumber: StringNumber | null;
  stringCents: number | null;
  confidence: number;
  status: string;
  timestampMs: number;
}

export interface TrackerState {
  activeString: StringNumber | null;
  /** Smoothed cents vs active string target (null when idle). */
  displayCents: number | null;
  targetFrequency: number | null;
  targetNote: string | null;
  guidance: TuneGuidance;
  /** True when showing held (stale) value during 600ms dropout — UI should dim. */
  held: boolean;
}

export const ACQUIRE_CENTS = 35;
export const RELEASE_CENTS = 55;
export const MIN_CONFIDENCE = 0.6;
export const HOLD_MS = 600;
export const SWITCH_MARGIN_CENTS = 15;
export const IN_TUNE_CENTS = 5;
export const PERFECT_CENTS = 3;
/** Outer edge of the "slightly off — still close" user-facing band. */
export const CLOSE_CENTS = 15;

/**
 * Single user-facing tuning classification (P0-1: one vocabulary for the
 * status label, guidance line, string strip, and meter — no CLOSE-vs-SHARP
 * split). Coarse machine guidance (`TuneGuidance`) stays FLAT/IN_TUNE/SHARP:
 * SLIGHTLY_* maps to FLAT/SHARP there, so `guidanceForCents` and
 * `classifyTuning` always agree on direction and on the ±5¢ deadband.
 */
export type TunerState =
  | 'PERFECT'
  | 'IN_TUNE'
  | 'SLIGHTLY_FLAT'
  | 'SLIGHTLY_SHARP'
  | 'FLAT'
  | 'SHARP'
  | 'IDLE';

export function classifyTuning(cents: number | null): TunerState {
  if (cents === null || !Number.isFinite(cents)) return 'IDLE';
  const abs = Math.abs(cents);
  if (abs <= PERFECT_CENTS) return 'PERFECT';
  if (abs <= IN_TUNE_CENTS) return 'IN_TUNE';
  if (abs <= CLOSE_CENTS) return cents < 0 ? 'SLIGHTLY_FLAT' : 'SLIGHTLY_SHARP';
  return cents < 0 ? 'FLAT' : 'SHARP';
}

export function guidanceForCents(cents: number | null): TuneGuidance {
  // Coarse DSP/tracker compatibility API — NOT the UI source of truth.
  // UI classification must use classifyTuning(); the tested invariant is:
  //   PERFECT/IN_TUNE -> IN_TUNE, SLIGHTLY_FLAT/FLAT -> FLAT,
  //   SLIGHTLY_SHARP/SHARP -> SHARP (same deadband, same direction).
  if (cents === null || !Number.isFinite(cents)) return 'IDLE';
  const abs = Math.abs(cents);
  if (abs <= IN_TUNE_CENTS) return 'IN_TUNE';
  return cents < 0 ? 'FLAT' : 'SHARP';
}

export function targetForString(n: StringNumber): { frequency: number; note: string } | null {
  const s = STANDARD_TUNING.find((x) => x.stringNumber === n);
  return s ? { frequency: s.frequency, note: s.note } : null;
}

function isValidStatus(status: string): boolean {
  return status === 'NOTE_DETECTED' || status === 'OCTAVE_CORRECTED';
}

export class StringTracker {
  private smoothers = new Map<StringNumber, TunerSmoother>();
  private activeString: StringNumber | null = null;
  private displayCents: number | null = null;
  private candidateString: StringNumber | null = null;
  private candidateCount = 0;
  private lastValidMs: number | null = null;
  private medianSize: number;
  private emaAlpha: number;

  constructor(medianSize = 5, emaAlpha = 0.25) {
    this.medianSize = medianSize;
    this.emaAlpha = emaAlpha;
  }

  private smootherFor(n: StringNumber): TunerSmoother {
    let s = this.smoothers.get(n);
    if (!s) {
      s = new TunerSmoother(this.medianSize, this.emaAlpha);
      this.smoothers.set(n, s);
    }
    return s;
  }

  push(input: TrackerInput): TrackerState {
    const { stringNumber, stringCents, confidence, status, timestampMs } = input;
    const usable =
      isValidStatus(status) &&
      stringNumber !== null &&
      stringCents !== null &&
      Number.isFinite(stringCents) &&
      confidence >= MIN_CONFIDENCE &&
      Math.abs(stringCents) <= RELEASE_CENTS;

    if (!usable || stringNumber === null || stringCents === null) {
      // Hold active briefly across dropouts (TRANSIENT/NO_SIGNAL/LOW conf);
      // mark held so UI dims stale cents instead of showing them as live.
      // A genuinely stronger new string can still replace held state because
      // any *usable* frame below takes the challenger path immediately.
      if (
        this.activeString !== null &&
        this.lastValidMs !== null &&
        timestampMs - this.lastValidMs <= HOLD_MS &&
        this.displayCents !== null
      ) {
        return this.snapshot(true);
      }
      this.clearActive();
      return this.snapshot(false);
    }

    this.lastValidMs = timestampMs;
    // Per-string smoothing: key is constant per instance so histories never mix.
    const smoothed = this.smootherFor(stringNumber).push(`s${stringNumber}`, stringCents);
    const cents = smoothed ?? stringCents;

    if (this.activeString === null) {
      if (Math.abs(cents) <= ACQUIRE_CENTS) {
        if (this.candidateString === stringNumber) this.candidateCount += 1;
        else {
          this.candidateString = stringNumber;
          this.candidateCount = 1;
        }
        if (this.candidateCount >= 2) {
          this.activeString = stringNumber;
          this.displayCents = cents;
          this.candidateString = null;
          this.candidateCount = 0;
        }
      } else {
        this.candidateString = null;
        this.candidateCount = 0;
      }
      // Not yet acquired: keep showing nothing (avoid single-frame flash).
      if (this.activeString === null) return this.snapshot(false);
      return this.snapshot(false);
    }

    // Already latched.
    if (stringNumber === this.activeString) {
      this.displayCents = cents;
      this.candidateString = null;
      this.candidateCount = 0;
      return this.snapshot(false);
    }

    // Different string: require clearly closer + 2 consecutive frames.
    const currentAbs = Math.abs(this.displayCents ?? Infinity);
    const challengerAbs = Math.abs(cents);
    const clearlyCloser = challengerAbs + SWITCH_MARGIN_CENTS < currentAbs;
    // Also require challenger itself be within acquire region.
    if (clearlyCloser && challengerAbs <= ACQUIRE_CENTS) {
      if (this.candidateString === stringNumber) this.candidateCount += 1;
      else {
        this.candidateString = stringNumber;
        this.candidateCount = 1;
      }
      if (this.candidateCount >= 2) {
        this.activeString = stringNumber;
        this.displayCents = cents;
        this.candidateString = null;
        this.candidateCount = 0;
      }
    } else {
      // Weak challenger: ignore, keep showing current (but don't update cents).
      // If challenger keeps failing, candidate resets so a single blip never flips.
      if (this.candidateString !== null && this.candidateString !== this.activeString) {
        this.candidateString = null;
        this.candidateCount = 0;
      }
    }
    return this.snapshot();
  }

  private clearActive(): void {
    this.activeString = null;
    this.displayCents = null;
    this.candidateString = null;
    this.candidateCount = 0;
    this.lastValidMs = null;
  }

  private snapshot(held = false): TrackerState {
    if (this.activeString === null) {
      return {
        activeString: null,
        displayCents: null,
        targetFrequency: null,
        targetNote: null,
        guidance: 'IDLE',
        held: false,
      };
    }
    const t = targetForString(this.activeString);
    return {
      activeString: this.activeString,
      displayCents: this.displayCents,
      targetFrequency: t?.frequency ?? null,
      targetNote: t?.note ?? null,
      guidance: guidanceForCents(this.displayCents),
      held,
    };
  }

  reset(): void {
    this.smoothers.clear();
    this.clearActive();
  }
}
