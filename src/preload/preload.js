const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gutCheck', {
  sdk: {
    info: () => ipcRenderer.invoke('sdk:info'),
    start: () => ipcRenderer.invoke('sdk:start'),
    stop: () => ipcRenderer.invoke('sdk:stop'),
    destroy: () => ipcRenderer.invoke('sdk:destroy'),
    readiness: () => ipcRenderer.invoke('sdk:readiness'),
    onEvent: (callback) => {
      ipcRenderer.removeAllListeners('sdk:event');
      ipcRenderer.on('sdk:event', (_e, name, ...args) => callback(name, ...args));
    },
  },
  saveRecording: (text) => ipcRenderer.invoke('gutcheck:saveRecording', text),
  listRecordings: () => ipcRenderer.invoke('gutcheck:listRecordings'),
  readRecording: (name) => ipcRenderer.invoke('gutcheck:readRecording', name),
  getAutoReplay: () => ipcRenderer.invoke('gutcheck:getAutoReplay'),
});
