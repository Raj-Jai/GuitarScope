import type { LivePitch } from '../hooks/useGuitarAudio';
import { describeStringClaim } from '../lib/guitar/tuning';

function tuningClass(p: LivePitch): string {
  if (p.note === null) return 'idle';
  if (!p.openString || p.tuning === null) return 'note';
  if (p.tuning === 'IN_TUNE') return 'in-tune';
  if (p.tuning === 'CLOSE') return 'close';
  return 'off';
}

function statusText(p: LivePitch | null, running: boolean): string {
  if (!running) return 'Press Start to listen';
  if (!p) return 'Listening…';
  switch (p.status) {
    case 'NO_SIGNAL':
      return 'No signal — play a note';
    case 'LOW_SIGNAL':
      return 'Signal too quiet';
    case 'TRANSIENT':
      return 'Listening…';
    case 'UNCERTAIN':
      return 'Low confidence';
    case 'NOTE_DETECTED':
    case 'OCTAVE_CORRECTED': {
      const claim = describeStringClaim(p.openString, p.stringCents ?? 999);
      if (claim === 'open-match') return 'Open string';
      if (claim === 'near-open') return 'Near open string';
      return 'Note detected';
    }
    default:
      return 'Listening…';
  }
}

/** Needle position: clamp cents to ±50 for the meter. */
function needlePct(cents: number | null): number {
  if (cents === null || !Number.isFinite(cents)) return 50;
  const c = Math.max(-50, Math.min(50, cents));
  return ((c + 50) / 100) * 100;
}

export function TunerPanel({
  pitch,
  running,
}: {
  pitch: LivePitch | null;
  running: boolean;
}) {
  const cls = pitch ? tuningClass(pitch) : 'idle';
  const cents = pitch?.displayCents ?? null;
  const centsLabel =
    cents === null || !Number.isFinite(cents)
      ? '—'
      : `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}`;
  const noteLabel = pitch?.stableNote ?? pitch?.note ?? null;
  return (
    <section className={`panel tuner tuner-${cls}`} aria-label="Tuner">
      <div className="panel-title">Tuner</div>
      <div
        className={`tuner-note${noteLabel === null ? ' tuner-note-empty' : ''}`}
        data-testid="tuner-note"
      >
        {noteLabel ?? '···'}
      </div>
      <div className="tuner-sub" data-testid="tuner-status">
        {statusText(pitch, running)}
      </div>
      <div className="meter" aria-label="Tuning meter">
        <span className="meter-end flat">FLAT</span>
        <div className="meter-track">
          <div className="meter-center" />
          <div
            className="meter-needle"
            data-testid="tuner-needle"
            style={{ left: `${needlePct(cents)}%` }}
          />
        </div>
        <span className="meter-end sharp">SHARP</span>
      </div>
      <div className="tuner-grid">
        <div className="tuner-cell">
          <span className="label">Frequency</span>
          <span className="value" data-testid="tuner-freq">
            {pitch?.frequency != null ? `${pitch.frequency.toFixed(2)} Hz` : '—'}
          </span>
        </div>
        <div className="tuner-cell">
          <span className="label">Cents</span>
          <span className="value" data-testid="tuner-cents">
            {centsLabel}
          </span>
        </div>
        <div className="tuner-cell">
          <span className="label">String</span>
          <span className="value" data-testid="tuner-string">
            {pitch?.stringNumber != null ? (
              <>
                {pitch.stringNumber}
                {ordinal(pitch.stringNumber)} string
                {describeStringClaim(pitch.openString, pitch.stringCents ?? 999) === 'nearest' && (
                  <span className="value dim"> (nearest)</span>
                )}
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="tuner-cell">
          <span className="label">Confidence</span>
          <span className="value" data-testid="tuner-conf">
            {pitch != null ? `${Math.round(pitch.confidence * 100)}%` : '—'}
          </span>
        </div>
      </div>
      {pitch?.tuning === 'IN_TUNE' && pitch.openString && (
        <div className="in-tune-badge" data-testid="tuner-in-tune">
          IN TUNE
        </div>
      )}
    </section>
  );
}

function ordinal(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}
