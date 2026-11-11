const { ValidationCode, SmartSpectraErrorCode, ProcessingStatus } = require('@smartspectra/node-sdk/renderer');
const { LiveSource, ReplaySource } = require('../core/sources');
const { VitalsTracker } = require('../core/vitals');
const { REQUESTED_METRICS } = require('../core/metrics');

const MIN_FPS = 25;

const nameOf = (table, value) => Object.keys(table).find((k) => table[k] === value) || String(value);

const $ = (id) => document.getElementById(id);
const ui = {
  preview: $('preview'), placeholder: $('videoPlaceholder'), modeChip: $('modeChip'),
  openCam: $('openCam'), closeCam: $('closeCam'), camInfo: $('camInfo'), camFps: $('camFps'),
  exposureRow: $('exposureRow'), exposureMode: $('exposureMode'), exposureTime: $('exposureTime'), exposureValue: $('exposureValue'),
  duration: $('duration'), startLive: $('startLive'), stopRun: $('stopRun'), checkDevice: $('checkDevice'),
  elapsed: $('elapsed'), credits: $('credits'), sentFps: $('sentFps'), keyWarning: $('keyWarning'),
  recordings: $('recordings'), speed: $('speed'), startReplay: $('startReplay'), refreshRecordings: $('refreshRecordings'),
  vPulse: $('vPulse'), vPulseQ: $('vPulseQ'), vBreath: $('vBreath'), vBreathQ: $('vBreathQ'),
  vHrv: $('vHrv'), vHrvQ: $('vHrvQ'), vStress: $('vStress'), vExpr: $('vExpr'), vExprQ: $('vExprQ'),
  vBlinks: $('vBlinks'), vBlinkRate: $('vBlinkRate'),
  procStatus: $('procStatus'), packets: $('packets'), validation: $('validation'), log: $('log'),
};

const bridge = window.gutCheck.sdk;
let info = { hasKey: false };
let stream = null;
let measuredFps = 0;
let source = null;
let runStartedAt = 0;
let autoStopTimer = null;
let clockTimer = null;
let sdkFailed = false;
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
  ui.startLive.disabled = busy || !info.hasKey;
  ui.checkDevice.disabled = busy || !info.hasKey;
  ui.startReplay.disabled = busy || !ui.recordings.value;
  ui.stopRun.disabled = !busy;
  ui.closeCam.disabled = busy || !stream;
  ui.openCam.disabled = busy || !!stream;
}

// ---------- Camera check (browser camera, no credits) ----------

let fpsFrames = [];
function trackPreviewFps() {
  if (!stream) return;
  const now = performance.now();
  fpsFrames.push(now);
  fpsFrames = fpsFrames.filter((t) => now - t < 2000);
  measuredFps = fpsFrames.length / 2;
  ui.camFps.textContent = measuredFps.toFixed(1);
  ui.camFps.className = measuredFps >= MIN_FPS ? 'good' : 'bad';
  ui.preview.requestVideoFrameCallback(trackPreviewFps);
}

function setupExposureControls(track) {
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const modes = caps.exposureMode || [];
  if (!modes.includes('manual') || !caps.exposureTime) {
    ui.exposureRow.classList.add('hidden');
    log(`Camera exposure control: not available (modes: ${modes.join(', ') || 'none'})`);
    return;
  }
  ui.exposureRow.classList.remove('hidden');
  ui.exposureMode.value = 'auto';
  ui.exposureTime.min = caps.exposureTime.min;
  ui.exposureTime.max = caps.exposureTime.max;
  ui.exposureTime.step = caps.exposureTime.step || 1;
  const current = track.getSettings().exposureTime;
  ui.exposureTime.value = current ?? caps.exposureTime.min;
  ui.exposureTime.disabled = true;
  ui.exposureValue.textContent = ui.exposureTime.value;
  log(`Camera exposure control available: time ${caps.exposureTime.min}–${caps.exposureTime.max} (step ${caps.exposureTime.step})`);
}

