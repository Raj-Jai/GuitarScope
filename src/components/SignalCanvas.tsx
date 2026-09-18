import { useEffect, useRef } from 'react';

/**
 * Waveform + spectrum canvases driven by AnalyserNode on rAF.
 * Draws imperatively (no React re-renders per animation frame).
 * Both mic and (audible) demo modes provide an analyser tap.
 */
export function SignalCanvas({
  analyser,
  listening,
}: {
  analyser: AnalyserNode | null;
  listening: boolean;
}) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  useEffect(() => {
    analyserRef.current = analyser;
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
      const an = analyserRef.current;
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
      if (!an) {
        // Idle/stopped: clear stale frames instead of freezing them.
        wctx.setTransform(2, 0, 0, 2, 0, 0);
        wctx.clearRect(0, 0, w, h);
        sctx.setTransform(2, 0, 0, 2, 0, 0);
        sctx.clearRect(0, 0, w, h);
        return;
      }
      drawWave(wctx, w, h, an, timeData);
      drawSpectrum(sctx, w, h, an, freqData);
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
  analyser: AnalyserNode,
  scratch: Float32Array<ArrayBuffer>,
): void {
  analyser.getFloatTimeDomainData(scratch);
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#7dd3a8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(scratch.length / w));
  for (let x = 0; x < w; x++) {
    const v = scratch[Math.min(scratch.length - 1, x * step)];
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
  analyser: AnalyserNode,
  scratch: Float32Array<ArrayBuffer>,
): void {
  analyser.getFloatFrequencyData(scratch);
  const sampleRate = analyser.context.sampleRate;
  const minF = 40;
  const hi = Math.min(4000, sampleRate / 2);
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#c084fc';
  const binHz = sampleRate / analyser.fftSize;
  const toX = (f: number) =>
    ((Math.log(f) - Math.log(minF)) / (Math.log(hi) - Math.log(minF))) * w;
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
}
