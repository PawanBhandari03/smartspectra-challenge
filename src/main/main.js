const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { SmartSpectraSDK, CameraSelection } = require('@smartspectra/node-sdk');
const { REQUESTED_METRICS } = require('../core/metrics');

const appRoot = app.getAppPath();

// In development the key comes from .env and data lives in the project folder. An installed app
// can't write inside its own (read-only) package, so it uses the per-user app data folder and a
// key saved (encrypted) from Settings.
if (!app.isPackaged) require('dotenv').config({ path: path.join(appRoot, '.env'), quiet: true });
const dataRoot = app.isPackaged ? app.getPath('userData') : appRoot;
const recordingsDir = path.join(dataRoot, 'recordings');
const sessionsDir = path.join(dataRoot, 'sessions');
const keyFile = path.join(app.getPath('userData'), 'presage-key.bin');
const CAPTURE = { width: 1280, height: 720, fps: 30 };

// The saved key is decrypted once at startup and kept in memory.
let savedKey = '';

async function loadSavedKey() {
  try {
    if (!fs.existsSync(keyFile) || !(await safeStorage.isAsyncEncryptionAvailable())) return;
    savedKey = (await safeStorage.decryptStringAsync(fs.readFileSync(keyFile))).result;
  } catch {
    savedKey = '';
  }
}

function apiKey() {
  return process.env.PRESAGE_API_KEY || savedKey;
}

function keySource() {
  if (process.env.PRESAGE_API_KEY) return 'env';
  return savedKey ? 'saved' : 'none';
}

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
  sdk = new SmartSpectraSDK({ apiKey: apiKey(), requestedMetrics: REQUESTED_METRICS, enableTelemetry: false });
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
  version: SmartSpectraSDK.version, hasKey: !!apiKey(), cameras: listCameras(), cameraId, capture: CAPTURE,
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
function safeSessionPath(name) {
  const base = path.basename(String(name));
  if (!base.endsWith('.json')) throw new Error('Not a session file');
  return path.join(sessionsDir, base);
}

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

ipcMain.handle('session:read', (_e, name) => fs.readFileSync(safeSessionPath(name), 'utf8'));

// Records what the person actually decided, after the fact. Only this one field can be changed.
ipcMain.handle('session:setChoice', (_e, name, choice) => {
  const file = safeSessionPath(name);
  const session = JSON.parse(fs.readFileSync(file, 'utf8'));
  session.choice = choice
    ? { optionIndex: choice.optionIndex ?? null, note: String(choice.note || '').slice(0, 500), at: new Date().toISOString() }
    : null;
  fs.writeFileSync(file, JSON.stringify(session), 'utf8');
  return session.choice;
});

// Deletes a session and the raw recording it was made from.
ipcMain.handle('session:delete', (_e, name) => {
  const file = safeSessionPath(name);
  if (!fs.existsSync(file)) return;
  let recording = null;
  try { recording = JSON.parse(fs.readFileSync(file, 'utf8')).recording; } catch { /* unreadable session */ }
  fs.rmSync(file);
  if (recording) fs.rmSync(safeRecordingPath(recording), { force: true });
});

// ---------- Settings & data ----------

ipcMain.handle('settings:get', async () => ({
  keySource: keySource(),
  encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
  dataDir: dataRoot,
  telemetry: false,
}));

ipcMain.handle('settings:saveKey', async (_e, key) => {
  const value = String(key || '').trim();
  if (!value) throw new Error('The key is empty');
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Secure storage is not available on this computer');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, await safeStorage.encryptStringAsync(value));
  savedKey = value;
  await destroySdk(); // the next measurement starts with the new key
  return keySource();
});

ipcMain.handle('settings:removeKey', async () => {
  fs.rmSync(keyFile, { force: true });
  savedKey = '';
  await destroySdk();
  return keySource();
});

ipcMain.handle('data:openFolder', () => shell.openPath(dataRoot));

ipcMain.handle('data:deleteAll', () => {
  fs.rmSync(sessionsDir, { recursive: true, force: true });
  fs.rmSync(recordingsDir, { recursive: true, force: true });
});

ipcMain.handle('gutcheck:listRecordings', () => {
  if (!fs.existsSync(recordingsDir)) return [];
  return fs.readdirSync(recordingsDir).filter((f) => f.endsWith('.jsonl')).sort().reverse();
});

ipcMain.handle('gutcheck:readRecording', (_e, name) => fs.readFileSync(safeRecordingPath(name), 'utf8'));

// Dev/testing hook: GUTCHECK_AUTOREPLAY=<recording file> replays it at 10x on launch.
ipcMain.handle('gutcheck:getAutoReplay', () => (app.isPackaged ? '' : process.env.GUTCHECK_AUTOREPLAY || ''));

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
  const shotsDir = app.isPackaged ? null : process.env.GUTCHECK_SHOTS;
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

app.whenReady().then(loadSavedKey).then(createWindow);

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !sdk) return;
  e.preventDefault();
  quitting = true;
  destroySdk().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
