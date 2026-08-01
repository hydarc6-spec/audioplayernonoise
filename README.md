# Real-Time Noise-Reduction Audio Player

Production-structured, cross-platform (any browser → wrappable in Electron /
Capacitor with **no DSP code changes**) audio player that loads AMR files,
decodes them to PCM, and applies a real-time denoise/enhancement DSP chain
during playback — without ever touching the source file on disk.

## Why this architecture

| Requirement                          | Choice                                                                 |
|---------------------------------------|-------------------------------------------------------------------------|
| Cross-platform                        | Web Audio API (`AudioWorklet`) — runs unmodified in Chromium/Firefox/Safari, and inside Electron/Capacitor shells |
| < 30 ms latency                       | 128-sample worklet quantum (2.7 ms @ 48 kHz) + 512-pt FFT / hop-128 overlap-add for spectral stages ⇒ ~10.7 ms algorithmic latency |
| Non-destructive processing            | Source PCM is decoded once into an immutable `Float32Array`; the worklet reads it and writes to a *separate* output buffer. Dry/processed routing is just a graph rewire — instant, glitch-free |
| AMR decode                            | AMR-NB/WB is a patented ACELP codec — not something to hand-roll. We use `@ffmpeg/ffmpeg` (ffmpeg.wasm), which has genuine AMR decode support, to transcode AMR → WAV PCM. The `AmrDecoder` interface is decoder-agnostic, so a native `libopencore-amr` WASM build can be swapped in later with no changes elsewhere |

## Project layout

```
src/
  decoder/
    AudioLoader.js        # detects file type, routes to the right decode path
    AmrDecoder.js          # AMR -> PCM via ffmpeg.wasm, documented swap point
  dsp/
    FFT.js                 # radix-2 iterative Cooley-Tukey (real+imag arrays)
    DCBlocker.js            # Stage 1: DC offset removal
    HighPassFilter.js       # Stage 2: RBJ biquad high-pass, adjustable cutoff
    NotchFilter.js           # Stage 3: adaptive 50/60 Hz + harmonics notch
    SpectralNoiseSuppressor.js # Stage 4: FFT spectral subtraction
    WienerFilter.js           # Stage 5: decision-directed Wiener speech gain
    AGC.js                     # Stage 6: automatic gain control
    SoftLimiter.js               # Stage 7: tanh soft limiter
    DSPPipeline.js                # wires all stages together, engine-agnostic
    dsp-worklet-processor.js       # AudioWorkletProcessor wrapper around DSPPipeline
  engine/
    AudioEngine.js           # AudioContext graph, buffer mgmt, A/B switching
  ui/
    index.html
    main.js
    style.css
    components/
      Controls.js
      WaveformView.js
      SpectrumView.js
```

## Running it

Because the UI uses native ES modules + an `AudioWorklet` module (which
requires a real HTTP origin, not `file://`), serve the `src/ui` directory
with any static server:

```bash
npx serve src/ui
# or
python3 -m http.server --directory src/ui 8080
```

Then open the printed URL. Drop an `.amr`, `.wav`, `.mp3`, etc. file onto
the player.

## Swapping in RNNoise instead of the Wiener filter

`WienerFilter.js` implements a classical decision-directed Wiener gain
(Ephraim–Malah style a-priori SNR estimate) — good quality, zero external
dependencies, runs happily inside an `AudioWorkletProcessor`. If you want
RNNoise specifically (a small RNN trained on noisy speech, distributed as
a C library), compile the `rnnoise` C sources to WASM and give it the same
`process(frame: Float32Array) -> Float32Array` interface as
`WienerFilter.process()`. `DSPPipeline.js` selects the stage by interface,
not by class, so this is a drop-in swap (see `USE_RNNOISE` flag).
