const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { SmartSpectraSDK, CameraSelection } = require('@smartspectra/node-sdk');
const { REQUESTED_METRICS } = require('../core/metrics');

const appRoot = app.getAppPath();
require('dotenv').config({ path: path.join(appRoot, '.env'), quiet: true });

const apiKey = process.env.PRESAGE_API_KEY || '';
const recordingsDir = path.join(appRoot, 'recordings');
const CAPTURE = { width: 1280, height: 720, fps: 30 };

let win = null;
let sdk = null;
let cameraId = null;

function cameraSelection() {
  return cameraId ? CameraSelection.byId(cameraId) : CameraSelection.default;
}

function listCameras() {
  try {
    return SmartSpectraSDK.availableCameras();
  } catch {
    return [];
  }
}

// ---------- SDK (runs here, capturing the camera natively: no per-frame copies to the window) ----------

function sendEvent(name, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send('sdk:event', name, ...args);
}

// Live preview while measuring: the SDK owns the camera, so we show a small, throttled copy of its frames.
const PREVIEW_WIDTH = 320;
const PREVIEW_INTERVAL_MS = 100;
const BYTES_PER_PIXEL = { 0: 3, 1: 3, 2: 4, 3: 4 }; // RGB, BGR, RGBA, BGRA
let lastPreviewAt = 0;

function onVideoFrame(buf, width, height, stride, pixelFormat) {
  const now = Date.now();
  if (now - lastPreviewAt < PREVIEW_INTERVAL_MS || !win || win.isDestroyed()) return;
  const bpp = BYTES_PER_PIXEL[pixelFormat];
  if (!bpp || !width || !height) return;
  lastPreviewAt = now;
  const outW = PREVIEW_WIDTH;
  const outH = Math.round((height * outW) / width);
  const out = Buffer.alloc(outW * outH * 4);
  const bgr = pixelFormat === 1 || pixelFormat === 3;
  for (let y = 0; y < outH; y++) {
    const row = Math.floor((y * height) / outH) * stride;
    for (let x = 0; x < outW; x++) {
      const i = row + Math.floor((x * width) / outW) * bpp;
      const o = (y * outW + x) * 4;
      out[o] = buf[i + (bgr ? 2 : 0)];
      out[o + 1] = buf[i + 1];
      out[o + 2] = buf[i + (bgr ? 0 : 2)];
      out[o + 3] = 255;
    }
  }
  win.webContents.send('sdk:preview', out, outW, outH);
}

function ensureSdk() {
  if (sdk) return sdk;
  sdk = new SmartSpectraSDK({ apiKey, requestedMetrics: REQUESTED_METRICS, enableTelemetry: false });
  for (const name of ['metrics', 'validationStatus', 'processingStatus', 'error', 'frameSentThrough']) {
    sdk.on(name, (...args) => sendEvent(name, ...args));
  }
  sdk.on('videoOutput', onVideoFrame);
  sdk.useCamera(cameraSelection(), CAPTURE);
  return sdk;
}

async function destroySdk() {
  if (!sdk) return;
  const old = sdk;
  sdk = null;
  try { await old.stopAsync(); } catch { /* already stopped */ }
  await old.destroy();
}

function serializeError(err) {
  return { message: err.message, code: err.code ?? null, retryable: err.retryable ?? null };
}

ipcMain.handle('sdk:start', () => {
  try {
    ensureSdk().start();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: serializeError(err) };
  }
});

ipcMain.handle('sdk:stop', async () => {
  if (sdk) await sdk.stopAsync();
});

// After an error the SDK sits in its error state; a fresh instance is the reliable way to retry.
ipcMain.handle('sdk:destroy', destroySdk);

ipcMain.handle('sdk:readiness', async () => {
  try {
    return { ok: true, result: await ensureSdk().checkDeviceReadiness() };
  } catch (err) {
    return { ok: false, error: serializeError(err) };
  }
});

ipcMain.handle('sdk:info', () => ({
  version: SmartSpectraSDK.version, hasKey: !!apiKey, cameras: listCameras(), cameraId, capture: CAPTURE,
}));

ipcMain.handle('sdk:cameras', () => listCameras());

