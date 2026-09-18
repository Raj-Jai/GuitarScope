import type { ChordResult } from '../lib/analysis/polyphonic';
import { fingeringFor } from '../lib/chords/fingerings';
import { ChordDiagram } from './ChordDiagram';

function chordStatus(chord: ChordResult | null, running: boolean): string {
  if (!running) return 'Press Start to listen';
  if (!chord) return 'Detecting…';
  switch (chord.status) {
    case 'NO_SIGNAL':
      return 'No signal — strum a chord';
    case 'LOW_SIGNAL':
      return 'Signal too quiet';
    case 'MONOPHONIC':
      return 'Single note — strum a chord';
    case 'UNCERTAIN':
      return 'Uncertain';
    case 'CHORD_DETECTED':
      return 'Chord detected';
    default:
      return 'Detecting…';
  }
}

export function ChordPanel({
  chord,
  chordName,
  running,
}: {
  chord: ChordResult | null;
  chordName: string | null;
  running: boolean;
}) {
  const detected = chord?.status === 'CHORD_DETECTED' && chordName;
  return (
    <section className="panel chord" aria-label="Chord detection">
      <div className="panel-title">Chord</div>
      <div
        className={`chord-name${detected ? '' : ' chord-name-empty'}`}
        data-testid="chord-name"
      >
        {detected ? chordName : '···'}
      </div>
      <div className="tuner-sub" data-testid="chord-status">
        {chordStatus(chord, running)}
      </div>
      <div className="chord-row">
        <div className="chord-meta">
          <div className="tuner-cell">
            <span className="label">Confidence</span>
            <span className="value" data-testid="chord-conf">
              {detected && chord ? `${Math.round(chord.confidence * 100)}%` : '—'}
            </span>
          </div>
          <div className="tuner-cell">
            <span className="label">Notes</span>
            <span className="value" data-testid="chord-notes">
              {detected && chord ? chord.noteNames.join(' ') : '—'}
            </span>
          </div>
          {chord && chord.alternatives.length > 0 && detected && (
            <div className="tuner-cell">
              <span className="label">Also possible</span>
              <span className="value dim" data-testid="chord-alt">
                {chord.alternatives
                  .slice(0, 2)
                  .map((a) => a.name)
                  .join(', ')}
              </span>
            </div>
          )}
        </div>
        {detected && chordName && fingeringFor(chordName) && (
          <ChordDiagram name={chordName} frets={fingeringFor(chordName) as number[]} />
        )}
      </div>
    </section>
  );
}
