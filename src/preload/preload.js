const { contextBridge, ipcRenderer } = require('electron');

// Exposes window.__smartspectraBridge, used by the SDK's renderer module.
require('@smartspectra/node-sdk/preload');

contextBridge.exposeInMainWorld('gutCheck', {
  getApiKey: () => ipcRenderer.invoke('gutcheck:getApiKey'),
  getAutoReplay: () => ipcRenderer.invoke('gutcheck:getAutoReplay'),
  saveRecording: (text) => ipcRenderer.invoke('gutcheck:saveRecording', text),
  listRecordings: () => ipcRenderer.invoke('gutcheck:listRecordings'),
  readRecording: (name) => ipcRenderer.invoke('gutcheck:readRecording', name),
});
