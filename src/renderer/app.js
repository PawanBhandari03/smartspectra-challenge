const { SmartSpectraErrorCode, ProcessingStatus } = require('@smartspectra/node-sdk/renderer');
const { LiveSource, ReplaySource } = require('../core/sources');
const { buildPlan, plannedDurationMs, SessionRunner } = require('../core/session');
const { analyzeSession, pulseTrace, MIN_CONFIDENCE, MIN_ROUND_GAP_BPM, MOMENT } = require('../core/analysis');
const { renderTimeline, OPTION_COLORS } = require('./timeline');
const { VitalsTracker } = require('../core/vitals');
const { REQUESTED_METRICS } = require('../core/metrics');

const $ = (id) => document.getElementById(id);
const bridge = window.gutCheck.sdk;

// Unexpected errors go to the log (visible in the terminal when run from source).
window.addEventListener('error', (e) => console.log(`Screen error: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => console.log(`Unhandled: ${e.reason?.stack || e.reason}`));

const CAMERA_PREF_KEY = 'gutcheck.cameraName';

// Friendly versions of the SDK's ValidationCode guidance.
const GUIDANCE = {
  1: 'We can\'t see your face. Look at the screen.',
  2: 'Only one person in view, please.',
  3: 'Center your face in the frame.',
  4: 'Adjust your distance to the camera.',
  5: 'Too dark. Add light in front of you.',
  6: 'Too bright behind you.',
  7: 'Sit back a little so your chest is visible.',
  10: 'Adjusting the camera…',
  11: 'The camera is slowing down. Check your lighting.',
  12: 'Try to keep still.',
  13: 'Move back a little.',
  14: 'Move a little closer.',
  15: 'Lower the camera or sit up straighter.',
  16: 'Raise the camera a little.',
  17: 'Look straight at the screen.',
};

const PHASE_NAMES = { settle: 'Getting ready', baseline: 'Calm baseline', reset: 'Reset' };

const state = {
  options: [{ label: '', detail: '' }, { label: '', detail: '' }],
  info: { hasKey: false },
  stream: null,
  source: null,
  runner: null,
  plan: null,
  demo: false,
};

// ---------- Navigation ----------

function go(name) {
  if (state.source && name !== 'session') return Promise.resolve();
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  $('appBar').classList.toggle('hidden', name === 'session');
  const section = { options: 'options', consent: 'options', setup: 'options', history: 'history', settings: 'settings' }[name];
  document.querySelectorAll('.app-bar .nav[data-go]').forEach((b) => {
    if (b.dataset.go === section) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('appBar').classList.remove('tucked');
  window.scrollTo(0, 0);
  if (name === 'setup') return enterSetup();
  closeCamera();
  if (name === 'options') renderOptions();
  if (name === 'history') return renderHistory();
  if (name === 'settings') return renderSettings();
  return Promise.resolve();
}

// ---------- Settings ----------

const KEY_STATUS = {
  env: 'Using the key from the developer .env file',
  saved: 'Saved (encrypted on this computer)',
  none: 'Not set: live measurement is off. The sample still works.',
};

async function renderSettings() {
  const s = await window.gutCheck.settings.get();
  $('keyStatus').textContent = KEY_STATUS[s.keySource];
  $('removeKey').disabled = s.keySource !== 'saved';
  $('dataDir').textContent = s.dataDir;
  $('keyMessage').textContent = s.encryptionAvailable ? '' : 'Secure storage is not available on this computer, so a key cannot be saved.';
  $('dataMessage').textContent = '';
}

$('saveKey').onclick = async () => {
  try {
    await window.gutCheck.settings.saveKey($('keyInput').value);
    $('keyInput').value = '';
    await renderSettings();
    $('keyMessage').textContent = 'Key saved. The next live session will use it.';
  } catch (err) {
    $('keyMessage').textContent = `Couldn't save the key: ${err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`;
  }
};

$('removeKey').onclick = async () => {
  await window.gutCheck.settings.removeKey();
  await renderSettings();
  $('keyMessage').textContent = 'Key removed from this computer.';
};

$('openDataFolder').onclick = () => window.gutCheck.data.openFolder();

$('deleteAllData').onclick = async () => {
  if (!confirm('Delete all your CrossRoads sessions and recordings from this computer? This cannot be undone.')) return;
  await window.gutCheck.data.deleteAll();
  $('dataMessage').textContent = 'All sessions and recordings were deleted.';
};

document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });

// ---------- Theme: light by default, dark on request (remembered on this computer) ----------
let redrawTimeline = null;
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  $('themeToggle').title = label;
  $('themeToggle').setAttribute('aria-label', label);
  if (redrawTimeline && $('screen-results').classList.contains('active')) redrawTimeline();
}
let savedTheme = 'light';
try { savedTheme = localStorage.getItem('crossroads-theme') === 'dark' ? 'dark' : 'light'; } catch { /* storage unavailable */ }
applyTheme(savedTheme);
$('themeToggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('crossroads-theme', next); } catch { /* storage unavailable */ }
  applyTheme(next);
};

