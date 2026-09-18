/**
 * ChordStabilityGate: acceptance rule for the DISPLAYED chord.
 * Stronger than bare majority voting: a challenger must confirm across
 * consecutive chord runs before replacing the display, while collapse
 * (or a very confident challenger) switches immediately. Single-run
 * transition blips never reach the screen.
 */
export interface ObservedChord {
  name: string;
  confidence: number;
}

export class ChordStabilityGate {
  private displayed: string | null = null;
  private displayedConf = 0;
  private challenger: string | null = null;
  private challengerStreak = 0;
  private absence = 0;

  private readonly requiredConfirmations: number;
  private readonly minConfidence: number;
  private readonly collapseConfidence: number;
  private readonly maxAbsence: number;
  private readonly instantConfidence: number;

  constructor(
    requiredConfirmations = 2,
    minConfidence = 0.5,
    collapseConfidence = 0.3,
    maxAbsence = 3,
    instantConfidence = 0.9,
  ) {
    this.requiredConfirmations = requiredConfirmations;
    this.minConfidence = minConfidence;
    this.collapseConfidence = collapseConfidence;
    this.maxAbsence = maxAbsence;
    this.instantConfidence = instantConfidence;
  }

  get current(): string | null {
    return this.displayed;
  }

  push(observed: ObservedChord | null): string | null {
    if (!observed || observed.confidence < this.minConfidence) {
      this.absence++;
      this.challenger = null;
      this.challengerStreak = 0;
      if (this.absence >= this.maxAbsence) {
        this.displayed = null;
        this.displayedConf = 0;
      }
      return this.displayed;
    }
    this.absence = 0;
    if (observed.name === this.displayed) {
      this.displayedConf = observed.confidence;
      this.challenger = null;
      this.challengerStreak = 0;
      return this.displayed;
    }
    if (this.displayed === null || this.displayedConf < this.collapseConfidence) {
      this.setDisplayed(observed);
      return this.displayed;
    }
    if (observed.confidence >= this.instantConfidence) {
      this.setDisplayed(observed);
      return this.displayed;
    }
    if (observed.name === this.challenger) {
      this.challengerStreak++;
    } else {
      this.challenger = observed.name;
      this.challengerStreak = 1;
    }
    if (this.challengerStreak >= this.requiredConfirmations) {
      this.setDisplayed(observed);
    }
    return this.displayed;
  }

  private setDisplayed(observed: ObservedChord): void {
    this.displayed = observed.name;
    this.displayedConf = observed.confidence;
    this.challenger = null;
    this.challengerStreak = 0;
  }

  reset(): void {
    this.displayed = null;
    this.displayedConf = 0;
    this.challenger = null;
    this.challengerStreak = 0;
    this.absence = 0;
  }
}
