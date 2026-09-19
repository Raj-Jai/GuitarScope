import { useEffect, useRef } from 'react';
import type { StrumEvent, TabEvent } from '../../analyzer/schema';

/**
 * Rolling guitar tab: six string lanes (high e on top), fret numbers at
 * onset positions, duration lines, simultaneous stacks sharing x, strum
 * arrows correlated from strum events. Center-fixed playhead; content
 * scrolls beneath it via direct DOM transform (no re-renders).
 * All fingerings are SUGGESTED (see header) — never ground truth.
 */
const STRINGS = [1, 2, 3, 4, 5, 6]; // display order: high e first
const LANE_H = 26;

export function RollingTab({
  tab,
  strums,
  duration,
  getTime,
  pxPerSec = 140,
}: {
  tab: TabEvent[];
  strums: StrumEvent[];
  duration: number;
  getTime: () => number;
  pxPerSec?: number;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const getTimeRef = useRef(getTime);
  useEffect(() => {
    getTimeRef.current = getTime;
  });

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const strip = stripRef.current;
      const wrap = wrapRef.current;
      if (!strip || !wrap) return;
      const t = getTimeRef.current();
      const center = wrap.clientWidth / 2;
      strip.style.transform = `translateX(${center - t * pxPerSec}px)`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pxPerSec, tab]);

  if (tab.length === 0) {
    return (
      <div className="tuner-sub" data-testid="tab-empty">
        No tab events — try a track with clearer guitar.
      </div>
    );
  }

  const width = Math.max(1, duration * pxPerSec);
  // Strum direction near each chord-kind event (for ↓/↑ arrows).
  const arrowFor = (start: number): string | null => {
    let best: StrumEvent | null = null;
    let bestDt = 0.12;
    for (const s of strums) {
      const dt = Math.abs(s.time - start);
      if (dt < bestDt && (s.direction === 'D' || s.direction === 'U')) {
        bestDt = dt;
        best = s;
      }
    }
    return best ? (best.direction === 'D' ? '↓' : '↑') : null;
  };

  const dense =
    tab.length / Math.max(1, duration) > 8 ||
    tab.some((e) => e.notes.length > 4);

  return (
    <div className="tabwrap" data-testid="rolling-tab">
      <div className="tuner-sub tab-caption">
        Suggested tab (concert pitch) — auto-fingering, verify by ear
      </div>
      <div ref={wrapRef} className={`tabview${dense ? ' compact' : ''}`}>
        <div ref={stripRef} className="tabstrip" style={{ width }}>
          {STRINGS.map((s) => (
            <div
              key={s}
              className="tablane"
              style={{ top: (s - 1) * LANE_H }}
              data-testid={`tab-lane-${s}`}
            >
              <span className="tabstring">{stringName(s)}</span>
            </div>
          ))}
          {tab.flatMap((e, ei) => {
            const arrow = e.kind === 'chord' ? arrowFor(e.start) : null;
            return e.notes.map((n, ni) => (
              <div key={`${ei}-${ni}`}>
                <span
                  className="tabfret"
                  style={{
                    left: n.start * pxPerSec,
                    top: (n.string - 1) * LANE_H,
                  }}
                  data-testid="tab-fret"
                  data-midi={n.midi}
                  title={`string ${n.string} fret ${n.fret}`}
                >
                  {n.fret}
                </span>
                {n.end > n.start + 0.05 && (
                  <div
                    className="tabdur"
                    style={{
                      left: n.start * pxPerSec + 14,
                      width: Math.max(2, (n.end - n.start) * pxPerSec - 14),
                      top: (n.string - 1) * LANE_H + LANE_H / 2,
                    }}
                  />
                )}
                {arrow !== null && ni === 0 && (
                  <span
                    className="tabarrow"
                    style={{ left: n.start * pxPerSec }}
                    data-testid="tab-arrow"
                  >
                    {arrow}
                  </span>
                )}
              </div>
            ));
          })}
        </div>
        <div className="tabplayhead" data-testid="tab-playhead" />
      </div>
    </div>
  );
}

function stringName(s: number): string {
  return ['e', 'B', 'G', 'D', 'A', 'E'][s - 1];
}
