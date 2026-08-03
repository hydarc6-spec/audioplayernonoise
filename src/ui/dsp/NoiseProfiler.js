import { FFT } from './FFT.js';

/**
 * NoiseProfiler.js
 * ----------------
 * Offline, whole-file noise floor estimator.
 *
 * The real-time SpectralNoiseSuppressor has to estimate the noise floor
 * causally, one hop at a time, because during live playback it can only
 * see the past. For this app, though, files are fully decoded to PCM
 * *before* playback starts (see AudioLoader / AudioEngine.loadFile) --
 * the whole recording is sitting in memory. That means we don't have to
 * settle for a causal guess: we can scan the entire file once, up front,
 * and compute a per-bin noise floor from a low percentile of that bin's
 * magnitude across every frame in the recording.
 *
 * Why a percentile instead of a true minimum: a straight minimum is
 * fragile (one outlier near-silent frame, or a frame with a deep spectral
 * null, can pin the estimate too low). A low percentile (default 15th)
 * is far more robust while still reliably falling below where speech
 * energy sits for the majority of the file, since speech is intermittent
 * and steady-state noise (fan hum, line hiss, AC) is not.
 *
 * This runs once per loaded file, off the audio thread, so it isn't
 * bound by the same <30ms budget as the AudioWorklet path -- it can
 * afford a full pass over a multi-minute call recording.
 *
 * Output feeds two things in SpectralNoiseSuppressor:
 *   1. An initial seed for the causal floor, so suppression is at full
 *      strength from sample zero instead of needing a few seconds to
 *      warm up (see setHopSeconds/_riseTau in SpectralNoiseSuppressor).
 *   2. A per-bin anchor ceiling, so a long run of continuous speech can't
 *      drag the causal estimate upward far past what the whole-file
 *      analysis says the true noise floor is.
 */
export class NoiseProfiler {
  /**
   * @param {Float32Array} samples Mono PCM, any length.
   * @param {number} sampleRate
   * @param {object} [opts]
   * @param {number} [opts.fftSize] Must match the pipeline's analysis size (512).
   * @param {number} [opts.hopSize] Analysis hop for profiling (doesn't need
   *   to match playback hop; a larger hop here just means fewer frames to
   *   scan and is fine since we're not reconstructing audio).
   * @param {number} [opts.percentile] 0..1, e.g. 0.15 = 15th percentile.
   * @param {number} [opts.maxFrames] Safety cap so pathologically long
   *   files still profile in bounded time (subsamples evenly if exceeded).
   * @returns {Float32Array} length fftSize/2+1, linear-magnitude noise floor per bin.
   */
  static computeProfile(samples, sampleRate, opts = {}) {
    const fftSize = opts.fftSize ?? 512;
    const hopSize = opts.hopSize ?? 256;
    const percentile = opts.percentile ?? 0.15;
    const maxFrames = opts.maxFrames ?? 20000; // ~4.3 min of audio at 256-hop/48kHz before subsampling kicks in

    const numBins = fftSize / 2 + 1;
    const totalFrames = Math.max(0, Math.floor((samples.length - fftSize) / hopSize) + 1);
    if (totalFrames <= 0) return new Float32Array(numBins).fill(1e-4);

    // If the file is very long, stride through frames evenly rather than
    // scanning all of them, to keep this a bounded, fast pre-pass.
    const frameStride = Math.max(1, Math.floor(totalFrames / maxFrames));
    const framesToUse = Math.floor(totalFrames / frameStride);

    // Log-magnitude histogram per bin: cheap, fixed-memory percentile
    // extraction without holding every frame's magnitude in RAM.
    const HIST_BINS = 96;
    const DB_MIN = -100, DB_MAX = 20; // covers silence floor up to loud speech
    const hist = new Uint32Array(numBins * HIST_BINS);

    const fft = new FFT(fftSize);
    const window = NoiseProfiler._hann(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    for (let f = 0; f < framesToUse; f++) {
      const start = f * frameStride * hopSize;
      if (start + fftSize > samples.length) break;

      for (let i = 0; i < fftSize; i++) {
        re[i] = samples[start + i] * window[i];
        im[i] = 0;
      }
      fft.forward(re, im);

      for (let b = 0; b < numBins; b++) {
        const mag = Math.hypot(re[b], im[b]) || 1e-9;
        const db = 20 * Math.log10(mag);
        let binIdx = Math.round(((db - DB_MIN) / (DB_MAX - DB_MIN)) * (HIST_BINS - 1));
        if (binIdx < 0) binIdx = 0;
        else if (binIdx >= HIST_BINS) binIdx = HIST_BINS - 1;
        hist[b * HIST_BINS + binIdx]++;
      }
    }

    const profile = new Float32Array(numBins);
    for (let b = 0; b < numBins; b++) {
      let total = 0;
      for (let h = 0; h < HIST_BINS; h++) total += hist[b * HIST_BINS + h];
      if (total === 0) { profile[b] = 1e-4; continue; }

      const target = total * percentile;
      let running = 0;
      let chosenBin = 0;
      for (let h = 0; h < HIST_BINS; h++) {
        running += hist[b * HIST_BINS + h];
        if (running >= target) { chosenBin = h; break; }
      }
      const db = DB_MIN + (chosenBin / (HIST_BINS - 1)) * (DB_MAX - DB_MIN);
      profile[b] = Math.pow(10, db / 20);
    }

    return profile;
  }

  static _hann(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    return w;
  }
}
