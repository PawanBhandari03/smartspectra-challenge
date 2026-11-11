const {
  SmartSpectraSDK, MetricType, ValidationCode, SmartSpectraErrorCode, ProcessingStatus,
} = require('@smartspectra/node-sdk/renderer');
const { LiveSource, ReplaySource } = require('../core/sources');
const { VitalsTracker } = require('../core/vitals');

// Only what Gut Check uses; landmarks and the arterial trace are left out to keep processing light.
const REQUESTED_METRICS = [
  MetricType.CHEST_BREATHING,
  MetricType.ABDOMEN_BREATHING,
  MetricType.BREATHING_RATE,
  MetricType.PULSE_RATE,
  MetricType.HRV,
  MetricType.BLINKING,
  MetricType.EXPRESSIONS,
];

const nameOf = (table, value) => Object.keys(table).find((k) => table[k] === value) || String(value);

const $ = (id) => document.getElementById(id);
const ui = {
  preview: $('preview'), placeholder: $('videoPlaceholder'), modeChip: $('modeChip'),
  openCam: $('openCam'), closeCam: $('closeCam'), camInfo: $('camInfo'), camFps: $('camFps'),
  duration: $('duration'), startLive: $('startLive'), stopRun: $('stopRun'),
  elapsed: $('elapsed'), credits: $('credits'), sentFps: $('sentFps'), keyWarning: $('keyWarning'),
  recordings: $('recordings'), speed: $('speed'), startReplay: $('startReplay'), refreshRecordings: $('refreshRecordings'),
  vPulse: $('vPulse'), vPulseQ: $('vPulseQ'), vBreath: $('vBreath'), vBreathQ: $('vBreathQ'),
  vHrv: $('vHrv'), vHrvQ: $('vHrvQ'), vStress: $('vStress'), vExpr: $('vExpr'), vExprQ: $('vExprQ'),
  vBlinks: $('vBlinks'), vBlinkRate: $('vBlinkRate'),
  procStatus: $('procStatus'), packets: $('packets'), validation: $('validation'), log: $('log'),
};

let apiKey = '';
let stream = null;
let sdk = null;
let sdkFailed = false;
let source = null;
let runStartedAt = 0;
let autoStopTimer = null;
let clockTimer = null;
const tracker = new VitalsTracker();

