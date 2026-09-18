/** Equal-temperament constants. A4 = 440 Hz, MIDI 69. */
export const A4_FREQUENCY = 440;
export const A4_MIDI = 69;
export const MIN_MIDI = 0;
export const MAX_MIDI = 127;

/** f = 440 * 2^((n - 69)/12) */
export function midiToFrequency(midi: number): number {
  return A4_FREQUENCY * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** n = 69 + 12 * log2(f / 440). Returns fractional MIDI number. */
export function frequencyToMidiFloat(frequency: number): number {
  if (!Number.isFinite(frequency) || frequency <= 0) return NaN;
  return A4_MIDI + 12 * Math.log2(frequency / A4_FREQUENCY);
}

/** Nearest integer MIDI note for a frequency, or null if out of range. */
export function frequencyToMidi(frequency: number): number | null {
  const m = frequencyToMidiFloat(frequency);
  if (!Number.isFinite(m)) return null;
  const rounded = Math.round(m);
  if (rounded < MIN_MIDI || rounded > MAX_MIDI) return null;
  return rounded;
}
