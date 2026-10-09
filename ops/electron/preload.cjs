const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studyLogDesktop', Object.freeze({ close: () => ipcRenderer.send('workbench:close') }));

window.addEventListener('DOMContentLoaded', () => {
  const update = () => ipcRenderer.send('workbench:theme', document.documentElement.dataset.theme);
  new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  update();
});

ipcRenderer.on("workbench:help", () => window.dispatchEvent(new Event("study-log:help")));
