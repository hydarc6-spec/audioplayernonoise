/**
 * OverlapAddFramework.js
 * -----------------------
 * Shared STFT (short-time Fourier transform) analysis/synthesis engine
 * used by both SpectralNoiseSuppressor and WienerFilter, since they're
 * both "look at the spectrum, compute a gain per bin, come back to time
 * domain" stages. Sharing one FFT/OLA engine (rather than each stage
 * running its own) halves the transform cost for the pair.
 *
 * Frame size 512 @ 48 kHz = 10.67 ms analysis window; hop size 128
 * (= worklet quantum) gives 4x overlap, which is enough for a Hann
 * window to satisfy the constant-overlap-add (COLA) condition with
 * negligible artifacts, while keeping algorithmic latency at one frame
 * (~10.7 ms) — comfortably inside the 30 ms budget.
 */
export class OverlapAddFramework {
  constructor(fft, hopSize) {
    this.fft = fft;
    this.frameSize = fft.size;
    this.hopSize = hopSize;

    this.window = OverlapAddFramework._hann(this.frameSize);

    // Circular input ring buffer + output accumulation buffer.
    this._inputRing = new Float32Array(this.frameSize);
    this._outputAccum = new Float32Array(this.frameSize);
    this._normalizationAccum = new Float32Array(this.frameSize);
    this._writePos = 0;
    this._samplesSinceFrame = 0;

    this._re = new Float32Array(this.frameSize);
    this._im = new Float32Array(this.frameSize);
  }

  static _hann(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    }
    return w;
  }

  /**
   * Feeds `hopSize` new input samples and, once enough history has
   * accumulated, runs one analysis -> spectralProcessor -> synthesis
   * pass, writing `hopSize` output samples into `outBlock`.
   *
   * @param {Float32Array} inBlock length === hopSize
   * @param {Float32Array} outBlock length === hopSize (written in place)
   * @param {(mag: Float32Array, phaseRe: Float32Array, phaseIm: Float32Array, re: Float32Array, im: Float32Array) => void} spectralProcessor
   *        Callback that mutates re/im in place (or uses mag to build gains).
   */
  process(inBlock, outBlock, spectralProcessor) {
    const N = this.frameSize;
    const H = this.hopSize;

    // Shift ring buffer left by H and append new hop at the end.
    // (H << N so this memmove is cheap relative to the FFT itself.)
    this._inputRing.copyWithin(0, H, N);
    this._inputRing.set(inBlock, N - H);

    // Windowed analysis frame -> FFT
    for (let i = 0; i < N; i++) {
      this._re[i] = this._inputRing[i] * this.window[i];
      this._im[i] = 0;
    }
    this.fft.forward(this._re, this._im);

    // Caller mutates spectrum (magnitude-domain gain application etc.)
    spectralProcessor(this._re, this._im);

    // Synthesis
    this.fft.inverse(this._re, this._im);

    // Overlap-add into the accumulation buffer (apply synthesis window too
    // for a proper COLA reconstruction).
    for (let i = 0; i < N; i++) {
      this._outputAccum[i] += this._re[i] * this.window[i];
      this._normalizationAccum[i] += this.window[i] * this.window[i];
    }

    // The oldest H samples of the accumulator are now finished (no more
    // future frames will contribute to them) -> emit as output.
    for (let i = 0; i < H; i++) {
      outBlock[i] = this._outputAccum[i] / Math.max(this._normalizationAccum[i], 1e-8);
    }
    this._outputAccum.copyWithin(0, H, N);
    this._normalizationAccum.copyWithin(0, H, N);
    this._outputAccum.fill(0, N - H, N);
    this._normalizationAccum.fill(0, N - H, N);
  }

  reset() {
    this._inputRing.fill(0);
    this._outputAccum.fill(0);
    this._normalizationAccum.fill(0);
  }
}
