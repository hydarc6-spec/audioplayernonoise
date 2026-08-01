/**
 * SpectralNoiseSuppressor.js
 * ---------------------------
 * Stage 4: broadband noise reduction via spectral subtraction.
 *
 * Algorithm:
 *  1. Estimate a per-bin noise magnitude floor using "minimum statistics":
 *     track a running minimum of each bin's magnitude over a sliding
 *     window (~1.5 s). Speech is intermittent, so the true noise floor
 *     keeps reappearing as the minimum even while someone is talking;
 *     this lets the estimator adapt without needing an explicit
 *     voice-activity detector.
 *  2. Subtract (a scaled version of) that noise estimate from the current
 *     frame's magnitude spectrum, bin by bin, with a spectral floor to
 *     avoid "musical noise" (the metallic warbling artifact classic
 *     over-subtraction produces).
 *  3. `strength` (0-1, from the UI's 0-100% control) scales how
 *     aggressively the floor is subtracted, and how deep the spectral
 *     floor is allowed to go.
 */
export class SpectralNoiseSuppressor {
  constructor(fftSize) {
    this.enabled = true;
    this.strength = 0.5; // 0..1, UI-controlled
    this._numBins = fftSize / 2 + 1;
    this._noiseFloor = new Float32Array(this._numBins).fill(1e-4);
    this._mag = new Float32Array(this._numBins);
    this._smoothedGain = new Float32Array(this._numBins).fill(1);
    // Ring of recent magnitudes per bin for the running-minimum estimate.
    this._minHistoryLen = 12; // ~12 frames * (128/48000)s hop-equivalent window
    this._minHistory = [];
    for (let i = 0; i < this._minHistoryLen; i++) {
      this._minHistory.push(new Float32Array(this._numBins).fill(1e-4));
    }
    this._historyIdx = 0;
  }

  setStrength(pct0to100) {
    this.strength = Math.min(1, Math.max(0, pct0to100 / 100));
  }

  _updateNoiseEstimate(mag, peakProtectionThreshold = Infinity) {
    const cur = this._minHistory[this._historyIdx];
    for (let b = 0; b < this._numBins; b++) {
      // Keep the speech harmonics out of the noise model, while still
      // learning the weaker surrounding fan/air noise during speech.
      if (mag[b] < peakProtectionThreshold) cur[b] = mag[b];
    }
    this._historyIdx = (this._historyIdx + 1) % this._minHistoryLen;

    for (let b = 0; b < this._numBins; b++) {
      let m = Infinity;
      for (let h = 0; h < this._minHistoryLen; h++) {
        const v = this._minHistory[h][b];
        if (v < m) m = v;
      }
      this._noiseFloor[b] = m;
    }
  }

  /**
   * @param {Float32Array} re, im  Full-size (fftSize) spectrum, mutated in place.
   *                                Only the first numBins are physically meaningful
   *                                for a real input; the mirror half is reconstructed
   *                                by symmetry after processing.
   */
  process(re, im) {
    if (!this.enabled) return;
    const numBins = this._numBins;
    const N = re.length;

    const mag = this._mag;
    let magnitudeSum = 0;
    let peakMagnitude = 0;
    for (let b = 0; b < numBins; b++) {
      const m = Math.hypot(re[b], im[b]) || 1e-9;
      mag[b] = m;
      magnitudeSum += m;
      if (m > peakMagnitude) peakMagnitude = m;
    }

    // A voiced frame has a few strong harmonic peaks, unlike steady fan
    // noise. Do not add those peaks to the noise model: doing so causes the
    // model to alternately remove and restore a clean voice every STFT hop.
    const meanMagnitude = magnitudeSum / numBins;
    const voicedFrame = peakMagnitude > meanMagnitude * 6;
    this._updateNoiseEstimate(mag, voicedFrame ? meanMagnitude * 3 : Infinity);

    // Over-subtraction factor and spectral floor both scale with `strength`:
    // higher strength => subtract more of the noise estimate, and allow the
    // result to be pushed further down before floor-clamping kicks in.
    const overSubtraction = 1 + 3.5 * this.strength; // 1x (off) .. 4.5x (max)
    const spectralFloor = 0.25 - 0.22 * this.strength; // 0.25 (gentle) .. 0.03 (max)

    for (let b = 0; b < numBins; b++) {
      const targetGain = Math.max(
        1 - (overSubtraction * this._noiseFloor[b]) / Math.max(mag[b], 1e-9),
        spectralFloor
      );
      const previousGain = this._smoothedGain[b];
      // Let speech onsets recover promptly, but turn noise down gradually.
      // This removes the audible frame-to-frame "jumping" or pumping.
      const smoothing = targetGain > previousGain ? 0.45 : 0.15;
      const gain = previousGain + smoothing * (targetGain - previousGain);
      this._smoothedGain[b] = gain;
      re[b] *= gain;
      im[b] *= gain;
    }

    // Rebuild the conjugate-symmetric upper half so the inverse FFT of a
    // real-valued original signal stays real-valued.
    for (let b = 1; b < numBins - 1; b++) {
      re[N - b] = re[b];
      im[N - b] = -im[b];
    }
  }
}
