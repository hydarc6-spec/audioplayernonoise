/**
 * DCBlocker.js
 * ------------
 * Stage 1 of the pipeline: removes DC offset (a constant bias in the
 * waveform, usually from cheap ADC hardware) that would otherwise:
 *  - waste headroom before the limiter,
 *  - bias the high-pass filter's transient response,
 *  - and show up as a spike at bin 0 in the FFT-based stages.
 *
 * Implementation: classic one-pole DC blocker (a first-order high-pass
 * with a pole almost at DC):
 *
 *   y[n] = x[n] - x[n-1] + R * y[n-1]
 *
 * R close to 1 (e.g. 0.995) pushes the cutoff very close to 0 Hz so it
 * only removes true DC / sub-audible drift, not low bass content — that
 * job belongs to the tunable high-pass filter in the next stage.
 */
export class DCBlocker {
  constructor(sampleRate) {
    this.R = 1 - (30 / sampleRate); // cutoff ~a few Hz, scales with sample rate
    this._prevX = 0;
    this._prevY = 0;
    this.enabled = true;
  }

  reset() {
    this._prevX = 0;
    this._prevY = 0;
  }

  /** Processes one block in place. */
  process(block) {
    if (!this.enabled) return block;
    let x1 = this._prevX;
    let y1 = this._prevY;
    for (let i = 0; i < block.length; i++) {
      const x0 = block[i];
      const y0 = x0 - x1 + this.R * y1;
      block[i] = y0;
      x1 = x0;
      y1 = y0;
    }
    this._prevX = x1;
    this._prevY = y1;
    return block;
  }
}
