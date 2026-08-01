/** Keeps residual fan noise down during pauses without clipping word endings. */
export class VoiceGate {
  constructor(sampleRate) {
    this.enabled = true;
    this.amount = 0.6;
    this._level = 0.02;
    this._noise = 0.003;
    this._gain = 1;
    this._attack = Math.exp(-1 / (0.008 * sampleRate));
    this._release = Math.exp(-1 / (0.18 * sampleRate));
    this._noiseRise = Math.exp(-1 / (1.5 * sampleRate));
    this._noiseFall = Math.exp(-1 / (0.08 * sampleRate));
  }

  setAmount(percent) { this.amount = Math.min(1, Math.max(0, percent / 100)); }

  reset() { this._level = 0.02; this._noise = 0.003; this._gain = 1; }

  process(block) {
    if (!this.enabled || this.amount === 0) return block;
    for (let i = 0; i < block.length; i++) {
      const level = Math.abs(block[i]);
      const levelCoeff = level > this._level ? this._attack : this._release;
      this._level = levelCoeff * this._level + (1 - levelCoeff) * level;
      // Only learn from quiet material, so speech is never considered noise.
      if (level < this._noise * 2.5) {
        const noiseCoeff = level > this._noise ? this._noiseRise : this._noiseFall;
        this._noise = noiseCoeff * this._noise + (1 - noiseCoeff) * level;
      }
      const threshold = Math.max(0.006, this._noise * 3.2);
      const closedGain = 1 - 0.88 * this.amount;
      const target = this._level >= threshold ? 1 : closedGain + (1 - closedGain) * (this._level / threshold);
      const gainCoeff = target < this._gain ? this._attack : this._release;
      this._gain = gainCoeff * this._gain + (1 - gainCoeff) * target;
      block[i] *= this._gain;
    }
    return block;
  }
}
