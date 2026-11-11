const { ValidationCode, SmartSpectraErrorCode, ProcessingStatus } = require('@smartspectra/node-sdk/renderer');
const { LiveSource, ReplaySource } = require('../core/sources');
const { VitalsTracker } = require('../core/vitals');
const { REQUESTED_METRICS } = require('../core/metrics');

const MIN_FPS = 25;

const nameOf = (table, value) => Object.keys(table).find((k) => table[k] === value) || String(value);

const $ = (id) => document.getElementById(id);
const ui = {
  preview: $('preview'), placeholder: $('videoPlaceholder'), modeChip: $('modeChip'),
  liveCanvas: $('liveCanvas'), recBadge: $('recBadge'), recTime: $('recTime'),
  cameraSelect: $('cameraSelect'), refreshCameras: $('refreshCameras'),
  openCam: $('openCam'), closeCam: $('closeCam'), camInfo: $('camInfo'), camFps: $('camFps'),
  exposureRow: $('exposureRow'), exposureMode: $('exposureMode'), exposureTime: $('exposureTime'), exposureValue: $('exposureValue'),
  duration: $('duration'), startLive: $('startLive'), stopRun: $('stopRun'), checkDevice: $('checkDevice'),
  elapsed: $('elapsed'), credits: $('credits'), sentFps: $('sentFps'), keyWarning: $('keyWarning'),
  recordings: $('recordings'), speed: $('speed'), startReplay: $('startReplay'), refreshRecordings: $('refreshRecordings'),
  vPulse: $('vPulse'), vPulseQ: $('vPulseQ'), vBreath: $('vBreath'), vBreathQ: $('vBreathQ'),
  vHrv: $('vHrv'), vHrvQ: $('vHrvQ'), vStress: $('vStress'), vExpr: $('vExpr'), vExprQ: $('vExprQ'),
  vBlinks: $('vBlinks'), vBlinkRate: $('vBlinkRate'),
  procStatus: $('procStatus'), packets: $('packets'), validation: $('validation'), log: $('log'),
  copyLog: $('copyLog'),
};

// Copies oldest-first so it reads top to bottom, plus the current vitals snapshot.
async function copyLog() {
  const lines = ui.log.textContent.trim().split('\n').reverse();
  const snapshot = `Vitals on screen: pulse ${ui.vPulse.textContent} · breathing ${ui.vBreath.textContent} · HRV ${ui.vHrv.textContent}`
    + ` · stress ${ui.vStress.textContent} · expression ${ui.vExpr.textContent} · blinks ${ui.vBlinks.textContent}`
    + ` · status ${ui.procStatus.textContent} · guidance ${ui.validation.textContent}`;
  try {
    await navigator.clipboard.writeText(`${lines.join('\n')}\n${snapshot}\n`);
  } catch (err) {
    log(`Copy failed: ${err.message}`);
    return;
  }
  $('copyIcon').classList.add('hidden');
  $('copiedIcon').classList.remove('hidden');
  ui.copyLog.classList.add('done');
  setTimeout(() => {
    $('copyIcon').classList.remove('hidden');
    $('copiedIcon').classList.add('hidden');
    ui.copyLog.classList.remove('done');
  }, 1500);
}

const bridge = window.gutCheck.sdk;
let info = { hasKey: false };
let stream = null;
let measuredFps = 0;
let source = null;
let runStartedAt = 0;
let autoStopTimer = null;
let clockTimer = null;
let sdkFailed = false;
let reopenPreviewAfterRun = false;
let livePreviewSeen = false;
const tracker = new VitalsTracker();
const liveCtx = ui.liveCanvas.getContext('2d');

function setPlaceholder(text) {
  ui.placeholder.textContent = text;
  ui.placeholder.classList.toggle('hidden', !text);
}

bridge.onPreview((pixels, width, height) => {
  if (!(source instanceof LiveSource)) return;
  if (ui.liveCanvas.width !== width) ui.liveCanvas.width = width;
  if (ui.liveCanvas.height !== height) ui.liveCanvas.height = height;
  liveCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height), 0, 0);
  if (!livePreviewSeen) {
    livePreviewSeen = true;
    ui.liveCanvas.classList.remove('hidden');
    setPlaceholder('');
  }
});

function formatClock(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

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
  ui.cameraSelect.disabled = busy;
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

// The SDK and the browser number cameras differently, so the preview finds the same camera by name.
async function browserDeviceIdFor(sdkCameraName) {
  if (!sdkCameraName) return null;
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.every((d) => !d.label)) {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach((t) => t.stop());
    devices = await navigator.mediaDevices.enumerateDevices();
  }
  const want = sdkCameraName.toLowerCase();
  const match = devices.find((d) => d.kind === 'videoinput'
    && (d.label.toLowerCase().includes(want) || want.includes(d.label.toLowerCase().replace(/\s*\([0-9a-f:]+\)$/, ''))));
  return match ? match.deviceId : null;
}

const CAMERA_PREF_KEY = 'gutcheck.cameraName';

function savedCameraName() {
  try { return localStorage.getItem(CAMERA_PREF_KEY); } catch { return null; }
}