// Masthead: a shadow once the page scrolls; hides while scrolling down, returns on any scroll up.
let lastScrollY = 0;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const bar = $('appBar');
  bar.classList.toggle('scrolled', y > 4);
  if (y > 120 && y > lastScrollY + 4) bar.classList.add('tucked');
  else if (y < lastScrollY - 4 || y <= 120) bar.classList.remove('tucked');
  lastScrollY = y;
}, { passive: true });

// ---------- Options ----------

function renderOptions() {
  const list = $('optionList');
  list.innerHTML = '';
  state.options.forEach((opt, i) => {
    const card = document.createElement('div');
    card.className = 'option-card';
    card.style.setProperty('--opt-color', OPTION_COLORS[i]);

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('span');
    title.textContent = `Option ${i + 1}`;
    head.append(swatch(OPTION_COLORS[i]), title);

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'label';
    label.maxLength = 60;
    label.placeholder = i === 0 ? 'e.g. Stay in my city' : 'e.g. Move to Bangalore for the new job';
    label.value = opt.label;
    label.oninput = () => { opt.label = label.value; };

    const detail = document.createElement('input');
    detail.type = 'text';
    detail.maxLength = 80;
    detail.placeholder = 'Optional detail, e.g. "close to family, same salary"';
    detail.value = opt.detail;
    detail.oninput = () => { opt.detail = detail.value; };

    card.append(head, label, detail);
    list.appendChild(card);
  });
}

$('welcomeNext').onclick = () => go('options');


$('optionsNext').onclick = () => {
  const cleaned = state.options.map((o) => ({ label: o.label.trim(), detail: o.detail.trim() }));
  const labels = cleaned.map((o) => o.label.toLowerCase());
  let error = '';
  if (cleaned.some((o) => !o.label)) error = 'Give both options a name.';
  else if (new Set(labels).size !== labels.length) error = 'Each option needs a different name.';
  $('optionsError').textContent = error;
  $('optionsError').classList.toggle('hidden', !error);
  if (error) return;
  state.options = cleaned;
  go('consent');
};

// ---------- Consent ----------

$('consentBox').onchange = () => { $('consentNext').disabled = !$('consentBox').checked; };
$('consentNext').onclick = () => go('setup');

// ---------- Setup: camera + data source ----------

function savedCameraName() {
  try { return localStorage.getItem(CAMERA_PREF_KEY); } catch { return null; }
}

// The SDK and the browser number cameras differently, so the preview finds the same camera by name.
async function browserDeviceIdFor(name) {
  if (!name) return null;
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.every((d) => !d.label)) {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach((t) => t.stop());
    devices = await navigator.mediaDevices.enumerateDevices();
  }
  const want = name.toLowerCase();
  const match = devices.find((d) => d.kind === 'videoinput'
    && (d.label.toLowerCase().includes(want) || want.includes(d.label.toLowerCase().replace(/\s*\([0-9a-f:]+\)$/, ''))));
  return match ? match.deviceId : null;
}

async function refreshCameras() {
  const cams = await bridge.cameras();
  const select = $('cameraSelect');
  const wanted = select.selectedOptions[0]?.textContent || savedCameraName();
  select.innerHTML = '';
  for (const c of cams) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name || c.id;
    select.appendChild(opt);
  }
  if (!cams.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No camera found';
    select.appendChild(opt);
  }
  const match = cams.find((c) => (c.name || c.id) === wanted);
  if (match) select.value = match.id;
  await applyCameraChoice();
}

async function applyCameraChoice() {
  const select = $('cameraSelect');
  if (!select.value || !(await bridge.setCamera(select.value))) return false;
  try { localStorage.setItem(CAMERA_PREF_KEY, select.selectedOptions[0].textContent); } catch { /* storage unavailable */ }
  return true;
}

async function openCamera() {
  closeCamera();
  const name = $('cameraSelect').selectedOptions[0]?.textContent;
  const deviceId = $('cameraSelect').value ? await browserDeviceIdFor(name) : null;
  if (!deviceId) {
    $('setupPlaceholder').textContent = 'Pick a camera above.';
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, deviceId: { exact: deviceId } },
      audio: false,
    });
  } catch (err) {
    $('setupPlaceholder').textContent = `Camera error: ${err.message}`;
    return;
  }
  $('setupVideo').srcObject = state.stream;
  $('setupPlaceholder').classList.add('hidden');
  trackPreviewFps(state.stream);
}

