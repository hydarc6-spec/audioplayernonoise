/**
 * WaveformView.js
 * ----------------
 * Draws a live time-domain waveform from an AnalyserNode. Reads whichever
 * analyser AudioEngine currently reports as `activeAnalyser` each frame,
 * so it automatically reflects the original/processed A|B switch with no
 * extra wiring.
 */
export class WaveformView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._buf = new Float32Array(2048);
  }

  draw(analyserNode) {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!analyserNode) return;
    const buf = this._buf.length === analyserNode.fftSize ? this._buf : (this._buf = new Float32Array(analyserNode.fftSize));
    analyserNode.getFloatTimeDomainData(buf);

    ctx.strokeStyle = '#4f9dff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = buf.length / w;
    for (let x = 0; x < w; x++) {
      const sample = buf[Math.floor(x * step)];
      const y = h / 2 - sample * (h / 2) * 0.95;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = '#262c35';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }
}
