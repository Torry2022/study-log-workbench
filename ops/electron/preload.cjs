const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studyLogDesktop', Object.freeze({ close: () => ipcRenderer.send('workbench:close') }));