async function applyExposure() {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  const manual = ui.exposureMode.value === 'manual';
  ui.exposureTime.disabled = !manual;
  ui.exposureValue.textContent = ui.exposureTime.value;
  const constraint = manual
    ? { exposureMode: 'manual', exposureTime: Number(ui.exposureTime.value) }
    : { exposureMode: 'continuous' };
  try {
    await track.applyConstraints({ advanced: [constraint] });
  } catch (err) {
    log(`Exposure change failed: ${err.message}`);
  }
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
  const track = stream.getVideoTracks()[0];
  ui.preview.srcObject = stream;
  ui.placeholder.classList.add('hidden');
  const s = track.getSettings();
  ui.camInfo.textContent = `${s.width}×${s.height} @ ${Math.round(s.frameRate)} fps requested`;
  fpsFrames = [];
  ui.preview.requestVideoFrameCallback(trackPreviewFps);
  log(`Camera opened: ${track.label}`);
  setupExposureControls(track);
  setMode('idle');
}

async function closeCamera() {
  if (!stream) return;
  // Hand exposure back to the camera so other apps aren't left with a manual setting.
  if (ui.exposureMode.value === 'manual') {
    ui.exposureMode.value = 'auto';
    await applyExposure();
  }
  for (const t of stream.getTracks()) t.stop();
  stream = null;
  ui.preview.srcObject = null;
  ui.placeholder.classList.remove('hidden');
  ui.camFps.textContent = '—';
  ui.camFps.className = '';
  ui.camInfo.textContent = '—';
  ui.exposureRow.classList.add('hidden');
  log('Camera closed');
  setMode('idle');
}

// ---------- Rendering vitals ----------

function setQ(el, m) {
  el.textContent = m ? `${m.stable ? 'stable' : 'warming up'} · conf ${(m.confidence ?? 0).toFixed(2)}` : '';
  el.className = `q ${m?.stable ? 'stable' : ''}`;
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
  // Expression scores arrive as percentages (they sum to ~100).
  ui.vExpr.textContent = expression?.top ? `${expression.top} ${Math.round(expression.topScore)}%` : '—';
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
  ui.validation.textContent = '—';
  ui.procStatus.textContent = '—';
  ui.sentFps.textContent = '—';
  runStartedAt = performance.now();
  renderVitals();
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
  if (stream && measuredFps < MIN_FPS
      && !confirm(`The camera check shows ${measuredFps.toFixed(1)} fps (needs ${MIN_FPS}+). The SDK will likely stop early. Start anyway?`)) {
    return;
  }
  // The SDK opens the camera itself in the main process, so the preview must let go of it first.
  await closeCamera();
  const src = new LiveSource(bridge, {
    mode: 'live',
    capture: 'native',
    requestedMetrics: REQUESTED_METRICS,
    camera: info.capture,
    previewFps: measuredFps || null,
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

async function checkDevice() {
  ui.checkDevice.disabled = true;
  log('Device check running…');
  const res = await bridge.readiness();
  if (res.ok) {
    log(`Device check: ${res.result.verdict.toUpperCase()} — ${res.result.reason}`);
  } else {
    log(`Device check failed: ${res.error.message}${res.error.code != null ? ` (code ${nameOf(SmartSpectraErrorCode, res.error.code)})` : ''}`);
    await bridge.destroy();
  }
  setMode('idle');
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
  if (sdkFailed) {
    await bridge.destroy();
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
ui.exposureMode.onchange = applyExposure;
ui.exposureTime.oninput = applyExposure;
ui.startLive.onclick = startLive;
ui.stopRun.onclick = stopRun;
ui.checkDevice.onclick = checkDevice;
ui.startReplay.onclick = startReplay;
ui.refreshRecordings.onclick = () => refreshRecordings();

(async () => {
  info = await bridge.info();
  ui.keyWarning.classList.toggle('hidden', info.hasKey);
  await refreshRecordings();
  const cams = info.cameras.map((c) => c.name || c.id).join(', ') || 'none found';
  log(`Ready. SDK ${info.version}. API key ${info.hasKey ? 'loaded' : 'MISSING'}. SDK cameras: ${cams}.`);
  const auto = await window.gutCheck.getAutoReplay();
  if (auto) {
    ui.recordings.value = auto;
    ui.speed.value = '10';
    await startReplay();
  }
})();
