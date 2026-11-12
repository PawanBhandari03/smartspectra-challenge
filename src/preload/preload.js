const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gutCheck', {
  sdk: {
    info: () => ipcRenderer.invoke('sdk:info'),
    cameras: () => ipcRenderer.invoke('sdk:cameras'),
    setCamera: (id) => ipcRenderer.invoke('sdk:setCamera', id),
    start: () => ipcRenderer.invoke('sdk:start'),
    stop: () => ipcRenderer.invoke('sdk:stop'),
    destroy: () => ipcRenderer.invoke('sdk:destroy'),
    readiness: () => ipcRenderer.invoke('sdk:readiness'),
    onPreview: (callback) => {
      ipcRenderer.removeAllListeners('sdk:preview');
      ipcRenderer.on('sdk:preview', (_e, pixels, width, height) => callback(pixels, width, height));
    },
    onEvent: (callback) => {
      ipcRenderer.removeAllListeners('sdk:event');
      ipcRenderer.on('sdk:event', (_e, name, ...args) => callback(name, ...args));
    },
  },
  recording: {
    begin: () => ipcRenderer.invoke('recording:begin'),
    append: (name, text) => ipcRenderer.invoke('recording:append', name, text),
  },
  saveSession: (json) => ipcRenderer.invoke('session:save', json),
  listSessions: () => ipcRenderer.invoke('session:list'),
  readSample: () => ipcRenderer.invoke('sample:read'),
  readSession: (name) => ipcRenderer.invoke('session:read', name),
  listRecordings: () => ipcRenderer.invoke('gutcheck:listRecordings'),
  readRecording: (name) => ipcRenderer.invoke('gutcheck:readRecording', name),
  getAutoReplay: () => ipcRenderer.invoke('gutcheck:getAutoReplay'),
});
