/**
 * AmrDecoder.js
 * -------------
 * AMR-NB (RFC 4867) and AMR-WB are patented, ACELP-based speech codecs.
 * They are not something to hand-roll correctly in an evening of JS --
 * getting the codebook math even slightly wrong produces audible
 * artifacts that are very hard to debug. The correct production approach
 * is to use a real, tested AMR implementation compiled to WebAssembly.
 *
 * This module uses ffmpeg.wasm (`@ffmpeg/ffmpeg`), which wraps a genuine
 * FFmpeg build (including AMR decode support) compiled to WASM, to
 * transcode the AMR bytes to a WAV PCM buffer. That buffer is then
 * decoded to an AudioBuffer via the standard Web Audio
 * `decodeAudioData`, same as any other format.
 *
 * ---- Swapping in a native libopencore-amr WASM build ----
 * If you'd rather avoid the ffmpeg.wasm dependency (~30 MB WASM binary),
 * compile `libopencore-amrnb` / `libopencore-amrwb` with Emscripten and
 * expose a function with this signature:
 *
 *   decodeAmrToPcm(amrBytes: Uint8Array) -> { pcm: Int16Array, sampleRate: number }
 *
 * then replace the body of `decode()` below with a call to it. Nothing
 * else in the app needs to change -- AudioLoader.js only depends on
 * AmrDecoder.decode() returning a standard Web Audio `AudioBuffer`.
 */

let _ffmpegInstance = null;

async function _getFFmpeg() {
  if (_ffmpegInstance) return _ffmpegInstance;

  // Dynamic import: keeps the (large) ffmpeg.wasm bundle out of the
  // critical path for users who only ever open WAV/MP3 files.
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { fetchFile, toBlobURL } = await import('@ffmpeg/util');

  const ffmpeg = new FFmpeg();
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  _ffmpegInstance = { ffmpeg, fetchFile };
  return _ffmpegInstance;
}

export class AmrDecoder {
  /** True if the byte header matches the AMR-NB or AMR-WB magic string. */
  static isAmr(bytes) {
    const asciiHeader = String.fromCharCode(...bytes.subarray(0, 9));
    return asciiHeader.startsWith('#!AMR');
  }

  /**
   * @param {ArrayBuffer} amrArrayBuffer Raw bytes of the .amr file.
   * @param {AudioContext} audioContext Used for the final decodeAudioData call.
   * @returns {Promise<AudioBuffer>}
   */
  static async decode(amrArrayBuffer, audioContext) {
    const { ffmpeg, fetchFile } = await _getFFmpeg();

    const inputName = 'input.amr';
    const outputName = 'output.wav';

    await ffmpeg.writeFile(inputName, new Uint8Array(amrArrayBuffer));
    // -ar 48000: resample to the engine's working rate up front so the
    // DSP pipeline's filter coefficients (tuned for 48kHz) apply correctly
    // regardless of the AMR source rate (8kHz NB / 16kHz WB).
    await ffmpeg.exec(['-i', inputName, '-ar', '48000', '-ac', '1', outputName]);
    const wavData = await ffmpeg.readFile(outputName);

    // Clean up the in-memory FS to avoid unbounded growth across multiple loads.
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    const wavArrayBuffer = wavData.buffer.slice(
      wavData.byteOffset,
      wavData.byteOffset + wavData.byteLength
    );
    return audioContext.decodeAudioData(wavArrayBuffer);
  }
}
