import type { LivePitch } from '../hooks/useGuitarAudio';
import { STANDARD_TUNING, describeStringClaim } from '../lib/guitar/tuning';
import { classifyTuning } from '../lib/analysis/string-tracker';

function tuningClass(p: LivePitch | null): string {
  if (!p || p.activeString === null) return 'idle';
  // Single source of truth: derive the panel class from classifyTuning so the
  // label, guidance, strip, and meter can never disagree (P0-1).
  switch (classifyTuning(p.displayCents)) {
    case 'PERFECT':
    case 'IN_TUNE':
      return 'in-tune';
    case 'SLIGHTLY_FLAT':
    case 'SLIGHTLY_SHARP':
      return 'close';
    case 'IDLE':
      return 'idle';
    default:
      return 'off';
  }
}

function statusText(p: LivePitch | null, running: boolean): string | null {
  if (!running) return 'Press Start to listen';
  if (!p) return 'Listening… pluck a string';
  if (p.activeString === null) {
    switch (p.status) {
      case 'NO_SIGNAL':
        return 'No signal — pluck a string';
      case 'LOW_SIGNAL':
        return 'Signal too quiet — pluck louder';
      case 'TRANSIENT':
        return 'Listening…';
      case 'UNCERTAIN':
        return 'Low confidence — pluck one open string';
      default:
        return 'Listening… pluck a string';
    }
  }
  const claim = describeStringClaim(p.openString, p.stringCents ?? 999);
  // open-match duplicates the target line ("5th string • target 110.00 Hz"),
  // so no status line is needed (P1-4).
  if (claim === 'open-match') return null;
  // near-open is secondary diagnostic info, not a primary tuning instruction.
  if (claim === 'near-open') return `Near open — tune toward ${p.targetNote ?? 'target'}`;
  const ord = `${p.activeString}${ordinal(p.activeString)} string`;
  return `Nearest: ${ord}`;
}

/** True when the status line is secondary diagnostic info (dimmed, P1-6). */
function statusSecondary(p: LivePitch | null): boolean {
  if (!p || p.activeString === null) return false;
  return describeStringClaim(p.openString, p.stringCents ?? 999) === 'near-open';
}

function guidanceLabel(p: LivePitch | null): { arrow: string; text: string; sub: string | null } | null {
  if (!p || p.activeString === null || p.displayCents === null) return null;
  const c = p.displayCents;
  if (!Number.isFinite(c)) return null;
  // Primary instruction stays glanceable (TUNE UP/DOWN); the 5–15¢ band adds
  // a "slightly" qualifier instead of a competing CLOSE state (P0-1).
  switch (classifyTuning(c)) {
    case 'PERFECT':
      return { arrow: '✓', text: 'PERFECT', sub: null };
    case 'IN_TUNE':
      return { arrow: '✓', text: 'IN TUNE', sub: null };
    case 'SLIGHTLY_FLAT':
      return { arrow: '↑', text: 'TUNE UP', sub: 'Slightly flat' };
    case 'SLIGHTLY_SHARP':
      return { arrow: '↓', text: 'TUNE DOWN', sub: 'Slightly sharp' };
    case 'FLAT':
      return { arrow: '↑', text: 'TUNE UP', sub: null };
    case 'SHARP':
      return { arrow: '↓', text: 'TUNE DOWN', sub: null };
    default:
      return null;
  }
}

/** Needle position: clamp string-cents to ±50 for the meter. */
function needlePct(cents: number | null): number {
  if (cents === null || !Number.isFinite(cents)) return 50;
  const c = Math.max(-50, Math.min(50, cents));
  return ((c + 50) / 100) * 100;
}

function stringStateClass(
  stringNumber: number,
  active: number | null,
  displayCents: number | null,
): string {
  if (active === null || active !== stringNumber) return 'idle';
  if (displayCents === null || !Number.isFinite(displayCents)) return 'active';
  switch (classifyTuning(displayCents)) {
    case 'PERFECT':
      return 'active in-tune perfect';
    case 'IN_TUNE':
      return 'active in-tune';
    case 'SLIGHTLY_FLAT':
    case 'SLIGHTLY_SHARP':
      return 'active close';
    case 'FLAT':
      return 'active flat';
    case 'SHARP':
      return 'active sharp';
    default:
      return 'active';
  }
}

