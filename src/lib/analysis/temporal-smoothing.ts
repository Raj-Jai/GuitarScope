/**
 * Temporal smoothing: median filtering + hysteresis so the DISPLAYED
 * note/chord doesn't flicker even when instantaneous detection wavers.
 */

/** Majority vote over a sliding window (for note names / chord names). */
export class LabelStabilizer {
  private window: (string | null)[] = [];
  private readonly size: number;
  constructor(size = 5) {
    this.size = size;
  }

  push(label: string | null): string | null {
    this.window.push(label);
    if (this.window.length > this.size) this.window.shift();
    const counts = new Map<string, number>();
    let nulls = 0;
    for (const l of this.window) {
      if (l === null) nulls++;
      else counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [label, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        best = label;
      }
    }
    // Require a strict majority of non-null votes to change the display.
    if (best !== null && bestCount > this.window.length / 2) return best;
    // All-null window → show nothing; otherwise hold last stable (null = no change signal).
    if (best === null) return null;
    return best;
  }

  reset(): void {
    this.window = [];
  }
}

/** Median filter for numeric streams (frequency, cents). */
export class MedianFilter {
  private window: number[] = [];
  private readonly size: number;
  constructor(size = 5) {
    this.size = size;
  }

  push(value: number): number {
    this.window.push(value);
    if (this.window.length > this.size) this.window.shift();
    const sorted = [...this.window].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  reset(): void {
    this.window = [];
  }
}
