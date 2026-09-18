/**
 * FrameQueue: bounded latest-wins queue between the audio thread and DSP.
 * NEWER AUDIO > STALE AUDIO: when full, the OLDEST frame is dropped and
 * counted. Prevents unbounded Worker backlog under load.
 */
export interface QueuedFrame {
  seq: number;
  captureTimestamp: number;
  samples: Float32Array;
}

export class FrameQueue<T extends { seq: number } = QueuedFrame> {
  private items: T[] = [];
  droppedFrames = 0;
  readonly capacity: number;

  constructor(capacity = 2) {
    this.capacity = capacity;
  }

  push(frame: T): void {
    this.items.push(frame);
    while (this.items.length > this.capacity) {
      this.items.shift();
      this.droppedFrames++;
    }
  }

  pop(): T | null {
    return this.items.shift() ?? null;
  }

  get depth(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}
