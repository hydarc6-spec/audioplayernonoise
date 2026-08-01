import { AudioEngine } from './engine/AudioEngine.js';
import { renderControls } from './components/Controls.js';
import { WaveformView } from './components/WaveformView.js';
import { SpectrumView } from './components/SpectrumView.js';

const engine = new AudioEngine();

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileInfo = document.getElementById('fileInfo');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const seekBar = document.getElementById('seekBar');
const timeLabel = document.getElementById('timeLabel');
const controlsContainer = document.getElementById('controls');
const installBtn = document.getElementById('installBtn');

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'));
}

const waveformView = new WaveformView(document.getElementById('waveformCanvas'));
const spectrumView = new SpectrumView(document.getElementById('spectrumCanvas'));

// ---- File loading (drag/drop + native label-triggered file picker) ----
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});
['dragover', 'dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => e.preventDefault())
);
dropzone.addEventListener('dragover', () => dropzone.classList.add('dragover'));
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  fileInfo.textContent = `Decoding "${file.name}"...`;
  playBtn.disabled = pauseBtn.disabled = seekBar.disabled = true;
  try {
    const info = await engine.loadFile(file, (p) => {
      fileInfo.textContent = `${p.stage === 'decoding' ? 'Decoding' : 'Ready'}: "${file.name}"`;
    });
    fileInfo.textContent =
      `"${file.name}" — ${info.format.toUpperCase()}, ${info.sampleRate} Hz, ${info.duration.toFixed(1)}s`;
    playBtn.disabled = pauseBtn.disabled = seekBar.disabled = false;
    seekBar.max = info.duration;
  } catch (err) {
    console.error(err);
    fileInfo.textContent = `Failed to decode "${file.name}": ${err.message}`;
  }
}

// ---- Transport ----
playBtn.addEventListener('click', async () => {
  await engine.play();
});
pauseBtn.addEventListener('click', () => engine.pause());
seekBar.addEventListener('input', () => engine.seek(Number(seekBar.value)));

engine.onEnded = () => {
  seekBar.value = 0;
};

// ---- Original/Processed instant switch ----
document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    if (e.target.checked) engine.setMode(e.target.value);
  });
});

// ---- Controls (7 DSP stages) ----
renderControls(controlsContainer, engine.settings, (partial) => engine.updateSettings(partial));

// ---- Render loop: waveform, spectrum, transport time/seek position ----
function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function tick() {
  waveformView.draw(engine.activeAnalyser);
  spectrumView.draw(engine.activeAnalyser);

  if (engine.audioBuffer) {
    const cur = engine.getCurrentTime();
    const dur = engine.audioBuffer.duration;
    if (engine.isPlaying) seekBar.value = cur;
    timeLabel.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
  }

  requestAnimationFrame(tick);
}
tick();
