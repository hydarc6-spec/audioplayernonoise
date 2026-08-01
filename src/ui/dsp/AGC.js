/**
 * AGC.js
 * ------
 * Stage 6: Automatic Gain Control. Smoothly rides the output level toward
 * a target RMS so quiet passages (e.g. after aggressive noise suppression
 * has removed both noise *and* some low-level speech energy) get brought
 * back up, and loud passages get gently pulled down before hitting the
 * final limiter.
 *
 * Implementation: classic feed-forward AGC on smoothed RMS, with separate
 * attack (fast, gain reduction on loud transients) and release (slow,
 * gain recovery on quiet passages) time constants -- fast attack avoids
 * overshoot/clipping into the limiter, slow release avoids audible
 * "pumping".
 */
export class AGC {
  constructor(sampleRate, targetRMS = 0.1) {
    this.sampleRate = sampleRate;
    this.enabled = true;
    this.targetRMS = targetRMS;

    this._attackCoeff = Math.exp(-1 / (0.005 * sampleRate));  // 5 ms attack
    this._releaseCoeff = Math.exp(-1 / (0.300 * sampleRate)); // 300 ms release

    this._envelope = targetRMS;
    this._gain = 1;
    this.maxGain = 8;   // +18 dB ceiling, avoid runaway amplification of noise floor
    this.minGain = 0.1; // -20 dB floor
  }

  reset() {
    this._envelope = this.targetRMS;
    this._gain = 1;
  }

  process(block) {
    if (!this.enabled) return block;
    for (let i = 0; i < block.length; i++) {
      const x = block[i];
      const rectified = Math.abs(x);

      // Smooth envelope follower (asymmetric attack/release).
      const coeff = rectified > this._envelope ? this._attackCoeff : this._releaseCoeff;
      this._envelope = coeff * this._envelope + (1 - coeff) * rectified;

      const desiredGain = this.targetRMS / Math.max(this._envelope, 1e-6);
      const clampedGain = Math.min(this.maxGain, Math.max(this.minGain, desiredGain));

      // Smooth the *gain* too (separately from the envelope) to prevent
      // sample-to-sample gain zippering.
      this._gain = 0.995 * this._gain + 0.005 * clampedGain;

      block[i] = x * this._gain;
    }
    return block;
  }
}
