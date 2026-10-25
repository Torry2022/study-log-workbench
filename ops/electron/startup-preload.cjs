const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('startup', {
  close: () => ipcRenderer.send('startup:close'),
  onShow: callback => ipcRenderer.once('startup:show', () => callback()),
  onMessage: callback => ipcRenderer.on('startup:message', (_event, message) => callback(message))
});
