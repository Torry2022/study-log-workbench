const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('startup', {
  close: () => ipcRenderer.send('startup:close'),
  onMessage: callback => ipcRenderer.on('startup:message', (_event, message) => callback(message))
});
