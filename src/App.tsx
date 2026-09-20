import { useState } from 'react';
import { useGuitarAudio } from './hooks/useGuitarAudio';
import { TunerPanel } from './components/TunerPanel';
import { ChordPanel } from './components/ChordPanel';
import { SignalCanvas } from './components/SignalCanvas';
import { ControlBar } from './components/ControlBar';
import { SongLab } from './components/SongLab';
import { ErrorBoundary } from './components/ErrorBoundary';

function TunerView() {
  const audio = useGuitarAudio();
  const running = audio.status === 'running';

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <div className={`live-dot ${running ? 'on' : ''}`} data-testid="live-dot" aria-label={running ? 'Listening' : 'Idle'}>
          {running ? '● LIVE' : '○ IDLE'}
        </div>
      </div>

      <ControlBar
        status={audio.status}
        micError={audio.micError}
        demoMode={audio.demoMode}
        stats={audio.stats}
        sessionEvents={audio.sessionEvents}
        demoVolume={audio.demoVolume}
        onStartMic={() => void audio.startMic()}
        onStartDemo={() => void audio.startDemo()}
        onStop={() => void audio.stop()}
        onCadence={audio.setChordCadence}
        onVolume={audio.setDemoVolume}
        onDownloadLog={audio.downloadSessionLog}
      />

      <main className="panels">
        <TunerPanel pitch={audio.pitch} running={running} />
        <ChordPanel chord={audio.chord} chordName={audio.chordName} running={running} />
      </main>

      <SignalCanvas analyser={audio.analyser} listening={running} targetFrequency={audio.pitch?.targetFrequency ?? null} />
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState<'tuner' | 'songs'>('tuner');

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>GuitarScope</h1>
          <p className="tagline">Real-time tuner · note detector · chord detector · song lab</p>
        </div>
        <nav className="tabs" aria-label="Views">
          <button
            className={`tab${tab === 'tuner' ? ' active' : ''}`}
            onClick={() => setTab('tuner')}
            data-testid="tab-tuner"
          >
            Tuner
          </button>
          <button
            className={`tab${tab === 'songs' ? ' active' : ''}`}
            onClick={() => setTab('songs')}
            data-testid="tab-songs"
          >
            Song Lab
          </button>
        </nav>
      </header>

      {tab === 'tuner' ? (
        <ErrorBoundary label="the tuner">
          <TunerView />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary label="Song Lab">
          <SongLab />
        </ErrorBoundary>
      )}

      <footer className="app-footer">
        <span>Mic → AudioWorklet → DSP Worker → UI · YIN pitch + harmonic-subtraction chords</span>
      </footer>
    </div>
  );
}