// Free frame-rate check while the preview is open. The SDK needs 25+ frames per second.
function trackPreviewFps(stream) {
  const video = $('setupVideo');
  let frames = [];
  const onFrame = () => {
    if (state.stream !== stream) return;
    const now = performance.now();
    frames.push(now);
    frames = frames.filter((t) => now - t < 2000);
    const fps = frames.length / 2;
    const info = $('fpsInfo');
    if (fps >= 25) {
      info.textContent = `Camera smooth ✓ (${fps > 30 ? '30+' : Math.round(fps)} fps)`;
      info.className = 'fps-info good';
    } else {
      info.textContent = `Camera slow (${Math.round(fps)} fps, needs 25+). Add light in front of you.`;
      info.className = 'fps-info bad';
    }
    video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}

function closeCamera() {
  if (!state.stream) return;
  state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  $('setupVideo').srcObject = null;
  $('fpsInfo').textContent = '';
  $('setupPlaceholder').textContent = 'Camera is off';
  $('setupPlaceholder').classList.remove('hidden');
}

async function enterSetup() {
  const plan = buildPlan(state.options);
  const minutes = plannedDurationMs(plan) / 60000;
  $('liveCost').textContent = `about ${Math.ceil(minutes)} minutes · uses ~${Math.ceil((minutes * 60) / 30)} Presage credits`;
  $('setupError').classList.add('hidden');
  await refreshCameras();
  await openCamera();
}

$('cameraSelect').onchange = async () => { await applyCameraChoice(); await openCamera(); };
$('refreshCameras').onclick = async () => { await refreshCameras(); await openCamera(); };

function setupError(msg) {
  $('setupError').textContent = msg;
  $('setupError').classList.remove('hidden');
}

// ---------- Session ----------

const thumbCtx = $('thumbCanvas').getContext('2d');
const FOCUS_PREF_KEY = 'gutcheck.focusMode';
const live = { tracker: new VitalsTracker(), startedAt: 0, previewSeen: false };

bridge.onPreview((pixels, width, height) => {
  if (!(state.source instanceof LiveSource)) return;
  const canvas = $('thumbCanvas');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  thumbCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height), 0, 0);
  if (!live.previewSeen) {
    live.previewSeen = true;
    $('liveNote').classList.add('hidden');
  }
});

function sessionLog(msg) {
  const el = $('sessionLog');
  el.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
  el.scrollTop = el.scrollHeight;
  console.log(msg);
}

function renderLiveVitals() {
  const { pulse, breathing, expression, blinkCount } = live.tracker;
  $('vPulse').textContent = pulse?.value != null ? Math.round(pulse.value) : '—';
  $('vPulseQ').textContent = pulse ? (pulse.stable ? 'steady' : 'warming up') : 'waiting';
  $('vPulseQ').className = `vital-q ${pulse?.stable ? 'stable' : ''}`;
  const heart = $('heartIcon');
  if (pulse?.value) {
    heart.style.setProperty('--beat', `${(60 / pulse.value).toFixed(2)}s`);
    heart.classList.add('beating');
  }
  $('vBreath').textContent = breathing?.value != null ? breathing.value.toFixed(1) : '—';
  $('vBreathQ').textContent = breathing ? (breathing.stable ? 'steady' : 'warming up') : 'waiting';
  $('vBreathQ').className = `vital-q ${breathing?.stable ? 'stable' : ''}`;
  $('vBlinks').textContent = blinkCount;
  const minutes = ((performance.now() - live.startedAt) * (state.runner?.speed || 1)) / 60000;
  $('vBlinkRate').textContent = minutes > 0.25 ? `${Math.round(blinkCount / minutes)}/min` : '';
  $('vExpr').textContent = expression?.top ? `${expression.top} ${Math.round(expression.topScore)}%` : '—';
}

