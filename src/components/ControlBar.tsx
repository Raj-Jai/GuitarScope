import type { AudioStatus, LiveStats } from '../hooks/useGuitarAudio';
import type { MicError } from '../lib/audio/microphone';

function fmtMs(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)} ms`;
}

export function ControlBar({
  status,
  micError,
  demoMode,
  stats,
  onStartMic,
  onStartDemo,
  onStop,
  onCadence,
}: {
  status: AudioStatus;
  micError: MicError | null;
  demoMode: boolean;
  stats: LiveStats;
  onStartMic: () => void;
  onStartDemo: () => void;
  onStop: () => void;
  onCadence: (hz: number) => void;
}) {
  const running = status === 'running';
  return (
    <div className="controls">
      <div className="controls-row">
        {!running && status !== 'starting' && (
          <>
            <button className="btn primary" onClick={onStartMic} data-testid="btn-start">
              Start microphone
            </button>
            <button className="btn" onClick={onStartDemo} data-testid="btn-demo">
              Play demo signal
            </button>
          </>
        )}
        {(running || status === 'starting') && (
          <button className="btn danger" onClick={onStop} data-testid="btn-stop">
            Stop{demoMode ? ' demo' : ''}
          </button>
        )}
        <label className="cadence">
          Chord rate
          <select
            value={stats.chordCadenceHz}
            onChange={(e) => onCadence(Number(e.target.value))}
            data-testid="cadence-select"
            aria-label="Chord analysis rate"
          >
            <option value={2}>2 Hz</option>
            <option value={4}>4 Hz</option>
            <option value={8}>8 Hz</option>
          </select>
        </label>
        {status === 'starting' && <span className="status-line">Requesting microphone…</span>}
        {running && demoMode && <span className="status-line demo">Demo signal (synthetic, real DSP path)</span>}
        {running && !demoMode && <span className="status-line live">Listening via microphone</span>}
      </div>
      {micError && (
        <div className="error-banner" role="alert" data-testid="error-banner">
          <strong>
            {micError.reason === 'permission-denied'
              ? 'Microphone blocked'
              : micError.reason === 'no-microphone'
                ? 'No microphone found'
                : micError.reason === 'insecure-origin'
                  ? 'Microphone needs HTTPS'
                  : 'Audio error'}
          </strong>
          <span>{micError.message}</span>
        </div>
      )}
      <div className="stats-grid" data-testid="stats">
        <Stat label="Results" value={`${stats.resultsPerSec.toFixed(0)}/s`} />
        <Stat label="End-to-end" value={fmtMs(stats.e2eLatencyMs)} title="Capture to UI update" />
        <Stat label="Worker" value={fmtMs(stats.workerTurnaroundMs)} title="Worker receive to result" />
        <Stat label="Pitch DSP" value={fmtMs(stats.pitchProcessingMs)} />
        <Stat label="Chord DSP" value={fmtMs(stats.chordProcessingMs)} />
        <Stat label="Queue" value={`${stats.queueDepth}`} title="Worker queue depth" />
        <Stat label="Dropped" value={`${stats.droppedFrames}`} title="Stale frames dropped (latest-wins)" />
        <Stat label="Sample rate" value={`${stats.sampleRate} Hz`} />
      </div>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
