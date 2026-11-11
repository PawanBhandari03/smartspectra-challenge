const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

const appRoot = app.getAppPath();
require('dotenv').config({ path: path.join(appRoot, '.env'), quiet: true });

const recordingsDir = path.join(appRoot, 'recordings');

function safeRecordingPath(name) {
  const base = path.basename(String(name));
  if (!base.endsWith('.jsonl')) throw new Error('Not a recording file');
  return path.join(recordingsDir, base);
}

ipcMain.handle('gutcheck:getApiKey', () => process.env.PRESAGE_API_KEY || '');

// Dev/testing hook: GUTCHECK_AUTOREPLAY=<recording file> replays it at 10x on launch.
ipcMain.handle('gutcheck:getAutoReplay', () => process.env.GUTCHECK_AUTOREPLAY || '');

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

function createWindow() {
  const win = new BrowserWindow({
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

  bindSmartSpectraIpc(win);
  win.loadFile(path.join(appRoot, 'src/renderer/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
