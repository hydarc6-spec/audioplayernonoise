import { AmrDecoder } from './AmrDecoder.js';

/**
 * AudioLoader.js
 * --------------
 * Single entry point for turning "a File the user dropped/selected" into
 * a decoded `AudioBuffer` (immutable PCM ready for playback). Detects AMR
 * by magic header (extension alone isn't reliable) and routes there;
 * everything else goes through the browser's native, hardware-accelerated
 * `decodeAudioData` (covers WAV, MP3, AAC/M4A, OGG/Opus, FLAC depending
 * on browser).
 *
 * Decoding happens exactly once per load. The resulting AudioBuffer is
 * treated as read-only for the lifetime of the app -- see AudioEngine.js
 * for how playback/processing never mutates it, satisfying the
 * "never permanently modify the source file" requirement (indeed we never
 * even write back to disk at all; the source file on disk is untouched
 * regardless).
 */
export class AudioLoader {
  /**
   * @param {File} file
   * @param {AudioContext} audioContext
   * @returns {Promise<{audioBuffer: AudioBuffer, format: string}>}
   */
  static async load(file, audioContext) {
    const arrayBuffer = await file.arrayBuffer();
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, 16));

    if (AmrDecoder.isAmr(headerBytes)) {
      const audioBuffer = await AmrDecoder.decode(arrayBuffer, audioContext);
      return { audioBuffer, format: 'amr' };
    }

    // Native path for WAV/MP3/AAC/OGG/FLAC etc.
    // decodeAudioData detaches the buffer, so pass a copy in case the
    // caller wants to reuse `arrayBuffer` (we don't here, but it's cheap
    // insurance against a footgun for future callers).
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return { audioBuffer, format: file.name.split('.').pop()?.toLowerCase() ?? 'unknown' };
  }
}
