/**
 * SpeechClarityFilter.js
 * -----------------------
 * Optional stage: a presence-band peaking boost centered around 2.8kHz,
 * where consonant energy (the part of speech that carries most of a
 * word's *intelligibility*, as opposed to its loudness) sits. Spectral
 * noise suppression and the Wiener filter both tend to shave a bit off
 * this region along with the noise, since consonants are naturally
 * lower-energy than vowels and can look noise-like to a bin-by-bin gain
 * estimator. This stage runs after those stages and gives that band back
 * a controlled boost, which is specifically aimed at recovering spoken
 * *content* (understanding what was said) rather than just loudness or
 * general tone -- distinct from what the AGC/limiter do.
 *
 * Implementation: RBJ (Audio EQ Cookbook) peaking biquad, Direct Form I.
 * `amount` (0-100 from the UI) maps to 0-8 dB of boost at ~2.8kHz.
 */
export class SpeechClarityFilter {
  /**
   * @param {number} sampleRate
   * @param {number} freqHz Center frequency of the presence boost.
   * @param {number} Q Bandwidth of the boost; ~1.0 covers roughly 2-4kHz.
   */
  constructor(sampleRate, freqHz = 2800, Q = 1.0) {
    this.sampleRate = sampleRate;
    this.enabled = true;
    this.freqHz = freqHz;
    this.Q = Q;
    this._x1 = 0; this._x2 = 0; this._y1 = 0; this._y2 = 0;
    this.setAmount(0);
  }

  /** @param {number} pct0to100 Maps linearly to 0-8 dB of boost. */
  setAmount(pct0to100) {
    this.amount = Math.min(1, Math.max(0, pct0to100 / 100));
    this._recompute(this.amount * 8);
  }

  _recompute(gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * this.freqHz) / this.sampleRate;
    const alpha = Math.sin(w0) / (2 * this.Q);
    const cosw0 = Math.cos(w0);

    const b0 = 1 + alpha * A;
    const b1 = -2 * cosw0;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha / A;

    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  reset() {
    this._x1 = this._x2 = this._y1 = this._y2 = 0;
  }

  process(block) {
    if (!this.enabled || this.amount === 0) return block;
    const { b0, b1, b2, a1, a2 } = this;
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
