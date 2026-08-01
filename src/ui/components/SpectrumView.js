/**
 * SpectrumView.js
 * ----------------
 * Draws a live frequency-domain bar spectrum from an AnalyserNode's FFT
 * output. Uses a log-ish bin grouping so low frequencies (where most
 * speech energy and the notch/high-pass action lives) get proportionally
 * more visual resolution than a linear bin layout would give them.
 */
export class SpectrumView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._buf = new Uint8Array(1024);
  }

  draw(analyserNode) {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!analyserNode) return;

    const binCount = analyserNode.frequencyBinCount;
    const buf = this._buf.length === binCount ? this._buf : (this._buf = new Uint8Array(binCount));
    analyserNode.getByteFrequencyData(buf);

    const numBars = 96;
    const barWidth = w / numBars;

    for (let i = 0; i < numBars; i++) {
      // Log-spaced bin index so low frequencies get more bars.
      const t0 = i / numBars, t1 = (i + 1) / numBars;
      const start = Math.floor(binCount ** t0) - 1;
      const end = Math.max(start + 1, Math.floor(binCount ** t1) - 1);

      let sum = 0, count = 0;
      for (let b = Math.max(0, start); b < Math.min(binCount, end); b++) {
        sum += buf[b];
        count++;
      }
      const avg = count ? sum / count : 0;
      const barHeight = (avg / 255) * h;

      const hue = 200 - (i / numBars) * 60; // blue -> green sweep
      ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
      ctx.fillRect(i * barWidth, h - barHeight, barWidth * 0.8, barHeight);
    }
  }
}
