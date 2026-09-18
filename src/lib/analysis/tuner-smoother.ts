/**
 * TunerSmoother: raw cents -> display cents.
 * median window (outlier rejection) -> EMA (low-latency smoothing).
 * Resets instantly on note change so E2 and A2 are never averaged together.
 */
export class TunerSmoother {
  private window: number[] = [];
  private ema: number | null = null;
  private currentNote: string | null = null;
  private readonly medianSize: number;
  private readonly emaAlpha: number;

  constructor(medianSize = 5, emaAlpha = 0.35) {
    this.medianSize = medianSize;
    this.emaAlpha = emaAlpha;
  }

  /**
   * Returns smoothed cents, or null when input is unusable.
   * Any note change resets all state.
   */
  push(note: string | null, cents: number | null): number | null {
    if (note === null || cents === null || !Number.isFinite(cents)) {
      this.reset();
      return null;
    }
    if (note !== this.currentNote) {
      this.reset();
      this.currentNote = note;
    }
    this.window.push(cents);
    if (this.window.length > this.medianSize) this.window.shift();
    const sorted = [...this.window].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    this.ema = this.ema === null ? median : this.emaAlpha * median + (1 - this.emaAlpha) * this.ema;
    return this.ema;
  }

  reset(): void {
    this.window = [];
    this.ema = null;
    this.currentNote = null;
  }
}
