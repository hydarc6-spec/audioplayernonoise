/**
 * FFT.js
 * ------
 * Minimal, allocation-free (after construction) iterative radix-2
 * Cooley-Tukey FFT. Used by SpectralNoiseSuppressor and WienerFilter for
 * the analysis/synthesis (overlap-add) transforms.
 *
 * Why hand-rolled instead of a library: AudioWorkletProcessor runs in an
 * isolated worklet global scope with no bundler/npm resolution at runtime,
 * so third-party FFT packages would need to be inlined anyway. A ~100 line
 * radix-2 implementation is easy to audit and fast enough at our sizes
 * (256-1024 points, one call per 128-sample hop).
 */
export class FFT {
  /**
   * @param {number} size Must be a power of two (e.g. 512).
   */
  constructor(size) {
    if ((size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    this._bitReverseTable = FFT._buildBitReverseTable(size);
    // Precompute twiddle factors once; reused across every call.
    this._cosTable = new Float32Array(size / 2);
    this._sinTable = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this._cosTable[i] = Math.cos(angle);
      this._sinTable[i] = Math.sin(angle);
    }
  }

  static _buildBitReverseTable(size) {
    const bits = Math.log2(size);
    const table = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let rev = 0;
      let v = i;
      for (let b = 0; b < bits; b++) {
        rev = (rev << 1) | (v & 1);
        v >>= 1;
      }
      table[i] = rev;
    }
    return table;
  }

  /**
   * In-place forward FFT. `re`/`im` are Float32Array of length `size`.
   * `im` should be zero-filled by the caller for a real-input transform.
   */
  forward(re, im) {
    this._transform(re, im, false);
  }

  /** In-place inverse FFT (includes 1/N scaling). */
  inverse(re, im) {
    this._transform(re, im, true);
  }

  _transform(re, im, inverse) {
    const n = this.size;
    const rev = this._bitReverseTable;

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }

    // Iterative butterfly stages
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const tableStep = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const tableIdx = k * tableStep;
          let tRe = this._cosTable[tableIdx];
          let tIm = this._sinTable[tableIdx] * (inverse ? -1 : 1);

          const evenIdx = start + k;
          const oddIdx = start + k + half;

          const oddRe = re[oddIdx] * tRe - im[oddIdx] * tIm;
          const oddIm = re[oddIdx] * tIm + im[oddIdx] * tRe;

          re[oddIdx] = re[evenIdx] - oddRe;
          im[oddIdx] = im[evenIdx] - oddIm;
          re[evenIdx] += oddRe;
          im[evenIdx] += oddIm;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }
}
