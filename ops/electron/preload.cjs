const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studyLogDesktop', Object.freeze({ close: () => ipcRenderer.send('workbench:close'),
  context: () => ipcRenderer.invoke('workbench:context'), configuration: () => ipcRenderer.invoke('workbench:configuration'),
  configure: value => ipcRenderer.invoke('workbench:configure', value), probe: value => ipcRenderer.invoke('workbench:probe', value), deploymentPreview: () => ipcRenderer.invoke('workbench:deployment-preview'), deploymentRestore: value => ipcRenderer.invoke('workbench:deployment-restore', value), settingsAction: action => ipcRenderer.invoke('workbench:settings-action', action) }));

window.addEventListener('DOMContentLoaded', () => {
  const update = () => ipcRenderer.send('workbench:theme', document.documentElement.dataset.theme);
  new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  update();
});

ipcRenderer.on("workbench:help", () => window.dispatchEvent(new Event("study-log:help")));
ipcRenderer.on("workbench:settings", () => {
  const event = new Event("study-log:settings", { cancelable: true });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) ipcRenderer.send("workbench:settings-unavailable");
});
