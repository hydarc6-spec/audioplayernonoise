/**
 * SoftLimiter.js
 * --------------
 * Stage 7 (final stage): prevents clipping after AGC/upstream gain
 * changes push transients close to full scale.
 *
 * Implementation: tanh-based soft-knee waveshaper rather than a hard
 * clip. Below `threshold` the signal passes through essentially
 * unchanged (tanh is ~linear near 0); as the signal approaches and
 * exceeds the threshold, gain compresses smoothly instead of slicing
 * the waveform flat, which avoids the harsh odd-harmonic distortion
 * hard clipping produces.
 *
 * A short look-ahead peak hold could be added for broadcast-grade
 * "brickwall" limiting, but a memoryless soft-knee is the right
 * complexity/latency trade-off here: it adds *zero* extra latency,
 * which matters given the 30 ms budget.
 */
export class SoftLimiter {
  constructor(threshold = 0.89) {
    this.enabled = true;
    this.threshold = threshold; // linear amplitude, ~ -1 dBFS
  }

  process(block) {
    if (!this.enabled) return block;
    const t = this.threshold;
    for (let i = 0; i < block.length; i++) {
      const x = block[i];
      const ax = Math.abs(x);
      if (ax <= t) {
        // Linear region: leave untouched for transparency.
        continue;
      }
      // Soft-knee region: compress the excess above threshold with tanh,
      // so peaks approach but never exceed 1.0.
      const sign = x < 0 ? -1 : 1;
      const excess = ax - t;
      const compressed = t + (1 - t) * Math.tanh(excess / (1 - t));
      block[i] = sign * compressed;
    }
    return block;
  }
}
