import { FFT } from './FFT.js';
import { OverlapAddFramework } from './OverlapAddFramework.js';
import { DCBlocker } from './DCBlocker.js';
import { HighPassFilter } from './HighPassFilter.js';
import { AdaptiveNotchFilter } from './NotchFilter.js';
import { SpectralNoiseSuppressor } from './SpectralNoiseSuppressor.js';
import { WienerFilter } from './WienerFilter.js';
import { AGC } from './AGC.js';
import { SoftLimiter } from './SoftLimiter.js';
import { VoiceGate } from './VoiceGate.js';

// Flip to swap the Wiener stage for an RNNoise WASM module implementing
// the same { enabled, process(re, im) } interface. See WienerFilter.js.
const USE_RNNOISE = false;

const FFT_SIZE = 512; // 10.67 ms @ 48kHz analysis window

/**
 * DSPPipeline.js
 * --------------
 * Wires the seven processing stages together in the order specified:
 *   1. DC offset removal
 *   2. High-pass filter
 *   3. Adaptive notch filter (mains hum + harmonics)
 *   4. Spectral noise suppression (FFT)
 *   5. Wiener filter (speech enhancement) [or RNNoise]
 *   6. Automatic gain control
 *   7. Soft limiter
 *
 * Deliberately engine-agnostic: it doesn't know about AudioWorklet,
 * AudioContext, or the DOM, so it's unit-testable on the main thread and
 * reusable if the app is ever ported to a native shell (Electron main
 * process, a React Native audio module, etc). `dsp-worklet-processor.js`
 * is the thin adapter that plugs this into the real-time audio thread.
 *
 * Stages 1-3 and 6-7 are simple per-sample/per-block time-domain filters
 * and run directly on each incoming hop. Stages 4-5 are spectral and
 * share one OverlapAddFramework (STFT) instance so the FFT/IFFT cost is
 * paid once per hop, not twice.
 */
export class DSPPipeline {
  constructor(sampleRate, hopSize) {
    this.sampleRate = sampleRate;
    this.hopSize = hopSize;

    // Time-domain stages (run in signal order 1 -> 2 -> 3 before the FFT,
    // then 6 -> 7 after the FFT, on every hop).
    this.dcBlocker = new DCBlocker(sampleRate);
    this.highPass = new HighPassFilter(sampleRate, 80);
    this.notch = new AdaptiveNotchFilter(sampleRate, 'auto', 3);
    this.agc = new AGC(sampleRate);
    this.voiceGate = new VoiceGate(sampleRate);
    this.limiter = new SoftLimiter(0.89);

    // Spectral stages (run inside the STFT callback).
    this._fft = new FFT(FFT_SIZE);
    this._ola = new OverlapAddFramework(this._fft, hopSize);
    this.noiseSuppressor = new SpectralNoiseSuppressor(FFT_SIZE);
    this.wiener = USE_RNNOISE ? null /* RNNoiseAdapter would go here */
                               : new WienerFilter(FFT_SIZE, this.noiseSuppressor);

    this._scratchOut = new Float32Array(hopSize);

    // Bypass: when true, process() just copies input -> output untouched.
    // Used for the instant original/processed A|B switch at the engine level
    // as a belt-and-braces option (the primary switch mechanism is graph
    // routing in AudioEngine, this is a fallback if a single node is reused).
    this.bypass = false;
  }

  /**
   * Processes one hop (block) of audio in place.
   * @param {Float32Array} block length === hopSize
   */
  process(block) {
    if (this.bypass) return block;

    // Stages 1-3: time domain, cheap, run first so the FFT stages see
    // already-cleaned input (removing DC/rumble/hum before spectral
    // analysis avoids them polluting the noise floor estimate).
    this.dcBlocker.process(block);
    this.highPass.process(block);
    this.notch.process(block);

    // Stages 4-5: spectral domain via shared STFT.
    this._ola.process(block, this._scratchOut, (re, im) => {
      this.noiseSuppressor.process(re, im);
      if (this.wiener) this.wiener.process(re, im);
    });
    block.set(this._scratchOut);

    this.voiceGate.process(block);

    // Stages 6-7: time domain, run last on the cleaned+enhanced signal.
    this.agc.process(block);
    this.limiter.process(block);

    return block;
  }

  /** Applies a full settings object from the UI in one call. */
  applySettings(settings) {
    if (settings.dcBlockerEnabled !== undefined) this.dcBlocker.enabled = settings.dcBlockerEnabled;

    if (settings.highPassEnabled !== undefined) this.highPass.enabled = settings.highPassEnabled;
    if (settings.highPassCutoffHz !== undefined) this.highPass.setCutoff(settings.highPassCutoffHz);

    if (settings.notchEnabled !== undefined) this.notch.enabled = settings.notchEnabled;
    if (settings.notchMode !== undefined) this.notch.setMode(settings.notchMode);

    if (settings.noiseSuppressionEnabled !== undefined) this.noiseSuppressor.enabled = settings.noiseSuppressionEnabled;
    if (settings.noiseReductionStrength !== undefined) this.noiseSuppressor.setStrength(settings.noiseReductionStrength);

    if (this.wiener) {
      if (settings.voiceEnhancementEnabled !== undefined) this.wiener.enabled = settings.voiceEnhancementEnabled;
      if (settings.voiceEnhancement !== undefined) this.wiener.setVoiceEnhancement(settings.voiceEnhancement);
    }

    if (settings.voiceGateEnabled !== undefined) this.voiceGate.enabled = settings.voiceGateEnabled;
    if (settings.voiceGateAmount !== undefined) this.voiceGate.setAmount(settings.voiceGateAmount);

    if (settings.agcEnabled !== undefined) this.agc.enabled = settings.agcEnabled;
    if (settings.limiterEnabled !== undefined) this.limiter.enabled = settings.limiterEnabled;
  }

  reset() {
    this.dcBlocker.reset();
    this.highPass.reset();
    this.agc.reset();
    this.voiceGate.reset();
    this._ola.reset();
  }
}
