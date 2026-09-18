/**
 * M0 — Reference annotation format (ground truth for validation).
 *
 * Chord reference file, one segment per line:
 *   <startSec> <endSec> <label>
 * e.g.  0.000  4.112  G
 *
 * Note reference file, one note per line:
 *   <onsetSec> <durationSec> <midi>
 * e.g.  12.440  0.532  64
 *
 * Blank lines and `#` comments are ignored. Labels use the same chord
 * names as the matcher dictionary ('NO_CHORD' allowed).
 */

export interface RefChord {
  start: number;
  end: number;
  label: string;
}

export interface RefNote {
  onset: number;
  duration: number;
  midi: number;
}

function cleanLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

export function parseChordReference(text: string): RefChord[] {
  const out: RefChord[] = [];
  for (const line of cleanLines(text)) {
    const parts = line.split(/\s+/);
    if (parts.length < 3) throw new Error(`bad chord ref line: ${line}`);
    const start = Number(parts[0]);
    const end = Number(parts[1]);
    const label = parts.slice(2).join(' ');
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start) || !label) {
      throw new Error(`bad chord ref line: ${line}`);
    }
    out.push({ start, end, label });
  }
  return out;
}

export function parseNoteReference(text: string): RefNote[] {
  const out: RefNote[] = [];
  for (const line of cleanLines(text)) {
    const parts = line.split(/\s+/);
    if (parts.length !== 3) throw new Error(`bad note ref line: ${line}`);
    const onset = Number(parts[0]);
    const duration = Number(parts[1]);
    const midi = Number(parts[2]);
    if (!Number.isFinite(onset) || !Number.isFinite(duration) || !Number.isInteger(midi)) {
      throw new Error(`bad note ref line: ${line}`);
    }
    out.push({ onset, duration, midi });
  }
  return out;
}
