export function ChordDiagram({ name, frets }: { name: string; frets: number[] }) {
  const nums = frets.filter((f) => f > 0);
  const maxFret = Math.max(4, ...nums);
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
      {frets.map((fret, s) => {
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