// Preview and measurement must always use the same, explicitly named camera,
// because "default" means different devices to the browser and to the SDK.
async function refreshCameras() {
  const cams = await bridge.cameras();
  const wanted = ui.cameraSelect.selectedOptions[0]?.textContent || savedCameraName();
  ui.cameraSelect.innerHTML = '';
  for (const c of cams) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name || c.id;
    ui.cameraSelect.appendChild(opt);
  }
  if (!cams.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No camera found';
    ui.cameraSelect.appendChild(opt);
  }
  const match = cams.find((c) => (c.name || c.id) === wanted);
  if (match) ui.cameraSelect.value = match.id;
  log(`Cameras found: ${cams.map((c) => c.name || c.id).join(', ') || 'none'}`);
  await applyCameraChoice();
}

async function applyCameraChoice() {
  const id = ui.cameraSelect.value;
  if (!id) return false;
  const chosen = await bridge.setCamera(id);
  if (!chosen) return false;
  const name = ui.cameraSelect.selectedOptions[0].textContent;
  try { localStorage.setItem(CAMERA_PREF_KEY, name); } catch { /* storage unavailable */ }
  log(`Camera for preview + measurement: ${name}`);
  return true;
}

async function selectCamera() {
  if (!(await applyCameraChoice())) {
    log('That camera disappeared. Refreshing the list.');
    await refreshCameras();
    return;
  }
  if (stream) {
    await closeCamera();
    await openCamera();
  }
}

async function openCamera() {
  const sdkName = ui.cameraSelect.selectedOptions[0]?.textContent;
  const deviceId = ui.cameraSelect.value ? await browserDeviceIdFor(sdkName) : null;
  if (!deviceId) {
    log(`Preview couldn't find "${sdkName}". Pick a camera and try again.`);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, deviceId: { exact: deviceId } },
      audio: false,
    });
  } catch (err) {
    log(`Camera error: ${err.message}`);
    return;
  }
  const track = stream.getVideoTracks()[0];
  ui.preview.srcObject = stream;
  setPlaceholder('');
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
  setPlaceholder('Camera is off');
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
  ui.vStress.textContent = hrv?.baevsky != null ? hrv.baevsky.toFixed(2) : '—';
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
    if (mode === 'live') {
      ui.credits.textContent = Math.ceil(sec / 30);
      ui.recTime.textContent = formatClock(sec);
      if (!livePreviewSeen && sec >= 15) setPlaceholder('Measuring… (live preview not available from this camera)');
    }
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
  if (!(await applyCameraChoice())) {
    log('No camera selected for measurement. Pick one from the list.');
    return;
  }
  const cameraName = ui.cameraSelect.selectedOptions[0].textContent;
  // The SDK opens the camera itself in the main process, so the preview must let go of it first.
  reopenPreviewAfterRun = !!stream;
  await closeCamera();
  livePreviewSeen = false;
  setPlaceholder('Starting measurement…');
  ui.recTime.textContent = '0:00';
  ui.recBadge.classList.remove('hidden');
  const src = new LiveSource(bridge, window.gutCheck.recording, {
    mode: 'live',
    capture: 'native',
    requestedMetrics: REQUESTED_METRICS,
    camera: { ...info.capture, name: cameraName },
    previewFps: measuredFps || null,
  });
  log(`Measuring with: ${cameraName}`);
  beginRun(src, 'live');
  ui.credits.textContent = '0';
  // Count the auto-stop from when measuring actually begins; SDK startup takes several seconds.
  const seconds = Number(ui.duration.value);
  const SAFETY_SECONDS = 30;
  autoStopTimer = setTimeout(() => {
    log(`Auto-stop: measurement never started within ${SAFETY_SECONDS} s`);
    stopRun();
  }, SAFETY_SECONDS * 1000);
  src.on('processingStatus', (status) => {
    if (status !== ProcessingStatus.kRunning || src !== source) return;
    clearTimeout(autoStopTimer);
    runStartedAt = performance.now();
    autoStopTimer = setTimeout(() => {
      log(`Auto-stop after ${seconds} s of measuring`);
      stopRun();
    }, seconds * 1000);
  });
  log(`Live test started (auto-stop ${seconds} s after measuring begins)`);
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
  const src = new ReplaySource(text, { speed: Number(ui.speed.value) });
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
  if (src instanceof LiveSource && src.recordingName) {
    log(`Recording saved: recordings/${src.recordingName}`);
    await refreshRecordings(src.recordingName);
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
    + ` · HRV ${hrv?.rmssd != null ? Math.round(hrv.rmssd) + ' ms' : 'none'} · stress ${hrv?.baevsky != null ? hrv.baevsky.toFixed(2) : 'none'}`
    + ` · expression ${expression?.top ?? 'none'} · blinks ${tracker.blinkCount}`);
  clearInterval(clockTimer);
  const wasLive = source instanceof LiveSource;
  source = null;
  setMode('idle');
  if (wasLive) {
    ui.recBadge.classList.add('hidden');
    ui.liveCanvas.classList.add('hidden');
    setPlaceholder('Camera is off');
    if (reopenPreviewAfterRun) {
      reopenPreviewAfterRun = false;
      openCamera();
    }
  }
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

ui.copyLog.onclick = copyLog;
ui.cameraSelect.onchange = selectCamera;
ui.refreshCameras.onclick = refreshCameras;
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
  log(`Ready. SDK ${info.version}. API key ${info.hasKey ? 'loaded' : 'MISSING'}.`);
  await refreshCameras();
  const auto = await window.gutCheck.getAutoReplay();
  if (auto) {
    ui.recordings.value = auto;
    ui.speed.value = '10';
    await startReplay();
  }
})();
