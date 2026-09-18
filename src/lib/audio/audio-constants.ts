/** Shared audio constants (single source of truth). */

/** Monophonic tuner analysis frame in samples (≈85ms @48k). */
export const PITCH_FRAME_SIZE = 4096;

/** Polyphonic chord analysis window (≈341ms @48k — calibrated, see ADR-001). */
export const CHORD_WINDOW_SIZE = 16384;

/** Pitch result cadence target (Hz). */
export const PITCH_CADENCE_HZ = 12;

/** Chord analysis cadence default (Hz); configurable to 8. */
export const CHORD_CADENCE_HZ = 4;
