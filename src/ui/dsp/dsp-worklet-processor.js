// dsp-worklet-processor.js
// -------------------------
// Thin AudioWorkletProcessor adapter. Runs on the browser's dedicated
// real-time audio rendering thread (never the main/UI thread), so DSP
// work here can never be blocked by UI re-renders, GC pauses on the main
// thread, etc. -- this is what makes the <30ms latency budget achievable
// even while the waveform/spectrum canvases are repainting.
//
// NOTE: this file is loaded via `audioContext.audioWorklet.addModule(...)`,
// which runs it in an isolated worklet global scope with no access to the
// DOM. Static imports of plain ES modules ARE supported in that scope in
// modern browsers, which is why DSPPipeline.js has zero DOM dependencies.

import { DSPPipeline } from './DSPPipeline.js';

const WORKLET_QUANTUM = 128; // fixed by the Web Audio spec

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sampleRate = options.processorOptions?.sampleRate ?? sampleRate; // global `sampleRate` is provided by the worklet scope
    this._pipeline = new DSPPipeline(sampleRate, WORKLET_QUANTUM);

    // Settings + bypass updates arrive as messages from the main thread
    // (posted by AudioEngine whenever a UI control changes).
    this.port.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'settings') {
        this._pipeline.applySettings(payload);
      } else if (type === 'reset') {
        this._pipeline.reset();
      }
    };
  }

  /**
   * Called by the browser roughly every 128/sampleRate seconds.
   * `inputs[0][0]` / `outputs[0][0]` are Float32Array(128) for a mono
   * channel; we process channel 0 and mirror it to channel 1 if the
   * graph is stereo, since the source AMR content here is speech/mono
   * in the common case. (Extending to independent per-channel DSP state
   * is a straightforward array-of-pipelines change if true stereo input
   * is required.)
   */
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const inCh0 = input[0];
    if (!inCh0) return true;

    // Copy so the pipeline can safely mutate in place without touching
    // the host's input buffer (which the Web Audio spec doesn't
    // guarantee is safe to retain/mutate across calls).
    const work = this._workBuf && this._workBuf.length === inCh0.length
      ? this._workBuf
      : (this._workBuf = new Float32Array(inCh0.length));
    work.set(inCh0);

    this._pipeline.process(work);

    for (let ch = 0; ch < output.length; ch++) {
      output[ch].set(work);
    }
    return true; // keep processor alive
  }
}

registerProcessor('denoise-processor', DenoiseProcessor);
