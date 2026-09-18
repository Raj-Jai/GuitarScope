import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChordEvent, NoteEvent, NoteGroup, SongAnalysis } from '../../analyzer/schema';
import { isNoteGroup, validateAnalysis } from '../../analyzer/schema';
import { chordTone } from '../lib/dsp/synth';
import { encodeWavBlob } from '../lib/audio/wav-encode';
import { fingeringFor } from '../lib/chords/fingerings';
import { transposeChordLabel, transposeNoteName } from '../lib/chords/transpose';
import { extractVideoId } from '../lib/song/youtube';
import { ChordDiagram } from './ChordDiagram';

// Local analysis event types (mirror schema to keep UI decoupled).
type SongChord = ChordEvent;
type SongNote = NoteEvent | NoteGroup;

interface AnalysisData {
  chords: SongChord[];
  notes: SongNote[];
  duration: number;
}

interface YTPlayerLike {
  getCurrentTime: () => number;
  getDuration: () => number;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (t: number, allowSeekAhead: boolean) => void;
  setPlaybackRate: (r: number) => void;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string;
          playerVars?: Record<string, number | string>;
          events?: { onReady?: () => void; onError?: (e: unknown) => void };
        },
      ) => YTPlayerLike;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeAPI(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('YouTube API load timed out')), 15000);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Could not load YouTube player (network blocked?)'));
    };
    document.head.appendChild(script);
  });
}

function demoSongSamples(): Float32Array {
  const SR = 48000;
  const prog = [
    [196.0, 246.9417, 293.6648], // G
    [146.8318, 185.0, 220.0], // D
    [110, 130.8128, 164.8138], // Am
    [130.8128, 164.8138, 196.0], // C
  ];
  const total = new Float32Array(SR * 32);
  prog.forEach((freqs, i) => {
    const part = chordTone(freqs, { sampleRate: SR, duration: 8 });
    total.set(part, i * SR * 8);
  });
  return total;
}

function soundingNotes(notes: SongNote[], t: number, transpose: number): { label: string; key: string }[] {
  const out: { label: string; key: string }[] = [];
  for (const n of notes) {
    if (isNoteGroup(n)) {
      if (t >= n.onset && t < n.offset) {
        for (const m of n.notes) {
          out.push({ label: transposeNoteName(m.midi, transpose), key: `${n.onset}-${m.midi}` });
        }
      }
    } else if (t >= n.onset && t < n.offset) {
      out.push({ label: transposeNoteName(n.midi, transpose), key: `${n.onset}-${n.midi}` });
    }
    if (out.length >= 8) break;
  }
  return out;
}

