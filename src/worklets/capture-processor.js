/**
 * AudioWorklet capture processor: deterministic framing ONLY.
 * No YIN/FFT/chord DSP here — accumulate arbitrary input blocks into
 * fixed frames and transfer them to the DSP Worker via the main thread.
 *
 * SELF-CONTAINED plain JS (no imports): this exact file is shipped to the
 * browser (?raw -> Blob -> audioWorklet.addModule). The canonical,
 * unit-tested framing logic lives in src/lib/audio/frame-assembler.ts;
 * this file mirrors it and is itself tested by driving process() with
 * stubbed worklet globals (see src/test/worklet-artifact.test.ts).
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = (options && options.processorOptions) || {};
    this.frameSize = processorOptions.frameSize || 4096;
    this.buffer = new Float32Array(this.frameSize);
    this.filled = 0;
    this.running = false;
    this.seq = 0;
    this.port.onmessage = (event) => {
      const msg = event && event.data;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'start') {
        this.filled = 0;
        this.running = true;
      } else if (msg.type === 'stop') {
        this.running = false;
        this.filled = 0;
      } else if (msg.type === 'set-frame-size' && msg.frameSize > 0) {
        this.frameSize = msg.frameSize;
        this.buffer = new Float32Array(this.frameSize);
        this.filled = 0;
      }
    };
  }

  pushMono(mono) {
    // NEVER assume a fixed quantum: consume the actual block length.
    let offset = 0;
    while (offset < mono.length) {
      const room = this.frameSize - this.filled;
      const take = Math.min(room, mono.length - offset);
      this.buffer.set(mono.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.frameSize) {
        const frame = this.buffer.slice();
        this.filled = 0;
        this.emit(frame);
      }
    }
  }

  emit(frame) {
    const capturePerf =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : currentTime * 1000;
    this.port.postMessage(
      { type: 'frame', seq: this.seq++, capturePerf, samples: frame },
      [frame.buffer],
    );
  }

  process(inputs) {
    const channels = inputs && inputs[0];
    if (this.running && channels && channels.length > 0 && channels[0].length > 0) {
      if (channels.length === 1) {
        this.pushMono(channels[0]);
      } else {
        // Mono mixdown (average) for multi-channel input.
        const len = channels[0].length;
        const mono = new Float32Array(len);
        for (let i = 0; i < len; i++) {
          let sum = 0;
          for (let c = 0; c < channels.length; c++) sum += channels[c][i];
          mono[i] = sum / channels.length;
        }
        this.pushMono(mono);
      }
    }
    return true; // keep alive
  }
}

registerProcessor('guitar-capture', CaptureProcessor);
