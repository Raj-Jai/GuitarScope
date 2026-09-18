/**
 * Note transcription scoring: onset precision/recall (±tolerance) with
 * pitch match required. Duration/offset are reported, not scored in v1.
 */
import type { NoteEvent, NoteGroup } from './schema';
import { isNoteGroup } from './schema';
import type { RefNote } from './reference';

export interface NoteScores {
  precision: number;
  recall: number;
  f1: number;
  matched: number;
  falsePositives: number;
  missed: number;
  meanOnsetErrMs: number;
}

function eventOnsets(events: (NoteEvent | NoteGroup)[]): { onset: number; midis: number[] }[] {
  return events.map((e) => {
    if (isNoteGroup(e)) {
      return { onset: e.onset, midis: e.notes.map((n) => n.midi) };
    }
    return { onset: e.onset, midis: [e.midi] };
  });
}

export function scoreNotes(
  detected: (NoteEvent | NoteGroup)[],
  ref: RefNote[],
  toleranceSec = 0.1,
): NoteScores {
  const det = eventOnsets(detected);
  const used = new Array<boolean>(det.length).fill(false);
  let matched = 0;
  let onsetErr = 0;
  for (const r of ref) {
    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < det.length; i++) {
      if (used[i]) continue;
      const err = Math.abs(det[i].onset - r.onset);
      if (err <= toleranceSec && det[i].midis.includes(r.midi) && err < bestErr) {
        best = i;
        bestErr = err;
      }
    }
    if (best >= 0) {
      used[best] = true;
      matched++;
      onsetErr += bestErr;
    }
  }
  const falsePositives = used.filter((u) => !u).length;
  const missed = ref.length - matched;
  const precision = det.length ? matched / det.length : ref.length === 0 ? 1 : 0;
  const recall = ref.length ? matched / ref.length : 1;
  return {
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    matched,
    falsePositives,
    missed,
    meanOnsetErrMs: matched ? (onsetErr / matched) * 1000 : 0,
  };
}
