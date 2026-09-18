/**
 * SessionLog: lightweight in-memory record of a test session so
 * real-guitar failures are reproducible (no reliance on memory).
 * Bounded ring (default 1000 events); exportable as JSON.
 */
export type SessionEventKind = 'pitch' | 'chord' | 'stats' | 'marker';

export interface SessionEvent {
  /** ms since session start. */
  t: number;
  kind: SessionEventKind;
  data: Record<string, number | string | null>;
}

export class SessionLog {
  private events: SessionEvent[] = [];
  private startedWall: string;
  private readonly capacity: number;

  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.startedWall = new Date().toISOString();
  }

  begin(): void {
    this.events = [];
    this.startedWall = new Date().toISOString();
  }

  get length(): number {
    return this.events.length;
  }

  private push(kind: SessionEventKind, data: SessionEvent['data'], now?: number): void {
    this.events.push({ t: Math.round(now ?? 0), kind, data });
    while (this.events.length > this.capacity) this.events.shift();
  }

  logPitch(
    data: { note: string | null; frequency: number | null; cents: number | null; confidence: number; status: string },
    elapsedMs: number,
  ): void {
    this.push('pitch', { ...data }, elapsedMs);
  }

  logChord(
    data: { name: string | null; confidence: number; status: string },
    elapsedMs: number,
  ): void {
    this.push('chord', { ...data }, elapsedMs);
  }

  logStats(
    data: { queueDepth: number; droppedFrames: number; pitchMs: number | null; chordMs: number | null; e2eMs: number | null },
    elapsedMs: number,
  ): void {
    this.push('stats', { ...data }, elapsedMs);
  }

  marker(label: string, elapsedMs: number): void {
    this.push('marker', { label }, elapsedMs);
  }

  toJSON(): { startedWall: string; eventCount: number; events: SessionEvent[] } {
    return {
      startedWall: this.startedWall,
      eventCount: this.events.length,
      events: [...this.events],
    };
  }

  clear(): void {
    this.events = [];
  }
}
