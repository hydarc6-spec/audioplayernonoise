/**
 * SpectralNoiseSuppressor.js
 * ---------------------------
 * Stage 4: broadband noise reduction via spectral subtraction.
 *
 * Algorithm:
 *  1. Estimate a per-bin noise magnitude floor using a two-timescale
 *     "leaky minimum" follower: the floor drops quickly toward the
 *     current magnitude whenever the signal dips near/below it (fast
 *     fall, ~70 ms), but only creeps upward slowly when the signal is
 *     well above it (slow rise, ~1.5 s). Speech is intermittent, so the
 *     true (lower) noise floor keeps reappearing in the gaps between
 *     words/phonemes and pulls the estimate back down; steady fan/air
 *     noise, being continuous, is what the floor converges to. This
 *     lets the estimator adapt without needing an explicit
 *     voice-activity detector.
 *  2. Subtract (a scaled version of) that noise estimate from the current
 *     frame's magnitude spectrum, bin by bin, with a spectral floor to
 *     avoid "musical noise" (the metallic warbling artifact classic
 *     over-subtraction produces).
 *  3. `strength` (0-1, from the UI's 0-100% control) scales how
 *     aggressively the floor is subtracted, and how deep the spectral
 *     floor is allowed to go.
 *
 * (Previously the floor was tracked as a true running minimum over a
 * 12-frame ring buffer. At the 128-sample/48kHz hop used by this
 * pipeline that's only a ~32ms window -- nearly 50x shorter than the
 * ~1.5s window this stage is designed around. A window that short
 * reacts to quiet dips *inside* speech -- between phonemes, on breaths
 * -- as if they were the noise floor, so it both under-estimates the
 * true (higher, but steadier) fan-noise level, and ends up carving
 * pieces out of voiced speech. The leaky-follower below is O(numBins)
 * per hop, no history buffer needed, and its rise time constant is the
 * actual ~1.5s the design intends.)
 */
export class SpectralNoiseSuppressor {
  constructor(fftSize) {
    this.enabled = true;
    this.strength = 0.5; // 0..1, UI-controlled
    this._numBins = fftSize / 2 + 1;
    this._noiseFloor = new Float32Array(this._numBins).fill(1e-4);
    this._mag = new Float32Array(this._numBins);
    this._smoothedGain = new Float32Array(this._numBins).fill(1);

    // Leaky-minimum time constants, expressed as per-hop pole
    // coefficients. Defaults assume the pipeline's usual 128-sample/48kHz
    // hop (~2.67ms); setHopSeconds() recomputes them if that differs.
    this._fallTau = 0.07;  // seconds; floor tracks downward dips quickly
    this._riseTau = 1.5;   // seconds; floor creeps upward slowly
    this.setHopSeconds(128 / 48000);
  }

  setStrength(pct0to100) {
    this.strength = Math.min(1, Math.max(0, pct0to100 / 100));
  }

  /** Recomputes the fall/rise pole coefficients for a given hop duration. */
  setHopSeconds(hopSeconds) {
    this._fallCoeff = Math.exp(-hopSeconds / this._fallTau);
    this._riseCoeff = Math.exp(-hopSeconds / this._riseTau);
  }

  /**
   * Seeds the causal floor from an offline whole-file profile (see
   * NoiseProfiler.js) so suppression is at full strength from the first
   * frame instead of needing ~1.5s to warm up from near-zero, and sets an
   * anchor ceiling so long stretches of continuous speech can't drag the
   * causal estimate upward past what the whole-file analysis found.
   * `anchorRatio` bounds the causal floor to at most this many times the
   * offline profile per bin (default 3x -- generous enough to track a
   * genuinely rising noise floor, e.g. fan speed increasing mid-call).
   */
  seedNoiseFloor(profile, anchorRatio = 3) {
    if (!profile || profile.length !== this._numBins) return;
    this._noiseFloor.set(profile);
    if (!this._anchor) this._anchor = new Float32Array(this._numBins);
    this._anchor.set(profile);
    this._anchorRatio = anchorRatio;
  }

  _updateNoiseEstimate(mag, peakProtectionThreshold = Infinity) {
    const floor = this._noiseFloor;
    const fallCoeff = this._fallCoeff;
    const riseCoeff = this._riseCoeff;
    for (let b = 0; b < this._numBins; b++) {
      // Keep speech harmonics out of the noise model entirely (don't let
      // them pull the floor up at all), while still learning the weaker
      // surrounding fan/air noise during speech.
      if (mag[b] >= peakProtectionThreshold) continue;

      const m = mag[b];
      const f = floor[b];
      let next = m < f
        ? fallCoeff * f + (1 - fallCoeff) * m   // fast fall toward dips
        : riseCoeff * f + (1 - riseCoeff) * m;  // slow rise otherwise

      if (this._anchor) {
        const ceiling = this._anchor[b] * this._anchorRatio;
        if (next > ceiling) next = ceiling;
      }
      floor[b] = next;
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
