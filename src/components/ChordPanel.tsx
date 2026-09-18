import type { ChordResult } from '../lib/analysis/polyphonic';

/**
 * Common open-position shapes, strings 6..1.
 * -1 = muted, 0 = open. Only shapes we can vouch for are listed;
 * anything else falls back to the note list.
 */
const OPEN_SHAPES: Record<string, number[]> = {
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

export function ChordDiagram({ name }: { name: string }) {
  const shape = OPEN_SHAPES[name];
  if (!shape) return null;
  const frets = shape.filter((f) => f > 0);
  const maxFret = Math.max(4, ...frets);
  const W = 150;
  const H = 110;
  const left = 24;
  const top = 14;
  const strGap = (W - left - 10) / 5;
  const fretGap = (H - top - 8) / maxFret;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chord-diagram"
      role="img"
      aria-label={`${name} chord diagram`}
      data-testid="chord-diagram"
    >
      {Array.from({ length: 6 }, (_, s) => (
        <line
          key={`s${s}`}
          x1={left + s * strGap}
          y1={top}
          x2={left + s * strGap}
          y2={H - 8}
          stroke="currentColor"
          strokeWidth={s === 0 ? 2.5 : 1}
          opacity={0.7}
        />
      ))}
      {Array.from({ length: maxFret + 1 }, (_, f) => (
        <line
          key={`f${f}`}
          x1={left}
          y1={top + f * fretGap}
          x2={W - 10}
          y2={top + f * fretGap}
          stroke="currentColor"
          strokeWidth={f === 0 ? 2.5 : 1}
          opacity={0.7}
        />
      ))}
      {shape.map((fret, s) => {
        const x = left + s * strGap;
        if (fret === -1) {
          return (
            <text key={s} x={x} y={top - 4} textAnchor="middle" fontSize={9} fill="currentColor">
              ×
            </text>
          );
        }
        if (fret === 0) {
          return (
            <circle key={s} cx={x} cy={top - 6} r={3.4} fill="none" stroke="currentColor" strokeWidth={1.2} />
          );
        }
        return <circle key={s} cx={x} cy={top + (fret - 0.5) * fretGap} r={5} fill="currentColor" />;
      })}
    </svg>
  );
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
        {detected && chordName && <ChordDiagram name={chordName} />}
      </div>
    </section>
  );
}
