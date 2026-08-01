/**
 * Removes high-frequency microphone air/hiss while preserving the speech
 * range. A Butterworth low-pass is deliberately gentle so voices stay clear.
 */
export class LowPassFilter {
  constructor(sampleRate, cutoffHz = 7000, Q = 0.707) {
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
    const b0 = (1 - cosw0) / 2;
    const b1 = 1 - cosw0;
    const b2 = b0;
    const a0 = 1 + alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cosw0) / a0; this.a2 = (1 - alpha) / a0;
  }

  reset() { this._x1 = this._x2 = this._y1 = this._y2 = 0; }

  process(block) {
    if (!this.enabled) return block;
    let { b0, b1, b2, a1, a2 } = this;
    let x1 = this._x1, x2 = this._x2, y1 = this._y1, y2 = this._y2;
    for (let i = 0; i < block.length; i++) {
      const x0 = block[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      block[i] = y0;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    }
    this._x1 = x1; this._x2 = x2; this._y1 = y1; this._y2 = y2;
    return block;
  }
}
