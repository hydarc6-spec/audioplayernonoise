/**
 * WienerFilter.js
 * ----------------
 * Stage 5: speech enhancement via a decision-directed Wiener gain
 * (Ephraim & Malah-style a-priori SNR estimation). This runs *after*
 * spectral subtraction and focuses specifically on shaping the residual
 * spectrum toward speech, rather than just knocking down a static noise
 * floor.
 *
 * Per bin, per frame:
 *   a-posteriori SNR:  gamma = |Y|^2 / N_floor^2
 *   a-priori SNR (decision-directed):
 *       xi = alpha * (Ghat_prev^2 * gamma_prev) + (1 - alpha) * max(gamma - 1, 0)
 *   Wiener gain:  G = xi / (1 + xi)
 *
 * `alpha` (~0.98) trades responsiveness for smoothness -- higher alpha
 * gives less musical-noise but slower tracking of fast speech onsets.
 * The `voiceEnhancement` UI control blends between the raw Wiener gain
 * (more aggressive/natural at higher settings) and a gentler sqrt-shaped
 * gain (safer, less residual distortion) at lower settings.
 *
 * ---- Swapping in RNNoise ----
 * RNNoise (Xiph.org) computes a similar per-band gain but via a small
 * trained RNN over 22 Bark-scale bands instead of a closed-form SNR
 * estimator, generally with better results on non-stationary noise. To
 * use it: compile the rnnoise C sources with Emscripten, expose a
 * `processFrame(pcmFrame: Float32Array) -> Float32Array` export, and
 * give it an `enabled`/`process(re, im)` interface matching this class.
 * DSPPipeline.js only depends on that interface, so no other file needs
 * to change (see the USE_RNNOISE flag in DSPPipeline.js).
 */
export class WienerFilter {
  constructor(fftSize, noiseSuppressor) {
    this.enabled = true;
    this.voiceEnhancement = 0.5; // 0..1 UI control
    this._numBins = fftSize / 2 + 1;
    this._noiseSuppressor = noiseSuppressor; // reuse its noise floor estimate
    this._prevGain = new Float32Array(this._numBins).fill(1);
    this._prevGamma = new Float32Array(this._numBins).fill(1);
    this._alpha = 0.98;
  }

  setVoiceEnhancement(pct0to100) {
    this.voiceEnhancement = Math.min(1, Math.max(0, pct0to100 / 100));
  }

  process(re, im) {
    if (!this.enabled) return;
    const numBins = this._numBins;
    const N = re.length;
    const noiseFloor = this._noiseSuppressor._noiseFloor; // Float32Array, len numBins

    for (let b = 0; b < numBins; b++) {
      const magSq = re[b] * re[b] + im[b] * im[b];
      const noiseSq = Math.max(noiseFloor[b] * noiseFloor[b], 1e-12);

      const gamma = magSq / noiseSq; // a-posteriori SNR
      const prioriRaw = Math.max(gamma - 1, 0);
      const decisionDirected =
        this._alpha * (this._prevGain[b] * this._prevGain[b] * this._prevGamma[b]) +
        (1 - this._alpha) * prioriRaw;

      const wienerGain = decisionDirected / (1 + decisionDirected);
      // Gentler alternative: sqrt-shaped gain preserves more of the signal,
      // at the cost of less noise removal. Blend by voiceEnhancement.
      const gentleGain = Math.sqrt(wienerGain);
      const gain = this.voiceEnhancement * wienerGain + (1 - this.voiceEnhancement) * gentleGain;

      re[b] *= gain;
      im[b] *= gain;

      this._prevGain[b] = gain;
      this._prevGamma[b] = gamma;
    }

    for (let b = 1; b < numBins - 1; b++) {
      re[N - b] = re[b];
      im[N - b] = -im[b];
    }
  }
}
