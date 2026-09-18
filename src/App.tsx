import { useGuitarAudio } from './hooks/useGuitarAudio';
import { TunerPanel } from './components/TunerPanel';
import { ChordPanel } from './components/ChordPanel';
import { SignalCanvas } from './components/SignalCanvas';
import { ControlBar } from './components/ControlBar';

export default function App() {
  const audio = useGuitarAudio();
  const running = audio.status === 'running';

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>GuitarScope</h1>
          <p className="tagline">Real-time tuner · note detector · chord detector</p>
        </div>
        <div className={`live-dot ${running ? 'on' : ''}`} data-testid="live-dot" aria-label={running ? 'Listening' : 'Idle'}>
          {running ? '● LIVE' : '○ IDLE'}
        </div>
      </header>

      <ControlBar
        status={audio.status}
        micError={audio.micError}
        demoMode={audio.demoMode}
        stats={audio.stats}
        onStartMic={() => void audio.startMic()}
        onStartDemo={audio.startDemo}
        onStop={() => void audio.stop()}
        onCadence={audio.setChordCadence}
      />

      <main className="panels">
        <TunerPanel pitch={audio.pitch} running={running} />
        <ChordPanel chord={audio.chord} chordName={audio.chordName} running={running} />
      </main>

      <SignalCanvas analyser={audio.analyser} listening={running} />

      <footer className="app-footer">
        <span>Mic → AudioWorklet → DSP Worker → UI · YIN pitch + harmonic-subtraction chords</span>
      </footer>
    </div>
  );
}
