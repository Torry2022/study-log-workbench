const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('historySettings',Object.freeze({read:()=>ipcRenderer.invoke('history:read'),save:value=>ipcRenderer.invoke('history:save',value),cancel:()=>ipcRenderer.invoke('history:cancel')}));