// Camera IDs are only valid until devices change, so the list is re-read before each selection.
ipcMain.handle('sdk:setCamera', (_e, id) => {
  if (!id || !listCameras().some((c) => c.id === id)) return null;
  cameraId = id;
  if (sdk) sdk.useCamera(cameraSelection(), CAPTURE);
  return cameraId;
});

// ---------- Recordings ----------

function safeRecordingPath(name) {
  const base = path.basename(String(name));
  if (!base.endsWith('.jsonl')) throw new Error('Not a recording file');
  return path.join(recordingsDir, base);
}

const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-');

ipcMain.handle('recording:begin', () => {
  fs.mkdirSync(recordingsDir, { recursive: true });
  const name = `session-${timestamp()}.jsonl`;
  fs.writeFileSync(path.join(recordingsDir, name), '', 'utf8');
  return name;
});

ipcMain.handle('recording:append', (_e, name, text) => {
  fs.appendFileSync(safeRecordingPath(name), String(text), 'utf8');
});

// Gut Check session results: options, phase timings and the full vitals time series.
const sessionsDir = path.join(appRoot, 'sessions');

ipcMain.handle('session:save', (_e, json) => {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const name = `gutcheck-${timestamp()}.json`;
  fs.writeFileSync(path.join(sessionsDir, name), String(json), 'utf8');
  return name;
});

// The bundled sample (beach vs speech positive control, recorded by the developer, camera name redacted).
const sampleDir = path.join(appRoot, 'samples', 'beach-vs-speech');

ipcMain.handle('sample:read', () => ({
  session: fs.readFileSync(path.join(sampleDir, 'session.json'), 'utf8'),
  recording: fs.readFileSync(path.join(sampleDir, 'recording.jsonl'), 'utf8'),
}));

ipcMain.handle('session:list', () => {
  if (!fs.existsSync(sessionsDir)) return [];
  return fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json')).sort().reverse();
});

ipcMain.handle('session:read', (_e, name) => {
  const base = path.basename(String(name));
  if (!base.endsWith('.json')) throw new Error('Not a session file');
  return fs.readFileSync(path.join(sessionsDir, base), 'utf8');
});

ipcMain.handle('gutcheck:listRecordings', () => {
  if (!fs.existsSync(recordingsDir)) return [];
  return fs.readdirSync(recordingsDir).filter((f) => f.endsWith('.jsonl')).sort().reverse();
});

ipcMain.handle('gutcheck:readRecording', (_e, name) => fs.readFileSync(safeRecordingPath(name), 'utf8'));

// Dev/testing hook: GUTCHECK_AUTOREPLAY=<recording file> replays it at 10x on launch.
ipcMain.handle('gutcheck:getAutoReplay', () => process.env.GUTCHECK_AUTOREPLAY || '');

// ---------- Window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#f4efe6',
    icon: path.join(appRoot, 'assets/icon.png'),
    title: 'Gut Check',
    webPreferences: {
      preload: path.join(appRoot, 'dist/preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Mirror renderer console output into the terminal so problems are visible without DevTools.
  win.webContents.on('console-message', (event) => {
    console.log(`[renderer] ${event.message}`);
  });

  win.loadFile(path.join(appRoot, 'src/renderer/index.html'));

  // Dev/testing hook: GUTCHECK_SHOTS=<folder> saves a screenshot of the window every 2 s,
  // alternating between the top and the bottom of long pages.
  const shotsDir = process.env.GUTCHECK_SHOTS;
  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    let n = 0;
    const timer = setInterval(async () => {
      if (win.isDestroyed()) return clearInterval(timer);
      try {
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${n % 2 ? 'document.body.scrollHeight' : 0})`);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(shotsDir, `shot-${String(n++).padStart(3, '0')}.png`), img.toPNG());
      } catch {
        // The window can't be captured while minimised; try again on the next tick.
      }
    }, 2000);
  }
}

// Groups the window under its own taskbar entry and icon on Windows (instead of Electron's).
if (process.platform === 'win32') app.setAppUserModelId('com.pawanbhandari.gutcheck');

app.whenReady().then(createWindow);

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !sdk) return;
  e.preventDefault();
  quitting = true;
  destroySdk().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
