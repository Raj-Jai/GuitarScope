import { useEffect, useRef } from 'react';
import { magnitudeSpectrum } from '../lib/dsp/fft';
import { applyHannWindow, removeDcOffset } from '../lib/dsp/windowing';

/**
 * Waveform + spectrum canvases, drawn imperatively on rAF (no React
 * re-renders per animation frame). Sources: live AnalyserNode (mic) or
 * the latest demo frame (synthetic path).
 */
export function SignalCanvas({
  analyser,
  demoFrameRef,
  listening,
}: {
  analyser: AnalyserNode | null;
  demoFrameRef: { current: Float32Array | null };
  listening: boolean;
}) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef({ analyser, demoFrameRef });
  useEffect(() => {
    sourceRef.current = { analyser, demoFrameRef };
  });

  useEffect(() => {
    let raf = 0;
    const wave = waveRef.current;
    const spec = specRef.current;
    if (!wave || !spec) return;
    const wctx = wave.getContext('2d');
    const sctx = spec.getContext('2d');
    if (!wctx || !sctx) return;

    const timeData: Float32Array<ArrayBuffer> = new Float32Array(4096);
    const freqData: Float32Array<ArrayBuffer> = new Float32Array(2048);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { analyser: an, demoFrameRef: ref } = sourceRef.current;
      const demoFrame = !an ? ref.current : null;
      if (!an && !demoFrame) return; // idle: leave canvases blank
      const w = wave.clientWidth;
      const h = wave.clientHeight;
      if (wave.width !== w * 2) {
        wave.width = w * 2;
        wave.height = h * 2;
      }
      if (spec.width !== w * 2) {
        spec.width = w * 2;
        spec.height = h * 2;
      }
      drawWave(wctx, w, h, an, demoFrame, timeData);
      drawSpectrum(sctx, w, h, an, demoFrame, freqData);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="panel signal" aria-label="Signal diagnostics">
      <div className="panel-title">Signal</div>
      {!listening && <div className="tuner-sub">Waveform and spectrum appear while listening</div>}
      <div className="signal-grid">
        <div>
          <div className="label">Waveform</div>
          <canvas ref={waveRef} className="scope" data-testid="waveform" />
        </div>
        <div>
          <div className="label">Spectrum (40 Hz – 4 kHz, log)</div>
          <canvas ref={specRef} className="scope" data-testid="spectrum" />
        </div>
      </div>
    </section>
  );
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  analyser: AnalyserNode | null,
  demoFrame: Float32Array | null,
  scratch: Float32Array<ArrayBuffer>,
): void {
  let data: ArrayLike<number> = scratch;
  if (analyser) {
    analyser.getFloatTimeDomainData(scratch);
  } else if (demoFrame) {
    data = demoFrame;
  } else {
    return;
  }
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#7dd3a8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(data.length / w));
  for (let x = 0; x < w; x++) {
    const v = data[Math.min(data.length - 1, x * step)];
    const y = h / 2 - v * (h / 2 - 4);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  analyser: AnalyserNode | null,
  demoFrame: Float32Array | null,
  scratch: Float32Array<ArrayBuffer>,
): void {
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const minF = 40;
  const maxF = 4000;
  const sampleRate = analyser ? analyser.context.sampleRate : 48000;
  const hi = Math.min(maxF, sampleRate / 2);
  const toX = (f: number) =>
    ((Math.log(f) - Math.log(minF)) / (Math.log(hi) - Math.log(minF))) * w;
  ctx.fillStyle = '#c084fc';

  if (analyser) {
    analyser.getFloatFrequencyData(scratch);
    const binHz = sampleRate / analyser.fftSize;
    const toY = (db: number) => {
      const clamped = Math.max(-100, Math.min(-20, db));
      return h - ((clamped + 100) / 80) * h;
    };
    let prevX = -1;
    for (let k = 1; k < scratch.length; k++) {
      const f = k * binHz;
      if (f < minF || f > hi) continue;
      const x = Math.floor(toX(f));
      if (x === prevX) continue;
      prevX = x;
      const y = toY(scratch[k]);
      ctx.fillRect(x, y, 1, h - y);
    }
    return;
  }

  if (demoFrame) {
    // Lightweight main-thread FFT of the latest demo frame (4096pt, ~1ms).
    const copy = new Float32Array(demoFrame);
    const mag = magnitudeSpectrum(applyHannWindow(removeDcOffset(copy)));
    let peak = 0;
    for (let k = 0; k < mag.length; k++) if (mag[k] > peak) peak = mag[k];
    if (peak <= 0) return;
    const binHz = sampleRate / demoFrame.length;
    let prevX = -1;
    for (let k = 1; k < mag.length; k++) {
      const f = k * binHz;
      if (f < minF || f > hi) continue;
      const x = Math.floor(toX(f));
      if (x === prevX) continue;
      prevX = x;
      const norm = mag[k] / peak; // 0..1
      const barH = norm * (h - 6);
      ctx.fillRect(x, h - barH, 1, barH);
    }
  }
}
