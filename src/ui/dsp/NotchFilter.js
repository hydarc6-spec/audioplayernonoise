/**
 * NotchFilter.js
 * --------------
 * Stage 3: removes electrical mains hum (50 Hz in most of the world,
 * 60 Hz in the Americas/parts of Asia) plus its harmonics (100/120,
 * 150/180 Hz, ...), which is a very common contaminant picked up by
 * cheap microphone preamps and ungrounded cabling.
 *
 * Two parts:
 *  1. A cascade of narrow-band RBJ notch biquads, one per harmonic.
 *  2. An "auto" mode that estimates whether 50 Hz or 60 Hz is the better
 *     fit by comparing short-term energy in two narrow analysis bands
 *     (49-51 Hz vs 59-61 Hz) using a simple Goertzel-style single-bin
 *     energy estimate — far cheaper than running a full FFT just to
 *     pick a mains frequency.
 */

/** Cheap single-frequency energy estimator (Goertzel algorithm). */
function goertzelPower(block, sampleRate, targetFreq) {
  const N = block.length;
  const k = Math.round((N * targetFreq) / sampleRate);
  const w = (2 * Math.PI * k) / N;
  const cosine = Math.cos(w);
  const coeff = 2 * cosine;
  let s1 = 0, s2 = 0;
  for (let i = 0; i < N; i++) {
    const s0 = block[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

class NotchBiquad {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this._x1 = 0; this._x2 = 0; this._y1 = 0; this._y2 = 0;
  }

  /** Narrow Q so we remove the hum tone without gouging nearby speech content. */
  setFrequency(freqHz, Q = 20) {
    const w0 = (2 * Math.PI * freqHz) / this.sampleRate;
    const alpha = Math.sin(w0) / (2 * Q);
    const cosw0 = Math.cos(w0);

    const b0 = 1;
    const b1 = -2 * cosw0;
    const b2 = 1;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;

    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  process(block) {
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
  }
}

export class AdaptiveNotchFilter {
  /**
   * @param {number} sampleRate
   * @param {'auto'|50|60} mode
   * @param {number} harmonics Number of harmonics to also notch (fundamental + N-1 more).
   */
  constructor(sampleRate, mode = 'auto', harmonics = 3) {
    this.sampleRate = sampleRate;
    this.enabled = true;
    this.mode = mode;
    this.harmonics = harmonics;
    this._detectedBase = 60; // sensible default until first auto-detect pass
    this._stages = [];
    this._rebuildStages();
    // Auto-detection is smoothed across blocks to avoid flip-flopping.
    this._autoScoreEMA50 = 0;
    this._autoScoreEMA60 = 0;
  }

  _rebuildStages() {
    this._stages = [];
    const base = this.mode === 'auto' ? this._detectedBase : this.mode;
    for (let h = 1; h <= this.harmonics; h++) {
      const stage = new NotchBiquad(this.sampleRate);
      const freq = base * h;
      if (freq < this.sampleRate / 2) {
        stage.setFrequency(freq, 20);
        this._stages.push(stage);
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
    this._rebuildStages();
  }

  _updateAutoDetection(block) {
    // Exponential moving average of hum-band energy; ~0.1s time constant
    // at typical block sizes keeps this stable against short-term speech energy.
    const p50 = goertzelPower(block, this.sampleRate, 50);
    const p60 = goertzelPower(block, this.sampleRate, 60);
    const alpha = 0.05;
    this._autoScoreEMA50 += alpha * (p50 - this._autoScoreEMA50);
    this._autoScoreEMA60 += alpha * (p60 - this._autoScoreEMA60);

    const newBase = this._autoScoreEMA60 > this._autoScoreEMA50 ? 60 : 50;
    if (newBase !== this._detectedBase) {
      this._detectedBase = newBase;
      this._rebuildStages();
    }
  }

  process(block) {
    if (!this.enabled) return block;
    if (this.mode === 'auto') this._updateAutoDetection(block);
    for (const stage of this._stages) stage.process(block);
    return block;
  }
}