export function SongLab() {
  const [phase, setPhase] = useState<'empty' | 'loading' | 'analyzing' | 'ready' | 'error'>('empty');
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [progress, setProgress] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [chordIdx, setChordIdx] = useState(-1);
  const [sounding, setSounding] = useState<{ label: string; key: string }[]>([]);
  const [transpose, setTranspose] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loopOn, setLoopOn] = useState(false);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [showChords, setShowChords] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [ytUrl, setYtUrl] = useState('');
  const [ytError, setYtError] = useState<string | null>(null);
  const [player, setPlayer] = useState<'audio' | 'youtube'>('audio');
  const [audioDur, setAudioDur] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const ytPlayerRef = useRef<YTPlayerLike | null>(null);
  const ytDivRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const clockRef = useRef<{ kind: 'audio' | 'youtube' }>({ kind: 'audio' });
  const analysisRef = useRef<AnalysisData | null>(null);
  const uiRef = useRef({ transpose: 0, chordIdx: -1, soundingKey: '', tick: 0 });
  useEffect(() => {
    uiRef.current.transpose = transpose;
    analysisRef.current = analysis;
  });

  const getTime = useCallback((): number => {
    if (clockRef.current.kind === 'youtube') {
      try {
        return ytPlayerRef.current?.getCurrentTime() ?? 0;
      } catch {
        return 0;
      }
    }
    return audioRef.current?.currentTime ?? 0;
  }, []);

  const getDuration = useCallback((): number => {
    if (clockRef.current.kind === 'youtube') {
      try {
        return ytPlayerRef.current?.getDuration() ?? 0;
      } catch {
        return 0;
      }
    }
    return audioRef.current?.duration || analysisRef.current?.duration || 0;
  }, []);

  const loopOnRef = useRef(false);
  const loopRef = useRef<{ A: number | null; B: number | null }>({ A: null, B: null });

  const seekTo = useCallback((t: number) => {
    if (clockRef.current.kind === 'youtube') {
      try {
        ytPlayerRef.current?.seekTo(t, true);
      } catch {
        /* ignore */
      }
    } else if (audioRef.current) {
      audioRef.current.currentTime = t;
    }
    setTime(t);
  }, []);

  const setPlayingState = useCallback((play: boolean) => {
    if (clockRef.current.kind === 'youtube') {
      try {
        if (play) ytPlayerRef.current?.playVideo();
        else ytPlayerRef.current?.pauseVideo();
      } catch {
        /* ignore */
      }
    } else if (audioRef.current) {
      if (play) void audioRef.current.play().catch(() => undefined);
      else audioRef.current.pause();
    }
    setPlaying(play);
  }, []);

  // rAF: playhead (direct DOM), loop enforcement, event changes -> state.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const a = analysisRef.current;
      if (!a) return;
      let t = getTime();
      const dur = getDuration() || a.duration;
      if (loopOnRef.current && a) {
        const { A, B } = loopRef.current;
        if (A !== null && B !== null && B > A && (t < A || t > B)) {
          seekTo(A);
          t = A;
        }
      }
      if (playheadRef.current && dur > 0) {
        playheadRef.current.style.left = `${Math.min(100, (t / dur) * 100)}%`;
      }
      const ui = uiRef.current;
      ui.tick++;
      // Current chord index.
      let idx = -1;
      for (let i = 0; i < a.chords.length; i++) {
        if (t >= a.chords[i].start && t < a.chords[i].end) {
          idx = i;
          break;
        }
      }
      if (idx !== ui.chordIdx) {
        ui.chordIdx = idx;
        setChordIdx(idx);
      }
      // Sounding notes + slow time readout (4 Hz).
      const key = `${idx}`;
      if (ui.tick % 15 === 0) {
        setTime(t);
        const s = soundingNotes(a.notes, t, ui.transpose);
        const skey = key + s.map((x) => x.key).join(',');
        if (skey !== ui.soundingKey) {
          ui.soundingKey = skey;
          setSounding(s);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getTime, getDuration, seekTo]);


  const runAnalysis = useCallback(
    (samples: Float32Array, sampleRate: number, label: string) => {
      setPhase('analyzing');
      setProgress('starting worker…');
      setSourceLabel(label);
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../workers/song-worker.ts', import.meta.url), {
          type: 'module',
        });
      }
      const worker = workerRef.current;
      const jobId = ++jobRef.current;
      const copy = new Float32Array(samples);
      const onMessage = (event: MessageEvent) => {
        const msg = event.data as { type: string; jobId: number } & Record<string, never>;
        if (msg.jobId !== jobId) return;
        if (msg.type === 'progress') {
          const p = msg as unknown as { stage: string; done: number; total: number };
          setProgress(`${p.stage} ${p.done}/${p.total}`);
        } else if (msg.type === 'done') {
          const d = msg as unknown as { chords: AnalysisData['chords']; notes: AnalysisData['notes']; duration: number };
          setAnalysis({ chords: d.chords, notes: d.notes, duration: d.duration });
          setPhase('ready');
          setProgress('');
          worker.removeEventListener('message', onMessage);
        } else if (msg.type === 'error') {
          const e = msg as unknown as { message: string };
          setError(`Analysis failed: ${e.message}`);
          setPhase('error');
          worker.removeEventListener('message', onMessage);
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'analyze', jobId, samples: copy, sampleRate }, [copy.buffer]);
    },
    [],
  );

  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const loadAudioFile = useCallback(
    async (file: File) => {
      setPhase('loading');
      setError(null);
      try {
        clockRef.current = { kind: 'audio' };
        setPlayer('audio');
        const url = URL.createObjectURL(file);
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        const ch0 = buf.getChannelData(0);
        const mono = buf.numberOfChannels > 1 ? averageChannels(buf) : new Float32Array(ch0);
        const { resampleLinear: resample } = await import('../lib/dsp/resample');
        const samples = resample(mono, buf.sampleRate, 48000);
        setAudioUrl(url);
        runAnalysis(samples, 48000, file.name);
      } catch (err) {
        setError(`Could not load audio: ${err instanceof Error ? err.message : String(err)}`);
        setPhase('error');
      }
    },
    [runAnalysis, setAudioUrl],
  );


  const loadAnalysisFile = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as SongAnalysis;
      const errs = validateAnalysis(parsed);
      if (errs.length > 0) throw new Error(errs.join('; '));
      const dur = analysisRef.current?.duration ?? parsed.source.duration;
      if (Math.abs(dur - parsed.source.duration) > 2) {
        setError(`Warning: analysis duration (${parsed.source.duration.toFixed(1)}s) differs from audio (${dur.toFixed(1)}s).`);
      }
      setAnalysis({ chords: parsed.chords, notes: parsed.notes, duration: parsed.source.duration });
      setPhase('ready');
    } catch (err) {
      setError(`Bad analysis file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const loadDemo = useCallback(() => {
    setPhase('loading');
    setError(null);
    clockRef.current = { kind: 'audio' };
    const samples = demoSongSamples();
    const blob = encodeWavBlob(samples, 48000);
    setAudioUrl(URL.createObjectURL(blob));
    runAnalysis(samples, 48000, 'demo progression (G D Am C)');
  }, [runAnalysis]);

  const loadYouTube = useCallback(async () => {
    const id = extractVideoId(ytUrl);
    if (!id) {
      setYtError('That does not look like a YouTube URL.');
      return;
    }
    setYtError(null);
    try {
      await loadYouTubeAPI();
    } catch (err) {
      setYtError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!ytDivRef.current || !window.YT) return;
    ytPlayerRef.current?.destroy();
    clockRef.current = { kind: 'youtube' };
    setPlayer('youtube');
    ytPlayerRef.current = new window.YT.Player(ytDivRef.current, {
      videoId: id,
      playerVars: { rel: 0 },
      events: {
        onError: () => setYtError('YouTube player reported an error (video may restrict embedding).'),
      },
    });
    setSourceLabel(`YouTube ${id} — load an analysis JSON to sync charts`);
  }, [ytUrl]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      try {
        ytPlayerRef.current?.destroy();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const a = analysis;
  const dur = a?.duration ?? audioDur;
  const cur = chordIdx >= 0 && a ? a.chords[chordIdx] : null;
  const prev = chordIdx > 0 && a ? a.chords[chordIdx - 1] : null;
  const next = a && chordIdx >= 0 && chordIdx + 1 < a.chords.length ? a.chords[chordIdx + 1] : null;
  const shownCur = cur && cur.label !== 'NO_CHORD' ? transposeChordLabel(cur.label, transpose) : null;
  const midiRange = noteRange(a?.notes ?? []);

  return (
    <section className="panel songlab" aria-label="Song lab">
      <div className="panel-title">Song Lab — chord & note tutorial</div>

      <div className="controls-row">
        <label className="btn" data-testid="song-audio-label">
          Open audio file
          <input
            type="file"
            accept="audio/*"
            hidden
            data-testid="song-audio-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadAudioFile(f);
              e.target.value = '';
            }}
          />
        </label>
        <label className="btn" data-testid="song-json-label">
          Open analysis JSON
          <input
            type="file"
            accept="application/json"
            hidden
            data-testid="song-json-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadAnalysisFile(f);
              e.target.value = '';
            }}
          />
        </label>
        <button className="btn" onClick={loadDemo} data-testid="song-demo">
          Analyze demo song
        </button>
      </div>

      <div className="controls-row">
        <input
          className="yt-input"
          placeholder="Paste YouTube URL for video-synced charts"
          value={ytUrl}
          onChange={(e) => setYtUrl(e.target.value)}
          data-testid="yt-url"
          aria-label="YouTube URL"
        />
        <button className="btn" onClick={() => void loadYouTube()} data-testid="yt-load">
          Load video
        </button>
      </div>
      {ytError && (
        <div className="error-banner" role="alert" data-testid="yt-error">
          <span>{ytError}</span>
        </div>
      )}
      <div ref={ytDivRef} data-testid="yt-player" className={player === 'youtube' ? '' : 'yt-hidden'} />

      {phase === 'loading' && <div className="tuner-sub">Loading audio…</div>}
      {phase === 'analyzing' && (
        <div className="tuner-sub" data-testid="song-progress">
          Analyzing… {progress}
        </div>
      )}
      {phase === 'error' && error && (
        <div className="error-banner" role="alert" data-testid="song-error">
          <span>{error}</span>
        </div>
      )}
      {error && phase !== 'error' && <div className="tuner-sub">{error}</div>}

      {audioUrl && player === 'audio' && (
        <audio
          ref={audioRef}
          src={audioUrl}
          data-testid="song-audio"
          onLoadedMetadata={(e) => setAudioDur(e.currentTarget.duration || 0)}
        />
      )}

      {a && (
        <>
          <div className="tuner-sub" data-testid="song-source">
            {sourceLabel} · {a.chords.length} chords · {a.notes.length} notes
          </div>

          <div className="transport" data-testid="transport">
            <button className="btn" onClick={() => setPlayingState(!playing)} data-testid="song-play">
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(1, dur)}
              step={0.1}
              value={Math.min(time, dur)}
              onChange={(e) => seekTo(Number(e.target.value))}
              data-testid="song-seek"
              aria-label="Seek"
              className="seek"
            />
            <span className="mono" data-testid="song-time">
              {fmtTime(time)} / {fmtTime(dur)}
            </span>
            <select
              value={speed}
              onChange={(e) => {
                const r = Number(e.target.value);
                setSpeed(r);
                if (audioRef.current) audioRef.current.playbackRate = r;
                try {
                  ytPlayerRef.current?.setPlaybackRate(r);
                } catch {
                  /* ignore */
                }
              }}
              data-testid="song-speed"
              aria-label="Playback speed"
            >
              <option value={0.5}>0.5×</option>
              <option value={0.75}>0.75×</option>
              <option value={1}>1×</option>
            </select>
          </div>

          <div className="controls-row">
            <button
              className="btn"
              onClick={() => {
                setLoopA(time);
                setLoopOn(true);
              }}
              data-testid="loop-a"
            >
              Set A{loopA !== null ? ` ${fmtTime(loopA)}` : ''}
            </button>
            <button
              className="btn"
              onClick={() => {
                setLoopB(time);
                setLoopOn(true);
              }}
              data-testid="loop-b"
            >
              Set B{loopB !== null ? ` ${fmtTime(loopB)}` : ''}
            </button>
            <button
              className="btn"
              onClick={() => setLoopOn(!loopOn)}
              data-testid="loop-toggle"
              disabled={loopA === null || loopB === null}
            >
              Loop {loopOn ? 'on' : 'off'}
            </button>
            <button className="btn" onClick={() => setTranspose(transpose - 1)} data-testid="transpose-down">
              −1
            </button>
            <span className="mono" data-testid="transpose-val">
              {transpose >= 0 ? `+${transpose}` : transpose}
            </span>
            <button className="btn" onClick={() => setTranspose(transpose + 1)} data-testid="transpose-up">
              +1
            </button>
            <label className="chk">
              <input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} data-testid="toggle-chords" />
              Chords
            </label>
            <label className="chk">
              <input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} data-testid="toggle-notes" />
              Notes
            </label>
          </div>

          {showChords && (
            <div className="song-chords">
              <div className="song-current">
                <div className="song-prev" data-testid="chord-prev">
                  {prev && prev.label !== 'NO_CHORD' ? transposeChordLabel(prev.label, transpose) : ''}
                </div>
                <div className="song-cur" data-testid="song-chord">
                  {shownCur ?? '···'}
                </div>
                <div className="song-prev" data-testid="chord-next">
                  {next && next.label !== 'NO_CHORD' ? transposeChordLabel(next.label, transpose) : ''}
                </div>
              </div>
              {shownCur && fingeringFor(shownCur.replace(/^[A-G][#b]?/, (m) => m)) && (
                <ChordDiagram
                  name={shownCur}
                  frets={fingeringFor(cur?.label ?? '') as number[]}
                />
              )}
              <div className="chord-strip" data-testid="chord-strip">
                {a.chords.map((c, i) => (
                  <div
                    key={i}
                    className={`chord-seg${i === chordIdx ? ' active' : ''}${c.label === 'NO_CHORD' ? ' nochord' : ''}`}
                    style={{ flexGrow: Math.max(1, c.end - c.start), flexBasis: 0 }}
                    title={`${c.label} ${fmtTime(c.start)}–${fmtTime(c.end)}`}
                  >
                    {c.end - c.start > 1.2 ? transposeChordLabel(c.label, transpose) : ''}
                  </div>
                ))}
                <div ref={playheadRef} className="playhead" data-testid="playhead" />
              </div>
            </div>
          )}

          {showNotes && (
            <div className="pianoroll" data-testid="pianoroll">
              {renderRoll(a.notes, dur, transpose, midiRange)}
              <div className="song-sounding" data-testid="song-notes">
                {sounding.length > 0 ? sounding.map((s) => s.label).join(' ') : '—'}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function averageChannels(buf: AudioBuffer): Float32Array {
  const ch0 = buf.getChannelData(0);
  if (buf.numberOfChannels < 2) return new Float32Array(ch0);
  const ch1 = buf.getChannelData(1);
  const out = new Float32Array(ch0.length);
  for (let i = 0; i < out.length; i++) out[i] = (ch0[i] + ch1[i]) / 2;
  return out;
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function noteRange(notes: (NoteEvent | NoteGroup)[]): { lo: number; hi: number } {
  let lo = 127;
  let hi = 0;
  for (const n of notes) {
    const midis = isNoteGroup(n) ? n.notes.map((x) => x.midi) : [n.midi];
    for (const m of midis) {
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
  }
  if (hi <= lo) return { lo: 40, hi: 76 };
  return { lo: lo - 1, hi: hi + 1 };
}

function renderRoll(
  notes: (NoteEvent | NoteGroup)[],
  duration: number,
  transpose: number,
  range: { lo: number; hi: number },
): ReactNode {
  const span = Math.max(1, range.hi - range.lo);
  const items: { key: string; left: number; width: number; top: number; midi: number }[] = [];
  for (const n of notes.slice(0, 1500)) {
    const list = isNoteGroup(n)
      ? n.notes.map((x) => ({ midi: x.midi, onset: n.onset, offset: n.offset }))
      : [{ midi: n.midi, onset: n.onset, offset: n.offset }];
    for (const it of list) {
      const m = it.midi + transpose;
      items.push({
        key: `${it.onset}-${it.midi}`,
        left: (it.onset / duration) * 100,
        width: Math.max(0.3, ((it.offset - it.onset) / duration) * 100),
        top: ((range.hi - m) / span) * 100,
        midi: m,
      });
    }
  }
  return (
    <div className="roll" data-testid="roll-blocks">
      {items.map((it) => (
        <div
          key={it.key}
          className="roll-note"
          style={{ left: `${it.left}%`, width: `${it.width}%`, top: `${it.top}%` }}
          title={transposeNoteName(it.midi, 0)}
        />
      ))}
    </div>
  );
}