function log(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}\n`;
  ui.log.textContent = (line + ui.log.textContent).slice(0, 20000);
  console.log(msg);
}

function setMode(mode) {
  ui.modeChip.textContent = mode;
  ui.modeChip.className = `chip ${mode === 'live' ? 'live' : mode === 'replay' ? 'replay' : ''}`;
  const busy = mode !== 'idle';
  ui.startLive.disabled = busy || !stream || !apiKey;
  ui.startReplay.disabled = busy || !ui.recordings.value;
  ui.stopRun.disabled = !busy;
  ui.closeCam.disabled = busy || !stream;
  ui.openCam.disabled = busy || !!stream;
}

// ---------- Camera (no credits) ----------

let fpsFrames = [];
function trackPreviewFps() {
  if (!stream) return;
  const now = performance.now();
  fpsFrames.push(now);
  fpsFrames = fpsFrames.filter((t) => now - t < 2000);
  ui.camFps.textContent = (fpsFrames.length / 2).toFixed(1);
  ui.preview.requestVideoFrameCallback(trackPreviewFps);
}

async function openCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
      audio: false,
    });
  } catch (err) {
    log(`Camera error: ${err.message}`);
    return;
  }
  ui.preview.srcObject = stream;
  ui.placeholder.classList.add('hidden');
  const s = stream.getVideoTracks()[0].getSettings();
  ui.camInfo.textContent = `${s.width}×${s.height} @ ${Math.round(s.frameRate)} fps requested`;
  fpsFrames = [];
  ui.preview.requestVideoFrameCallback(trackPreviewFps);
  log(`Camera opened: ${stream.getVideoTracks()[0].label}`);
  setMode('idle');
}

function closeCamera() {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
  stream = null;
  ui.preview.srcObject = null;
  ui.placeholder.classList.remove('hidden');
  ui.camFps.textContent = '—';
  ui.camInfo.textContent = '—';
  log('Camera closed');
  setMode('idle');
}

// ---------- Rendering vitals ----------

function quality(m) {
  if (!m) return { text: '', cls: '' };
  return { text: `${m.stable ? 'stable' : 'warming up'} · conf ${(m.confidence ?? 0).toFixed(2)}`, cls: m.stable ? 'stable' : '' };
}

function setQ(el, m) {
  const q = quality(m);
  el.textContent = q.text;
  el.className = `q ${q.cls}`;
}

function renderVitals() {
  const { pulse, breathing, hrv, expression } = tracker;
  ui.vPulse.textContent = pulse?.value != null ? Math.round(pulse.value) : '—';
  setQ(ui.vPulseQ, pulse);
  ui.vBreath.textContent = breathing?.value != null ? breathing.value.toFixed(1) : '—';
  setQ(ui.vBreathQ, breathing);
  ui.vHrv.textContent = hrv?.rmssd != null ? Math.round(hrv.rmssd) : '—';
  setQ(ui.vHrvQ, hrv);
  ui.vStress.textContent = hrv?.baevsky != null ? Math.round(hrv.baevsky) : '—';
  ui.vExpr.textContent = expression?.top ? `${expression.top} ${Math.round(expression.topScore * 100)}%` : '—';
  ui.vExprQ.textContent = expression ? (expression.stable ? 'stable' : 'warming up') : '';
  ui.vExprQ.className = `q ${expression?.stable ? 'stable' : ''}`;
  ui.vBlinks.textContent = tracker.blinkCount;
  const mins = (performance.now() - runStartedAt) / 60000;
  ui.vBlinkRate.textContent = mins > 0.25 ? `${(tracker.blinkCount / mins).toFixed(0)} /min` : '';
  ui.packets.textContent = tracker.packets;
}

// ---------- Runs (live or replay) ----------

function attach(src) {
  src.on('metrics', (buf) => {
    try {
      tracker.ingest(buf);
    } catch (err) {
      log(`Decode error: ${err.message}`);
      return;
    }
    renderVitals();
  });
  src.on('validationStatus', (code, _ts, hint) => {
    ui.validation.textContent = code === ValidationCode.kOk ? 'OK' : `${nameOf(ValidationCode, code)}${hint ? ' — ' + hint : ''}`;
  });
  src.on('processingStatus', (status) => {
    ui.procStatus.textContent = nameOf(ProcessingStatus, status);
    log(`Processing status: ${nameOf(ProcessingStatus, status)}`);
  });
  src.on('error', (code, message, retryable) => {
    log(`SDK error ${nameOf(SmartSpectraErrorCode, code)}: ${message} (retryable=${retryable})`);
    if (src === source && src instanceof LiveSource) {
      sdkFailed = true;
      stopRun();
    }
  });
  src.on('fps', (sent, dropped) => {
    ui.sentFps.textContent = dropped ? `${sent} (+${dropped} dropped)` : String(sent);
  });
  src.on('ended', () => log('Run ended'));
}

function beginRun(src, mode) {
  source = src;
  tracker.reset();
  renderVitals();
  ui.validation.textContent = '—';
  ui.procStatus.textContent = '—';
  runStartedAt = performance.now();
  clockTimer = setInterval(() => {
    const sec = Math.floor((performance.now() - runStartedAt) / 1000);
    ui.elapsed.textContent = `${sec} s`;
    if (mode === 'live') ui.credits.textContent = Math.ceil(sec / 30);
    renderVitals();
  }, 500);
  setMode(mode);
  attach(src);
}

async function startLive() {
  if (!sdk) {
    sdk = new SmartSpectraSDK({ apiKey, requestedMetrics: REQUESTED_METRICS, enableTelemetry: false });
  }
  const settings = stream.getVideoTracks()[0].getSettings();
  const src = new LiveSource(sdk, stream, {
    mode: 'live',
    requestedMetrics: REQUESTED_METRICS,
    camera: { width: settings.width, height: settings.height, frameRate: settings.frameRate },
  });
  beginRun(src, 'live');
  ui.credits.textContent = '0';
  const seconds = Number(ui.duration.value);
  autoStopTimer = setTimeout(() => {
    log(`Auto-stop after ${seconds} s`);
    stopRun();
  }, seconds * 1000);
  log(`Live test started (auto-stop in ${seconds} s)`);
  try {
    await src.start();
  } catch (err) {
    log(`Start failed: ${err.message}${err.code != null ? ` (code ${nameOf(SmartSpectraErrorCode, err.code)})` : ''}`);
    sdkFailed = true;
    await stopRun();
  }
}

async function startReplay() {
  const name = ui.recordings.value;
  if (!name) return;
  const text = await window.gutCheck.readRecording(name);
  const src = new ReplaySource(text, Number(ui.speed.value));
  beginRun(src, 'replay');
  src.on('ended', () => finishRun());
  log(`Replaying ${name} at ${ui.speed.value}× (${Math.round(src.durationMs / 1000)} s recorded)`);
  await src.start();
}

let stopping = false;
async function stopRun() {
  if (!source || stopping) return;
  stopping = true;
  clearTimeout(autoStopTimer);
  const src = source;
  try {
    await src.stop();
  } catch (err) {
    log(`Stop error: ${err.message}`);
  }
  if (src instanceof LiveSource && src.lines.length > 1) {
    const saved = await window.gutCheck.saveRecording(src.recordingText());
    log(`Recording saved: recordings/${saved}`);
    await refreshRecordings(saved);
  }
  // After an error the SDK sits in its error state; a fresh instance is the reliable way to retry.
  if (sdkFailed && sdk) {
    sdk.destroy();
    sdk = null;
    sdkFailed = false;
    log('SDK reset after error. You can try again.');
  }
  stopping = false;
  finishRun();
}

function finishRun() {
  if (!source) return;
  const { pulse, breathing, hrv, expression } = tracker;
  log(`Summary: packets ${tracker.packets} · pulse ${pulse?.value?.toFixed(1) ?? 'none'} · breathing ${breathing?.value?.toFixed(1) ?? 'none'}`
    + ` · HRV ${hrv?.rmssd != null ? Math.round(hrv.rmssd) + ' ms' : 'none'} · stress ${hrv?.baevsky != null ? Math.round(hrv.baevsky) : 'none'}`
    + ` · expression ${expression?.top ?? 'none'} · blinks ${tracker.blinkCount}`);
  clearInterval(clockTimer);
  source = null;
  setMode('idle');
}

async function refreshRecordings(select) {
  const names = await window.gutCheck.listRecordings();
  ui.recordings.innerHTML = '';
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    ui.recordings.appendChild(opt);
  }
  if (!names.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No recordings yet';
    ui.recordings.appendChild(opt);
  }
  if (select) ui.recordings.value = select;
  setMode(source ? ui.modeChip.textContent : 'idle');
}

// ---------- Wire up ----------

ui.openCam.onclick = openCamera;
ui.closeCam.onclick = closeCamera;
ui.startLive.onclick = startLive;
ui.stopRun.onclick = stopRun;
ui.startReplay.onclick = startReplay;
ui.refreshRecordings.onclick = () => refreshRecordings();

(async () => {
  apiKey = await window.gutCheck.getApiKey();
  ui.keyWarning.classList.toggle('hidden', !!apiKey);
  await refreshRecordings();
  log(`Ready. SDK ${SmartSpectraSDK.version}. API key ${apiKey ? 'loaded' : 'MISSING'}.`);
  const auto = await window.gutCheck.getAutoReplay();
  if (auto) {
    ui.recordings.value = auto;
    ui.speed.value = '10';
    await startReplay();
  }
})();
