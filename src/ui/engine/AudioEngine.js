import { AudioLoader } from '../decoder/AudioLoader.js';

/**
 * AudioEngine.js
 * --------------
 * Owns the AudioContext graph and playback transport. Key structural
 * decision for the "switch original/processed instantly, never mutate
 * the source" requirement:
 *
 *   AudioBufferSourceNode (decoded PCM, read-only)
 *         |
 *         +--> dryGain ------------------------> masterGain -> analyser -> destination
 *         |
 *         +--> denoiseWorkletNode -> wetGain --/
 *
 * Both paths are always running in parallel; switching "original" vs
 * "processed" is just crossfading dryGain/wetGain between 0 and 1 (with
 * a short ramp to avoid a click), which is inaudible-latency and never
 * touches the decoded buffer or the source file. The worklet path runs
 * the DSPPipeline regardless of which one is currently audible, so
 * switching to "processed" mid-playback doesn't need a re-sync -- its
 * filter state has been running continuously.
 */
export class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.dryGain = null;
    this.wetGain = null;
    this.masterGain = null;
    this.analyserDry = null;   // for waveform/spectrum of whichever path is monitored
    this.analyserProcessed = null;

    this.isPlaying = false;
    this._startedAtContextTime = 0;
    this._pausedAtOffset = 0;

    this.mode = 'processed'; // 'original' | 'processed'
    this.settings = AudioEngine.defaultSettings();
  }

  static defaultSettings() {
    return {
      dcBlockerEnabled: true,
      highPassEnabled: true,
      highPassCutoffHz: 140,
      lowPassEnabled: true,
      lowPassCutoffHz: 7000,
      notchEnabled: true,
      notchMode: 'auto', // 'auto' | 50 | 60
      noiseSuppressionEnabled: true,
      noiseReductionStrength: 85,
      voiceEnhancementEnabled: true,
      voiceEnhancement: 45,
      voiceGateEnabled: true,
      voiceGateAmount: 60,
      agcEnabled: true,
      limiterEnabled: true,
    };
  }

  async _ensureContext() {
    if (this.audioContext) return;
    this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    await this.audioContext.audioWorklet.addModule(
      new URL('../dsp/dsp-worklet-processor.js', import.meta.url)
    );
  }

  /**
   * @param {File} file
   * @param {(progress: {stage: string}) => void} [onProgress]
   */
  async loadFile(file, onProgress) {
    await this._ensureContext();
    onProgress?.({ stage: 'decoding' });
    const { audioBuffer, format } = await AudioLoader.load(file, this.audioContext);
    this.audioBuffer = audioBuffer; // treated as read-only from here on
    this.format = format;
    onProgress?.({ stage: 'ready' });
    return { duration: audioBuffer.duration, sampleRate: audioBuffer.sampleRate, format };
  }

  _buildGraph(startOffsetSeconds) {
    const ctx = this.audioContext;

    // A fresh AudioBufferSourceNode is required per playback (per Web
    // Audio spec, they're single-use), but the *decoded* AudioBuffer it
    // reads from is reused/untouched every time -- this is what keeps
    // playback non-destructive across repeated play/pause/seek cycles.
    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;

    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.masterGain = ctx.createGain();
    this.analyserDry = ctx.createAnalyser();
    this.analyserProcessed = ctx.createAnalyser();
    this.analyserDry.fftSize = 2048;
    this.analyserProcessed.fftSize = 2048;

    this.workletNode = new AudioWorkletNode(ctx, 'denoise-processor', {
      processorOptions: { sampleRate: ctx.sampleRate },
      outputChannelCount: [this.audioBuffer.numberOfChannels],
    });
    this.workletNode.port.postMessage({ type: 'settings', payload: this.settings });

    // Dry path: source -> dryGain -> analyserDry -> master
    this.sourceNode.connect(this.dryGain);
    this.dryGain.connect(this.analyserDry);
    this.analyserDry.connect(this.masterGain);

    // Wet path: source -> worklet (DSP) -> wetGain -> analyserProcessed -> master
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.wetGain);
    this.wetGain.connect(this.analyserProcessed);
    this.analyserProcessed.connect(this.masterGain);

    this.masterGain.connect(ctx.destination);

    this._applyModeGains(/* instant */ true);

    this.sourceNode.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false;
        this._pausedAtOffset = 0;
        this.onEnded?.();
      }
    };

    this.sourceNode.start(0, startOffsetSeconds);
    this._startedAtContextTime = ctx.currentTime - startOffsetSeconds;
  }

  _applyModeGains(instant = false) {
    if (!this.dryGain || !this.wetGain) return;
    const now = this.audioContext.currentTime;
    const rampTime = instant ? 0 : 0.02; // 20ms equal-power-ish ramp avoids a click
    const dryTarget = this.mode === 'original' ? 1 : 0;
    const wetTarget = this.mode === 'processed' ? 1 : 0;

    this.dryGain.gain.cancelScheduledValues(now);
    this.wetGain.gain.cancelScheduledValues(now);
    if (instant) {
      this.dryGain.gain.setValueAtTime(dryTarget, now);
      this.wetGain.gain.setValueAtTime(wetTarget, now);
    } else {
      this.dryGain.gain.setValueAtTime(this.dryGain.gain.value, now);
      this.wetGain.gain.setValueAtTime(this.wetGain.gain.value, now);
      this.dryGain.gain.linearRampToValueAtTime(dryTarget, now + rampTime);
      this.wetGain.gain.linearRampToValueAtTime(wetTarget, now + rampTime);
    }
  }

  /** Instantly (with a tiny anti-click ramp) switches monitoring between original and processed audio. */
  setMode(mode) {
    this.mode = mode;
    this._applyModeGains(false);
  }

  /** Which analyser to read for the currently-monitored waveform/spectrum. */
  get activeAnalyser() {
    return this.mode === 'original' ? this.analyserDry : this.analyserProcessed;
  }

  async play() {
    await this._ensureContext();
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    if (this.isPlaying) return;
    this._buildGraph(this._pausedAtOffset);
    this.isPlaying = true;
  }

  pause() {
    if (!this.isPlaying) return;
    this._pausedAtOffset = this.getCurrentTime();
    this.sourceNode.onended = null;
    this.sourceNode.stop();
    this.isPlaying = false;
  }

  seek(seconds) {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      this.sourceNode.onended = null;
      this.sourceNode.stop();
      this.isPlaying = false;
    }
    this._pausedAtOffset = Math.max(0, Math.min(seconds, this.audioBuffer.duration));
    if (wasPlaying) this.play();
  }

  getCurrentTime() {
    if (!this.isPlaying) return this._pausedAtOffset;
    return this.audioContext.currentTime - this._startedAtContextTime;
  }

  /** Push a partial or full settings update from the UI to the worklet. */
  updateSettings(partialSettings) {
    Object.assign(this.settings, partialSettings);
    this.workletNode?.port.postMessage({ type: 'settings', payload: partialSettings });
  }
}
