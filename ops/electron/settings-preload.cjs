const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('modelSettings',Object.freeze({read:()=>ipcRenderer.invoke('settings:read'),save:value=>ipcRenderer.invoke('settings:save',value),cancel:()=>ipcRenderer.invoke('settings:cancel')}));
