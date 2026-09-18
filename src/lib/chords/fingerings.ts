/**
 * Known open-position guitar fingerings, strings 6..1.
 * -1 = muted, 0 = open. Only shapes we can vouch for are listed —
 * never invent a diagram from a chord name.
 */
export const OPEN_SHAPES: Record<string, number[]> = {
  E: [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0],
  E7: [0, 2, 0, 1, 0, 0],
  Em7: [0, 2, 0, 0, 0, 0],
  A: [-1, 0, 2, 2, 2, 0],
  Am: [-1, 0, 2, 2, 1, 0],
  A7: [-1, 0, 2, 0, 2, 0],
  Am7: [-1, 0, 2, 0, 1, 0],
  D: [-1, -1, 0, 2, 3, 2],
  Dm: [-1, -1, 0, 2, 3, 1],
  D7: [-1, -1, 0, 2, 1, 2],
  G: [3, 2, 0, 0, 0, 3],
  G7: [3, 2, 0, 0, 0, 1],
  C: [-1, 3, 2, 0, 1, 0],
  C7: [-1, 3, 2, 3, 1, 0],
};

/** Fingering for a chord name, or null when unknown (no invention). */
export function fingeringFor(chordName: string): number[] | null {
  return OPEN_SHAPES[chordName] ?? null;
}
