const { SmartSpectraErrorCode, ProcessingStatus } = require('@smartspectra/node-sdk/renderer');
const { LiveSource, ReplaySource } = require('../core/sources');
const { buildPlan, plannedDurationMs, SessionRunner } = require('../core/session');
const { analyzeSession } = require('../core/analysis');
const { REQUESTED_METRICS } = require('../core/metrics');

const $ = (id) => document.getElementById(id);
const bridge = window.gutCheck.sdk;

const MAX_OPTIONS = 3;
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

const PHASE_NAMES = { settle: 'Getting ready', baseline: 'Calm baseline', reset: 'Reset', endBaseline: 'Calm baseline' };

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
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  if (name === 'setup') return enterSetup();
  closeCamera();
  return Promise.resolve();
}

document.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });

// ---------- Options ----------

function renderOptions() {
  const list = $('optionList');
  list.innerHTML = '';
  state.options.forEach((opt, i) => {
    const card = document.createElement('div');
    card.className = 'option-card';

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('span');
    title.textContent = `Option ${i + 1}`;
    head.appendChild(title);
    if (state.options.length > 2) {
      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.textContent = 'Remove';
      remove.onclick = () => { state.options.splice(i, 1); renderOptions(); };
      head.appendChild(remove);
    }

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'label';
    label.maxLength = 60;
    label.placeholder = i === 0 ? 'e.g. Stay in my city' : i === 1 ? 'e.g. Move to Bangalore for the new job' : 'e.g. Take a gap year';
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
  $('addOption').classList.toggle('hidden', state.options.length >= MAX_OPTIONS);
}

$('addOption').onclick = () => {
  if (state.options.length < MAX_OPTIONS) state.options.push({ label: '', detail: '' });
  renderOptions();
};

$('welcomeNext').onclick = () => { renderOptions(); go('options'); };

$('optionsNext').onclick = () => {
  const cleaned = state.options.map((o) => ({ label: o.label.trim(), detail: o.detail.trim() }));
  const labels = cleaned.map((o) => o.label.toLowerCase());
  let error = '';
  if (cleaned.some((o) => !o.label)) error = 'Give every option a name (or remove the empty one).';
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
}

function closeCamera() {
  if (!state.stream) return;
  state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  $('setupVideo').srcObject = null;
  $('setupPlaceholder').textContent = 'Camera is off';
  $('setupPlaceholder').classList.remove('hidden');
}

function sourceMode() {
  return document.querySelector('input[name="source"]:checked').value;
}

async function refreshDemoRecordings() {
  const names = (await window.gutCheck.listRecordings()).filter((n) => n !== 'synthetic-test.jsonl');
  const select = $('demoRecording');
  select.innerHTML = '';
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    const m = n.match(/session-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
    const date = m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
    opt.textContent = date ? `Recording ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : n;
    select.appendChild(opt);
  }
}

async function updateSourceUi() {
  const demo = sourceMode() === 'demo';
  $('demoOptions').classList.toggle('hidden', !demo);
  if (demo) {
    closeCamera();
    $('setupPlaceholder').textContent = 'Demo mode: no camera needed';
  } else {
    await openCamera();
  }
}

async function enterSetup() {
  const plan = buildPlan(state.options);
  const minutes = plannedDurationMs(plan) / 60000;
  $('liveCost').textContent = `About ${Math.ceil(minutes)} minutes · uses ~${Math.ceil((minutes * 60) / 30)} Presage credits`;
  $('setupError').classList.add('hidden');
  await refreshCameras();
  await refreshDemoRecordings();
  await updateSourceUi();
}

$('cameraSelect').onchange = async () => { await applyCameraChoice(); if (sourceMode() === 'live') await openCamera(); };
$('refreshCameras').onclick = async () => { await refreshCameras(); if (sourceMode() === 'live') await openCamera(); };
document.querySelectorAll('input[name="source"]').forEach((r) => { r.onchange = updateSourceUi; });

function setupError(msg) {
  $('setupError').textContent = msg;
  $('setupError').classList.remove('hidden');
}

// ---------- Session ----------

const thumbCtx = $('thumbCanvas').getContext('2d');

bridge.onPreview((pixels, width, height) => {
  if (!(state.source instanceof LiveSource)) return;
  const canvas = $('thumbCanvas');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  thumbCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height), 0, 0);
});

function buildPhaseBar(plan) {
  const bar = $('phaseBar');
  bar.innerHTML = '';
  for (const p of plan.phases) {
    const seg = document.createElement('div');
    seg.className = `seg ${p.kind}`;
    seg.style.flexGrow = String(Math.round((p.durationMs || plan.timing.settleMinMs) / 1000));
    seg.appendChild(document.createElement('i'));
    bar.appendChild(seg);
  }
}

function phaseTitle(phase) {
  if (phase.kind !== 'option') return PHASE_NAMES[phase.kind];
  const n = state.plan.order.indexOf(phase.optionIndex) + 1;
  return `Option ${n} of ${state.plan.order.length}`;
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
  console.log(`Phase ${index}: ${phase.kind}${phase.kind === 'option' ? ` (${state.plan.options[phase.optionIndex].label})` : ''} at ${state.runner.now()} ms`);
  $('phaseLabel').textContent = phaseTitle(phase);
  $('settleChecks').classList.toggle('hidden', phase.kind !== 'settle');
  const title = $('optionTitle');
  if (phase.kind === 'option') {
    title.textContent = state.plan.options[phase.optionIndex].label;
    title.classList.remove('hidden');
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
  const demo = sourceMode() === 'demo';
  let source;
  let speed = 1;

  if (demo) {
    const name = $('demoRecording').value;
    if (!name) return setupError('No recordings yet. Do a live session first (or use the Signal Lab).');
    speed = Number($('demoSpeed').value);
    source = new ReplaySource(await window.gutCheck.readRecording(name), { speed, loop: true });
  } else {
    if (!state.info.hasKey) return setupError('No Presage API key found. Add PRESAGE_API_KEY to the .env file and restart.');
    // The SDK opens the camera itself, so the preview has to let go of it first.
    if (!(await applyCameraChoice())) return setupError('Pick a camera first.');
    closeCamera();
    source = new LiveSource(bridge, window.gutCheck.recording, {
      mode: 'gutcheck',
      requestedMetrics: REQUESTED_METRICS,
      camera: { name: $('cameraSelect').selectedOptions[0].textContent },
    });
  }

  const plan = buildPlan(state.options);
  const runner = new SessionRunner(plan, source, { speed, demo });
  Object.assign(state, { source, runner, plan, demo });

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
    console.log(`SDK error: ${lastError}`);
  });
  source.on('processingStatus', (status) => {
    if (!demo && status === ProcessingStatus.kError) endWithError(`The measurement stopped: ${lastError || 'unknown error'}`);
  });

  buildPhaseBar(plan);
  lastPrompt = '';
  $('prompt').textContent = demo ? 'Loading recorded data…' : 'Starting the camera…';
  $('phaseLabel').textContent = 'Starting…';
  $('phaseClock').textContent = '';
  $('optionTitle').classList.add('hidden');
  $('settleChecks').classList.add('hidden');
  $('guidance').classList.add('hidden');
  $('thumbCanvas').classList.toggle('hidden', demo);
  $('thumbBadge').textContent = demo ? `DEMO ${speed}×` : '● REC';
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
  const recordingName = state.source?.recordingName;
  const sessionName = await window.gutCheck.saveSession(JSON.stringify({ ...result, recording: recordingName || null }));
  state.source = null;
  finishing = false;
  renderResults(result, sessionName, recordingName);
  go('results');
}

// ---------- Results (raw numbers; the Body Vote comes in Phase 3) ----------

function fmtChange(v, digits, unit) {
  if (v == null || Number.isNaN(v)) return { text: '—', cls: '' };
  if (Math.abs(v) < 0.5 * 10 ** -digits) return { text: `0${unit}`, cls: '' };
  const sign = v > 0 ? '+' : '';
  return { text: `${sign}${v.toFixed(digits)}${unit}`, cls: v > 0 ? 'up' : v < 0 ? 'down' : '' };
}

function biggestExpressionShift(change) {
  const top = Object.entries(change).filter(([, v]) => v != null).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return top ? fmtChange(top[1], 0, ` ${top[0]}`) : { text: '—', cls: '' };
}

function cell(row, content, cls = '') {
  const td = document.createElement('td');
  td.textContent = content;
  if (cls) td.className = cls;
  row.appendChild(td);
}

function renderResults(result, sessionName, recordingName) {
  const a = analyzeSession(result);
  console.log(`Session done (completed=${result.completed}): baseline pulse ${a.baseline.pulse?.toFixed(1)}, breathing ${a.baseline.breathing?.toFixed(1)}, blinks/min ${a.baseline.blinksPerMin?.toFixed(1)} · `
    + a.options.map((o) => `${o.label}: pulse ${o.change.pulse?.toFixed(1)}, breathing ${o.change.breathing?.toFixed(1)}, blinks ${o.change.blinksPerMin?.toFixed(1)}`).join(' · ')
    + ` · series sizes ${Object.entries(result.series).map(([k, v]) => `${k}=${v.length}`).join(' ')} · saved ${sessionName}`);
  $('resultsTitle').textContent = result.completed ? 'How your body reacted' : 'Partial results';
  $('resultsNote').textContent = `Each option compared with your own calm baseline (pulse ${a.baseline.pulse?.toFixed(0) ?? '—'} bpm, `
    + `breathing ${a.baseline.breathing?.toFixed(1) ?? '—'}/min, ${a.baseline.blinksPerMin?.toFixed(0) ?? '—'} blinks/min). `
    + 'Orange = more aroused than baseline, green = calmer. The Body Vote verdict is the next step of the build.';

  const table = document.createElement('table');
  table.className = 'results';
  const head = table.createTHead().insertRow();
  for (const h of ['Option', 'Pulse', 'Breathing', 'Blinks', 'Biggest expression shift']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  const body = table.createTBody();
  for (const o of a.options) {
    const row = body.insertRow();
    cell(row, o.label);
    const p = fmtChange(o.change.pulse, 1, ' bpm');
    cell(row, p.text, `num ${p.cls}`);
    const b = fmtChange(o.change.breathing, 1, ' /min');
    cell(row, b.text, `num ${b.cls}`);
    const k = fmtChange(o.change.blinksPerMin, 0, ' /min');
    cell(row, k.text, `num ${k.cls}`);
    const e = biggestExpressionShift(o.change.expression);
    cell(row, e.text, 'num');
  }
  if (!a.options.length) {
    const row = body.insertRow();
    cell(row, 'The session ended before any option was measured.');
  }
  $('resultsTable').innerHTML = '';
  $('resultsTable').appendChild(table);

  const hrv = a.sessionHrv ? ` Session HRV: ${Math.round(a.sessionHrv.rmssd)} ms RMSSD.` : '';
  $('resultsFiles').textContent = `${result.demo ? 'Demo session (recorded data). ' : ''}Saved: sessions/${sessionName}`
    + `${recordingName ? ` · recordings/${recordingName}` : ''}.${hrv}`;
}

$('newSession').onclick = () => {
  state.options = [{ label: '', detail: '' }, { label: '', detail: '' }];
  $('consentBox').checked = false;
  $('consentNext').disabled = true;
  go('welcome');
};

// ---------- Start ----------

(async () => {
  state.info = await bridge.info();
  const auto = await window.gutCheck.getAutoReplay();
  // Dev/testing hook: run a full demo session automatically with sample options.
  if (auto) {
    state.options = [{ label: 'Stay in my city', detail: '' }, { label: 'Move for the new job', detail: 'higher salary' }];
    document.querySelector('input[name="source"][value="demo"]').checked = true;
    await go('setup');
    $('demoRecording').value = auto;
    $('demoSpeed').value = '20';
    await beginSession();
  }
})();
