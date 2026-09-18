/**
 * FrameAssembler: pure, headless frame-assembly logic shared by the
 * AudioWorklet processor and unit tests.
 *
 * Accumulates arbitrary input blocks (worklet quanta are NOT fixed at 128
 * samples — always use the actual block length) into fixed analysis frames.
 */
export class FrameAssembler {
  private buffer: Float32Array;
  private filled = 0;
  readonly frameSize: number;

  constructor(frameSize = 4096) {
    if (frameSize <= 0) throw new Error('frameSize must be positive');
    this.frameSize = frameSize;
    this.buffer = new Float32Array(frameSize);
  }

  /**
   * Push one input block (any length >= 0). Returns 0+ completed frames;
   * each returned frame is a FRESH Float32Array safe to transfer.
   */
  push(block: ArrayLike<number>): Float32Array[] {
    const out: Float32Array[] = [];
    let offset = 0;
    while (offset < block.length) {
      const room = this.frameSize - this.filled;
      const take = Math.min(room, block.length - offset);
      for (let i = 0; i < take; i++) {
        this.buffer[this.filled + i] = block[offset + i];
      }
      this.filled += take;
      offset += take;
      if (this.filled === this.frameSize) {
        out.push(this.buffer.slice());
        this.filled = 0;
      }
    }
    return out;
  }

  /** Samples currently buffered toward the next frame. */
  get pending(): number {
    return this.filled;
  }

  reset(): void {
    this.filled = 0;
  }
}

/** Mix multi-channel worklet input down to mono (average). */
export function toMono(input: Float32Array[] | Float32Array): Float32Array {
  if (!Array.isArray(input)) return input;
  if (input.length === 0) return new Float32Array(0);
  if (input.length === 1) return input[0];
  const len = input[0].length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const ch of input) sum += ch[i] ?? 0;
    out[i] = sum / input.length;
  }
  return out;
}
