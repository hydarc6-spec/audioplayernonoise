/**
 * HighPassFilter.js
 * -----------------
 * Stage 2: removes rumble / handling noise / breath pops below the cutoff
 * (default 80 Hz — below the fundamental of virtually all speech).
 *
 * Implementation: RBJ (Robert Bristow-Johnson) "Audio EQ Cookbook" biquad
 * high-pass, Direct Form I. Chosen over a simple one-pole HPF because it
 * gives a proper 12 dB/octave rolloff with a controllable Q, so it's steep
 * enough to be useful without smearing phase near the cutoff the way a
 * gentler filter would.
 */
export class HighPassFilter {
  /**
   * @param {number} sampleRate
   * @param {number} cutoffHz Default 80 Hz per spec.
   * @param {number} Q Filter resonance/steepness, 0.707 = Butterworth (maximally flat).
   */
  constructor(sampleRate, cutoffHz = 80, Q = 0.707) {
    this.sampleRate = sampleRate;
    this.enabled = true;
    this._x1 = 0; this._x2 = 0; this._y1 = 0; this._y2 = 0;
    this.setCutoff(cutoffHz, Q);
  }

  setCutoff(cutoffHz, Q = this.Q ?? 0.707) {
    this.cutoffHz = cutoffHz;
    this.Q = Q;
    const w0 = (2 * Math.PI * cutoffHz) / this.sampleRate;
    const alpha = Math.sin(w0) / (2 * Q);
    const cosw0 = Math.cos(w0);

    const b0 = (1 + cosw0) / 2;
    const b1 = -(1 + cosw0);
    const b2 = (1 + cosw0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;

    // Normalize by a0 so the process loop doesn't need a division per sample.
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  reset() {
    this._x1 = this._x2 = this._y1 = this._y2 = 0;
  }

  process(block) {
    if (!this.enabled) return block;
    let { b0, b1, b2, a1, a2 } = this;
    let x1 = this._x1, x2 = this._x2, y1 = this._y1, y2 = this._y2;
    for (let i = 0; i < block.length; i++) {
      const x0 = block[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      block[i] = y0;
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
    }
    this._x1 = x1; this._x2 = x2; this._y1 = y1; this._y2 = y2;
    return block;
  }
}