function applyFocusMode() {
  const on = $('focusMode').checked;
  $('vitalGrid').classList.toggle('focus', on);
  $('focusNote').classList.toggle('hidden', !on);
  try { localStorage.setItem(FOCUS_PREF_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

$('focusMode').onchange = applyFocusMode;
try { $('focusMode').checked = localStorage.getItem(FOCUS_PREF_KEY) === '1'; } catch { /* storage unavailable */ }
applyFocusMode();

$('copyLog').onclick = async (e) => {
  e.preventDefault();
  try {
    await navigator.clipboard.writeText($('sessionLog').textContent);
  } catch {
    return;
  }
  $('copyIcon').classList.add('hidden');
  $('copiedIcon').classList.remove('hidden');
  $('copyLog').classList.add('done');
  setTimeout(() => {
    $('copyIcon').classList.remove('hidden');
    $('copiedIcon').classList.add('hidden');
    $('copyLog').classList.remove('done');
  }, 1500);
};

function buildPhaseBar(plan) {
  const bar = $('phaseBar');
  bar.innerHTML = '';
  for (const p of plan.phases) {
    const seg = document.createElement('div');
    seg.className = `seg ${p.kind}${p.kind === 'option' ? ` option${p.optionIndex}` : ''}`;
    seg.style.flexGrow = String(Math.round((p.durationMs || plan.timing.settleMinMs) / 1000));
    seg.appendChild(document.createElement('i'));
    bar.appendChild(seg);
  }
}

function phaseTitle(phase) {
  if (phase.kind !== 'option') return PHASE_NAMES[phase.kind];
  const n = state.plan.phases.filter((p) => p.kind === 'option').indexOf(phase) + 1;
  return `Visit ${n} of 4`;
}

let lastPrompt = '';
function showPrompt(text) {
  if (text === lastPrompt) return;
  lastPrompt = text;
  const el = $('prompt');
  el.classList.add('fade');
  setTimeout(() => { el.textContent = text; el.classList.remove('fade'); }, 300);
}

function onPhase(phase, index) {
  sessionLog(`Phase ${index}: ${phaseTitle(phase)}${phase.kind === 'option' ? ` (${state.plan.options[phase.optionIndex].label})` : ''} at ${Math.round(state.runner.now() / 1000)} s`);
  $('phaseLabel').textContent = phaseTitle(phase);
  $('settleChecks').classList.toggle('hidden', phase.kind !== 'settle');
  const title = $('optionTitle');
  if (phase.kind === 'option') {
    title.textContent = `${state.plan.options[phase.optionIndex].label}${phase.visit === 2 ? ' · second look' : ''}`;
    title.className = `option-title opt${phase.optionIndex}`;
  } else {
    title.classList.add('hidden');
  }
  const segs = $('phaseBar').children;
  for (let i = 0; i < segs.length; i++) segs[i].firstChild.style.width = i < index ? '100%' : '0';
}

function onTick(s) {
  showPrompt(s.prompt);
  const seg = $('phaseBar').children[s.phaseIndex];
  const total = s.phase.durationMs || state.plan.timing.settleMinMs;
  seg.firstChild.style.width = `${Math.min(100, (s.elapsedMs / total) * 100)}%`;
  $('phaseClock').textContent = s.remainingMs != null ? `${Math.ceil(s.remainingMs / 1000)} s` : '';

  if (s.readiness) {
    $('chkFrames').classList.toggle('ok', s.readiness.framesOk);
    $('chkFace').classList.toggle('ok', s.readiness.faceOk);
    $('chkPulse').classList.toggle('ok', s.readiness.pulseOk);
  }
  const hint = s.validationCode ? GUIDANCE[s.validationCode] : null;
  const settleHint = s.settleTooLong && !hint ? 'Still waiting for a steady signal. Check lighting and keep still.' : null;
  $('guidance').textContent = hint || settleHint || '';
  $('guidance').classList.toggle('hidden', !(hint || settleHint));
}

async function beginSession() {
  state.info = await bridge.info();
  if (!state.info.hasKey) return setupError('Live measurement needs a Presage API key. Add yours in Settings (top right), or try the sample from the home page.');
  // The SDK opens the camera itself, so the preview has to let go of it first.
  if (!(await applyCameraChoice())) return setupError('Pick a camera first.');
  const cameraName = $('cameraSelect').selectedOptions[0].textContent;
  closeCamera();
  const source = new LiveSource(bridge, window.gutCheck.recording, {
    mode: 'gutcheck',
    requestedMetrics: REQUESTED_METRICS,
    camera: { name: cameraName },
  });
  await runSession(source, buildPlan(state.options), { intro: `Live session with ${cameraName}` });
}

// Developer testing only: runs a full session from a raw recording (looped, re-planned, so its
// verdict is meaningless). Not reachable from the UI; the sample replay is the user-facing path.
async function devReplay(recordingName, speed = 20) {
  const source = new ReplaySource(await window.gutCheck.readRecording(recordingName), { speed, loop: true });
  await runSession(source, buildPlan(state.options), { speed, demo: true, intro: `Dev replay of ${recordingName} at ${speed}×` });
}

// Runs a session from any source: live camera, a demo replay, or the scripted sample replay.
async function runSession(source, plan, { speed = 1, demo = false, script = null, intro = '', sampleReplay = false }) {
  const runner = new SessionRunner(plan, source, { speed, demo, script });
  Object.assign(state, { source, runner, plan, demo, sampleReplay });

  runner.on('phase', onPhase);
  runner.on('tick', onTick);
  runner.on('done', (result) => finishSession(result));
  runner.on('settleFailed', (r) => {
    const missing = [
      !r.framesOk && 'the camera wasn\'t steady at 25+ frames per second (check lighting)',
      !r.faceOk && 'your face wasn\'t clearly visible',
      !r.pulseOk && 'no pulse could be read yet',
    ].filter(Boolean);
    endWithError(`We couldn't get a steady signal in 90 seconds, so the measurement was stopped to save credits: ${missing.join('; ') || 'unknown reason'}.`);
  });
  // Errors are only fatal once the SDK actually stops (status kError); some are recoverable.
  let lastError = '';
  source.on('error', (code, message) => {
    lastError = `${message} (${nameOf(SmartSpectraErrorCode, code)})`;
    if (!demo) sessionLog(`SDK error: ${lastError}`);
  });
  source.on('processingStatus', (status) => {
    if (!demo) sessionLog(`SDK status: ${nameOf(ProcessingStatus, status)}`);
    if (!demo && status === ProcessingStatus.kError) endWithError(`The measurement stopped: ${lastError || 'unknown error'}`);
  });
  let lastCode = null;
  source.on('validationStatus', (code) => {
    if (code === lastCode) return;
    lastCode = code;
    sessionLog(`Camera guidance: ${code === 0 ? 'OK' : GUIDANCE[code] || `code ${code}`}`);
  });
  source.on('fps', (sent) => { if (!demo) $('thumbBadge').textContent = `● REC · ${sent} fps`; });
  source.on('metrics', (buf) => {
    try { live.tracker.ingest(buf); } catch { return; }
    renderLiveVitals();
  });
  source.on('loop', () => live.tracker.blinks.reset());

  live.tracker.reset();
  live.startedAt = performance.now();
  live.previewSeen = false;
  $('heartIcon').classList.remove('beating');
  renderLiveVitals();
  $('sessionLog').textContent = '';
  sessionLog(intro);
  sessionLog(`Options: "${plan.options[0].label}" vs "${plan.options[1].label}"`);
  thumbCtx.clearRect(0, 0, $('thumbCanvas').width, $('thumbCanvas').height);
  $('liveNote').textContent = sampleReplay ? 'Sample: replaying a recorded session (no camera)'
    : demo ? 'Demo: replaying recorded data (no camera)' : 'Starting the camera…';
  $('liveNote').classList.remove('hidden');

  buildPhaseBar(plan);
  lastPrompt = '';
  $('prompt').textContent = demo ? 'Loading recorded data…' : 'Starting the camera…';
  $('phaseLabel').textContent = 'Starting…';
  $('phaseClock').textContent = '';
  $('optionTitle').classList.add('hidden');
  $('settleChecks').classList.add('hidden');
  $('guidance').classList.add('hidden');
  $('thumbBadge').textContent = sampleReplay ? `SAMPLE ${speed}×` : demo ? `DEMO ${speed}×` : '● REC';
  $('stopSession').textContent = sampleReplay ? 'Exit replay' : 'Stop session';
  $('thumbBadge').classList.toggle('demo', demo);
  go('session');

  try {
    await source.start();
  } catch (err) {
    await endWithError(`Couldn't start the measurement: ${err.message}`);
  }
}

$('beginSession').onclick = beginSession;

const nameOf = (table, value) => Object.keys(table).find((k) => table[k] === value) || String(value);

let finishing = false;

async function stopSource() {
  const { source } = state;
  if (!source) return;
  try { await source.stop(); } catch { /* already stopped */ }
}

async function endWithError(message) {
  if (finishing) return;
  finishing = true;
  const partial = state.runner?.abort();
  await stopSource();
  const recordingName = state.source?.recordingName;
  if (partial) {
    await window.gutCheck.saveSession(JSON.stringify({ ...partial, recording: recordingName || null, error: message }));
  }
  if (!state.demo) await bridge.destroy();
  finishing = false;
  state.source = null;
  await go('setup');
  setupError(message);
}

$('stopSession').onclick = async () => {
  if (state.sampleReplay) {
    await stopSource();
    state.source = null;
    await openSample();
    return;
  }
  if (!confirm('Stop this session? You will see results for the parts you finished.')) return;
  const result = state.runner?.abort();
  if (!result) {
    await stopSource();
    state.source = null;
    go('setup');
  }
};

async function finishSession(result) {
  if (finishing) return;
  finishing = true;
  await stopSource();
  if (state.sampleReplay) {
    // The replay is only a walkthrough; the sample's own saved results are what we show.
    state.source = null;
    finishing = false;
    await openSample();
    return;
  }
  const recordingName = state.source?.recordingName;
  const sessionName = await window.gutCheck.saveSession(JSON.stringify({ ...result, recording: recordingName || null }));
  state.source = null;
  finishing = false;
  renderResults(result, sessionName, recordingName);
  go('results');
}

// ---------- Sample session (no camera, no API key) ----------

let sampleCache = null;

async function loadSample() {
  if (!sampleCache) {
    const raw = await window.gutCheck.readSample();
    sampleCache = { session: JSON.parse(raw.session), recording: raw.recording };
  }
  return sampleCache;
}

async function openSample() {
  const { session } = await loadSample();
  renderResults(session, null, null, { sample: true });
  await go('results');
}

$('trySample').onclick = openSample;

const SAMPLE_REPLAY_SPEED = 5;

$('watchSample').onclick = async () => {
  const { session, recording } = await loadSample();
  const plan = buildPlan(session.options, { timing: session.timing, order: session.order });
  const source = new ReplaySource(recording, { speed: SAMPLE_REPLAY_SPEED });
  await runSession(source, plan, {
    speed: SAMPLE_REPLAY_SPEED,
    demo: true,
    script: session.phases,
    sampleReplay: true,
    intro: `Sample session replay at ${SAMPLE_REPLAY_SPEED}× (recorded by the developer)`,
  });
};

// ---------- Results: "a mirror, not a verdict" ----------

const fmt = (v, digits = 0) => (v == null ? '—' : v.toFixed(digits));

function cell(row, content, cls = '') {
  const td = document.createElement('td');
  td.textContent = content;
  if (cls) td.className = cls;
  row.appendChild(td);
}

function verdictText(v) {
  switch (v.kind) {
    case 'lean':
      return {
        title: `Your body stayed calmer with "${v.calmerLabel}"`,
        note: `In both rounds your pulse was lower while imagining "${v.calmerLabel}" (by ${fmt(Math.abs(v.round1), 1)} and ${fmt(Math.abs(v.round2), 1)} bpm), `
          + `both beyond the normal wobble of a resting pulse (${fmt(v.threshold, 1)} bpm). A higher pulse for "${v.tenserLabel}" can mean tension or excitement: which was it?`,
      };
    case 'tooClose':
      return {
        title: 'Your body didn\'t pick a side',
        note: 'That is an answer too: neither option made your body clearly calmer or tenser than the other, so this choice '
          + 'is less about fear or comfort and more about what you value. '
          + (v.agree
            ? `Both rounds leaned the same way, but by less than ${fmt(v.threshold, 1)} bpm, which is within the normal wobble of a resting pulse.`
            : 'The two rounds pointed in opposite directions.')
          + ' The moments below show where your body did react.',
      };
    case 'notEnough':
      return { title: 'Not enough clear signal', note: 'At least one visit had too few reliable pulse readings. Better light on your face and staying still usually fix this.' };
    default:
      return { title: 'Partial results', note: 'The session ended before both options were visited twice.' };
  }
}

function choiceLabel(session) {
  const c = session.choice;
  if (!c) return '';
  return c.optionIndex == null ? 'still deciding' : `"${session.options[c.optionIndex].label}"`;
}

// "What did you decide?": only for real sessions saved in My decisions.
function renderChoice(result, sessionName) {
  const card = $('choiceCard');
  const show = !!sessionName && !result.demo && !result.sample;
  card.classList.toggle('hidden', !show);
  if (!show) return;
  let selected = result.choice ? result.choice.optionIndex : undefined;
  const buttons = $('choiceButtons');
  buttons.innerHTML = '';
  const choices = [...result.options.map((o, i) => ({ label: o.label, value: i })), { label: 'Still deciding', value: null }];
  for (const c of choices) {
    const b = document.createElement('button');
    b.className = `choice-btn${selected === c.value ? ' selected' : ''}`;
    b.textContent = c.label;
    b.onclick = () => {
      selected = c.value;
      buttons.querySelectorAll('.choice-btn').forEach((x) => x.classList.toggle('selected', x === b));
    };
    buttons.appendChild(b);
  }
  $('choiceNote').value = result.choice?.note || '';
  $('choiceSaved').textContent = result.choice ? `Saved ${new Date(result.choice.at).toLocaleDateString()}: you chose ${choiceLabel(result)}.` : '';
  $('saveChoice').onclick = async () => {
    if (selected === undefined) {
      $('choiceSaved').textContent = 'Pick one of the options first.';
      return;
    }
    result.choice = await window.gutCheck.setChoice(sessionName, { optionIndex: selected, note: $('choiceNote').value });
    $('choiceSaved').textContent = `Saved: you chose ${choiceLabel(result)}.`;
  };
}

function renderResults(result, sessionName, recordingName, { sample = false } = {}) {
  const a = analyzeSession(result);
  $('sampleBanner').classList.toggle('hidden', !sample);
  renderChoice(result, sample ? null : sessionName);
  console.log(`Session done (completed=${result.completed}): verdict ${JSON.stringify(a.verdict)} · visits `
    + a.visits.map((v) => `${v.label}#${v.visit} pulse ${fmt(v.stats.pulse, 1)} (n${v.stats.pulseReadings})`).join(' · ')
    + ` · saved ${sessionName}`);

  const when = new Date(result.createdAt || Date.now())
    .toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('resultsDate').textContent = `${when} · “${result.options[0].label}” or “${result.options[1].label}”?`;

  const text = verdictText(a.verdict);
  renderReveal(a, result.options);
  $('resultsTitle').textContent = text.title;
  $('resultsNote').textContent = text.note;

  renderOptionSummary(a);
  renderMoments(a);
  renderReflection(a, result.options);
  renderLegend(result.options);
  // Draw after the screen is visible so the chart can measure its width.
  redrawTimeline = () => renderTimeline($('timeline'), result, pulseTrace(result), momentMarkers(a));
  requestAnimationFrame(redrawTimeline);

  $('method').textContent = 'How this works: Presage SmartSpectra reads your pulse from tiny colour changes in your face through the camera. '
    + 'Each option is visited twice in a mirrored order (A B B A), so the slow drift of a body during a session affects both options equally. '
    + `Only stable readings with confidence ${MIN_CONFIDENCE}+ count, skipping the first 15 s of each visit while the pulse average catches up. `
    + `A resting pulse wobbles 6 to 9 bpm from minute to minute by itself, so CrossRoads only names a calmer option when both rounds agree by more than ${MIN_ROUND_GAP_BPM} bpm. `
    + 'Breathing and blinks are shown, not counted: breathing is only readable in the last ~10 s of each visit, and in our tea-vs-coffee test it differed by chance. '
    + 'A wellness reflection tool, not medical advice.';

  const table = document.createElement('table');
  table.className = 'results';
  const head = table.createTHead().insertRow();
  for (const h of ['Visit', 'Option', 'Pulse', 'Breathing', 'Blinks', 'Signal']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  const body = table.createTBody();
  if (a.baseline) {
    const row = body.insertRow();
    cell(row, 'Baseline');
    cell(row, 'Calm scene', 'muted');
    cell(row, `${fmt(a.baseline.pulse)} bpm`, 'num');
    cell(row, `${fmt(a.baseline.breathing, 1)} /min`, 'num');
    cell(row, `${fmt(a.baseline.blinksPerMin)} /min`, 'num');
    cell(row, a.baseline.enoughSignal ? 'good' : 'weak', a.baseline.enoughSignal ? '' : 'up');
  }
  a.visits.forEach((v, i) => {
    const row = body.insertRow();
    cell(row, `${i + 1}`);
    cell(row, v.label);
    cell(row, `${fmt(v.stats.pulse)} bpm`, 'num');
    cell(row, `${fmt(v.stats.breathing, 1)} /min`, 'num');
    cell(row, `${fmt(v.stats.blinksPerMin)} /min`, 'num');
    cell(row, v.stats.enoughSignal ? 'good' : 'weak', v.stats.enoughSignal ? '' : 'up');
  });
  $('resultsTable').innerHTML = '';
  $('resultsTable').appendChild(table);

  $('resultsFiles').textContent = sample
    ? 'Sample session bundled with the app (camera name removed; numbers only, no video).'
    : `${result.demo ? 'Demo session (recorded data). ' : ''}`
      + `Saved: sessions/${sessionName}${recordingName ? ` · recordings/${recordingName}` : ''}`;
}

function swatch(color) {
  const s = document.createElement('span');
  s.className = 'swatch';
  s.style.background = color;
  return s;
}

function renderLegend(options) {
  const legend = $('chartLegend');
  legend.innerHTML = '';
  options.forEach((o, i) => {
    const item = document.createElement('span');
    item.append(swatch(OPTION_COLORS[i]), document.createTextNode(o.label));
    legend.appendChild(item);
  });
}

// The crossroads from the welcome screen, drawn again as the result: the path your body was calmer
// with draws thicker; if it didn't pick a side, both paths draw the same.
function renderReveal(a, options) {
  const svg = $('reveal');
  const v = a.verdict;
  const weight = (i) => {
    if (v.kind === 'lean') return v.calmerIndex === i ? 'strong' : 'faint';
    return v.kind === 'tooClose' ? 'even' : 'unsure';
  };
  const short = (t) => (t.length > 34 ? `${t.slice(0, 33)}…` : t);
  const el = (tag, attrs) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val);
    return e;
  };
  svg.replaceChildren();
  svg.appendChild(el('path', { d: 'M2 40h96l8-14 9 28 8-22 6 8h31', class: 'stem', pathLength: 1 }));
  [14, 66].forEach((y, i) => {
    const g = el('g', { class: `branch ${weight(i)}` });
    g.style.setProperty('--c', OPTION_COLORS[i]); // CSSOM, not a style attribute: the CSP blocks inline styles
    g.appendChild(el('path', { d: `M160 40c34 0 42 ${y - 40} 90 ${y - 40}h70`, pathLength: 1 }));
    g.appendChild(el('circle', { cx: 326, cy: y, r: 4.5 }));
    const label = el('text', { x: 340, y: y + 5 });
    label.textContent = short(options[i].label);
    g.appendChild(label);
    svg.appendChild(g);
  });
  svg.appendChild(el('circle', { cx: 160, cy: 40, r: 3.5, class: 'fork' }));
  const summary = { strong: 'calmer', faint: 'less calm', even: 'no clear difference', unsure: 'not enough signal' };
  svg.setAttribute('aria-label', options.map((o, i) => `${o.label}: ${summary[weight(i)]}`).join('; '));
}

function renderOptionSummary(a) {
  const box = $('optionSummary');
  box.innerHTML = '';
  a.options.forEach((o, i) => {
    const card = document.createElement('div');
    card.className = `opt${a.verdict.kind === 'lean' && a.verdict.calmerIndex === i ? ' calmer' : ''}`;
    card.style.setProperty('--opt-color', OPTION_COLORS[i]);
    const name = document.createElement('div');
    name.className = 'name';
    const label = document.createElement('span');
    label.textContent = o.label;
    name.append(swatch(OPTION_COLORS[i]), label);
    if (a.verdict.kind === 'lean' && a.verdict.calmerIndex === i) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Calmer';
      name.appendChild(tag);
    }
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = fmt(o.pulse);
    const unit = document.createElement('small');
    unit.textContent = 'bpm average';
    value.appendChild(unit);
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = `Pulse by visit: ${fmt(o.visitPulses[0])} · ${fmt(o.visitPulses[1])} bpm`;
    const sub2 = document.createElement('div');
    sub2.className = 'sub';
    sub2.textContent = `Breathing: ${fmt(o.visitBreathing[0], 1)} · ${fmt(o.visitBreathing[1], 1)} /min · Blinks: ${fmt(o.blinksPerMin)} /min`;
    card.append(name, value, sub, sub2);
    box.appendChild(card);
  });
}

// Markers sit where the reaction shows in the pulse (a few seconds after the prompt appeared).
function momentMarkers(a) {
  const marks = a.moments.rises.map((m, i) => ({ t: m.startMs + MOMENT.reactionDelayMs + 5000, label: String(i + 1) }));
  if (a.moments.calmest) marks.push({ t: a.moments.calmest.startMs + MOMENT.reactionDelayMs + 5000, label: 'C' });
  return marks;
}

function momentItem(numText, numClass, what, prompt) {
  const li = document.createElement('li');
  const num = document.createElement('span');
  num.className = `num ${numClass}`;
  num.textContent = numText;
  const body = document.createElement('div');
  const w = document.createElement('span');
  w.className = 'what';
  w.textContent = what;
  const q = document.createElement('span');
  q.className = 'quote';
  q.textContent = `“${prompt}”`;
  body.append(w, q);
  li.append(num, body);
  return li;
}

function renderMoments(a) {
  const list = $('momentsList');
  list.innerHTML = '';
  a.moments.rises.forEach((m, i) => {
    list.appendChild(momentItem(String(i + 1), '', `Pulse rose ~${fmt(m.shift)} bpm · ${m.label}, visit ${m.visit}`, m.prompt));
  });
  if (a.moments.calmest) {
    const m = a.moments.calmest;
    list.appendChild(momentItem('C', 'calm', `Calmest moment: pulse eased ~${fmt(Math.abs(m.shift))} bpm · ${m.label}, visit ${m.visit}`, m.prompt));
  }
  if (!list.children.length) {
    const li = document.createElement('li');
    li.className = 'what';
    li.textContent = 'No single moment stood out: your pulse stayed fairly even through the prompts.';
    list.appendChild(li);
  }
}

function renderReflection(a, options) {
  const qs = [];
  const top = a.moments.rises[0];
  if (top) qs.push(`At "${top.prompt}" your pulse rose. What came up for you right then?`);
  if (a.moments.calmest) qs.push(`Your body eased at "${a.moments.calmest.prompt}". What felt settled there?`);
  if (a.verdict.kind === 'tooClose') {
    qs.push('When you read that your body didn\'t pick a side, did you feel relief or disappointment? That feeling is information too.');
  } else if (a.verdict.kind === 'lean') {
    qs.push(`Your body was calmer with "${a.verdict.calmerLabel}". Does that match what you expected, or surprise you?`);
  }
  qs.push(`Which was easier to picture in detail: "${options[0].label}" or "${options[1].label}"?`);
  const list = $('reflectList');
  list.innerHTML = '';
  for (const q of qs.slice(0, 4)) {
    const li = document.createElement('li');
    li.textContent = q;
    list.appendChild(li);
  }
}

$('newSession').onclick = () => {
  state.options = [{ label: '', detail: '' }, { label: '', detail: '' }];
  $('consentBox').checked = false;
  $('consentNext').disabled = true;
  go('options');
};

// ---------- History ----------

function sessionDate(name) {
  const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!m) return name;
  return new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
    .toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function renderHistory() {
  const list = $('historyList');
  list.innerHTML = '';
  const names = await window.gutCheck.listSessions();
  for (const name of names) {
    let session;
    try { session = JSON.parse(await window.gutCheck.readSession(name)); } catch { continue; }
    if (!session.options || session.options.length < 2) continue;
    const a = analyzeSession(session);

    const item = document.createElement('div');
    item.className = 'history-item';
    item.tabIndex = 0;
    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    const first = document.createElement('span');
    first.textContent = session.options[0].label;
    const vs = document.createElement('span');
    vs.className = 'vs';
    vs.textContent = 'or';
    const second = document.createElement('span');
    second.textContent = session.options[1].label;
    const group = (i, label) => {
      const g = document.createElement('span');
      g.className = 'opt-group';
      g.append(swatch(OPTION_COLORS[i]), label);
      return g;
    };
    title.append(group(0, first), vs, group(1, second));
    if (session.demo) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = 'Demo';
      title.appendChild(chip);
    }
    if ((session.version || 1) < 2) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = 'Early format';
      title.appendChild(chip);
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = sessionDate(name);
    left.append(title, meta);
    if (session.choice) {
      const chose = document.createElement('div');
      chose.className = 'chose';
      chose.textContent = `You chose: ${choiceLabel(session)}`;
      left.appendChild(chose);
    }
    const verdict = document.createElement('div');
    verdict.className = 'verdict';
    verdict.textContent = verdictText(a.verdict).title;
    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = 'Delete';
    del.title = 'Delete this session and its recording';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${session.options[0].label}" or "${session.options[1].label}" from ${sessionDate(name)}? This cannot be undone.`)) return;
      await window.gutCheck.deleteSession(name);
      item.remove();
    };
    item.append(left, verdict, del);
    const open = () => {
      renderResults(session, name, session.recording);
      go('results');
    };
    item.onclick = open;
    item.onkeydown = (e) => { if (e.key === 'Enter') open(); };
    list.appendChild(item);
  }
  if (!list.children.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No sessions yet. Start a check to see it here.';
    list.appendChild(empty);
  }
}

