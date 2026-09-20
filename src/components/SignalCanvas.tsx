import { useEffect, useRef } from 'react';

/**
 * Waveform + spectrum canvases driven by AnalyserNode on rAF.
 * Draws imperatively (no React re-renders per animation frame).
 * Both mic and (audible) demo modes provide an analyser tap.
 */
export function SignalCanvas({
  analyser,
  listening,
  targetFrequency = null,
}: {
  analyser: AnalyserNode | null;
  listening: boolean;
  /** Active open-string target: drawn as a marker + label on the spectrum (P1-7). */
  targetFrequency?: number | null;
}) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const targetRef = useRef<number | null>(null);
  useEffect(() => {
    analyserRef.current = analyser;
  });
  useEffect(() => {
    targetRef.current = targetFrequency ?? null;
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
      drawSpectrum(sctx, w, h, an, freqData, targetRef.current);
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
          <canvas
            ref={waveRef}
            className="scope"
            data-testid="waveform"
            role="img"
            aria-label="Waveform display (supplementary — tuning readout is in the Tuner panel)"
          />
        </div>
        <div>
          <div className="label">Spectrum (40 Hz – 4 kHz, log)</div>
          <canvas
            ref={specRef}
            className="scope"
            data-testid="spectrum"
            role="img"
            aria-label="Spectrum display with open-string target marker (supplementary — tuning readout is in the Tuner panel)"
          />
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
  targetFreq: number | null,
): void {
  analyser.getFloatFrequencyData(scratch);
  const sampleRate = analyser.context.sampleRate;
  const minF = 40;
  const hi = Math.min(4000, sampleRate / 2);
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#c084fc';
  // Bottom 14px reserved for the frequency axis (P1-7).
  const ph = Math.max(20, h - 14);
  const binHz = sampleRate / analyser.fftSize;
  const toX = (f: number) =>
    ((Math.log(f) - Math.log(minF)) / (Math.log(hi) - Math.log(minF))) * w;
  const toY = (db: number) => {
    const clamped = Math.max(-100, Math.min(-20, db));
    return ph - ((clamped + 100) / 80) * ph;
  };
  let prevX = -1;
  for (let k = 1; k < scratch.length; k++) {
    const f = k * binHz;
    if (f < minF || f > hi) continue;
    const x = Math.floor(toX(f));
    if (x === prevX) continue;
    prevX = x;
    const y = toY(scratch[k]);
    ctx.fillRect(x, y, 1, ph - y);
  }
  // Frequency axis ticks (P1-7).
  ctx.font = '9px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#9aa1b2';
  for (const f of [50, 100, 200, 500, 1000, 2000, 4000]) {
    if (f < minF || f > hi) continue;
    const x = toX(f);
    ctx.fillRect(x, ph, 1, 3);
    const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
    ctx.fillText(label, Math.min(Math.max(x, 10), w - 10), ph + 4);
  }
  // Active-string target marker + annotation (P1-7).
  if (targetFreq !== null && Number.isFinite(targetFreq) && targetFreq >= minF && targetFreq <= hi) {
    const tx = toX(targetFreq);
    ctx.fillStyle = 'rgba(125,211,168,0.85)';
    ctx.fillRect(tx, 0, 1, ph);
    ctx.textAlign = tx > w - 46 ? 'right' : 'left';
    ctx.fillText(`${targetFreq.toFixed(0)} Hz`, tx > w - 46 ? tx - 3 : tx + 3, 2);
  }
}
