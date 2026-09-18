/** Windowing + preprocessing helpers (pure functions). */

/** Apply a Hann window in place. */
export function applyHannWindow(frame: Float32Array): Float32Array {
  const n = frame.length;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    frame[i] *= w;
  }
  return frame;
}

/** Remove DC offset in place (subtract mean). */
export function removeDcOffset(frame: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < frame.length; i++) mean += frame[i];
  mean /= Math.max(1, frame.length);
  for (let i = 0; i < frame.length; i++) frame[i] -= mean;
  return frame;
}

/** Next power of two >= n. */
export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 1 << Math.ceil(Math.log2(n));
}

/** Is n a power of two? */
export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}