// ---------- Start ----------

(async () => {
  // Refreshed every minute so the masthead stays right if the app is left open past midnight.
  const showToday = () => { $('todayDate').textContent = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }); };
  showToday();
  setInterval(showToday, 60000);
  state.info = await bridge.info();
  const auto = await window.gutCheck.getAutoReplay();
  // Dev/testing hooks: "screen:<name>" opens a screen; a recording name runs a full demo session.
  if (auto === 'screen:lab') {
    location.href = 'lab.html';
  } else if (auto === 'screen:sample') {
    await openSample();
  } else if (auto.startsWith('open:')) {
    const name = auto.slice(5);
    renderResults(JSON.parse(await window.gutCheck.readSession(name)), name, null);
    await go('results');
  } else if (auto === 'sample:replay') {
    await openSample();
    $('watchSample').click();
  } else if (auto.startsWith('screen:')) {
    if (auto === 'screen:options' || auto === 'screen:consent') {
      state.options = [{ label: 'A quiet afternoon at the beach', detail: '' }, { label: 'Giving a speech to 1,000 people', detail: 'no preparation' }];
    }
    await go(auto.slice(7));
  } else if (auto) {
    state.options = [{ label: 'Stay in my city', detail: '' }, { label: 'Move for the new job', detail: 'higher salary' }];
    await devReplay(auto);
  }
})();