export function TunerPanel({
  pitch,
  running,
}: {
  pitch: LivePitch | null;
  running: boolean;
}) {
  const cls = tuningClass(pitch);
  const active = pitch?.activeString ?? null;
  const cents = pitch?.displayCents ?? null;
  const held = pitch?.held ?? false;
  const centsLabel =
    cents === null || !Number.isFinite(cents)
      ? '—'
      : `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}¢`;
  // Center shows TARGET string note (stable), not flickering detected note.
  const centerNote = pitch?.targetNote ?? pitch?.stableNote ?? pitch?.note ?? null;
  const guidance = guidanceLabel(pitch);
  const targetFreq = pitch?.targetFrequency ?? null;
  const status = statusText(pitch, running);
  const secondary = statusSecondary(pitch);

  // Strip always shows all 6 targets; only active gets live cents.
  const strip = [...STANDARD_TUNING].sort((a, b) => b.stringNumber - a.stringNumber);

  return (
    <section className={`panel tuner tuner-${cls}${held ? ' tuner-held' : ''}`} aria-label="Tuner">
      <div className="panel-title">Tuner{held ? ' • held' : ''}</div>

      {/* 6-string strip — GuitarTuna style */}
      <div className="string-strip" data-testid="tuner-strip" role="list" aria-label="Guitar strings">
        {strip.map((s) => {
          const isActive = active === s.stringNumber;
          const stateCls = stringStateClass(s.stringNumber, active, isActive ? cents : null);
          const heldCls = held && isActive ? ' held' : '';
          return (
            <div
              key={s.stringNumber}
              role="listitem"
              data-testid={`tuner-string-${s.stringNumber}`}
              data-active={isActive}
              data-held={held && isActive}
              className={`string-cell ${stateCls}${heldCls}`}
              aria-label={`String ${s.stringNumber} ${s.note}${isActive ? ', active' : ''}${held && isActive ? ', held' : ''}`}
            >
              <span className="string-num">{s.stringNumber}</span>
              <span className="string-note">{s.note.replace(/[0-9]/g, '')}</span>
              <span className="string-oct">{s.note}</span>
              <span
                className="string-gauge"
                style={{ height: `${2 + (s.stringNumber - 1) * 1.1}px` }}
              />
              <span className="string-dot" />
            </div>
          );
        })}
      </div>

      {/* Center: big target note + guidance */}
      <div
        className={`tuner-note${centerNote === null ? ' tuner-note-empty' : ''}`}
        data-testid="tuner-note"
      >
        {centerNote ?? '···'}
      </div>
      {targetFreq !== null && active !== null ? (
        <div className="tuner-target" data-testid="tuner-target">
          {active}
          {ordinal(active)} string • target {targetFreq.toFixed(2)} Hz
        </div>
      ) : null}
      {status !== null ? (
        <div
          className={`tuner-sub${secondary ? ' secondary' : ''}`}
          data-testid="tuner-status"
        >
          {status}
        </div>
      ) : null}

      {guidance && (
        <div
          className={`tune-guidance guidance-${pitch?.guidance.toLowerCase()}${held ? ' held' : ''}`}
          data-testid="tuner-guidance"
          data-held={held}
        >
          <span className="guidance-arrow">{guidance.arrow}</span> {guidance.text}
          <span className="guidance-cents"> {centsLabel}</span>
          {guidance.sub ? <span className="guidance-sub">{guidance.sub}</span> : null}
          {held ? <span className="guidance-held"> (held)</span> : null}
        </div>
      )}

      <div className="meter" aria-label="Tuning meter">
        <span className="meter-end flat" title="Flat — sounds low, raise the pitch">FLAT<br />↑ raise pitch</span>
        <div className="meter-track">
          {/* Shaded ±5¢ in-tune zone + ±10¢ reference ticks (P0-3). */}
          <div className="meter-zone" data-testid="tuner-zone" title="In-tune zone (±5¢)" />
          <div className="meter-tick" style={{ left: '40%' }} title="−10¢" />
          <div className="meter-tick" style={{ left: '45%' }} title="−5¢" />
          <div className="meter-tick" style={{ left: '55%' }} title="+5¢" />
          <div className="meter-tick" style={{ left: '60%' }} title="+10¢" />
          <div className="meter-center" />
          {/* No measurement → no marker: a centered needle would falsely read
              as "in tune" (final-gate blocker). Zone + center line stay. */}
          {cents !== null && Number.isFinite(cents) ? (
            <div
              className="meter-needle"
              data-testid="tuner-needle"
              style={{ left: `${needlePct(cents)}%` }}
            />
          ) : null}
        </div>
        <span className="meter-end sharp" title="Sharp — sounds high, lower the pitch">SHARP<br />↓ lower pitch</span>
      </div>

      <div className="tuner-grid">
        <div className="tuner-cell">
          <span className="label">Heard</span>
          <span className="value" data-testid="tuner-freq">
            {pitch?.frequency != null ? `${pitch.frequency.toFixed(2)} Hz` : '—'}
          </span>
        </div>
        <div className="tuner-cell">
          <span className="label">Off by</span>
          <span className="value" data-testid="tuner-cents">
            {centsLabel.replace('¢', '')}
          </span>
        </div>
        <div className="tuner-cell">
          <span className="label">String</span>
          <span className="value" data-testid="tuner-string">
            {active != null ? (
              <>
                {active}
                {ordinal(active)} string
                {pitch && describeStringClaim(pitch.openString, pitch.stringCents ?? 999) === 'nearest' && (
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
      {pitch?.guidance === 'IN_TUNE' && active !== null && (
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
