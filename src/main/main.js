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

function ensureSdk() {
  if (sdk) return sdk;
  sdk = new SmartSpectraSDK({ apiKey, requestedMetrics: REQUESTED_METRICS, enableTelemetry: false });
  for (const name of ['metrics', 'validationStatus', 'processingStatus', 'error', 'frameSentThrough']) {
    sdk.on(name, (...args) => sendEvent(name, ...args));
  }
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
  cameraId = id && listCameras().some((c) => c.id === id) ? id : null;
  if (sdk) sdk.useCamera(cameraSelection(), CAPTURE);
  return cameraId;
});

// ---------- Recordings ----------

function safeRecordingPath(name) {
  const base = path.basename(String(name));
  if (!base.endsWith('.jsonl')) throw new Error('Not a recording file');
  return path.join(recordingsDir, base);
}

ipcMain.handle('gutcheck:saveRecording', (_e, text) => {
  fs.mkdirSync(recordingsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(recordingsDir, `session-${stamp}.jsonl`);
  fs.writeFileSync(file, text, 'utf8');
  return path.basename(file);
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
    backgroundColor: '#0f1115',
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
}

app.whenReady().then(createWindow);

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !sdk) return;
  e.preventDefault();
  quitting = true;
  destroySdk().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
